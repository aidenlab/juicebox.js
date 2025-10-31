/**
 * Session serialization utilities
 * 
 * @author Juicebox.js contributors
 */

import {isFile} from "./fileUtils.js"

/**
 * Detects local files (File objects) in a browser that cannot be serialized to JSON.
 * 
 * @param {HICBrowser} browser - The browser instance to check
 * @returns {Object} An object with counts of local files:
 *   - hasLocalHicFile: boolean - true if the Hi-C dataset uses a local file
 *   - localTracks1D: number - count of 1D tracks with local files
 *   - localTracks2D: number - count of 2D tracks with local files
 */
function detectLocalFiles(browser) {
    const result = {
        hasLocalHicFile: false,
        localTracks1D: 0,
        localTracks2D: 0
    }

    // Check Hi-C dataset: if dataset exists but has no URL, it was loaded from a local file
    if (browser.dataset && !browser.dataset.url) {
        result.hasLocalHicFile = true
    }

    // Check 1D tracks (trackPairs)
    if (browser.trackPairs && browser.trackPairs.length > 0) {
        for (const trackRenderer of browser.trackPairs) {
            const track = trackRenderer.x?.track
            const config = track?.config
            
            // Skip sequence tracks - they don't need URLs
            if (config && config.type === 'sequence') {
                continue
            }
            
            // Check if config.url is a File object (local file)
            if (config && config.url && isFile(config.url)) {
                result.localTracks1D++
            }
        }
    }

    // Check 2D tracks
    if (browser.tracks2D && browser.tracks2D.length > 0) {
        for (const track2D of browser.tracks2D) {
            const config = track2D?.config
            
            // Check if config.url is a File object (local file)
            if (config && config.url && isFile(config.url)) {
                result.localTracks2D++
            }
        }
    }

    return result
}

export {detectLocalFiles}

