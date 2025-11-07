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
import ColorScale from "./colorScale.js"
import {Globals} from "./globals.js";
import {StringUtils, BGZip} from '../node_modules/igv-utils/src/index.js'

const DEFAULT_ANNOTATION_COLOR = "rgb(22, 129, 198)";

const urlShortcuts = {
    "*s3e/": "https://hicfiles.s3.amazonaws.com/external/",
    "*s3/": "https://hicfiles.s3.amazonaws.com/",
    "*s3e_/": "http://hicfiles.s3.amazonaws.com/external/",
    "*s3_/": "http://hicfiles.s3.amazonaws.com/",
    "*enc/": "https://www.encodeproject.org/files/"
}

async function extractConfig(queryString) {

    let query = extractQuery(queryString);
    let sessionConfig;

    if (query.hasOwnProperty("session")) {
        if (query.session.startsWith("blob:") || query.session.startsWith("data:")) {
            sessionConfig = JSON.parse(BGZip.uncompressString(query.session.substr(5)));
        } else {
            // TODO - handle session url

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
        Object.keys(urlShortcuts).forEach(function (key) {
            var value = urlShortcuts[key];
            if (hicUrl.startsWith(key)) hicUrl = hicUrl.replace(key, value);
        });
        config.url = hicUrl;

    }
    if (name) {
        config.name = paramDecode(name, uriDecode);
    }
    if (controlUrl) {
        controlUrl = paramDecode(controlUrl, uriDecode);
        Object.keys(urlShortcuts).forEach(function (key) {
            var value = urlShortcuts[key];
            if (controlUrl.startsWith(key)) controlUrl = controlUrl.replace(key, value);
        });
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
        config.colorScale = ColorScale.parse(colorScale);
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
        Globals.selectedGene = selectedGene;
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
                const keys = Object.keys(urlShortcuts);
                for (let key of keys) {
                    var value = urlShortcuts[key];
                    if (url.startsWith(key)) {
                        url = url.replace(key, value);
                        break;
                    }
                }
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

export {extractConfig, DEFAULT_ANNOTATION_COLOR}
