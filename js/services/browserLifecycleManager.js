/*
 * BrowserLifecycleManager - Handles browser lifecycle and cleanup operations
 * Extracted from HICBrowser for better separation of concerns
 */

import { getAllBrowsers } from '../createBrowser.js';

class BrowserLifecycleManager {
    constructor(browser) {
        this.browser = browser;
    }

    /**
     * Reset the browser to initial state
     */
    reset() {
        this.browser.layoutController.removeAllTrackXYPairs();
        this.browser.contactMatrixView.clearImageCaches();
        this.browser.tracks2D = [];
        this.browser.tracks = [];
        this.browser.contactMapLabel.textContent = "";
        this.browser.contactMapLabel.title = "";
        this.browser.controlMapLabel.textContent = "";
        this.browser.controlMapLabel.title = "";
        this.browser.dataset = undefined;
        this.browser.controlDataset = undefined;
        this.unsyncSelf();
    }

    /**
     * Clear current session but keep browser alive
     */
    clearSession() {
        // Clear current datasets.
        this.browser.dataset = undefined;
        this.browser.controlDataset = undefined;
        this.browser.setDisplayMode('A');
        this.unsyncSelf();
    }

    /**
     * Remove reference to self from all synchedBrowsers lists
     */
    unsyncSelf() {
        const allBrowsers = getAllBrowsers();
        for (let b of allBrowsers) {
            b.unsync(this.browser);
        }
    }

    /**
     * Remove the reference browser from this collection of synched browsers
     * @param {Object} browser - Browser to remove from sync list
     */
    unsync(browser) {
        const list = [...this.browser.synchedBrowsers];
        this.browser.synchedBrowsers = new Set(list.filter(b => b !== browser));
    }
}

export default BrowserLifecycleManager;
