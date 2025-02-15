import {createBrowserList, deleteAllBrowsers, getAllBrowsers, syncBrowsers} from "./createBrowser.js"
import {Globals} from "./globals.js"
import {StringUtils, BGZip} from "../node_modules/igv-utils/src/index.js";

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