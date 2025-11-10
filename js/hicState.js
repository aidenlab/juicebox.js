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

    constructor(chr1, chr2, locus, zoom, x, y, pixelSize, normalization) {
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
            // console.warn("Normalization is undefined. Will use NONE");
            normalization = 'NONE';
        }
        this.normalization = normalization;

        // Validate and convert pixelSize to a number
        if (typeof pixelSize === 'string') {
            const parsed = parseFloat(pixelSize);
            pixelSize = isNaN(parsed) ? 1 : parsed;
        } else if (typeof pixelSize !== 'number' || Number.isNaN(pixelSize) || pixelSize <= 0) {
            pixelSize = 1;
        }
        this.pixelSize = pixelSize;

        this.locus = locus
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

        const minPixelSize = await browser.minPixelSize(this.chr1, this.chr2, zoom)
        pixelSize = Math.max(pixelSize, minPixelSize)

        // Genomic anchor  -- this position should remain at anchorPx, anchorPy after state change
        bpResolutions[this.zoom]
        const gx = (this.x + anchorPx / this.pixelSize) * bpResolutions[this.zoom].binSize
        const gy = (this.y + anchorPy / this.pixelSize) * bpResolutions[this.zoom].binSize

        this.x = gx / binSize - anchorPx / pixelSize
        this.y = gy / binSize - anchorPy / pixelSize

        this.zoom = zoom
        this.pixelSize = pixelSize

        this.clampXY(dataset, viewDimensions)

    }

    panShift(dx, dy, browser, dataset, viewDimensions) {

        this.x += (dx / this.pixelSize)
        this.y += (dy / this.pixelSize)
        this.clampXY(dataset, viewDimensions)

        this.configureLocus(browser, dataset, viewDimensions)

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

        const minPixelSize = await browser.minPixelSize(this.chr1, this.chr2, zoom)

        this.pixelSize = Math.max(DEFAULT_PIXEL_SIZE, minPixelSize)

        const resolutionChanged = (this.zoom !== zoom)

        this.zoom = zoom
        this.x = Math.max(0, xCenterNew - width / (2 * this.pixelSize))
        this.y = Math.max(0, yCenterNew - height / (2 * this.pixelSize))

        this.clampXY(dataset, viewDimensions)

        this.configureLocus(browser, dataset, viewDimensions)

        return resolutionChanged
    }

    configureLocus(browser, dataset, viewDimensions){

        const bpPerBin = dataset.bpResolutions[this.zoom];

        const startBP1 = Math.round(this.x * bpPerBin);
        const startBP2 = Math.round(this.y * bpPerBin);

        const chr1 = dataset.chromosomes[this.chr1];
        const chr2 = dataset.chromosomes[this.chr2];
        const pixelsPerBin = this.pixelSize;
        const endBP1 = Math.min(chr1.size, Math.round(((viewDimensions.width / pixelsPerBin) * bpPerBin)) + startBP1);
        const endBP2 = Math.min(chr2.size, Math.round(((viewDimensions.height / pixelsPerBin) * bpPerBin)) + startBP2);

        const x = { chr:chr1.name, start:startBP1, end:endBP1 }
        const y = { chr:chr2.name, start:startBP2, end:endBP2 }

        this.locus = { x, y }
    }

    updateWithLoci(chr1Name, bpX, bpXMax, chr2Name, bpY, bpYMax, browser, width, height){

        const bpResolutions = browser.getResolutions()

        // bp/pixel
        let bpPerPixelTarget = Math.max((bpXMax - bpX) / width, (bpYMax - bpY) / height)
        let resolutionChanged
        let zoomNew
        if (true === browser.resolutionLocked) {
            resolutionChanged = false
            zoomNew = this.zoom
        } else {
            zoomNew = browser.findMatchingZoomIndex(bpPerPixelTarget, bpResolutions)
            resolutionChanged = (zoomNew !== this.zoom)
        }

        const { binSize:binSizeNew } = bpResolutions[zoomNew]
        const pixelSize = Math.min(MAX_PIXEL_SIZE, Math.max(1, binSizeNew / bpPerPixelTarget))
        const newXBin = bpX / binSizeNew
        const newYBin = bpY / binSizeNew

        const { index:chr1Index } = browser.genome.getChromosome( chr1Name )
        const { index:chr2Index } = browser.genome.getChromosome( chr2Name )

        const chrChanged = this.chr1 !== chr1Index || this.chr2 !== chr2Index

        this.chr1 = chr1Index
        this.chr2 = chr2Index
        this.zoom = zoomNew
        this.x = newXBin
        this.y = newYBin
        this.pixelSize = pixelSize
        this.locus =
            {
                x: { chr: chr1Name, start: bpX, end: bpXMax },
                y: { chr: chr2Name, start: bpY, end: bpYMax }
            };

        return { chrChanged, resolutionChanged }
    }

    sync(targetState, browser, genome, dataset){

        const chr1 = genome.getChromosome(targetState.chr1Name)
        const chr2 = genome.getChromosome(targetState.chr2Name)

        const bpPerPixelTarget = targetState.binSize/targetState.pixelSize

        const zoomNew = browser.findMatchingZoomIndex(bpPerPixelTarget, dataset.bpResolutions)
        const binSizeNew = dataset.bpResolutions[ zoomNew ]
        const pixelSizeNew = Math.min(MAX_PIXEL_SIZE, Math.max(1, binSizeNew / bpPerPixelTarget))

        const xBinNew = targetState.binX * (targetState.binSize/binSizeNew)
        const yBinNew = targetState.binY * (targetState.binSize/binSizeNew)

        const zoomChanged = (browser.state.zoom !== zoomNew)
        const chrChanged = (browser.state.chr1 !== chr1.index || browser.state.chr2 !== chr2.index)

        this.chr1 = chr1.index
        this.chr2 = chr2.index
        this.zoom = zoomNew
        this.x = xBinNew
        this.y = yBinNew
        this.pixelSize = pixelSizeNew

        this.configureLocus(browser, dataset, browser.contactMatrixView.getViewDimensions())

        return { zoomChanged, chrChanged }

    }

    stringify() {
        if (this.normalization) {
            return `${this.chr1},${this.chr2},${this.zoom},${this.x},${this.y},0,0,${this.pixelSize},${this.normalization}`
        } else {
            return `${this.chr1},${this.chr2},${this.zoom},${this.x},${this.y},0,0,${this.pixelSize}`
        }
    }

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
                undefined, // locus
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
                undefined, // locus
                parseFloat(tokens[2]), // zoom
                parseFloat(tokens[3]), // x
                parseFloat(tokens[4]), // y
                parseFloat(tokens[7]), // pixelSize
                tokens.length > 8 ? tokens[8] : "NONE"   // normalization
            )
        }
    }

    // Method 1: Convert the State object to a JSON object
    toJSON() {
        const json =
            {
                chr1: this.chr1,
                chr2: this.chr2,
                zoom: this.zoom,
                x: this.x,
                y: this.y,
                pixelSize: this.pixelSize,
                normalization: this.normalization || 'NONE'
            }

        if (this.locus) {
            json.locus = this.locus
        }

        return json
    }

    // Method 2: Parse a JSON object and create an instance of the State class
    static fromJSON(json) {
        return new State(
            json.chr1,
            json.chr2,
            json.locus,
            json.zoom,
            json.x,
            json.y,
            json.pixelSize,
            json.normalization
        );
    }

    static default(configOrUndefined) {
        const state = new State(0, 0, undefined, 0, 0, 1, "NONE")
        return state
    }

}

export default State
