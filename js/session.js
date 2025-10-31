import {createBrowserList, deleteAllBrowsers, getAllBrowsers, syncBrowsers} from "./createBrowser.js"
import {Globals} from "./globals.js"
import {StringUtils, BGZip} from "../node_modules/igv-utils/src/index.js";
import {Alert} from '../node_modules/igv-ui/dist/igv-ui.js'
import {detectLocalFiles} from "./sessionUtils.js"

function toJSON() {
    const jsonOBJ = {};
    const browserJson = [];
    const allBrowsers = getAllBrowsers();
    
    // Detect local files before serialization
    let totalLocalHicFiles = 0;
    let totalLocalTracks1D = 0;
    let totalLocalTracks2D = 0;
    
    for (let browser of allBrowsers) {
        // Detect local files in this browser
        const localFiles = detectLocalFiles(browser);
        if (localFiles.hasLocalHicFile) {
            totalLocalHicFiles++;
        }
        totalLocalTracks1D += localFiles.localTracks1D;
        totalLocalTracks2D += localFiles.localTracks2D;
        
        // Serialize browser (local files will be excluded)
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

    // Show warning if any local files were detected
    if (totalLocalHicFiles > 0 || totalLocalTracks1D > 0 || totalLocalTracks2D > 0) {
        const warningParts = [];
        
        if (totalLocalHicFiles > 0) {
            warningParts.push(`${totalLocalHicFiles} Hi-C file${totalLocalHicFiles > 1 ? 's' : ''}`);
        }
        if (totalLocalTracks1D > 0) {
            warningParts.push(`${totalLocalTracks1D} 1D track${totalLocalTracks1D > 1 ? 's' : ''}`);
        }
        if (totalLocalTracks2D > 0) {
            warningParts.push(`${totalLocalTracks2D} 2D track${totalLocalTracks2D > 1 ? 's' : ''}`);
        }
        
        const warningMessage = `Warning: ${warningParts.join(', ')} with local files ${totalLocalHicFiles + totalLocalTracks1D + totalLocalTracks2D > 1 ? 'were' : 'was'} not saved to the session. Local files cannot be serialized and will need to be reloaded manually.`;
        
        Alert.presentAlert(warningMessage);
    }

    return jsonOBJ;
}

function compressedSession() {
    const jsonString = JSON.stringify(toJSON());
    return `session=blob:${BGZip.compressString(jsonString)}`
}


async function restoreSession(container, session) {

    deleteAllBrowsers();

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