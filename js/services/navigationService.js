/*
 * NavigationService - Handles zoom, pan, and navigation operations
 * Extracted from HICBrowser for better separation of concerns
 */

import HICEvent from '../hicEvent.js';
import CoordinateTransformer from './coordinateTransformer.js';
import ZoomCalculator from './zoomCalculator.js';
import LocusParser from './locusParser.js';

class NavigationService {
    constructor(browser) {
        this.browser = browser;
    }

    /**
     * Navigate to specific coordinates
     * @param {string} chr1 - First chromosome
     * @param {number} bpX - X coordinate in base pairs
     * @param {number} bpXMax - X end coordinate in base pairs
     * @param {string} chr2 - Second chromosome
     * @param {number} bpY - Y coordinate in base pairs
     * @param {number} bpYMax - Y end coordinate in base pairs
     */
    goto(chr1, bpX, bpXMax, chr2, bpY, bpYMax) {
        const { width, height } = this.browser.contactMatrixView.getViewDimensions();
        const { chrChanged, resolutionChanged } = this.browser.state.updateWithLoci(chr1, bpX, bpXMax, chr2, bpY, bpYMax, this.browser, width, height);

        this.browser.contactMatrixView.clearImageCaches();

        this.browser.update(HICEvent("LocusChange", { state: this.browser.state, resolutionChanged, chrChanged }));
    }

    /**
     * Find the closest matching zoom index for the target resolution
     * @param {number} targetResolution - Target resolution to find
     * @param {Array} resolutionArray - Array of resolutions or objects with index and binSize
     * @returns {number} Matching zoom index
     */
    findMatchingZoomIndex(targetResolution, resolutionArray) {
        return CoordinateTransformer.findMatchingZoomIndex(targetResolution, resolutionArray);
    }

    /**
     * Handle pinch zoom gesture
     * @param {number} anchorPx - Anchor position in pixels (should not move after transformation)
     * @param {number} anchorPy - Anchor position in pixels
     * @param {number} scaleFactor - Scale factor (>1 for zoom in, <1 for zoom out)
     */
    async pinchZoom(anchorPx, anchorPy, scaleFactor) {
        if (this.browser.state.chr1 === 0) {
            await this.zoomAndCenter(1, anchorPx, anchorPy);
        } else {
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
                    newPixelSize = Math.min(128, this.browser.state.pixelSize * scaleFactor); // MAX_PIXEL_SIZE
                    newZoom = this.browser.state.zoom;
                    resolutionChanged = false;
                } else {
                    const targetBinSize = (currentResolution.binSize / this.browser.state.pixelSize) / scaleFactor;
                    newZoom = this.findMatchingZoomIndex(targetBinSize, bpResolutions);
                    newBinSize = bpResolutions[newZoom].binSize;
                    resolutionChanged = newZoom !== this.browser.state.zoom;
                    newPixelSize = Math.min(128, newBinSize / targetBinSize); // MAX_PIXEL_SIZE
                }
                const z = await this.browser.minZoom(this.browser.state.chr1, this.browser.state.chr2);

                if (!this.browser.resolutionLocked && scaleFactor < 1 && newZoom < z) {
                    // Zoom out to whole genome
                    const xLocus = LocusParser.parseLocusString('1', this.browser.genome);
                    const yLocus = { ...xLocus };
                    await this.browser.setChromosomes(xLocus, yLocus);
                } else {
                    await this.browser.state.panWithZoom(newZoom, newPixelSize, anchorPx, anchorPy, newBinSize, this.browser, this.browser.dataset, this.browser.contactMatrixView.getViewDimensions(), bpResolutions);

                    await this.browser.contactMatrixView.zoomIn(anchorPx, anchorPy, 1/scaleFactor);

                    await this.browser.update(HICEvent("LocusChange", { state: this.browser.state, resolutionChanged, chrChanged: false }));
                }
            } finally {
                this.browser.stopSpinner();
            }
        }
    }

    /**
     * Zoom and center on bins at given screen coordinates
     * @param {number} direction - Direction of zoom (positive for zoom in, negative for zoom out)
     * @param {number} centerPX - Screen coordinate to center on
     * @param {number} centerPY - Screen coordinate to center on
     * @returns {Promise<void>}
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
            await this.browser.setChromosomes(xLocus, yLocus);
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
                const minPS = await this.browser.minPixelSize(this.browser.state.chr1, this.browser.state.chr2, this.browser.state.zoom);

                const newPixelSize = Math.max(Math.min(128, this.browser.state.pixelSize * (direction > 0 ? 2 : 0.5)), minPS); // MAX_PIXEL_SIZE

                const shiftRatio = (newPixelSize - this.browser.state.pixelSize) / newPixelSize;

                this.browser.state.pixelSize = newPixelSize;

                this.browser.state.x += shiftRatio * (width / this.browser.state.pixelSize);
                this.browser.state.y += shiftRatio * (height / this.browser.state.pixelSize);

                this.browser.state.clampXY(this.browser.dataset, this.browser.contactMatrixView.getViewDimensions());

                this.browser.state.configureLocus(this.browser, this.browser.dataset, { width, height });

                this.browser.update(HICEvent("LocusChange", {state: this.browser.state, resolutionChanged: false, chrChanged: false}));

            } else {
                let i;
                for (i = 0; i < resolutions.length; i++) {
                    if (this.browser.state.zoom === resolutions[i].index) break;
                }
                if (i) {
                    const newZoom = resolutions[i + direction].index;
                    this.setZoom(newZoom);
                }
            }
        }
    }

    /**
     * Set the current zoom state
     * @param {number} zoom - Index to the datasets resolution array (dataset.bpResolutions)
     * @returns {Promise<void>}
     */
    async setZoom(zoom) {
        const resolutionChanged = await this.browser.state.setWithZoom(zoom, this.browser.contactMatrixView.getViewDimensions(), this.browser, this.browser.dataset);

        await this.browser.contactMatrixView.zoomIn();

        this.browser.update(HICEvent("LocusChange", { state: this.browser.state, resolutionChanged, chrChanged: false }));
    }
}

export default NavigationService;
