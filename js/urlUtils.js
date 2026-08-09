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
 *
 */
import State from './hicState.js';
import {parseColorScale} from "./colorScaleParser.js"
import {StringUtils, BGZip} from 'igv-utils'
import {isFile} from './fileUtils.js'
import {igvxhr} from 'igv-utils'
import {decodeSessionString, isCompressedSession} from './sessionCodec.js'

const DEFAULT_ANNOTATION_COLOR = "rgb(22, 129, 198)";

const urlShortcuts = {
    "*s3e/": "https://hicfiles.s3.amazonaws.com/external/",
    "*s3/": "https://hicfiles.s3.amazonaws.com/",
    "*s3e_/": "http://hicfiles.s3.amazonaws.com/external/",
    "*s3_/": "http://hicfiles.s3.amazonaws.com/",
    "*enc/": "https://www.encodeproject.org/files/"
}

/**
 * Expand URL shortcuts in a URL string (e.g., *s3/ -> full URL)
 * @param {string} url - URL that may contain shortcuts
 * @returns {string} - URL with shortcuts expanded
 */
function expandUrlShortcuts(url) {
    if (!url || typeof url !== 'string') return url;
    let expandedUrl = url;
    Object.keys(urlShortcuts).forEach(function (key) {
        const value = urlShortcuts[key];
        if (expandedUrl.startsWith(key)) {
            expandedUrl = expandedUrl.replace(key, value);
        }
    });
    return expandedUrl;
}

/**
 * Expand the URL shortcuts everywhere a session document can carry one, in
 * place.
 *
 * Sessions handed straight to `restoreSession` never pass through
 * `extractConfig`, so a host or a saved file written with `*s3/` would reach the
 * loaders unexpanded without this. A single-browser config is a session with
 * its one browser inlined, which is why both shapes are walked.
 */
function expandSessionUrlShortcuts(session) {

    for (const config of session.browsers || [session]) {
        for (const key of ['url', 'controlUrl']) {
            if (config[key]) {
                config[key] = expandUrlShortcuts(config[key]);
            }
        }
        for (const track of config.tracks || []) {
            if (track.url) {
                track.url = expandUrlShortcuts(track.url);
            }
        }
    }
}

/**
 * Report a session that would not decode, in the shape the arm naming `origin`
 * has always reported it. Two arms, one shape, one noun apart.
 *
 * `cause` is the failure underneath the codec's single `SessionDecodeError`, and
 * is not always an `Error` -- `BGZip` rejects a corrupt payload with a bare
 * string, whose `message` is `undefined`. That `undefined` reaches the user
 * today; #521 is where it stops.
 */
function parseFailure(origin, e) {
    console.error(`Error parsing session ${origin}:`, e.cause);
    return new Error(`Failed to parse session ${origin}: ${e.cause?.message}`);
}

async function extractConfig(queryString) {

    let query = extractQuery(queryString);
    let sessionConfig;

    if (query.hasOwnProperty("session")) {
        const sessionValue = query.session;

        // Three arms, one decoder. The arms differ only in where the session
        // text comes from -- the parameter itself, a File, or a fetched
        // document -- and in how they report a failure. The reporting is
        // preserved verbatim: `decodeSessionString` raises one error for every
        // malformed session (ADR-0006 decision 9), and each arm rethrows its
        // `cause` in the shape it has always thrown, because #503's golden file
        // pins those messages and this ticket changes no behaviour. Collapsing
        // the three outward messages into one moves those snapshots and is #521.
        if (isCompressedSession(sessionValue)) {
            // No wrapping here, and never has been: a corrupt share link
            // rejects with whatever the decompressor threw, which is a bare
            // string rather than an Error.
            try {
                sessionConfig = decodeSessionString(sessionValue);
            } catch (e) {
                throw e.cause ?? e;
            }
        } else if (isFile(sessionValue)) {
            // Handle File object
            const sessionText = await sessionValue.text();
            try {
                sessionConfig = decodeSessionString(sessionText);
            } catch (e) {
                throw parseFailure("file", e);
            }
        } else if (typeof sessionValue === 'string') {
            // Handle session URL or local file path
            try {
                const sessionText = await igvxhr.loadString(sessionValue);
                try {
                    sessionConfig = decodeSessionString(sessionText);
                } catch (e) {
                    throw parseFailure("from URL/file", e);
                }
            } catch (e) {
                console.error("Error loading session from URL/file:", e);
                throw new Error(`Failed to load session from URL/file: ${e.message}`);
            }
        }
    }

    if (query.hasOwnProperty("juiceboxURL")) {
        const jbURL = await expandURL(query["juiceboxURL"])   // Legacy bitly urls
        query = extractQuery(jbURL);
    }

    if (query.hasOwnProperty("juicebox") || query.hasOwnProperty("juiceboxData")) {
        let q;
        if (query.hasOwnProperty("juiceboxData")) {
            q = BGZip.uncompressString(query["juiceboxData"])
        } else {
            q = query["juicebox"];
            if (q.startsWith("%7B")) {
                q = decodeURIComponent(q);
            }
        }

        q = q.substr(1, q.length - 2);  // Strip leading and trailing bracket
        const parts = q.split("},{");
        const browsers = [];
        for (let p of parts) {
            const qObj = extractQuery(decodeURIComponent(p));
            browsers.push(decodeQuery(qObj))
        }
        sessionConfig = {browsers};
    }

    // Try query parameter style
    const uriDecode = true;
    const queryConfig = decodeQuery(query, uriDecode);
    if (queryConfig.url) {
        sessionConfig = queryConfig;
    }

    // `selectedGene` used to leave `decodeQuery` as a write to a page-scoped
    // global, which is how it reached `restoreSession` from the two paths that
    // do not put it at the top level: a query string carrying the gene beside a
    // `session=`, and the legacy `juicebox=` form, where it sits inside each
    // browser's config. It now rides the session config instead, so it can land
    // on one registry. A session's own value wins, and after that the last
    // writer does -- which is the order the successive global writes produced.
    //
    // Not preserved: `?selectedGene=` on a URL naming no map and no session at
    // all. There being no session config to ride, the gene is dropped rather
    // than reaching whatever config the host passed `init()`. juicebox never
    // writes such a URL -- every URL it produces carries the gene inside the
    // session it also writes. #481.
    if (sessionConfig && undefined === sessionConfig.selectedGene) {
        const fromBrowsers = (sessionConfig.browsers || []).map(b => b.selectedGene).filter(Boolean).pop();
        const selectedGene = queryConfig.selectedGene || fromBrowsers;
        if (selectedGene) {
            sessionConfig.selectedGene = selectedGene;
        }
    }

    // Fix certain defaults
    if (sessionConfig) {
        if (sessionConfig.browsers) {
            for (let b of sessionConfig.browsers) {
                fixDefaults(b);
            }
        } else {
            fixDefaults(sessionConfig);
        }
    }

    return sessionConfig;

}

function fixDefaults(browserConfig) {
    if (browserConfig.tracks) {
        for (let t of browserConfig.tracks) {
            if (t.color === DEFAULT_ANNOTATION_COLOR) {
                delete t.color;
            }
            if (t.min !== undefined && Number.isNaN(t.min)) {
                delete t.min;
            }
            if (t.max !== undefined && Number.isNaN(t.max)) {
                delete t.max;
            }
            t.displayMode = "COLLAPSED";
        }
    }
}


/**
 * Extend config properties with query parameters
 *
 * @param query
 * @param config
 */
function decodeQuery(query, uriDecode) {

    const config = {};

    let hicUrl = query["hicUrl"];
    const name = query["name"];
    let stateString = query["state"];
    let colorScale = query["colorScale"];
    let trackString = query["tracks"];
    const selectedGene = query["selectedGene"];
    const nvi = query["nvi"];

    let controlUrl = query["controlUrl"];
    const controlName = query["controlName"];
    const displayMode = query["displayMode"];
    const controlNvi = query["controlNvi"];
    const cycle = query["cycle"];

    if (hicUrl) {
        hicUrl = paramDecode(hicUrl, uriDecode);
        hicUrl = expandUrlShortcuts(hicUrl);
        config.url = hicUrl;

    }
    if (name) {
        config.name = paramDecode(name, uriDecode);
    }
    if (controlUrl) {
        controlUrl = paramDecode(controlUrl, uriDecode);
        controlUrl = expandUrlShortcuts(controlUrl);
        config.controlUrl = controlUrl;
    }
    if (controlName) {
        config.controlName = paramDecode(controlName, uriDecode);
    }

    if (stateString) {
        stateString = paramDecode(stateString, uriDecode);
        config.state = State.parse(stateString);
    }
    if (colorScale) {
        colorScale = paramDecode(colorScale, uriDecode);
        config.colorScale = parseColorScale(colorScale);
    }

    if (displayMode) {
        config.displayMode = paramDecode(displayMode, uriDecode);
    }

    if (trackString) {
        trackString = paramDecode(trackString, uriDecode);
        config.tracks = destringifyTracksV0(trackString);

        // If an oAuth token is provided append it to track configs.
        if (config.tracks && config.oauthToken) {
            config.tracks.forEach(function (t) {
                t.oauthToken = config.oauthToken;
            })
        }
    }

    if (selectedGene) {
        config.selectedGene = selectedGene;
    }

    config.cycle = cycle;

    if (nvi) {
        config.nvi = paramDecode(nvi, uriDecode);
    }
    if (controlNvi) {
        config.controlNvi = paramDecode(controlNvi, uriDecode);
    }

    return config;

    function destringifyTracksV0(tracks) {

        const trackStringList = tracks.split("|||");
        const configList = [];
        for (let trackString of trackStringList) {

            const tokens = trackString.split("|");
            const color = tokens.pop();
            let url = tokens.length > 1 ? tokens[0] : trackString;
            if (url && url.trim().length > 0 && "undefined" !== url) {
                url = expandUrlShortcuts(url);
                const trackConfig = {url: url};

                if (tokens.length > 1) {
                    trackConfig.name = replaceAll(tokens[1], "$", "|");
                }

                if (tokens.length > 2) {
                    const dataRangeString = tokens[2];
                    if (dataRangeString.startsWith("-")) {
                        const r = dataRangeString.substring(1).split("-");
                        trackConfig.min = -parseFloat(r[0]);
                        trackConfig.max = parseFloat(r[1]);
                    } else {
                        const r = dataRangeString.split("-");
                        trackConfig.min = parseFloat(r[0]);
                        trackConfig.max = parseFloat(r[1]);
                    }
                }

                if (color) {
                    trackConfig.color = color;
                }

                configList.push(trackConfig);
            }
        }
        return configList;
    }

}


function paramDecode(str, uriDecode) {

    if (uriDecode) {
        return decodeURIComponent(str);   // Still more backward compatibility
    } else {
        var s = replaceAll(str, '%26', '&');
        s = replaceAll(s, '%20', ' ');
        s = replaceAll(s, '+', ' ');
        s = replaceAll(s, "%7C", "|");
        s = replaceAll(s, "%23", "#");
        s = replaceAll(s, "%3F", "?");
        s = replaceAll(s, "%3D", "=");
        return s;
    }
}


function replaceAll(str, target, replacement) {
    return str.split(target).join(replacement);
}

function extractQuery(uri) {
    var i1, i2, i, j, s, query, tokens;

    query = {};
    i1 = uri.indexOf("?");
    i2 = uri.lastIndexOf("#");
    const i3 = uri.indexOf("=");
    if (i1 > i3) i1 = -1;

    if (i2 < 0) i2 = uri.length;
    for (i = i1 + 1; i < i2;) {

        j = uri.indexOf("&", i);
        if (j < 0) j = i2;

        s = uri.substring(i, j);
        tokens = s.split("=", 2);
        if (tokens.length === 2) {
            query[tokens[0]] = tokens[1];
        }

        i = j + 1;

    }
    return query;
}

/**
 * Expand legacy bitly URLs
 * @param url
 * @returns {Promise<*>}
 */
async function expandURL(url) {

    const endpoint = `https://api-ssl.bitly.com/v4/expand`;
    const id = url.startsWith("http://") ? url.substring(7) : url.substring(8);
    const message = {
        "bitlink_id": id
    }

    const response = await fetch(endpoint, {
        method: 'POST', // or 'PUT'
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${btoa("ëtá¾´ãÎtsßéÆºÙçµóf¸í¿9snéÝz")}`
        },
        body: JSON.stringify(message),
    })

    if (!response.ok) {
        throw new Error(`Network error (${response.status}): ${response.statusText}`)
    }
    const json = await response.json();
    let longUrl = json.long_url;

    // Fix some Bitly "normalization"
    longUrl = longUrl.replace("{", "%7B").replace("}", "%7D");
    return longUrl;

}

export {extractConfig, DEFAULT_ANNOTATION_COLOR, expandUrlShortcuts, expandSessionUrlShortcuts}
