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

const GEO_DOWNLOAD = /^(https?:)?\/\/www\.ncbi\.nlm\.nih\.gov\/geo\/download\//

/**
 * The name of the file a URL points at: its last path segment, decoded -- or,
 * for a GEO download link only, its `file=` parameter, decoded, since the path
 * there names no file. A `File` gives its own name. The one place juicebox
 * derives a filename, exported so a host need not keep a copy. #692, #698.
 */
function filenameFromUrl(urlOrFile) {
    if (isFile(urlOrFile)) {
        return urlOrFile.name
    }
    const [path, query = ''] = urlOrFile.split('?')
    const fileParam = GEO_DOWNLOAD.test(path) && query.split('&').find(param => param.startsWith('file='))
    let raw
    if (fileParam) {
        raw = fileParam.substring('file='.length)
    } else {
        const idx = path.lastIndexOf("/")
        raw = idx > 0 ? path.substring(idx + 1) : path
    }
    try {
        return decodeURIComponent(raw)
    } catch {
        // A stray '%' is not an escape; show the name as written
        return raw
    }
}

function extractName(config) {
    return config.name === undefined ? filenameFromUrl(config.url) : config.name
}

/**
 * The name juicebox gives a track the host did not name: its file's name, as
 * `extractName` gives a map's. `undefined` when the host named it -- by `name`
 * or by `label`, igv reads either -- and for a `data:` URL, which has no file
 * name and which igv leaves unnamed. The one test of whether a track is
 * unnamed. #695.
 */
function derivedTrackName(config) {
    if (config.name || config.label || String(config.url).startsWith('data:')) {
        return undefined
    }
    return extractName({url: config.url})
}

/** The name a track shows: the host's, else the one juicebox derives. #695. */
function trackName(config) {
    return config.name || config.label || derivedTrackName(config)
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

/**
 * Report a failed load in one embed's own alert dialog.
 *
 * The registry is the alert surface -- passed in rather than reached for,
 * because this module has no browser to resolve one from. See #481.
 *
 * @param {BrowserRegistry} registry - the registry whose container shows this
 * @param {string} prefix - what was being loaded, e.g. "Error loading map"
 * @param {Error} error - the error the load failed with
 */
function presentError(registry, prefix, error) {
    registry.presentAlert(`${prefix}: ${errorMessage(error)}`);
}

/**
 * What the user is told about `error`: the words `presentError` puts after its prefix. Separate so a
 * report naming several failures can phrase each one the way a lone failure is phrased. #663.
 */
function errorMessage(error) {

    if (isBotChallenge(error)) {
        return botChallengeMessage;
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
    return Object.hasOwn(httpMessages, error.code) ? httpMessages[error.code] : error.message;
}

export { createDOMFromHTMLString, getOffset, parseRgbString, prettyPrint, filenameFromUrl, extractName, derivedTrackName, trackName, presentError, errorMessage, isBotChallenge, hitTestBbox }
