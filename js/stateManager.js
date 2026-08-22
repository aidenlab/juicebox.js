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
     * Install the active dataset. **The dataset and nothing else** -- state
     * arrives only through `setState`, the chokepoint (#559, ADR-0009
     * decision 1).
     *
     * This took a second `state` parameter until #559, and assigned it to
     * `this.activeState` with no validation at all, from five `dataLoader` call
     * sites. That was the live bypass of the mutation invariant -- not the
     * `browser.state = x` setters the review card names, which have no
     * production callers -- and it carried no warning comment while running on
     * every load.
     *
     * Routing the assignment through the chokepoint *inside* this setter was
     * the rejected alternative: it hides a chokepoint call in a method named
     * for something else, which is how the door was built the first time.
     * Dropping the parameter makes the ordering explicit at each call site --
     * install the dataset, then hand the state to `setState`, which needs the
     * dataset already in place because `clampXY` reads its chromosome table.
     *
     * @param {Dataset} dataset - The dataset to set as active
     */
    setActiveDataset(dataset) {
        this.activeDataset = dataset;
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
     * Restore a saved view. **A translator, like every other mutation path**
     * (#558, ADR-0009 decisions 2 and 4).
     *
     * The six canonical fields arrive off the incoming state and are handed to
     * `State.setView`, the one chokepoint. Restore used to clone and apply a
     * bare `Math.max(pixelSize, minPixelSize)` floor of its own, which meant a
     * saved view skipped the `MAX_PIXEL_SIZE` cap and the x/y clamp that every
     * gesture path gets. It no longer does.
     *
     * **A restored state is clamped silently, never rejected.** That is the same
     * rule the normalize stage one seam over follows (ADR-0006, #466): defaults
     * and coerces, never refuses. The cost is deliberate and is in the release
     * notes — a saved view at `pixelSize=1e9`, or with an origin past the end of
     * the chromosome, now opens somewhere different. Rejecting instead would
     * turn a link that renders something into a link that renders nothing.
     *
     * The clone is what is mutated, so the caller's state object is left alone:
     * `dataLoader` hands the same instance to `coordinator.onMapLoaded`.
     *
     * The dataset must already be installed — `clampXY` reads its chromosome
     * table and resolution ladder. All three production callers set it first,
     * one line earlier; #559 makes that ordering explicit at the call sites.
     *
     * `resolutionChanged: true` is unconditional and stays that way here: making
     * it honest is #560, deliberately a ticket of its own so its snapshot
     * movement has exactly one explanation.
     *
     * Locus is not cached — consumers derive it via state.getLocus().
     */
    async setState(state) {
        const chrChanged = !this.activeState ||
            this.activeState.chr1 !== state.chr1 ||
            this.activeState.chr2 !== state.chr2;

        const restored = state.clone();

        // `setView`'s return is deliberately discarded. It runs on the clone,
        // which already holds the incoming chromosomes, so its `chrChanged` is
        // always false and its `resolutionChanged` always false — the comparison
        // that means anything is against the outgoing value of
        // `this.activeState`, which is the one computed above.
        // `resolutionChanged` is #560's to make honest.
        //
        // The clone carries the incoming chr1/chr2 before `setView` runs, so
        // `_adjustPixelSize` consults `browser.minPixelSize` with the same
        // arguments the hand-rolled floor above it used to.
        await restored.setView(
            state.chr1, state.chr2, state.x, state.y, state.zoom, state.pixelSize,
            this.browser,
            this.activeDataset,
            this.browser.contactMatrixView.getViewDimensions()
        );

        this.activeState = restored;

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

        const { zoomChanged, chrChanged } = await this.activeState.sync(
            targetState, 
            this.browser, 
            this.browser.genome, 
            this.activeDataset
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

