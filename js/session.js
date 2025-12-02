import {createBrowserList, deleteAllBrowsers, getAllBrowsers, syncBrowsers} from "./createBrowser.js"
import {Globals} from "./globals.js"
import {StringUtils, BGZip} from "../node_modules/igv-utils/src/index.js";
import {expandUrlShortcuts} from "./urlUtils.js";

function toJSON() {
    const jsonOBJ = {};
    const browserJson = [];
    const allBrowsers = getAllBrowsers();
    for (let browser of allBrowsers) {
        browserJson.push(browser.toJSON());
    }
    jsonOBJ.browsers = browserJson;

    if (Globals.selectedGene) {
        jsonOBJ["selectedGene"] = Globals.selectedGene;
    }

    const captionDiv = document.getElementById('hic-caption');
    if (captionDiv) {
        var captionText = captionDiv.textContent;
        if (captionText) {
            captionText = captionText.trim();
            if (captionText) {
                jsonOBJ.caption = captionText;
            }
        }
    }

    return jsonOBJ;
}

function compressedSession() {
    const jsonString = JSON.stringify(toJSON());
    return `session=blob:${BGZip.compressString(jsonString)}`
}


async function restoreSession(container, session) {

    deleteAllBrowsers();

    // Expand URL shortcuts in session config for backward compatibility
    // This ensures sessions passed directly to restoreSession (not through extractConfig)
    // still work with URL shortcuts like *s3/, *enc/, etc.
    if (session.browsers) {
        for (let browser of session.browsers) {
            if (browser.url) {
                browser.url = expandUrlShortcuts(browser.url);
            }
            if (browser.controlUrl) {
                browser.controlUrl = expandUrlShortcuts(browser.controlUrl);
            }
            if (browser.tracks) {
                for (let track of browser.tracks) {
                    if (track.url) {
                        track.url = expandUrlShortcuts(track.url);
                    }
                }
            }
        }
    } else {
        // Single browser config (not in browsers array)
        if (session.url) {
            session.url = expandUrlShortcuts(session.url);
        }
        if (session.controlUrl) {
            session.controlUrl = expandUrlShortcuts(session.controlUrl);
        }
        if (session.tracks) {
            for (let track of session.tracks) {
                if (track.url) {
                    track.url = expandUrlShortcuts(track.url);
                }
            }
        }
    }

    if (session.hasOwnProperty("selectedGene")) {
        Globals.selectedGene = session.selectedGene;
    }
    if (session.hasOwnProperty("caption")) {
        const captionText = session.caption;
        var captionDiv = document.getElementById("hic-caption");
        if (captionDiv) {
            captionDiv.textContent = captionText;
        }
    }

    await createBrowserList(container, session);

    if (false !== session.syncDatasets) {
        syncBrowsers();
    }

}


export {toJSON, restoreSession, compressedSession}