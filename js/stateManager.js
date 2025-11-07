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

/**
 * StateManager handles all state management responsibilities for HICBrowser.
 * Extracted from HICBrowser to separate state management concerns.
 * 
 * This class manages:
 * - Active dataset and state
 * - State transitions and validation
 * - Cross-browser synchronization state
 * - State normalization and pixel size adjustments
 */
class StateManager {

    /**
     * @param {HICBrowser} browser - The browser instance this manager serves
     */
    constructor(browser) {
        this.browser = browser;
        
        // State properties
        this.activeDataset = undefined;
        this.activeState = undefined;
        this.controlDataset = undefined;
    }

    /**
     * Set the active dataset and optionally the state.
     * 
     * @param {Dataset} dataset - The dataset to set as active
     * @param {State} state - Optional state to set
     */
    setActiveDataset(dataset, state) {
        this.activeDataset = dataset;
        if (state) {
            this.activeState = state;
        }
    }

    /**
     * Get the active dataset.
     * 
     * @returns {Dataset|undefined} - The active dataset
     */
    getActiveDataset() {
        return this.activeDataset;
    }

    /**
     * Get the active state.
     * 
     * @returns {State|undefined} - The active state
     */
    getActiveState() {
        return this.activeState;
    }

    /**
     * Set the active state with validation and adjustment.
     * This method handles:
     * - Cloning the state to avoid mutations
     * - Adjusting pixel size based on minimum requirements
     * - Configuring locus if not present
     * 
     * @param {State} state - The state to set
     * @returns {Promise<{chrChanged: boolean, resolutionChanged: boolean}>} - Change flags
     */
    async setState(state) {
        const chrChanged = !this.activeState || 
            this.activeState.chr1 !== state.chr1 || 
            this.activeState.chr2 !== state.chr2;

        this.activeState = state.clone();

        // Possibly adjust pixel size
        const minPS = await this.browser.minPixelSize(
            this.activeState.chr1, 
            this.activeState.chr2, 
            this.activeState.zoom
        );
        this.activeState.pixelSize = Math.max(state.pixelSize, minPS);

        // Derive locus if none is present in source state
        if (undefined === state.locus) {
            const viewDimensions = this.browser.contactMatrixView.getViewDimensions();
            this.activeState.configureLocus(
                this.browser, 
                this.activeDataset, 
                viewDimensions
            );
        }

        return { 
            chrChanged, 
            resolutionChanged: true 
        };
    }

    /**
     * Set the control dataset (for A/B comparisons).
     * 
     * @param {Dataset} dataset - The control dataset
     */
    setControlDataset(dataset) {
        this.controlDataset = dataset;
    }

    /**
     * Get the control dataset.
     * 
     * @returns {Dataset|undefined} - The control dataset
     */
    getControlDataset() {
        return this.controlDataset;
    }

    /**
     * Clear all state (dataset and state).
     */
    clearState() {
        this.activeDataset = undefined;
        this.activeState = undefined;
        this.controlDataset = undefined;
    }

    /**
     * Return a modified state object used for synching.
     * Other datasets might have different chromosome ordering and resolution arrays.
     * 
     * @returns {Object} - Sync state object with chromosome names and bin coordinates
     */
    getSyncState() {
        if (!this.activeDataset || !this.activeState) {
            return undefined;
        }

        return {
            chr1Name: this.activeDataset.chromosomes[this.activeState.chr1].name,
            chr2Name: this.activeDataset.chromosomes[this.activeState.chr2].name,
            binSize: this.activeDataset.bpResolutions[this.activeState.zoom],
            binX: this.activeState.x,
            binY: this.activeState.y,
            pixelSize: this.activeState.pixelSize
        };
    }

    /**
     * Return true if this browser can be synced to the given state.
     * 
     * @param {Object} syncState - The sync state to check compatibility with
     * @returns {boolean} - True if browser can sync to the given state
     */
    canBeSynched(syncState) {
        if (false === this.browser.synchable) {
            return false; // Explicitly not synchable
        }

        if (!this.activeDataset) {
            return false;
        }

        return (
            this.activeDataset.getChrIndexFromName(syncState.chr1Name) !== undefined &&
            this.activeDataset.getChrIndexFromName(syncState.chr2Name) !== undefined
        );
    }

    /**
     * Sync this browser's state to match a target sync state.
     * This method updates the state to match another browser's state for synchronization.
     * 
     * @param {Object} targetState - The target sync state to sync to
     * @returns {Promise<{zoomChanged: boolean, chrChanged: boolean}>} - Change flags
     */
    async syncState(targetState) {
        if (!targetState || false === this.browser.synchable) {
            return { zoomChanged: false, chrChanged: false };
        }

        if (!this.activeDataset || !this.activeState) {
            return { zoomChanged: false, chrChanged: false };
        }

        const { zoomChanged, chrChanged } = this.activeState.sync(
            targetState, 
            this.browser, 
            this.browser.genome, 
            this.activeDataset
        );

        // Configure locus after sync
        this.activeState.configureLocus(
            this.browser, 
            this.activeDataset, 
            this.browser.contactMatrixView.getViewDimensions()
        );

        return { zoomChanged, chrChanged };
    }

    /**
     * Set normalization on the active state.
     * 
     * @param {string} normalization - The normalization type
     */
    setNormalization(normalization) {
        if (this.activeState) {
            this.activeState.normalization = normalization;
        }
    }

    /**
     * Get normalization from the active state.
     * 
     * @returns {string|undefined} - The normalization type
     */
    getNormalization() {
        return this.activeState ? this.activeState.normalization : undefined;
    }
}

export default StateManager;

