import {Alert} from '../node_modules/igv-ui/dist/igv-ui.js'
import {isFile} from "./fileUtils.js"

function createDOMFromHTMLString(string) {
    const template = document.createElement('template');
    template.innerHTML = string.trim(); // Removes whitespace to avoid unintended text nodes
    return template.content.firstElementChild;
}

function getOffset(element) {
    const { top, left } = element.getBoundingClientRect();
    return { top: top + window.scrollY, left: left + window.scrollX };
}

function parseRgbString(rgbString) {

    // Use a regular expression to extract the numbers from the string
    const match = rgbString.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);

    // Check if the match is successful
    if (!match) {
        throw new Error("Invalid RGB string format");
    }

    // Convert the matched strings into integers and return them as an array
    return match.slice(1, 4).map(Number);
}

function prettyPrint(number) {

    if (typeof number !== "number") {
        console.error(`${ number } must be a number`)
        return
    }

    const integerPart = Math.trunc(number)
    return integerPart.toLocaleString()
}

function extractName(config) {
    if (config.name === undefined) {
        const urlOrFile = config.url
        if (isFile(urlOrFile)) {
            return urlOrFile.name
        } else {
            const str = urlOrFile.split('?').shift()
            const idx = urlOrFile.lastIndexOf("/")
            return idx > 0 ? str.substring(idx + 1) : str
        }
    } else {
        return config.name
    }
}

/**
 * Hit test function for bounding box arrays.
 * Finds the element whose bounding box contains the given value.
 * 
 * @param {Array<{a: number, b: number, element: HTMLElement}>} bboxes - Array of bounding boxes
 * @param {number} value - The value to test against bounding boxes
 * @returns {HTMLElement|undefined} - The element whose bounding box contains the value, or undefined
 */
function hitTestBbox(bboxes, value) {
    for (const bbox of bboxes) {
        if (value >= bbox.a && value <= bbox.b) {
            return bbox.element;
        }
    }
    return undefined;
}

function presentError(prefix, error) {
    const httpMessages =
        {
            401: "Access unauthorized",
            403: "Access forbidden",
            404: "Not found"
        };

    const msg = httpMessages[error.message] || error.message;
    Alert.presentAlert(`${prefix}: ${msg}`);
}

export { createDOMFromHTMLString, getOffset, parseRgbString, prettyPrint, extractName, presentError, hitTestBbox }
