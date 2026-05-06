/*
 *  The MIT License (MIT)
 *
 * Copyright (c) 2016-2017 The Regents of the University of California
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

import {DEFAULT_PIXEL_SIZE, MAX_PIXEL_SIZE} from "./hicBrowser.js"

class State {

    constructor(chr1, chr2, zoom, x, y, pixelSize, normalization) {
        if (chr1 <= chr2) {
            this.chr1 = chr1;
            this['x'] = x;

            this.chr2 = chr2;
            this['y'] = y;
        } else {
            // Transpose
            this.chr1 = chr2;
            this['x'] = y;

            this.chr2 = chr1;
            this['y'] = x;
        }

        this.zoom = zoom;

        if (undefined === normalization) {
            normalization = 'NONE';
        }
        this.normalization = normalization;

        if (typeof pixelSize === 'string') {
            const parsed = parseFloat(pixelSize);
            pixelSize = isNaN(parsed) ? 1 : parsed;
        } else if (typeof pixelSize !== 'number' || Number.isNaN(pixelSize) || pixelSize <= 0) {
            pixelSize = 1;
        }
        this.pixelSize = pixelSize;
    }

    /**
     * Detect if resolution changed.
     * 
     * @param {number} newZoom - New zoom index
     * @returns {boolean} - True if resolution changed
     */
    _detectResolutionChange(newZoom) {
        return this.zoom !== newZoom;
    }

    /**
     * Detect if chromosome changed.
     * 
     * @param {number} newChr1 - New chromosome 1 index
     * @param {number} newChr2 - New chromosome 2 index
     * @returns {boolean} - True if chromosome changed
     */
    _detectChromosomeChange(newChr1, newChr2) {
        return this.chr1 !== newChr1 || this.chr2 !== newChr2;
    }

    /**
     * Adjust pixel size with validation and clamping.
     * Centralizes pixel size adjustment logic.
     * 
     * @param {number} targetPixelSize - Target pixel size (or undefined if calculating from bpPerPixelTarget)
     * @param {Object} browser - Browser instance
     * @param {number} zoom - Zoom index
     * @param {Object} options - Adjustment options
     * @param {number} [options.minPixelSize] - Pre-calculated minimum pixel size (if provided, won't call browser.minPixelSize)
     * @param {number} [options.bpPerPixelTarget] - Base pairs per pixel target (for calculation mode)
     * @param {number} [options.binSize] - Bin size for calculation (required if bpPerPixelTarget provided)
     * @param {boolean} [options.useDefaultMin=false] - Whether to use DEFAULT_PIXEL_SIZE as minimum (for setWithZoom pattern)
     * @returns {Promise<number>} - Adjusted pixel size
     */
    async _adjustPixelSize(targetPixelSize, browser, zoom, options = {}) {
        const { minPixelSize, bpPerPixelTarget, binSize, useDefaultMin = false } = options;
        
        let adjustedPixelSize;

        // If bpPerPixelTarget and binSize are provided, calculate from them
        if (bpPerPixelTarget !== undefined && binSize !== undefined) {
            adjustedPixelSize = binSize / bpPerPixelTarget;
        } else {
            adjustedPixelSize = targetPixelSize;
        }

        // Clamp to minimum of 1
        adjustedPixelSize = Math.max(1, adjustedPixelSize);

        // Get minimum pixel size from browser if not provided
        let actualMinPixelSize = minPixelSize;
        if (actualMinPixelSize === undefined && browser) {
            actualMinPixelSize = await browser.minPixelSize(this.chr1, this.chr2, zoom);
        }

        // Apply minimum pixel size constraint
        if (actualMinPixelSize !== undefined) {
            if (useDefaultMin) {
                // For setWithZoom pattern: use max of DEFAULT_PIXEL_SIZE and minPixelSize
                adjustedPixelSize = Math.max(DEFAULT_PIXEL_SIZE, actualMinPixelSize);
            } else {
                // For other patterns: use max of current value and minPixelSize
                adjustedPixelSize = Math.max(adjustedPixelSize, actualMinPixelSize);
            }
        } else if (useDefaultMin) {
            // If no minPixelSize but useDefaultMin is true, use DEFAULT_PIXEL_SIZE
            adjustedPixelSize = Math.max(DEFAULT_PIXEL_SIZE, adjustedPixelSize);
        }

        // Clamp to MAX_PIXEL_SIZE
        adjustedPixelSize = Math.min(MAX_PIXEL_SIZE, adjustedPixelSize);

        return adjustedPixelSize;
    }

    /**
     * Finalize state update with validation.
     * Standardizes post-update validation workflow.
     * 
     * @param {Object} browser - Browser instance
     * @param {Object} dataset - Dataset instance
     * @param {Object} viewDimensions - View dimensions {width, height}
     * @param {Object} options - Finalization options
     * @param {boolean} [options.clampXY=true] - Whether to clamp XY coordinates
     */
    _finalizeUpdate(browser, dataset, viewDimensions, options = {}) {
        const { clampXY = true } = options;

        if (clampXY) {
            this.clampXY(dataset, viewDimensions);
        }
    }

    /**
     * The single canonical mutation entry point for State. All seven legacy mutation
     * paths (updateWithLoci, panShift, panWithZoom, setWithZoom, sync,
     * zoomAndCenter's inline path, setChromosomes's inline path) are migrated to
     * delegate here.
     *
     * Inputs are the canonical six. Translators are responsible for converting their
     * domain-specific inputs (BP loci, dx/dy deltas, anchor pixels, peer-sync targets)
     * into these.
     *
     * @param {number} chr1 - Chromosome 1 index. Caller is responsible for ordering
     *                        (chr1 <= chr2) when that matters.
     * @param {number} chr2 - Chromosome 2 index.
     * @param {number} x - Bin position on x axis.
     * @param {number} y - Bin position on y axis.
     * @param {number} zoom - Zoom level (index into bpResolutions).
     * @param {number} [pixelSize] - Target pixelSize. May be undefined when
     *                               options.useDefaultMin is true (DEFAULT_PIXEL_SIZE
     *                               floor is applied without a target — preserves the
     *                               resolution-selector-only behavior).
     * @param {Object} browser - For minPixelSize lookup.
     * @param {Object} dataset - For clampXY.
     * @param {Object} viewDimensions - {width, height} for clampXY.
     * @param {Object} [options]
     * @param {boolean} [options.useDefaultMin=false] - Use DEFAULT_PIXEL_SIZE as floor
     *                                                   (resolution-selector path only).
     * @param {number}  [options.minPixelSize] - Override browser.minPixelSize lookup
     *                                            (caller has already computed it).
     * @param {boolean} [options.clampXY=true] - Whether to clamp x/y to chromosome bounds.
     * @returns {Promise<{chrChanged: boolean, resolutionChanged: boolean}>}
     */
    async setView(chr1, chr2, x, y, zoom, pixelSize, browser, dataset, viewDimensions, options = {}) {
        const { useDefaultMin = false, minPixelSize, clampXY = true } = options;

        const chrChanged = this._detectChromosomeChange(chr1, chr2);
        const resolutionChanged = this._detectResolutionChange(zoom);

        // Adjust pixelSize BEFORE mutating chr1/chr2 — preserves the existing convention
        // that browser.minPixelSize is consulted with the pre-mutation chr1/chr2 (and the
        // post-mutation zoom).
        const adjustedPixelSize = await this._adjustPixelSize(pixelSize, browser, zoom, { useDefaultMin, minPixelSize });

        this.chr1 = chr1;
        this.chr2 = chr2;
        this.zoom = zoom;
        this.x = x;
        this.y = y;
        this.pixelSize = adjustedPixelSize;

        this._finalizeUpdate(browser, dataset, viewDimensions, { clampXY });

        return { chrChanged, resolutionChanged };
    }

    clampXY(dataset, viewDimensions) {
        const { width, height } = viewDimensions
        const { chromosomes, bpResolutions } = dataset;

        const binSize = bpResolutions[this.zoom];
        const maxX = Math.max(0, chromosomes[this.chr1].size / binSize -  width / this.pixelSize);
        const maxY = Math.max(0, chromosomes[this.chr2].size / binSize - height / this.pixelSize);

        this.x = Math.min(Math.max(0, this.x), maxX);
        this.y = Math.min(Math.max(0, this.y), maxY);
    }

    async panWithZoom(zoom, pixelSize, anchorPx, anchorPy, binSize, browser, dataset, viewDimensions, bpResolutions){

        // Adjust pixel size with minimum constraint
        pixelSize = await this._adjustPixelSize(pixelSize, browser, zoom)

        // Genomic anchor  -- this position should remain at anchorPx, anchorPy after state change
        const gx = (this.x + anchorPx / this.pixelSize) * bpResolutions[this.zoom].binSize
        const gy = (this.y + anchorPy / this.pixelSize) * bpResolutions[this.zoom].binSize

        this.x = gx / binSize - anchorPx / pixelSize
        this.y = gy / binSize - anchorPy / pixelSize

        this.zoom = zoom
        this.pixelSize = pixelSize

        this._finalizeUpdate(browser, dataset, viewDimensions, { clampXY: true })

    }

    panShift(dx, dy, browser, dataset, viewDimensions) {

        this.x += (dx / this.pixelSize)
        this.y += (dy / this.pixelSize)

        this._finalizeUpdate(browser, dataset, viewDimensions, { clampXY: true })

    }

    async setWithZoom(zoom, viewDimensions, browser, dataset){

        const {width, height} = viewDimensions

        // bin = bin + pixel * bin/pixel = bin
        const xCenter = this.x + (width/2) / this.pixelSize
        const yCenter = this.y + (height/2) / this.pixelSize

        const binSize = dataset.bpResolutions[this.zoom]
        const binSizeNew = dataset.bpResolutions[zoom]

        const scaleFactor = binSize / binSizeNew

        const xCenterNew = xCenter * scaleFactor
        const yCenterNew = yCenter * scaleFactor

        const resolutionChanged = this._detectResolutionChange(zoom)

        // Adjust pixel size with DEFAULT_PIXEL_SIZE minimum
        const minPixelSize = await browser.minPixelSize(this.chr1, this.chr2, zoom)
        this.pixelSize = await this._adjustPixelSize(undefined, browser, zoom, { minPixelSize, useDefaultMin: true })

        this.zoom = zoom
        this.x = Math.max(0, xCenterNew - width / (2 * this.pixelSize))
        this.y = Math.max(0, yCenterNew - height / (2 * this.pixelSize))

        this._finalizeUpdate(browser, dataset, viewDimensions, { clampXY: true })

        return resolutionChanged
    }

    /**
     * Pure projection of canonical state into a BP locus, given dataset and view geometry.
     * Returns {x: {chr, start, end}, y: {chr, start, end}}. Does not mutate this.
     *
     * This is the only place "where am I in BP coordinates" is computed — it always
     * reflects what is actually on screen, derived from chr1/chr2/x/y/zoom/pixelSize.
     */
    getLocus(dataset, viewDimensions) {
        const bpPerBin = dataset.bpResolutions[this.zoom];
        const startBP1 = Math.round(this.x * bpPerBin);
        const startBP2 = Math.round(this.y * bpPerBin);
        const chr1 = dataset.chromosomes[this.chr1];
        const chr2 = dataset.chromosomes[this.chr2];
        const pixelsPerBin = this.pixelSize;
        const endBP1 = Math.min(chr1.size, Math.round(((viewDimensions.width / pixelsPerBin) * bpPerBin)) + startBP1);
        const endBP2 = Math.min(chr2.size, Math.round(((viewDimensions.height / pixelsPerBin) * bpPerBin)) + startBP2);
        return {
            x: { chr: chr1.name, start: startBP1, end: endBP1 },
            y: { chr: chr2.name, start: startBP2, end: endBP2 },
        };
    }

    async updateWithLoci(chr1Name, bpX, bpXMax, chr2Name, bpY, bpYMax, browser, width, height) {
        const bpResolutions = browser.getResolutions()
        const bpPerPixelTarget = Math.max((bpXMax - bpX) / width, (bpYMax - bpY) / height)
        const zoomNew = (true === browser.resolutionLocked)
            ? this.zoom
            : browser.findMatchingZoomIndex(bpPerPixelTarget, bpResolutions)
        const { binSize: binSizeNew } = bpResolutions[zoomNew]

        const { index: chr1Index } = browser.genome.getChromosome(chr1Name)
        const { index: chr2Index } = browser.genome.getChromosome(chr2Name)

        return await this.setView(
            chr1Index, chr2Index,
            bpX / binSizeNew, bpY / binSizeNew,
            zoomNew, binSizeNew / bpPerPixelTarget,
            browser, browser.dataset, { width, height },
            { clampXY: false },
        )
    }

    async sync(targetState, browser, genome, dataset){

        const chr1 = genome.getChromosome(targetState.chr1Name)
        const chr2 = genome.getChromosome(targetState.chr2Name)

        const bpPerPixelTarget = targetState.binSize/targetState.pixelSize

        const zoomNew = browser.findMatchingZoomIndex(bpPerPixelTarget, dataset.bpResolutions)
        const binSizeNew = dataset.bpResolutions[ zoomNew ]
        
        // Adjust pixel size from bpPerPixelTarget
        const pixelSizeNew = await this._adjustPixelSize(undefined, browser, zoomNew, {
            bpPerPixelTarget,
            binSize: binSizeNew
        })

        const xBinNew = targetState.binX * (targetState.binSize/binSizeNew)
        const yBinNew = targetState.binY * (targetState.binSize/binSizeNew)

        const zoomChanged = this._detectResolutionChange(zoomNew)
        const chrChanged = this._detectChromosomeChange(chr1.index, chr2.index)

        this.chr1 = chr1.index
        this.chr2 = chr2.index
        this.zoom = zoomNew
        this.x = xBinNew
        this.y = yBinNew
        this.pixelSize = pixelSizeNew

        this._finalizeUpdate(browser, dataset, browser.contactMatrixView.getViewDimensions(), {
            clampXY: true
        })

        return { zoomChanged, chrChanged }

    }

    stringify() {
        if (this.normalization) {
            return `${this.chr1},${this.chr2},${this.zoom},${this.x},${this.y},0,0,${this.pixelSize},${this.normalization}`
        } else {
            return `${this.chr1},${this.chr2},${this.zoom},${this.x},${this.y},0,0,${this.pixelSize}`
        }
    }

    /**
     * Shallow clone is intentional and correct: State holds only scalar fields
     * (chr1, chr2, zoom, x, y, pixelSize, normalization) since locus was made
     * a pure projection. Object.assign produces an independent clone.
     */
    clone() {
        return Object.assign(new State(), this);
    }

    equals(state) {
        const s1 = JSON.stringify(this);
        const s2 = JSON.stringify(state);
        return s1 === s2;
    }

    async sizeBP(dataset, zoomIndex, pixels){
        const matrix = await dataset.getMatrix(this.chr1, this.chr2)
        const { zoom } = matrix.getZoomDataByIndex(zoomIndex, 'BP')

        // bp = pixel * (bp/bin) * (bin/pixel) = pixel * bp/pixel = bp
        return pixels * (zoom.binSize/this.pixelSize)
    }

    static parse(string) {
        const tokens = string.split(",")

        if (tokens.length <= 7) {
            // Backwards compatibility
            return new State(
                parseInt(tokens[0]),    // chr1
                parseInt(tokens[1]),    // chr2
                parseFloat(tokens[2]), // zoom
                parseFloat(tokens[3]), // x
                parseFloat(tokens[4]), // y
                parseFloat(tokens[5]), // pixelSize
                tokens.length > 6 ? tokens[6] : "NONE"   // normalization
            )
        } else {
            return new State(
                parseInt(tokens[0]),    // chr1
                parseInt(tokens[1]),    // chr2
                parseFloat(tokens[2]), // zoom
                parseFloat(tokens[3]), // x
                parseFloat(tokens[4]), // y
                parseFloat(tokens[7]), // pixelSize
                tokens.length > 8 ? tokens[8] : "NONE"   // normalization
            )
        }
    }

    toJSON() {
        return {
            chr1: this.chr1,
            chr2: this.chr2,
            zoom: this.zoom,
            x: this.x,
            y: this.y,
            pixelSize: this.pixelSize,
            normalization: this.normalization || 'NONE',
        }
    }

    /**
     * Parse a JSON object into a State instance.
     * A `locus` field on the input is read-and-ignored for backward compatibility
     * with old session payloads — locus is derived on demand via getLocus().
     */
    static fromJSON(json) {
        return new State(
            json.chr1,
            json.chr2,
            json.zoom,
            json.x,
            json.y,
            json.pixelSize,
            json.normalization
        );
    }

    static default(configOrUndefined) {
        return new State(0, 0, 0, 0, 1, "NONE")
    }

}

export default State
