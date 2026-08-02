import {Alert} from 'igv-ui'
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

/**
 * A bot challenge arrives under a misleading 405; the tell is the x-amzn-waf-action header, which
 * hic-straw hangs off the thrown error. See docs/adr/0001-dev-proxy-for-waf-protected-hosts.md.
 *
 * @param {Error} error - the error a load failed with
 * @returns {boolean} - true if a bot challenge, rather than the request itself, caused the failure
 */
function isBotChallenge(error) {
    // Not every thrower attaches headers: network errors, aborts and local file reads have none,
    // and only a fetch Response supplies the case-insensitive Headers.get() this relies on.
    return typeof error.headers?.get === 'function' && error.headers.get('x-amzn-waf-action') === 'captcha';
}

const botChallengeMessage =
    "the data provider's bot protection blocked this request. " +
    "The domain of the page making the request — this one — is most likely not on the " +
    "provider's allowlist. " +
    "See https://github.com/aidenlab/juicebox.js/issues/441";

function presentError(prefix, error) {

    if (isBotChallenge(error)) {
        Alert.presentAlert(`${prefix}: ${botChallengeMessage}`);
        return;
    }

    const httpMessages =
        {
            401: "Access unauthorized",
            403: "Access forbidden",
            404: "Not found"
        };

    // hic-straw and igv both throw Error(statusText) with the numeric status on error.code, so
    // that is the only reliable key. Codes arrive as either numbers or strings; object keys
    // normalize both. See issue #442.
    const msg = Object.hasOwn(httpMessages, error.code) ? httpMessages[error.code] : error.message;
    Alert.presentAlert(`${prefix}: ${msg}`);
}

export { createDOMFromHTMLString, getOffset, parseRgbString, prettyPrint, extractName, presentError, hitTestBbox }
