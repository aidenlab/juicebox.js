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
 * which fetches nothing. What is left here is the one read that path may need —
 * a `session=<url>` document — and `extractConfig`, which injects it. ADR-0006
 * decisions 9 and 10.
 *
 * There were two reads until #506 retired the legacy bit.ly expansion, taking
 * the module's only `fetch` and its embedded bearer credential with it.
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
    })
}

export {extractConfig}
