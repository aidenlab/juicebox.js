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

const defaultRatioColorScaleConfig = {threshold: 5, positive: {r: 255, g: 0, b: 0}, negative: {r: 0, g: 0, b: 255}}

class RatioColorScale {

    constructor(threshold) {

        this.threshold = threshold;

        this.positiveScale = new ColorScale({
            threshold: Math.log(threshold),
            r: 255,
            g: 0,
            b: 0
        });
        this.negativeScale = new ColorScale(
            {
                threshold: Math.log(threshold),
                r: 0,
                g: 0,
                b: 255
            })
    }

    setThreshold(threshold) {
        this.threshold = threshold;
        this.positiveScale.setThreshold(Math.log(threshold));
        this.negativeScale.setThreshold(Math.log(threshold));
    }

    getThreshold() {
        return this.threshold;
    }

    setColorComponents(components, plusOrMinus) {
        if ('-' === plusOrMinus) {
            return this.negativeScale.setColorComponents(components);
        } else {
            return this.positiveScale.setColorComponents(components);
        }
    }

    getColorComponents(plusOrMinus) {

        if ('-' === plusOrMinus) {
            return this.negativeScale.getColorComponents();
        } else {
            return this.positiveScale.getColorComponents();
        }
    }

    getColor(score) {

        var logScore = Math.log(score);

        if (logScore < 0) {
            return this.negativeScale.getColor(-logScore);
        } else {
            return this.positiveScale.getColor(logScore);
        }
    }

    stringify() {
        return "R:" + this.threshold + ":" + this.positiveScale.stringify() + ":" + this.negativeScale.stringify();
    }
}

export {defaultRatioColorScaleConfig}

export default RatioColorScale
