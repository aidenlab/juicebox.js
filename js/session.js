import {createBrowserList, deleteAllBrowsers} from "./createBrowser.js"
import {registryForContainer, currentRegistry} from "./browserRegistry.js"
import {StringUtils, BGZip} from "igv-utils";
import {expandUrlShortcuts} from "./urlUtils.js";

function toJSON() {
    const jsonOBJ = {};
    const browserJson = [];

    // Page-wide, because `toJSON()` is a published zero-argument export with no
    // container to resolve from. Serializing one embed's session rather than
    // "whichever embed was touched last" is decision 5 of ADR-0004, which needs
    // `registry.toJSON()` and lands with the per-embed session work.
    //
    // The same registry `getAllBrowsers()` resolves, which is also what names
    // the registry the selected gene is read from: one embed's session carries
    // that embed's gene, not the page's. #481.
    const registry = currentRegistry();

    for (let browser of registry?.browsers || []) {
        browserJson.push(browser.toJSON());
    }
    jsonOBJ.browsers = browserJson;

    if (registry?.selectedGene) {
        jsonOBJ["selectedGene"] = registry.selectedGene;
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

    deleteAllBrowsers(container);

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
        registryForContainer(container).selectedGene = session.selectedGene;
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
        registryForContainer(container).sync();
    }

}


export {toJSON, restoreSession, compressedSession}