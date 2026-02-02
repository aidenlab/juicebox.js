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

class ScrollbarWidget {

    constructor(browser, xAxisScrollbarContainerElement, yAxisScrollbarContainerElement) {
        this.browser = browser;
        this.isDragging = false;

        // x-axis
        this.xAxisScrollbarContainerElement = xAxisScrollbarContainerElement;
        this.xAxisScrollbarElement = xAxisScrollbarContainerElement.querySelector("div[id$='-x-axis-scrollbar']");
        this.xLabelElement = this.xAxisScrollbarElement.querySelector('div');
        this.xLabelElement.textContent = '';

        // y-axis
        this.yAxisScrollbarContainerElement = yAxisScrollbarContainerElement;
        this.yAxisScrollbarElement = yAxisScrollbarContainerElement.querySelector("div[id$='-y-axis-scrollbar']");
        this.yLabelElement = this.yAxisScrollbarElement.querySelector('.scrollbar-label-rotation-in-place');
        this.yLabelElement.textContent = '';

        // Note: LocusChange subscription removed - now handled by BrowserCoordinator
        // Scrollbar widget is updated via coordinator.onLocusChange()
    }

    receiveEvent(event) {

        if (!this.isDragging && event.type === "LocusChange") {
            const { state } = event.data;
            const { dataset } = this.browser;

            if (state.chr1 === 0) {
                this.xAxisScrollbarElement.style.display = 'none';
                this.yAxisScrollbarElement.style.display = 'none';
            } else {
                this.xAxisScrollbarElement.style.display = 'block';
                this.yAxisScrollbarElement.style.display = 'block';

                this.xAxisScrollbarContainerElement.style.display = 'block';
                this.yAxisScrollbarContainerElement.style.display = 'block';

                const { chr1, chr2, zoom, pixelSize, x, y } = state;

                const chromosomeLengthsBin = [chr1, chr2].map(chr => dataset.chromosomes[chr].size / dataset.bpResolutions[zoom]);
                const chromosomeLengthsPixel = chromosomeLengthsBin.map(bin => bin * pixelSize);
                const { width, height } = this.browser.contactMatrixView.getViewDimensions();
                const pixels = [width, height];

                const bins = pixels.map(pixel => pixel / pixelSize);

                const percentages = bins.map((bin, i) => {
                    const binPercentage = Math.min(bin, chromosomeLengthsBin[i]) / chromosomeLengthsBin[i];
                    const pixelPercentage = Math.min(chromosomeLengthsPixel[i], pixels[i]) / pixels[i];
                    return Math.max(1, Math.round(100 * binPercentage * pixelPercentage));
                });

                this.xAxisScrollbarElement.style.width = `${percentages[0]}%`;
                this.yAxisScrollbarElement.style.height = `${percentages[1]}%`;

                const xPercentage = Math.round(100 * x / chromosomeLengthsBin[0]);
                this.xAxisScrollbarElement.style.left = `${xPercentage}%`;

                const yPercentage = Math.round(100 * y / chromosomeLengthsBin[1]);
                this.yAxisScrollbarElement.style.top = `${yPercentage}%`;

                this.xLabelElement.textContent = dataset.chromosomes[chr1].name;
                this.yLabelElement.textContent = dataset.chromosomes[chr2].name;
            }
        }
    }

}

export default ScrollbarWidget
