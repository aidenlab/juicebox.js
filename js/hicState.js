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
 * @author Jim Robinson
 */

import { defaultSize } from './createBrowser.js'

class State {

    constructor(chr1, chr2, zoom, x, y, width, height, pixelSize, normalization) {

        if (Number.isNaN(pixelSize)) {
            pixelSize = 1
        }

        if (chr1 !== undefined) {
            if (chr1 <= chr2) {
                this.chr1 = chr1;
                this.chr2 = chr2;
                this.x = x;
                this.y = y;
            } else {
                // Transpose
                this.chr1 = chr2;
                this.chr2 = chr1;
                this.x = y;
                this.y = x;
            }
            this.zoom = zoom;
            this.pixelSize = pixelSize;
            this.width = width
            this.height = height

            if ("undefined" === normalization) {
                console.log("No normalization defined !!!");
                normalization = undefined;
            }

            this.normalization = normalization;
        }
    }

    stringify() {
        if (this.normalization) {
            return `${this.chr1},${this.chr2},${this.zoom},${this.x},${this.y},${this.width},${this.height},${this.pixelSize},${this.normalization}`
        } else {
            return `${this.chr1},${this.chr2},${this.zoom},${this.x},${this.y},${this.width},${this.height},${this.pixelSize}`
        }

    }

    clone() {
        return Object.assign(new State(), this);
    }

    equals(state) {
        var s1 = JSON.stringify(this);
        var s2 = JSON.stringify(state);
        return s1 === s2;
    }

    static parse(string) {

        const tokens = string.split(",")

        if (tokens.length <= 7) {

            // Backwards compatibility
            return new State(
                parseInt(tokens[0]),    // chr1
                parseInt(tokens[1]),    // chr2
                parseFloat(tokens[2]), // zoom
                parseFloat(tokens[3]), // x
                parseFloat(tokens[4]), // y
                defaultSize.width,      // width
                defaultSize.height,     // height
                parseFloat(tokens[5]), // pixelSize
                tokens.length > 6 ? tokens[6] : "NONE"   // normalization
            )
        } else {

            return new State(
                parseInt(tokens[0]),    // chr1
                parseInt(tokens[1]),    // chr2
                parseFloat(tokens[2]), // zoom
                parseFloat(tokens[3]), // x
                parseFloat(tokens[4]), // y
                parseInt(tokens[5]), // width
                parseInt(tokens[6]), // height
                parseFloat(tokens[7]), // pixelSize
                tokens.length > 8 ? tokens[8] : "NONE"   // normalization
            )
        }

    }

    static default(configOrUndefined) {

        if (configOrUndefined) {
            return new State(0, 0, 0, 0, 0, configOrUndefined.width, configOrUndefined.height, 1, "NONE")
        } else {
            return new State(0, 0, 0, 0, 0, defaultSize.width, defaultSize.height, 1, "NONE")
        }

    }


}

export default State
