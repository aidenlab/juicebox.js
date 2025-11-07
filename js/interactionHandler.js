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
 */

import {DEFAULT_PIXEL_SIZE, MAX_PIXEL_SIZE} from "./hicBrowser.js"

/**
 * InteractionHandler handles all user interaction responsibilities for HICBrowser.
 * Extracted from HICBrowser to separate interaction handling concerns.
 * 
 * This class manages:
 * - Navigation (goto, setChromosomes)
 * - Zoom operations (pinchZoom, zoomAndCenter, setZoom)
 * - Pan operations (shiftPixels)
 * - Locus parsing (parseGotoInput, parseLocusString)
 * - Zoom index finding (findMatchingZoomIndex)
 */
class InteractionHandler {

    /**
     * @param {HICBrowser} browser - The browser instance this handler serves
     */
    constructor(browser) {
        this.browser = browser;
    }

    /**
     * Navigate to a specific genomic locus.
     * 
     * @param {string|number} chr1 - Chromosome 1 name or index
     * @param {number} bpX - Start base pair for X axis
     * @param {number} bpXMax - End base pair for X axis
     * @param {string|number} chr2 - Chromosome 2 name or index
     * @param {number} bpY - Start base pair for Y axis
     * @param {number} bpYMax - End base pair for Y axis
     */
    async goto(chr1, bpX, bpXMax, chr2, bpY, bpYMax) {
        const { width, height } = this.browser.contactMatrixView.getViewDimensions();
        const { chrChanged, resolutionChanged } = this.browser.state.updateWithLoci(
            chr1, bpX, bpXMax, chr2, bpY, bpYMax, 
            this.browser, width, height
        );

        this.browser.contactMatrixView.clearImageCaches();

        const eventData = { 
            state: this.browser.state, 
            resolutionChanged, 
            chrChanged 
        };

        await this.browser.update();
        this.browser.notifyLocusChange(eventData);
    }

    /**
     * Pan the view by pixel offset.
     * 
     * @param {number} dx - X pixel offset
     * @param {number} dy - Y pixel offset
     */
    async shiftPixels(dx, dy) {
        if (undefined === this.browser.dataset) {
            console.warn('dataset is undefined');
            return;
        }

        this.browser.state.panShift(
            dx, dy, 
            this.browser, 
            this.browser.dataset, 
            this.browser.contactMatrixView.getViewDimensions()
        );

        const eventData = {
            state: this.browser.state,
            resolutionChanged: false,
            dragging: true,
            chrChanged: false
        };

        await this.browser.update();
        this.browser.notifyLocusChange(eventData);
    }

    /**
     * Handle pinch zoom gesture.
     * 
     * @param {number} anchorPx - Anchor X position in pixels
     * @param {number} anchorPy - Anchor Y position in pixels
     * @param {number} scaleFactor - Scale factor (>1 = zoom in, <1 = zoom out)
     */
    async pinchZoom(anchorPx, anchorPy, scaleFactor) {
        if (this.browser.state.chr1 === 0) {
            await this.zoomAndCenter(1, anchorPx, anchorPy);
            return;
        }

        try {
            this.browser.startSpinner();

            const bpResolutions = this.browser.getResolutions();
            const currentResolution = bpResolutions[this.browser.state.zoom];

            let newBinSize;
            let newZoom;
            let newPixelSize;
            let resolutionChanged;

            if (this.browser.resolutionLocked ||
                (this.browser.state.zoom === bpResolutions.length - 1 && scaleFactor > 1) ||
                (this.browser.state.zoom === 0 && scaleFactor < 1)) {
                // Can't change resolution level, must adjust pixel size
                newBinSize = currentResolution.binSize;
                newPixelSize = Math.min(MAX_PIXEL_SIZE, this.browser.state.pixelSize * scaleFactor);
                newZoom = this.browser.state.zoom;
                resolutionChanged = false;
            } else {
                const targetBinSize = (currentResolution.binSize / this.browser.state.pixelSize) / scaleFactor;
                newZoom = this.findMatchingZoomIndex(targetBinSize, bpResolutions);
                newBinSize = bpResolutions[newZoom].binSize;
                resolutionChanged = newZoom !== this.browser.state.zoom;
                newPixelSize = Math.min(MAX_PIXEL_SIZE, newBinSize / targetBinSize);
            }

            const z = await this.browser.minZoom(this.browser.state.chr1, this.browser.state.chr2);

            if (!this.browser.resolutionLocked && scaleFactor < 1 && newZoom < z) {
                // Zoom out to whole genome
                const xLocus = this.parseLocusString('1');
                const yLocus = { xLocus };
                await this.setChromosomes(xLocus, yLocus);
            } else {
                await this.browser.state.panWithZoom(
                    newZoom, newPixelSize, anchorPx, anchorPy, newBinSize,
                    this.browser, this.browser.dataset,
                    this.browser.contactMatrixView.getViewDimensions(),
                    bpResolutions
                );

                await this.browser.contactMatrixView.zoomIn(anchorPx, anchorPy, 1 / scaleFactor);

                const eventData = { 
                    state: this.browser.state, 
                    resolutionChanged, 
                    chrChanged: false 
                };
                await this.browser.update();
                this.browser.notifyLocusChange(eventData);
            }
        } finally {
            this.browser.stopSpinner();
        }
    }

    /**
     * Zoom and center on bins at given screen coordinates.
     * Supports double-click zoom, pinch zoom.
     * 
     * @param {number} direction - Zoom direction (>0 = zoom in, <0 = zoom out)
     * @param {number} centerPX - Screen X coordinate to center on
     * @param {number} centerPY - Screen Y coordinate to center on
     */
    async zoomAndCenter(direction, centerPX, centerPY) {
        if (undefined === this.browser.dataset) {
            console.warn('Dataset is undefined');
            return;
        }

        if (this.browser.dataset.isWholeGenome(this.browser.state.chr1) && direction > 0) {
            // jump from whole genome to chromosome
            const genomeCoordX = centerPX * this.browser.dataset.wholeGenomeResolution / this.browser.state.pixelSize;
            const genomeCoordY = centerPY * this.browser.dataset.wholeGenomeResolution / this.browser.state.pixelSize;
            const chrX = this.browser.genome.getChromosomeForCoordinate(genomeCoordX);
            const chrY = this.browser.genome.getChromosomeForCoordinate(genomeCoordY);
            const xLocus = { chr: chrX.name, start: 0, end: chrX.size, wholeChr: true };
            const yLocus = { chr: chrY.name, start: 0, end: chrY.size, wholeChr: true };
            await this.setChromosomes(xLocus, yLocus);
        } else {
            const { width, height } = this.browser.contactMatrixView.getViewDimensions();

            const dx = centerPX === undefined ? 0 : centerPX - width / 2;
            this.browser.state.x += (dx / this.browser.state.pixelSize);

            const dy = centerPY === undefined ? 0 : centerPY - height / 2;
            this.browser.state.y += (dy / this.browser.state.pixelSize);

            const resolutions = this.browser.getResolutions();
            const directionPositive = direction > 0 && this.browser.state.zoom === resolutions[resolutions.length - 1].index;
            const directionNegative = direction < 0 && this.browser.state.zoom === resolutions[0].index;
            
            if (this.browser.resolutionLocked || directionPositive || directionNegative) {
                const minPS = await this.browser.minPixelSize(
                    this.browser.state.chr1, 
                    this.browser.state.chr2, 
                    this.browser.state.zoom
                );

                const newPixelSize = Math.max(
                    Math.min(MAX_PIXEL_SIZE, this.browser.state.pixelSize * (direction > 0 ? 2 : 0.5)), 
                    minPS
                );

                const shiftRatio = (newPixelSize - this.browser.state.pixelSize) / newPixelSize;

                this.browser.state.pixelSize = newPixelSize;

                this.browser.state.x += shiftRatio * (width / this.browser.state.pixelSize);
                this.browser.state.y += shiftRatio * (height / this.browser.state.pixelSize);

                this.browser.state.clampXY(this.browser.dataset, this.browser.contactMatrixView.getViewDimensions());
                this.browser.state.configureLocus(this.browser, this.browser.dataset, { width, height });

                const eventData = { 
                    state: this.browser.state, 
                    resolutionChanged: false, 
                    chrChanged: false 
                };
                await this.browser.update();
                this.browser.notifyLocusChange(eventData);
            } else {
                let i;
                for (i = 0; i < resolutions.length; i++) {
                    if (this.browser.state.zoom === resolutions[i].index) break;
                }
                if (i !== undefined) {
                    const newZoom = resolutions[i + direction].index;
                    await this.setZoom(newZoom);
                }
            }
        }
    }

    /**
     * Set the current zoom state.
     * 
     * @param {number} zoom - Index to the datasets resolution array (dataset.bpResolutions)
     */
    async setZoom(zoom) {
        const resolutionChanged = await this.browser.state.setWithZoom(
            zoom, 
            this.browser.contactMatrixView.getViewDimensions(), 
            this.browser, 
            this.browser.dataset
        );

        await this.browser.contactMatrixView.zoomIn();

        const eventData = { 
            state: this.browser.state, 
            resolutionChanged, 
            chrChanged: false 
        };
        await this.browser.update();
        this.browser.notifyLocusChange(eventData);
    }

    /**
     * Set chromosome view.
     * 
     * @param {Object} xLocus - X axis locus {chr, start, end, wholeChr?}
     * @param {Object} yLocus - Y axis locus {chr, start, end, wholeChr?}
     */
    async setChromosomes(xLocus, yLocus) {
        const { index: chr1Index } = this.browser.genome.getChromosome(xLocus.chr);
        const { index: chr2Index } = this.browser.genome.getChromosome(yLocus.chr);

        this.browser.state.chr1 = Math.min(chr1Index, chr2Index);
        this.browser.state.x = 0;

        this.browser.state.chr2 = Math.max(chr1Index, chr2Index);
        this.browser.state.y = 0;

        this.browser.state.locus = {
            x: { chr: xLocus.chr, start: xLocus.start, end: xLocus.end },
            y: { chr: yLocus.chr, start: yLocus.start, end: yLocus.end }
        };

        if (xLocus.wholeChr && yLocus.wholeChr) {
            this.browser.state.zoom = await this.browser.minZoom(this.browser.state.chr1, this.browser.state.chr2);
            const minPS = await this.browser.minPixelSize(this.browser.state.chr1, this.browser.state.chr2, this.browser.state.zoom);
            this.browser.state.pixelSize = Math.min(100, Math.max(DEFAULT_PIXEL_SIZE, minPS));
        } else {
            // Whole Genome
            this.browser.state.zoom = 0;
            const minPS = await this.browser.minPixelSize(this.browser.state.chr1, this.browser.state.chr2, this.browser.state.zoom);
            this.browser.state.pixelSize = Math.max(this.browser.state.pixelSize, minPS);
        }

        const eventData = { 
            state: this.browser.state, 
            resolutionChanged: true, 
            chrChanged: true 
        };
        await this.browser.update();
        this.browser.notifyLocusChange(eventData);
    }

    /**
     * Find the closest matching zoom index for the target resolution.
     * 
     * resolutionArray can be either:
     *   (1) an array of bin sizes
     *   (2) an array of objects with index and bin size
     * 
     * @param {number} targetResolution - Target resolution in base pairs per bin
     * @param {Array} resolutionArray - Array of resolutions
     * @returns {number} - Matching zoom index
     */
    findMatchingZoomIndex(targetResolution, resolutionArray) {
        const isObject = resolutionArray.length > 0 && resolutionArray[0].index !== undefined;
        for (let z = resolutionArray.length - 1; z > 0; z--) {
            const binSize = isObject ? resolutionArray[z].binSize : resolutionArray[z];
            const index = isObject ? resolutionArray[z].index : z;
            if (binSize >= targetResolution) {
                return index;
            }
        }
        return 0;
    }

    /**
     * Parse goto input string and navigate to the specified locus.
     * 
     * @param {string} input - Input string in format "chr:start-end" or "chr:start-end chr:start-end"
     * @returns {Promise<void>}
     */
    async parseGotoInput(input) {
        const loci = input.trim().split(' ');

        let xLocus = this.parseLocusString(loci[0]) || await this.browser.lookupFeatureOrGene(loci[0]);

        if (!xLocus) {
            console.error(`No feature found with name ${loci[0]}`);
            alert(`No feature found with name ${loci[0]}`);
            return;
        }

        let yLocus = loci[1] ? this.parseLocusString(loci[1]) : { ...xLocus };
        if (!yLocus) {
            yLocus = { ...xLocus };
        }

        if (xLocus.wholeChr && yLocus.wholeChr || 'All' === xLocus.chr && 'All' === yLocus.chr) {
            await this.setChromosomes(xLocus, yLocus);
        } else {
            await this.goto(xLocus.chr, xLocus.start, xLocus.end, yLocus.chr, yLocus.start, yLocus.end);
        }
    }

    /**
     * Parse a locus string into a locus object.
     * 
     * @param {string} locus - Locus string in format "chr:start-end" or "chr"
     * @returns {Object|undefined} - Locus object {chr, start, end, wholeChr?} or undefined if invalid
     */
    parseLocusString(locus) {
        const [chrName, range] = locus.trim().toLowerCase().split(':');
        const chromosome = this.browser.genome.getChromosome(chrName);

        if (!chromosome) {
            return undefined;
        }

        const locusObject = {
            chr: chromosome.name,
            wholeChr: (undefined === range && 'All' !== chromosome.name)
        };

        if (true === locusObject.wholeChr || 'All' === chromosome.name) {
            // Chromosome name only or All: Set to whole range
            locusObject.start = 0;
            locusObject.end = chromosome.size;
        } else {
            const [startStr, endStr] = range.split('-').map(part => part.replace(/,/g, ''));

            // Internally, loci are 0-based.
            locusObject.start = isNaN(startStr) ? undefined : parseInt(startStr, 10) - 1;
            locusObject.end = isNaN(endStr) ? undefined : parseInt(endStr, 10);
        }

        return locusObject;
    }
}

export default InteractionHandler;

