/*
 * StateManager - Handles browser state management and synchronization
 * Extracted from HICBrowser for better separation of concerns
 */

import HICEvent from '../hicEvent.js';

class StateManager {
    constructor(browser) {
        this.browser = browser;
    }

    /**
     * Set the matrix state. Used to restore state from a bookmark
     * @param {Object} state - Browser state
     */
    async setState(state) {
        const chrChanged = !this.browser.state || this.browser.state.chr1 !== state.chr1 || this.browser.state.chr2 !== state.chr2;

        this.browser.state = state.clone();

        // Possibly adjust pixel size
        const minPS = await this.browser.minPixelSize(this.browser.state.chr1, this.browser.state.chr2, this.browser.state.zoom);
        this.browser.state.pixelSize = Math.max(state.pixelSize, minPS);

        // Derive locus if none is present in source state
        if (undefined === state.locus) {
            const viewDimensions = this.browser.contactMatrixView.getViewDimensions();
            this.browser.state.configureLocus(this.browser, this.browser.dataset, viewDimensions);
        }

        const hicEvent = new HICEvent("LocusChange", { state: this.browser.state, resolutionChanged: true, chrChanged });
        this.browser.update(hicEvent);
        this.browser.eventBus.post(hicEvent);
    }

    /**
     * Return a modified state object used for synching
     * Other datasets might have different chromosome ordering and resolution arrays
     */
    getSyncState() {
        return {
            chr1Name: this.browser.dataset.chromosomes[this.browser.state.chr1].name,
            chr2Name: this.browser.dataset.chromosomes[this.browser.state.chr2].name,
            binSize: this.browser.dataset.bpResolutions[this.browser.state.zoom],
            binX: this.browser.state.x,            // TODO: translate to lower right corner
            binY: this.browser.state.y,
            pixelSize: this.browser.state.pixelSize
        };
    }

    /**
     * Return true if this browser can be synced to the given state
     * @param {Object} syncState - State to check compatibility with
     * @returns {boolean} Whether browser can be synced
     */
    canBeSynched(syncState) {
        if (false === this.browser.synchable) return false;   // Explicitly not synchable

        return this.browser.dataset &&
            (this.browser.dataset.getChrIndexFromName(syncState.chr1Name) !== undefined) &&
            (this.browser.dataset.getChrIndexFromName(syncState.chr2Name) !== undefined);
    }

    /**
     * Sync this browser's state to match the target state
     * @param {Object} targetState - State to sync to
     */
    async syncState(targetState) {
        if (!targetState || false === this.browser.synchable) return;

        if (!this.browser.dataset) return;

        const { zoomChanged, chrChanged } = this.browser.state.sync(targetState, this.browser, this.browser.genome, this.browser.dataset);

        const payload = { state: this.browser.state, resolutionChanged: zoomChanged, chrChanged };
        this.browser.update(HICEvent("LocusChange", payload, false));
    }
}

export default StateManager;
