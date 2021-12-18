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
 * Created by dat on 3/14/17.
 */

class SweepZoom {

    constructor(browser, $target) {

        this.browser = browser;

        this.$target = $target;

        this.$rulerSweeper = $target.find("div[id$='-sweep-zoom-container']");
        this.$rulerSweeper.hide();

        this.sweepRect = {};
    }

    initialize(pageCoords) {

        this.anchor = pageCoords;
        this.coordinateFrame = this.$rulerSweeper.parent().offset();
        this.aspectRatio = this.$target.width() / this.$target.height();
        this.sweepRect.x = {
            x: pageCoords.x,
            y: pageCoords.y,
            width: 1,
            height: 1
        };
        this.clipped = {value: false};
    }

    update(pageCoords) {

        var anchor = this.anchor,
            dx = Math.abs(pageCoords.x - anchor.x),
            dy = Math.abs(pageCoords.y - anchor.y);

        // Adjust deltas to conform to aspect ratio
        if (dx / dy > this.aspectRatio) {
            dy = dx / this.aspectRatio;
        } else {
            dx = dy * this.aspectRatio;
        }

        this.sweepRect.width = dx;
        this.sweepRect.height = dy;
        this.sweepRect.x = anchor.x < pageCoords.x ? anchor.x : anchor.x - dx;
        this.sweepRect.y = anchor.y < pageCoords.y ? anchor.y : anchor.y - dy;


        this.$rulerSweeper.width(this.sweepRect.width);
        this.$rulerSweeper.height(this.sweepRect.height);


        this.$rulerSweeper.offset(
            {
                left: this.sweepRect.x,
                top: this.sweepRect.y
            }
        );
        this.$rulerSweeper.show();

    }

    commit() {


        this.$rulerSweeper.hide();

        const state = this.browser.state;

        // bp-per-bin
        const resolution = this.browser.resolution();

        // Convert page -> offset coordinates
        const posX = this.sweepRect.x - this.$target.offset().left;
        const posY = this.sweepRect.y - this.$target.offset().top;


        // bp = ((bin + pixel/pixel-per-bin) / bp-per-bin)
        const x = (state.x + (posX / state.pixelSize)) * resolution;
        const y = (state.y + (posY / state.pixelSize)) * resolution;

        // bp = ((bin + pixel/pixel-per-bin) / bp-per-bin)
        const width = (this.sweepRect.width / state.pixelSize) * resolution;
        const height = (this.sweepRect.height / state.pixelSize) * resolution;

        // bp = bp + bp
        const xMax = x + width;
        const yMax = y + height;

        const minimumResolution = this.browser.dataset.bpResolutions[this.browser.dataset.bpResolutions.length - 1];
        this.browser.goto(state.chr1, x, xMax, state.chr2, y, yMax, minimumResolution);

    }
}

export default SweepZoom
