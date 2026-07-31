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

/**
 * A signed color scale: one color for scores above the neutral point, another
 * for scores below it, with alpha carrying the magnitude either side.
 *
 * The comparison display modes both need this shape but disagree about what
 * "below neutral" means, so subclasses supply a `transform` that maps a score
 * onto a signed axis centered on zero:
 *
 *   RatioColorScale (AOB / BOA) -- scores are ratios, positive and centered on
 *   1, so the transform is Math.log.
 *
 *   DiffColorScale (AMB) -- scores are differences, already centered on zero
 *   and already signed, so the transform is the identity.
 *
 * The transform applies to the threshold as well as to the score, keeping both
 * on the axis the underlying single-sided scales measure.
 */
class SignedColorScale {

    /**
     * Subclasses set this to the tag `stringify` emits and `parseColorScale`
     * dispatches on. Colons separate a stringified scale's fields, so the tag
     * carries its own.
     */
    static tag = ''

    /**
     * @param threshold in the units of the score, before `transform`
     * @param {{positive: {r,g,b}, negative: {r,g,b}}} config the two sides' colors
     */
    constructor(threshold, {positive, negative}) {

        this.threshold = threshold

        this.positiveScale = new ColorScale({threshold: this.transform(threshold), ...positive})
        this.negativeScale = new ColorScale({threshold: this.transform(threshold), ...negative})
    }

    /**
     * Map a score, or the threshold, onto the signed axis. Identity by default.
     */
    transform(value) {
        return value
    }

    setThreshold(threshold) {
        this.threshold = threshold
        this.positiveScale.setThreshold(this.transform(threshold))
        this.negativeScale.setThreshold(this.transform(threshold))
    }

    getThreshold() {
        return this.threshold
    }

    setColorComponents(components, plusOrMinus) {
        if ('-' === plusOrMinus) {
            return this.negativeScale.setColorComponents(components)
        } else {
            return this.positiveScale.setColorComponents(components)
        }
    }

    getColorComponents(plusOrMinus) {
        if ('-' === plusOrMinus) {
            return this.negativeScale.getColorComponents()
        } else {
            return this.positiveScale.getColorComponents()
        }
    }

    getColor(score) {

        const signed = this.transform(score)

        if (signed < 0) {
            return this.negativeScale.getColor(-signed)
        } else {
            return this.positiveScale.getColor(signed)
        }
    }

    stringify() {
        return `${this.constructor.tag}${this.threshold}:${this.positiveScale.stringify()}:${this.negativeScale.stringify()}`
    }
}

export default SignedColorScale
