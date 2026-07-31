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

import SignedColorScale from './signedColorScale.js'

/**
 * The threshold is a difference in normalized contact counts, so it has no
 * natural value the way a ratio's does -- 100 is the historical default and a
 * starting point, adjustable from the +/- buttons in the color scale widget.
 */
const defaultDiffColorScaleConfig = {threshold: 100, positive: {r: 255, g: 0, b: 0}, negative: {r: 0, g: 0, b: 255}}

/**
 * Color scale for the AMB (A minus B) display mode.
 *
 * AMB scores are signed differences of normalized counts: negative wherever the
 * control map exceeds the primary. The sign picks the side and |score| drives
 * alpha linearly, so equal departures in either direction read equally strong.
 */
class DiffColorScale extends SignedColorScale {

    static prefix = 'D'

    constructor(threshold = defaultDiffColorScaleConfig.threshold) {
        super(threshold, defaultDiffColorScaleConfig)
    }
}

export {defaultDiffColorScaleConfig}

export default DiffColorScale
