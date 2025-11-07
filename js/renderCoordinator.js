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
 * RenderCoordinator handles all rendering coordination responsibilities for HICBrowser.
 * Extracted from HICBrowser to separate rendering coordination concerns.
 *
 * This class manages:
 * - Rendering coordination and queuing
 * - Repainting visual components
 * - Track rendering
 * - Update scheduling and batching
 */
class RenderCoordinator {

    /**
     * @param {HICBrowser} browser - The browser instance this coordinator serves
     */
    constructor(browser) {
        this.browser = browser;
        this.updating = false;
        this.pending = new Map();
    }

    /**
     * Pure rendering method - repaints all visual components.
     * Reads state directly from browser state, no parameters needed.
     * This is the core rendering logic separated from update coordination.
     *
     * @returns {Promise<void>}
     */
    async repaint() {
        if (!this.browser.activeDataset || !this.browser.activeState) {
            return; // Can't render without dataset and state
        }

        // Update rulers with current state
        const pseudoEvent = { 
            type: "LocusChange", 
            data: { state: this.browser.activeState } 
        };
        this.browser.layoutController.xAxisRuler.locusChange(pseudoEvent);
        this.browser.layoutController.yAxisRuler.locusChange(pseudoEvent);

        // Render all tracks and contact matrix in parallel
        const promises = [];

        for (let xyTrackRenderPair of this.browser.trackPairs) {
            promises.push(this.renderTrackXY(xyTrackRenderPair));
        }
        promises.push(this.browser.contactMatrixView.update());
        await Promise.all(promises);
    }

    /**
     * Render the XY pair of tracks.
     *
     * @param {TrackPair} xy - The track pair to render
     * @returns {Promise<void>}
     */
    async renderTrackXY(xy) {
        try {
            this.browser.startSpinner();
            await xy.updateViews();
        } finally {
            this.browser.stopSpinner();
        }
    }

    /**
     * Public API for updating/repainting the browser.
     *
     * Handles queuing logic for rapid calls (e.g., during mouse dragging).
     * If called while an update is in progress, queues the request for later processing.
     * Only the most recent request per type is kept in the queue.
     *
     * @param {boolean} shouldSync - Whether to synchronize state to other browsers (default: true)
     *                     Set to false when called from syncState() to avoid infinite loops
     * @returns {Promise<void>}
     */
    async update(shouldSync = true) {
        if (this.updating) {
            // Queue this update request - use a simple key since we don't need event types anymore
            this.pending.set("update", { shouldSync });
            return;
        }

        this.updating = true;
        try {
            this.browser.startSpinner();
            await this.repaint();
            if (shouldSync) {
                this.browser.syncToOtherBrowsers();
            }
        } finally {
            this.updating = false;
            if (this.pending.size > 0) {
                const queued = [];
                for (let [k, v] of this.pending) {
                    queued.push(v);
                }
                this.pending.clear();
                if (queued.length > 0) {
                    const lastQueued = queued[queued.length - 1];
                    await this.update(lastQueued.shouldSync);
                }
            }
            this.browser.stopSpinner();
        }
    }

    /**
     * Initialize the render coordinator.
     * Called during browser initialization.
     */
    init() {
        this.pending = new Map();
    }
}

export default RenderCoordinator;

