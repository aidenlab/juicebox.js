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

    constructor(browser, $x_axis_scrollbar_container, $y_axis_scrollbar_container) {

        let id;

        this.browser = browser;
        this.isDragging = false;

        // x-axis
        this.$x_axis_scrollbar_container = $x_axis_scrollbar_container;
        this.$x_axis_scrollbar = this.$x_axis_scrollbar_container.find("div[id$='-x-axis-scrollbar']");
        this.$x_label = this.$x_axis_scrollbar.find('div');
        this.$x_label.text('');

        // y-axis
        this.$y_axis_scrollbar_container = $y_axis_scrollbar_container;
        this.$y_axis_scrollbar = this.$y_axis_scrollbar_container.find("div[id$='-y-axis-scrollbar']");
        this.$y_label = this.$y_axis_scrollbar.find('.scrollbar-label-rotation-in-place');
        this.$y_label.text('');

        this.browser.eventBus.subscribe("LocusChange", this);

    }

    css2Bin(chromosome, $element, attribute) {
        var numer,
            denom,
            percentage;

        numer = $element.css(attribute).slice(0, -2);
        denom = $element.parent().css('left' === attribute ? 'width' : 'height').slice(0, -2);
        percentage = parseInt(numer, 10) / parseInt(denom, 10);

        return percentage * chromosome.size / this.browser.dataset.bpResolutions[this.browser.state.zoom];
    }

    receiveEvent(event) {
        var self = this,
            chromosomeLengthsBin,
            chromosomeLengthsPixel,
            width,
            height,
            pixels,
            widthBin,
            heightBin,
            bins,
            percentage,
            percentages,
            str;

        if (!this.isDragging && event.type === "LocusChange") {

            var state = event.data.state,
                dataset = self.browser.dataset;

            if (0 === state.chr1) {
                this.$x_axis_scrollbar.hide();
                this.$y_axis_scrollbar.hide();
            } else {

                this.$x_axis_scrollbar.show();
                this.$y_axis_scrollbar.show();

                this.$x_axis_scrollbar_container.show();
                this.$y_axis_scrollbar_container.show();

                const {chr1, chr2, zoom, pixelSize, x, y} = state;

                // bp / bp-per-bin -> bin
                chromosomeLengthsBin = [chr1, chr2].map(chr => {
                    return dataset.chromosomes[chr].size / dataset.bpResolutions[zoom]
                });

                chromosomeLengthsPixel = chromosomeLengthsBin.map(bin => bin * pixelSize);

                pixels = [this.browser.contactMatrixView.getViewDimensions().width, this.browser.contactMatrixView.getViewDimensions().height];

                // pixel / pixel-per-bin -> bin
                bins = [pixels[0] / pixelSize, pixels[pixels.length - 1] / pixelSize];

                // bin / bin -> percentage
                percentages = bins.map((bin, i) => {
                    const binPercentage = Math.min(bin, chromosomeLengthsBin[i]) / chromosomeLengthsBin[i];
                    const pixelPercentage = Math.min(chromosomeLengthsPixel[i], pixels[i]) / pixels[i];
                    return Math.max(1, Math.round(100 * binPercentage * pixelPercentage));
                });

                this.$x_axis_scrollbar.css('width', `${percentages[0]}%`);
                this.$y_axis_scrollbar.css('height', `${percentages[percentages.length - 1]}%`);

                // bin / bin -> percentage
                percentage = Math.round(100 * x / chromosomeLengthsBin[0]);
                this.$x_axis_scrollbar.css('left', `${percentage}%`);

                // bin / bin -> percentage
                percentage = Math.round(100 * y / chromosomeLengthsBin[chromosomeLengthsBin.length - 1]);
                this.$y_axis_scrollbar.css('top', `${percentage}%`);

                this.$x_label.text(dataset.chromosomes[chr1].name);
                this.$y_label.text(dataset.chromosomes[chr2].name);

            }

        }
    }
}

export default ScrollbarWidget
