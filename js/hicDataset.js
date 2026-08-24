/*
 *  The MIT License (MIT)
 *
 * Copyright (c) 2016-2020 The Regents of the University of California
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
 * @author Jim Robinson
 */

import {isFile} from "./fileUtils.js"
import {getUrlMapper} from "./urlMapper.js"
import Straw from 'hic-straw'
import {SENTINEL_ZOOM} from './sentinelZoom.js'

const knownGenomes = {

    "hg19": [249250621, 243199373, 198022430],
    "hg38": [248956422, 242193529, 198295559],
    "mm10": [195471971, 182113224, 160039680],
    "mm9": [197195432, 181748087, 159599783],
    "dm6": [23513712, 25286936, 28110227]

}

/**
 * Abstract base class for all dataset types (Hi-C files, live maps, etc.)
 * Defines the common interface that all dataset implementations must provide.
 */
class Dataset {

    constructor(config) {
        this.name = config.name;

        // Where 'unknown' comes from: a subclass that names no type. It is a
        // published value hosts must handle rather than a bug to throw on --
        // see CONTEXT.md under "Dataset", and #471.
        this.datasetType = config.datasetType || 'unknown';
    }

    /**
     * Initialize the dataset. Must be called after construction.
     * @abstract
     */
    async init() {
        throw new Error("Dataset.init() must be implemented by subclass");
    }

    /**
     * Get contact records for a given region pair
     * @param {string} normalization - Normalization type
     * @param {Object} region1 - {chr, start, end}
     * @param {Object} region2 - {chr, start, end}
     * @param {string} units - "BP" or "FRAG"
     * @param {number} binsize - Bin size in base pairs
     * @returns {Promise<Array>} Array of contact records
     * @abstract
     */
    async getContactRecords(normalization, region1, region2, units, binsize) {
        throw new Error("Dataset.getContactRecords() must be implemented by subclass");
    }

    /**
     * Get matrix for chromosome pair
     * @param {number} chr1 - Chromosome index 1
     * @param {number} chr2 - Chromosome index 2
     * @returns {Promise<Object>} Matrix object
     * @abstract
     */
    async getMatrix(chr1, chr2) {
        throw new Error("Dataset.getMatrix() must be implemented by subclass");
    }

    /**
     * Check if normalization vector is available
     * @param {string} type - Normalization type
     * @param {string} chr - Chromosome name
     * @param {string} unit - "BP" or "FRAG"
     * @param {number} binSize - Bin size
     * @returns {Promise<boolean>}
     * @abstract
     */
    async hasNormalizationVector(type, chr, unit, binSize) {
        throw new Error("Dataset.hasNormalizationVector() must be implemented by subclass");
    }

    /**
     * Get zoom index for a given bin size
     * @param {number} binSize - Bin size in base pairs
     * @param {string} unit - "BP" or "FRAG"
     * @returns {number} Zoom index or -1 if not found
     */
    getZoomIndexForBinSize(binSize, unit) {
        var i,
            resolutionArray;

        unit = unit || "BP";

        if (unit === "BP") {
            resolutionArray = this.bpResolutions;
        } else if (unit === "FRAG") {
            resolutionArray = this.fragResolutions;
        } else {
            throw new Error("Invalid unit: " + unit);
        }

        for (i = 0; i < resolutionArray.length; i++) {
            if (resolutionArray[i] === binSize) return i;
        }

        return -1;
    }

    /**
     * Get bin size for a given zoom index
     * @param {number} zoomIndex - Zoom index
     * @param {string} unit - "BP" or "FRAG"
     * @returns {number} Bin size in base pairs
     */
    getBinSizeForZoomIndex(zoomIndex, unit) {
        var i,
            resolutionArray;

        unit = unit || "BP";

        if (unit === "BP") {
            resolutionArray = this.bpResolutions;
        } else if (unit === "FRAG") {
            resolutionArray = this.fragResolutions;
        } else {
            throw new Error("Invalid unit: " + unit);
        }

        return resolutionArray[zoomIndex];
    }

    /**
     * Get chromosome index from name
     * @param {string} chrName - Chromosome name
     * @returns {number|undefined} Chromosome index
     */
    getChrIndexFromName(chrName) {
        var i;
        for (i = 0; i < this.chromosomes.length; i++) {
            if (chrName === this.chromosomes[i].name) return i;
        }
        return undefined;
    }

    /**
     * Compare chromosomes with another dataset
     * @param {Dataset} otherDataset - Other dataset to compare
     * @returns {boolean} True if chromosomes match
     */
    compareChromosomes(otherDataset) {
        const chrs = this.chromosomes;
        const otherChrs = otherDataset.chromosomes;
        if (chrs.length !== otherChrs.length) {
            return false;
        }
        for (let i = 0; i < chrs.length; i++) {
            if (chrs[i].size !== otherChrs[i].size) {
                return false;
            }
        }
        return true;
    }

    /**
     * Check if chromosome index represents whole genome
     * @param {number} chrIndex - Chromosome index
     * @returns {boolean}
     */
    isWholeGenome(chrIndex) {
        return (this.wholeGenomeChromosome != null && this.wholeGenomeChromosome.index === chrIndex);
    }

    /**
     * True when the assembly holds the `All` pseudo-chromosome and exactly one
     * real chromosome, so the whole-genome view and that chromosome describe the
     * same picture.
     *
     * `All` is identified by `wholeGenomeChromosome` identity rather than by the
     * name test `genome.js:49` and `ruler.js:93` use. The predicate gates a
     * change of vocabulary, and it must stay false for every real genome --
     * a two-entry chromosome table is the whole claim. ADR-0010.
     */
    isSingleChromosome() {
        return this.wholeGenomeChromosome != null && this.chromosomes.length === 2;
    }

    /**
     * The one real chromosome of a single-chromosome assembly -- the scaffold
     * `All` is a duplicate of. Undefined for every other dataset.
     */
    soleChromosome() {
        if (!this.isSingleChromosome()) return undefined;
        return this.chromosomes.find(chr => chr !== this.wholeGenomeChromosome);
    }

    /**
     * Bin size in bp for a zoom index, the sentinel rung included.
     *
     * At the sentinel the answer is `wholeGenomeResolution`, which is the
     * whole-genome bin expressed in bp rather than in the kb the whole-genome
     * matrix stores its own coordinates in. For a one-chromosome genome the
     * cumulative offset is zero, so that bin divides the sole scaffold's bp
     * exactly -- ADR-0010 fact 4, and the reason this is a unit match rather
     * than a conversion.
     */
    binSizeForZoom(zoom) {
        return SENTINEL_ZOOM === zoom ? this.wholeGenomeResolution : this.bpResolutions[zoom];
    }

    /**
     * The matrix coordinates and resolution index that carry a view's *data*.
     *
     * Identity for a declared rung. At the sentinel it answers with the
     * whole-genome matrix at its only resolution: the rung is synthesised, but
     * the data behind it is the `All` matrix, queried in the `All` matrix's own
     * coordinates exactly as the whole-genome view queries it today.
     *
     * This is why `imageTileSource`'s `0 === zd.chr1.index` stays true at the
     * sentinel while `browser.isWholeGenome()` is false. The two whole-genome
     * tests are divergent **by design** -- ADR-0010 decisions 3 and 4. Do not
     * "fix" them into agreement.
     */
    matrixViewForZoom(chr1, chr2, zoom) {
        if (SENTINEL_ZOOM !== zoom) {
            return {chr1, chr2, zoomIndex: zoom};
        }
        const {index} = this.wholeGenomeChromosome;
        return {chr1: index, chr2: index, zoomIndex: 0};
    }

    /**
     * Clear any internal caches
     */
    clearCaches() {
        // Default implementation - subclasses can override
    }

    /**
     * Compare 2 datasets for compatibility.  Compatibility is defined as from the same assembly, even if
     * different IDs are used (e.g. GRCh38 vs hg38).
     *
     * Trust the ID for well-known assemblies (hg19, etc).  However, for others compare chromosome lengths
     * as its been observed that uniqueness of ID is not guaranteed.
     *
     * @param {Dataset} d2 - Other dataset to compare
     * @returns {boolean} True if compatible
     */
    isCompatible(d2) {
        const id1 = this.genomeId;
        const id2 = d2.genomeId;
        return ((id1 === "hg38" || id1 === "GRCh38") && (id2 === "hg38" || id2 === "GRCh38")) ||
            ((id1 === "hg19" || id1 === "GRCh37") && (id2 === "hg19" || id2 === "GRCh37")) ||
            ((id1 === "mm10" || id1 === "GRCm38") && (id2 === "mm10" || id2 === "GRCm38")) ||
            this.compareChromosomes(d2)
    }
}

/**
 * HiCDataset implementation for static .hic files
 */
class HiCDataset extends Dataset {

    constructor(config) {
        super(config);

        // A mapper registered via setUrlMapper applies to every read unless this caller supplied
        // one of its own. See js/urlMapper.js.
        const mapUrl = config.mapUrl || getUrlMapper()
        this.straw = new Straw(mapUrl ? {...config, mapUrl} : config)
        this.isLive = Boolean(config.liveContactMap);

        // The two concrete kinds. `isLive` is the field hosts branch on
        // (Spacewalk does); `datasetType` is the same answer spelled for the
        // onMapLoaded payload, and the two cannot be allowed to disagree.
        this.datasetType = this.isLive ? 'live' : 'hic';
    }

    async init() {

        this.hicFile = this.straw.hicFile;
        await this.hicFile.init();
        this.normalizationTypes = ['NONE'];

        this.genomeId = this.hicFile.genomeId
        this.chromosomes = this.hicFile.chromosomes
        this.bpResolutions = this.hicFile.bpResolutions
        this.wholeGenomeChromosome = this.hicFile.wholeGenomeChromosome
        this.wholeGenomeResolution = this.hicFile.wholeGenomeResolution

        // Attempt to determine genomeId if not recognized
        const tmp = matchGenome(this.chromosomes);
        if (tmp) this.genomeId = tmp;
    }

    async getContactRecords(normalization, region1, region2, units, binsize) {
        return this.straw.getContactRecords(normalization, region1, region2, units, binsize)
    }

    async hasNormalizationVector(type, chr, unit, binSize) {
        return this.straw.hicFile.hasNormalizationVector(type, chr, unit, binSize);
    }

    clearCaches() {
        this.colorScaleCache = {};
    }

    async getMatrix(chr1, chr2) {
        return this.hicFile.getMatrix(chr1, chr2)
    }

    async getNormVectorIndex() {
        return this.hicFile.getNormVectorIndex()
    }

    async getNormalizationOptions() {
        return this.hicFile.getNormalizationOptions()
    }

    /**
     * Factory method to load a Hi-C dataset from a file
     * @param {Object} config - Configuration object with url, name, etc.
     * @returns {Promise<HiCDataset>}
     */
    static async loadDataset(config) {

        // If this is a local file, use the "blob" field for straw
        if (isFile(config.url)) {
            config.blob = config.url
            delete config.url
        }

        const dataset = new HiCDataset(config)
        await dataset.init();
        dataset.url = config.url
        return dataset
    }
}

// For backward compatibility, export Dataset as the default and alias HiCDataset
// Existing code using Dataset.loadDataset() will continue to work
Dataset.loadDataset = HiCDataset.loadDataset;

function matchGenome(chromosomes) {

    if (chromosomes.length < 4) return undefined;

    const keys = Object.keys(knownGenomes);

    // Find a candidate
    let candidate;
    for (let chr of chromosomes) {
        for (let key of keys) {
            if (knownGenomes[key].includes(chr.size)) {
                candidate = key;
                break;
            }
        }
    }

    // Confirm candidate
    if (candidate) {
        const chrSizes = new Set(chromosomes.map((chr) => chr.size));
        for (let sz of knownGenomes[candidate]) {
            if (!chrSizes.has(sz)) {
                return undefined;
            }
        }
        return candidate;
    } else {
        return undefined;
    }


}

export default Dataset
export { HiCDataset }
