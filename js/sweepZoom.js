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

class SweepZoom {

    constructor(browser, targetElement) {
        this.browser = browser;
        this.targetElement = targetElement;

        this.rulerSweeperElement = targetElement.querySelector("div[id$='-sweep-zoom-container']");
        this.rulerSweeperElement.style.display = 'none';

        this.sweepRect = {};
    }

    initialize(startX, startY) {
        this.rulerSweeperElement.style.left = `${startX}px`;
        this.rulerSweeperElement.style.top = `${startY}px`;
        this.rulerSweeperElement.style.width = '0px';
        this.rulerSweeperElement.style.height = '0px';
        this.rulerSweeperElement.style.display = 'block';
    }

    update({ left, top, width, height }) {
        this.rulerSweeperElement.style.width = width
        this.rulerSweeperElement.style.height = height
        this.rulerSweeperElement.style.left = left
        this.rulerSweeperElement.style.top = top
    }

    async commit({ xPixel, yPixel, width, height }) {

        this.rulerSweeperElement.style.display = 'none';

        const state = this.browser.state;
        const { chromosomes, bpResolutions } = this.browser.dataset;
        const bpResolution = bpResolutions[state.zoom];

        // bp = ((bin + pixel/pixel-per-bin) / bp-per-bin)
        const xBP = (state.x + (xPixel / state.pixelSize)) * bpResolution
        const yBP = (state.y + (yPixel / state.pixelSize)) * bpResolution
        const  widthBP = ( width / state.pixelSize) * bpResolution;
        const heightBP = (height / state.pixelSize) * bpResolution;

        await this.browser.goto(
            chromosomes[state.chr1].name, Math.round(xBP), Math.round(xBP + widthBP),
            chromosomes[state.chr2].name, Math.round(yBP), Math.round(yBP + heightBP),
        );
    }
}

export default SweepZoom
