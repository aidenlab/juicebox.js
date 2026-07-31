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

import ColorScale from './colorScale.js'
import RatioColorScale from './ratioColorScale.js'
import DiffColorScale from './diffColorScale.js'

/**
 * The two-sided scales, by the tag their stringify emits.
 */
const twoSidedScales = {
    [RatioColorScale.prefix]: RatioColorScale,
    [DiffColorScale.prefix]: DiffColorScale
}

/**
 * Inverse of ColorScale#stringify, for color scales carried in sessions and
 * URLs.
 *
 * A leading tag selects a two-sided scale -- "R:" for the ratio scale used by
 * AOB / BOA, "D:" for the difference scale used by AMB. Anything else is a
 * plain single-sided scale.
 *
 * This lives outside colorScale.js so that the module defining the base class
 * does not import its own subclasses, which would leave them uninitialized
 * whenever a subclass module is the entry point into the cycle.
 *
 * @param {string} string
 * @returns {ColorScale|RatioColorScale|DiffColorScale}
 */
function parseColorScale(string) {

    const twoSided = twoSidedScales[string.charAt(0)]

    if (twoSided && ':' === string.charAt(1)) {
        const [threshold, positive, negative] = string.substring(2).split(":")
        const scale = new twoSided(Number.parseFloat(threshold))
        scale.positiveScale = parseSingle(positive)
        scale.negativeScale = parseSingle(negative)
        return scale
    }

    return parseSingle(string)
}

function parseSingle(string) {
    const [threshold, r, g, b] = string.split(",").map(Number.parseFloat)
    return new ColorScale({threshold, r, g, b})
}

export {parseColorScale}

export default parseColorScale
