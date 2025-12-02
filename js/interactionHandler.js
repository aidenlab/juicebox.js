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
 * - Zoom operations (pinchZoom, handleWheelZoom, zoomAndCenter, setZoom)
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
        this.wheelZoomInProgress = false;
        this.pendingWheelZoom = null;
    }

    /**
     * Validate that the dataset is available.
     * 
     * @returns {boolean} - True if dataset is valid, false otherwise
     */
    _validateDataset() {
        if (undefined === this.browser.dataset) {
            console.warn('dataset is undefined');
            return false;
        }
        return true;
    }

    /**
     * Apply state changes and notify listeners.
     * Centralizes the common post-state-change workflow.
     * 
     * @param {Object} options - State change options
     * @param {boolean} options.resolutionChanged - Whether resolution changed
     * @param {boolean} options.chrChanged - Whether chromosome changed
     * @param {boolean} [options.dragging] - Whether currently dragging (optional)
     * @param {boolean} [options.clearCaches] - Whether to clear image caches (optional)
     * @param {Object} [options.zoomIn] - Zoom in options {anchorPx?, anchorPy?, scaleFactor?} (optional)
     * @returns {Promise<void>}
     */
    async _applyStateChange(options) {
        const { resolutionChanged, chrChanged, dragging = false, clearCaches = false, zoomIn } = options;

        if (clearCaches) {
            this.browser.contactMatrixView.clearImageCaches();
        }

        // Only use smooth zoomIn animation when resolution hasn't changed
        // Resolution changes require loading new data tiles, so smooth zoom doesn't work correctly
        // and causes visual "pops" due to binSize unit mismatches
        if (zoomIn && !resolutionChanged) {
            if (zoomIn.anchorPx !== undefined && zoomIn.anchorPy !== undefined && zoomIn.scaleFactor !== undefined) {
                await this.browser.contactMatrixView.zoomIn(zoomIn.anchorPx, zoomIn.anchorPy, zoomIn.scaleFactor);
            } else {
                await this.browser.contactMatrixView.zoomIn();
            }
        }

        const eventData = {
            state: this.browser.state,
            resolutionChanged,
            chrChanged,
            ...(dragging && { dragging })
        };

        await this.browser.update();
        this.browser.notifyLocusChange(eventData);
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
        const { chrChanged, resolutionChanged } = await this.browser.state.updateWithLoci(
            chr1, bpX, bpXMax, chr2, bpY, bpYMax, 
            this.browser, width, height
        );

        await this._applyStateChange({
            resolutionChanged,
            chrChanged,
            clearCaches: true
        });
    }

    /**
     * Pan the view by pixel offset.
     * 
     * @param {number} dx - X pixel offset
     * @param {number} dy - Y pixel offset
     */
    async shiftPixels(dx, dy) {
        if (!this._validateDataset()) {
            return;
        }

        this.browser.state.panShift(
            dx, dy, 
            this.browser, 
            this.browser.dataset, 
            this.browser.contactMatrixView.getViewDimensions()
        );

        await this._applyStateChange({
            resolutionChanged: false,
            chrChanged: false,
            dragging: true
        });
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

                // Update the locus after zooming
                this.browser.state.configureLocus(
                    this.browser.dataset,
                    this.browser.contactMatrixView.getViewDimensions()
                );

                await this._applyStateChange({
                    resolutionChanged,
                    chrChanged: false,
                    zoomIn: {
                        anchorPx,
                        anchorPy,
                        scaleFactor: 1 / scaleFactor
                    }
                });
            }
        } finally {
            this.browser.stopSpinner();
        }
    }

    /**
     * Handle wheel-based zoom gesture.
     * Similar to pinchZoom but optimized for wheel events with smaller incremental steps.
     * Prevents concurrent zoom operations to avoid race conditions and discrete jumps.
     * Accumulates zoom scale factors when there are pending operations to maintain responsiveness
     * even when track rendering is slow.
     * 
     * @param {number} anchorPx - Anchor X position in pixels
     * @param {number} anchorPy - Anchor Y position in pixels
     * @param {number} scaleFactor - Scale factor (>1 = zoom in, <1 = zoom out)
     */
    async handleWheelZoom(anchorPx, anchorPy, scaleFactor) {
        if (!this._validateDataset()) {
            return;
        }

        // If a zoom operation is already in progress, accumulate the scale factor
        // This ensures that rapid wheel events don't get lost when track rendering is slow
        if (this.wheelZoomInProgress) {
            if (this.pendingWheelZoom) {
                // Accumulate scale factors multiplicatively
                // Use the most recent anchor position (where the mouse currently is)
                this.pendingWheelZoom.scaleFactor *= scaleFactor;
                this.pendingWheelZoom.anchorPx = anchorPx;
                this.pendingWheelZoom.anchorPy = anchorPy;
            } else {
                this.pendingWheelZoom = { anchorPx, anchorPy, scaleFactor };
            }
            return;
        }

        // Process zoom operations sequentially to prevent race conditions
        this.wheelZoomInProgress = true;
        try {
            await this._performWheelZoom(anchorPx, anchorPy, scaleFactor);
            
            // Process any pending zoom operation (with accumulated scale factor)
            while (this.pendingWheelZoom) {
                const pending = this.pendingWheelZoom;
                this.pendingWheelZoom = null;
                await this._performWheelZoom(pending.anchorPx, pending.anchorPy, pending.scaleFactor);
            }
        } finally {
            this.wheelZoomInProgress = false;
        }
    }

    /**
     * Internal method to perform the actual wheel zoom operation.
     * 
     * @param {number} anchorPx - Anchor X position in pixels
     * @param {number} anchorPy - Anchor Y position in pixels
     * @param {number} scaleFactor - Scale factor (>1 = zoom in, <1 = zoom out)
     */
    async _performWheelZoom(anchorPx, anchorPy, scaleFactor) {
        // Handle transition from whole genome to chromosome view
        if (this.browser.state.chr1 === 0) {
            // In whole genome view, only zoom in (jump to chromosome)
            // Zoom out doesn't make sense at whole genome level
            if (scaleFactor > 1) {
                // Use zoomAndCenter which safely handles the whole genome to chromosome transition
                // It will navigate to the chromosome under the mouse cursor
                await this.zoomAndCenter(1, anchorPx, anchorPy);
            }
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
                const xLocus = this.parseLocusString('All');
                const yLocus = { ...xLocus };
                await this.setChromosomes(xLocus, yLocus);
            } else {
                await this.browser.state.panWithZoom(
                    newZoom, newPixelSize, anchorPx, anchorPy, newBinSize,
                    this.browser, this.browser.dataset,
                    this.browser.contactMatrixView.getViewDimensions(),
                    bpResolutions
                );

                // Update the locus after zooming
                this.browser.state.configureLocus(
                    this.browser.dataset,
                    this.browser.contactMatrixView.getViewDimensions()
                );

                await this._applyStateChange({
                    resolutionChanged,
                    chrChanged: false,
                    zoomIn: {
                        anchorPx,
                        anchorPy,
                        scaleFactor: 1 / scaleFactor
                    }
                });
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
        if (!this._validateDataset()) {
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
                this.browser.state.configureLocus(this.browser.dataset, { width, height });

                await this._applyStateChange({
                    resolutionChanged: false,
                    chrChanged: false
                });
            } else {
                let i;
                for (i = 0; i < resolutions.length; i++) {
                    if (this.browser.state.zoom === resolutions[i].index) break;
                }
                if (i < resolutions.length && i + direction >= 0 && i + direction < resolutions.length) {
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

        await this._applyStateChange({
            resolutionChanged,
            chrChanged: false,
            zoomIn: {}
        });
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

        await this._applyStateChange({
            resolutionChanged: true,
            chrChanged: true,
            clearCaches: true
        });
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

