/*
 *  The MIT License (MIT)
 *
 * Copyright (c) 2016-2024 The Regents of the University of California
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
 * following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial
 * portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,  FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 */

/**
 * LiveMapDataset implementation for dynamically generated contact maps
 * (e.g., from Spacewalk 3D chromatin tracing data)
 * 
 * @author Turner
 */

import Dataset from './hicDataset.js'

/**
 * Convert 2D array of contact totals to contact record format
 * @param {Array<Array<number>>} contactMatrix - 2D array [bin1][bin2] = count
 * @param {number} binSize - Bin size in base pairs
 * @returns {Array<Object>} Array of contact records with {bin1, bin2, counts, getKey()}
 */
function convert2DArrayToContactRecords(contactMatrix, binSize) {
    const records = [];
    for (let bin1 = 0; bin1 < contactMatrix.length; bin1++) {
        if (!contactMatrix[bin1]) continue;
        for (let bin2 = 0; bin2 < contactMatrix[bin1].length; bin2++) {
            const count = contactMatrix[bin1][bin2];
            if (count > 0) {
                records.push({
                    bin1: bin1,
                    bin2: bin2,
                    counts: count,
                    getKey: function() {
                        // Symmetric key for contact matrix
                        return bin1 <= bin2 ? `${bin1}_${bin2}` : `${bin2}_${bin1}`;
                    }
                });
            }
        }
    }
    return records;
}

/**
 * Create a simple Matrix-like object for live maps
 */
class LiveMapMatrix {
    constructor(chr1, chr2, zoomData) {
        this.chr1 = chr1;
        this.chr2 = chr2;
        this.zoomData = zoomData;
    }

    getZoomDataByIndex(zoomIndex, unit) {
        // For live maps, we typically only have one resolution
        // Return the zoom data if index matches, otherwise return the first one
        if (this.zoomData && (zoomIndex === 0 || !this.zoomData.zoom)) {
            return this.zoomData;
        }
        // If zoom index doesn't match, return the only available zoom data
        return this.zoomData;
    }
}

/**
 * LiveMapDataset - implements Dataset interface for live/computed contact maps
 */
class LiveMapDataset extends Dataset {

    constructor(config) {
        super(config);
        this.datasetType = 'livemap';
        
        // Required config properties
        this.genomeId = config.genomeId;
        this.chromosomes = config.chromosomes || [];
        this.bpResolutions = config.bpResolutions || [config.binSize || 1000000];
        this.name = config.name || 'Live Map';
        
        // Contact data - can be provided as contactRecordList or 2D array
        this.contactRecordList = config.contactRecordList || [];
        this.contactMatrix = config.contactMatrix; // 2D array format
        
        // If 2D array provided, convert to contact records
        if (this.contactMatrix && this.contactRecordList.length === 0) {
            const binSize = config.binSize || this.bpResolutions[0];
            this.contactRecordList = convert2DArrayToContactRecords(this.contactMatrix, binSize);
        }
        
        // Store contact records in a Map for efficient lookup
        this.contactRecordMap = new Map();
        this.contactRecordList.forEach(record => {
            const key = record.getKey ? record.getKey() : `${record.bin1}_${record.bin2}`;
            this.contactRecordMap.set(key, record);
        });
        
        // Normalization support (limited for live maps)
        this.normalizationTypes = ['NONE'];
        this.wholeGenomeChromosome = null;
        this.wholeGenomeResolution = null;
    }

    async init() {
        // Live maps are typically pre-initialized, but we can validate here
        if (!this.chromosomes || this.chromosomes.length === 0) {
            throw new Error("LiveMapDataset requires chromosomes array");
        }
        if (this.bpResolutions.length === 0) {
            throw new Error("LiveMapDataset requires at least one resolution");
        }
    }

    async getContactRecords(normalization, region1, region2, units, binsize) {
        // For live maps, normalization is typically not supported
        if (normalization !== 'NONE') {
            console.warn(`Normalization ${normalization} not supported for live maps, using NONE`);
        }
        
        // Calculate bin ranges for the regions
        const chr1Index = this.getChrIndexFromName(region1.chr);
        const chr2Index = this.getChrIndexFromName(region2.chr);
        
        if (chr1Index === undefined || chr2Index === undefined) {
            return [];
        }
        
        const startBin1 = Math.floor(region1.start / binsize);
        const endBin1 = Math.ceil(region1.end / binsize);
        const startBin2 = Math.floor(region2.start / binsize);
        const endBin2 = Math.ceil(region2.end / binsize);
        
        // Filter contact records within the region
        const records = [];
        for (const record of this.contactRecordList) {
            if (record.bin1 >= startBin1 && record.bin1 < endBin1 &&
                record.bin2 >= startBin2 && record.bin2 < endBin2) {
                records.push(record);
            }
            // Also check symmetric pairs (bin2, bin1) for same chromosome
            if (chr1Index === chr2Index && 
                record.bin2 >= startBin1 && record.bin2 < endBin1 &&
                record.bin1 >= startBin2 && record.bin1 < endBin2) {
                // Add symmetric record if not already included
                const key = record.getKey ? record.getKey() : `${record.bin2}_${record.bin1}`;
                if (!this.contactRecordMap.has(key)) {
                    records.push({
                        bin1: record.bin2,
                        bin2: record.bin1,
                        counts: record.counts,
                        getKey: function() {
                            return record.bin1 <= record.bin2 ? `${record.bin1}_${record.bin2}` : `${record.bin2}_${record.bin1}`;
                        }
                    });
                }
            }
        }
        
        return records;
    }

    async getMatrix(chr1, chr2) {
        const chr1Obj = this.chromosomes[chr1];
        const chr2Obj = this.chromosomes[chr2];
        
        if (!chr1Obj || !chr2Obj) {
            throw new Error(`Invalid chromosome indices: ${chr1}, ${chr2}`);
        }
        
        // Get the first available resolution (live maps typically have one)
        const binSize = this.bpResolutions[0];
        
        // Calculate average count for this chromosome pair
        let totalCount = 0;
        let recordCount = 0;
        for (const record of this.contactRecordList) {
            totalCount += record.counts;
            recordCount++;
        }
        const averageCount = recordCount > 0 ? totalCount / recordCount : 1;
        
        const zoomData = {
            chr1: chr1Obj,
            chr2: chr2Obj,
            zoom: {
                binSize: binSize,
                unit: 'BP'
            },
            averageCount: averageCount
        };
        
        return new LiveMapMatrix(chr1Obj, chr2Obj, zoomData);
    }

    async hasNormalizationVector(type, chr, unit, binSize) {
        // Live maps don't support normalization vectors
        return false;
    }

    clearCaches() {
        // Live maps don't have caches that need clearing
    }

    /**
     * Update contact records (useful for dynamic updates)
     * @param {Array|Array<Array<number>>} data - Contact records or 2D array
     * @param {number} binSize - Bin size if data is 2D array
     */
    updateContactRecords(data, binSize) {
        if (Array.isArray(data[0]) && typeof data[0][0] === 'number') {
            // 2D array format
            this.contactMatrix = data;
            this.contactRecordList = convert2DArrayToContactRecords(data, binSize || this.bpResolutions[0]);
        } else {
            // Contact record list format
            this.contactRecordList = data;
        }
        
        // Rebuild map
        this.contactRecordMap.clear();
        this.contactRecordList.forEach(record => {
            const key = record.getKey ? record.getKey() : `${record.bin1}_${record.bin2}`;
            this.contactRecordMap.set(key, record);
        });
    }
}

export default LiveMapDataset

