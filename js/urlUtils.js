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

/**
 * The I/O edge of the session decoder, and nothing else.
 *
 * Every decision about what a session URL *means* lives in `js/sessionCodec.js`,
 * which fetches nothing. What is left here is the two reads that path may need —
 * a `session=<url>` document and a legacy bit.ly expansion — and `extractConfig`,
 * which injects them. ADR-0006 decisions 9 and 10.
 *
 * **`extractConfig` stays internal.** It has one caller (`init.js`) and is not
 * exported from `js/index.js`: the public contract here is the wire format, not
 * any function signature, and exporting a decoder would create a second, weaker
 * contract we would then owe compatibility to (decision 9).
 *
 * @see js/sessionCodec.js
 * @see docs/adr/0006-session-wire-format-and-one-decoder.md
 */
import {igvxhr} from 'igv-utils'
import {decodeSession} from './sessionCodec.js'

/**
 * Decode the session a URL carries, doing the decoder's I/O for it.
 *
 * @param {string} queryString - a whole href, as `init.js` reads it from
 *   `window.location.href`
 * @returns {Promise<object|undefined>} the session config, or `undefined` when
 *   nothing in the URL was ours
 */
async function extractConfig(queryString) {
    return decodeSession(queryString, {
        loadString: url => igvxhr.loadString(url),
        expandUrl: expandURL,
    })
}

/**
 * Expand legacy bitly URLs
 *
 * **The bearer literal below is byte-fragile.** It is mojibake carrying three
 * unprintable characters (0x7f, 0x1a, 0x1d); an editor that normalizes them away
 * leaves a token bit.ly answers 403 to, and `test/testURL.js` is the only thing
 * that notices. ADR-0006 decision 1 drops this format and #506 deletes this
 * function; until then, move these bytes, never retype them.
 *
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

export {extractConfig}
