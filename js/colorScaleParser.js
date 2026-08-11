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

import ColorScale, {defaultColorScaleConfig} from './colorScale.js'
import RatioColorScale from './ratioColorScale.js'
import DiffColorScale from './diffColorScale.js'

/**
 * The signed scales, by the tag their stringify emits.
 */
const signedScales = [RatioColorScale, DiffColorScale]

/**
 * Inverse of ColorScale#stringify, for color scales carried in sessions and
 * URLs.
 *
 * A leading tag selects a signed scale -- "R:" for the ratio scale used by
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

    const signed = signedScales.find(scale => string.startsWith(scale.tag))

    if (signed) {
        const [threshold, positive, negative] = string.substring(signed.tag.length).split(":")
        const scale = new signed(Number.parseFloat(threshold))
        // The two sides default apart -- red above the neutral point, blue below
        // -- so each half falls back to the color the scale was built with, read
        // off the scale before it is overwritten.
        const positiveDefaults = scale.getColorComponents('+')
        const negativeDefaults = scale.getColorComponents('-')
        scale.positiveScale = parseSingle(positive, positiveDefaults)
        scale.negativeScale = parseSingle(negative, negativeDefaults)
        return scale
    }

    return parseSingle(string)
}

/**
 * A bare threshold with no color components -- "18.89619862813927" -- is common
 * in harvested links. Read it as "this threshold, default color" rather than
 * letting the missing components reach getColor and paint rgba(undefined,...).
 * See issue #514.
 *
 * @param {string} string
 * @param {{r: number, g: number, b: number}} defaults the color a component the
 *        string does not supply falls back to. A signed scale passes the
 *        defaults of the side being parsed, which are not the single-sided ones.
 */
function parseSingle(string, defaults = defaultColorScaleConfig) {
    const [threshold, r, g, b] = string.split(",").map(Number.parseFloat)
    return new ColorScale({threshold, ...componentsOrDefault({r, g, b}, defaults)})
}

function componentsOrDefault({r, g, b}, defaults) {
    return {
        r: Number.isFinite(r) ? r : defaults.r,
        g: Number.isFinite(g) ? g : defaults.g,
        b: Number.isFinite(b) ? b : defaults.b
    }
}

export {parseColorScale}

export default parseColorScale
