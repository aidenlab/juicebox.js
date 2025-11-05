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

import {IGVColor, IGVMath} from '../node_modules/igv-utils/src/index.js'
import igv from '../node_modules/igv/dist/igv.esm.js'

class Ruler {

    constructor(browser, parentElement, axis) {
        this.browser = browser;
        this.axis = axis;

        this.axisElement = parentElement.querySelector(`div[id$='-axis']`);

        this.canvasElement = parentElement.querySelector("canvas");

        this.ctx = this.canvasElement.getContext("2d");
        this.ctx.canvas.width = this.axisElement.offsetWidth;
        this.ctx.canvas.height = this.axisElement.offsetHeight;

        this.wholeGenomeContainerElement = parentElement.querySelector("div[id$='-axis-whole-genome-container']");

        this.setAxisTransform(axis);

        browser.eventBus.subscribe('MapLoad', this);
        browser.eventBus.subscribe("UpdateContactMapMousePosition", this);
    }

    wholeGenomeLayout(axisElement, wholeGenomeContainerElement, axisName, dataset) {

        const decorate = (div) => {
            div.addEventListener('click', () => {
                this.browser.parseGotoInput(div.textContent);
                this.unhighlightWholeChromosome();
                this.otherRuler.unhighlightWholeChromosome();
            });

            div.addEventListener('mouseenter', () => {
                hoverHandler.call(this, div, true);
            });

            div.addEventListener('mouseleave', () => {
                hoverHandler.call(this, div, false);
            });
        };

        const hoverHandler = (element, doHover) => {
            const targetLabel = element.dataset.label;

            Array.from(this.otherRuler.wholeGenomeContainerElement.children).forEach(child => {
                if (child.dataset.label === targetLabel) {
                    if (doHover) {
                        element.classList.add('hic-whole-genome-chromosome-highlight');
                        child.classList.add('hic-whole-genome-chromosome-highlight');
                    } else {
                        element.classList.remove('hic-whole-genome-chromosome-highlight');
                        child.classList.remove('hic-whole-genome-chromosome-highlight');
                    }
                }
            });
        };


        const self = this;
        let list, dimen, extent, scraps, divElement, firstDivElement;

        // discard current tiles
        wholeGenomeContainerElement.innerHTML = '';

        list = dataset.chromosomes.filter(chromosome => chromosome.name.toLowerCase() !== 'all');

        extent = list.reduce((sum, chromosome) => sum + chromosome.size, 0);

        dimen = axisName === 'x' ? axisElement.offsetWidth : axisElement.offsetHeight;

        scraps = 0;
        this.bboxes = [];
        firstDivElement = undefined;

        for (const chr of list) {
            const percentage = chr.bpLength / extent;

            if (percentage * dimen < 1.0) {
                scraps += percentage;
            } else {
                const divElement = document.createElement('div');
                divElement.className = `${this.axis}-axis-whole-genome-chromosome-container`;
                divElement.dataset.label = chr.name;
                wholeGenomeContainerElement.appendChild(divElement);

                if (!firstDivElement) {
                    firstDivElement = divElement;
                }

                const size = Math.round(percentage * dimen);
                if (axisName === 'x') {
                    divElement.style.width = `${size}px`;
                } else {
                    divElement.style.height = `${size}px`;
                }

                // Border
                const borderElement = document.createElement('div');
                divElement.appendChild(borderElement);

                // Label
                const labelElement = document.createElement('div');
                borderElement.appendChild(labelElement);

                labelElement.textContent = divElement.dataset.label;
                labelElement.title = divElement.dataset.label;

                decorate(divElement);
            }
        }

        scraps = Math.floor(scraps * dimen);
        if (scraps >= 1) {

            const divElement = document.createElement('div')
            wholeGenomeContainerElement.appendChild(divElement)

            divElement.className = `${this.axis}-axis-whole-genome-chromosome-container`
            divElement.dataset.label = '-';
            divElement.style.width = `${scraps}px`;

            decorate(divElement);
        }

        for (const child of wholeGenomeContainerElement.children) {
            this.bboxes.push(bbox(axisName, child, firstDivElement));
        }

        this.hideWholeGenome();

    }

    hideWholeGenome() {
        this.wholeGenomeContainerElement.style.display = 'none';
        this.canvasElement.style.display = 'block';
    }

    showWholeGenome() {
        this.canvasElement.style.display = 'none';
        this.wholeGenomeContainerElement.style.display = 'flex';
    }

    setAxisTransform(axis) {

        this.canvasTransform    = ('y' === axis) ? canvasTransformWithContext      : identityTransformWithContext
        this.labelTransform     = ('y' === axis) ? labelTransformWithContext : noopTransformWithContext

    }

    unhighlightWholeChromosome() {
        for (const child of this.wholeGenomeContainerElement.children) {
            child.classList.remove('hic-whole-genome-chromosome-highlight');
        }
    }

    receiveEvent(event) {
        let offset, element;

        if (event.type === 'MapLoad') {
            // Handle both old format (event.data is dataset) and new format (event.data.dataset)
            const dataset = event.data.dataset || event.data;
            this.wholeGenomeLayout(this.axisElement, this.wholeGenomeContainerElement, this.axis, dataset);
            this.update();
        } else if (event.type === 'UpdateContactMapMousePosition') {
            if (this.bboxes) {
                this.unhighlightWholeChromosome();
                offset = this.axis === 'x' ? event.data.x : event.data.y;
                element = hitTest(this.bboxes, offset);
                if (element) {
                    element.classList.add('hic-whole-genome-chromosome-highlight');
                }
            }
        }
    }

    locusChange(event) {

        this.update();

    }

    updateWidthWithCalculation(calc) {
        this.axisElement.style.width = calc;

        const axisWidth = this.axisElement.offsetWidth;
        this.canvasElement.width = axisWidth;
        this.canvasElement.setAttribute('width', axisWidth);

        this.wholeGenomeLayout(this.axisElement, this.wholeGenomeContainerElement, this.axis, this.browser.dataset);
        this.update();
    }

    updateHeight(height) {
        this.canvasElement.height = height;
        this.canvasElement.setAttribute('height', height);

        this.wholeGenomeLayout(this.axisElement, this.wholeGenomeContainerElement, this.axis, this.browser.dataset);
        this.update();
    }

    update() {
        const browser = this.browser;
        const config = {};

        // Safety check: ensure dataset and state exist before accessing them
        if (!browser.dataset || !browser.state) {
            return;
        }

        if (browser.dataset.isWholeGenome(browser.state.chr1)) {
            this.showWholeGenome();
            return;
        }

        this.hideWholeGenome();

        identityTransformWithContext(this.ctx);
        igv.IGVGraphics.fillRect(
            this.ctx,
            0,
            0,
            this.canvasElement.width,
            this.canvasElement.height,
            { fillStyle: IGVColor.rgbColor(255, 255, 255) }
        );

        this.canvasTransform(this.ctx);

        const width = this.axis === 'x' ? this.canvasElement.width : this.canvasElement.height;
        const height = this.axis === 'x' ? this.canvasElement.height : this.canvasElement.width;

        igv.IGVGraphics.fillRect(
            this.ctx,
            0,
            0,
            width,
            height,
            { fillStyle: IGVColor.rgbColor(255, 255, 255) }
        );

        config.bpPerPixel = browser.dataset.bpResolutions[browser.state.zoom] / browser.state.pixelSize;
        const bin = this.axis === 'x' ? browser.state.x : browser.state.y;
        config.bpStart = bin * browser.dataset.bpResolutions[browser.state.zoom];

        config.rulerTickMarkReferencePixels = Math.max(
            this.canvasElement.width,
            this.canvasElement.height,
            this.otherRulerCanvas.width,
            this.otherRulerCanvas.height
        );

        config.rulerLengthPixels = width;
        config.rulerHeightPixels = height;

        config.height = Math.min(this.canvasElement.width, this.canvasElement.height);

        this.draw(config);
    }

    draw(options) {
        const {
            rulerLengthPixels,
            rulerHeightPixels,
            rulerTickMarkReferencePixels,
            bpPerPixel,
            bpStart,
            chrName
        } = options;

        const { chromosomes } = this.browser.dataset;
        const { state } = this.browser;
        const axisIsX = this.axis === 'x';
        const chr = axisIsX ? chromosomes[state.chr1] : chromosomes[state.chr2];
        const { name: chrNameSelected, size: chrSize } = chr;

        if (chrName !== "all") {
            // Clear the ruler area
            igv.IGVGraphics.fillRect(this.ctx, 0, 0, rulerLengthPixels, rulerHeightPixels, {
                fillStyle: IGVColor.rgbColor(255, 255, 255)
            });

            const fontStyle = {
                textAlign: 'center',
                font: '9px PT Sans',
                fillStyle: "rgba(64, 64, 64, 1)",
                strokeStyle: "rgba(64, 64, 64, 1)"
            };

            const tickSpec = findSpacing(Math.floor(rulerTickMarkReferencePixels * bpPerPixel));
            const majorTickSpacing = tickSpec.majorTick;

            let nTick = Math.floor(bpStart / majorTickSpacing) - 1;
            let pixel = 0;
            let pixelLast = 0;

            igv.IGVGraphics.setProperties(this.ctx, fontStyle);
            this.ctx.lineWidth = 1.0;

            const yShim = 1;
            const tickHeight = 8;

            while (pixel < rulerLengthPixels) {
                const l = Math.floor(nTick * majorTickSpacing);
                pixel = Math.round(((l - 1) - bpStart + 0.5) / bpPerPixel);

                const rulerLabel = `${formatNumber(l / tickSpec.unitMultiplier, 0)} ${tickSpec.majorUnit}`;
                const tickSpacingPixels = Math.abs(pixel - pixelLast);
                const labelWidthPixels = this.ctx.measureText(rulerLabel).width;

                const modulo = labelWidthPixels > tickSpacingPixels
                    ? (tickSpacingPixels < 32 ? 4 : 2)
                    : 1;

                if (nTick % modulo === 0) {
                    if (Math.floor((pixel * bpPerPixel) + bpStart) < chrSize) {
                        this.ctx.save();
                        this.labelTransform(this.ctx, pixel);
                        igv.IGVGraphics.fillText(this.ctx, rulerLabel, pixel, options.height - (tickHeight / 0.75));
                        this.ctx.restore();
                    }
                }

                if (Math.floor((pixel * bpPerPixel) + bpStart) < chrSize) {
                    igv.IGVGraphics.strokeLine(
                        this.ctx,
                        pixel, options.height - tickHeight,
                        pixel, options.height - yShim
                    );
                }

                pixelLast = pixel;
                nTick++;
            }

            // Draw the baseline
            igv.IGVGraphics.strokeLine(this.ctx, 0, options.height - yShim, rulerLengthPixels, options.height - yShim);
        }
    }
}

const formatNumber = (num, decimal = 0) => {
    // Ensure decimal is between 0 and 3
    const precision = Math.min(Math.max(decimal, 0), 3);

    // Round the number to the desired decimal places
    const roundedNum = Math.abs(num).toFixed(precision);

    // Split the integer and decimal parts
    let [integerPart, decimalPart] = roundedNum.split(".");

    // Add commas to the integer part
    integerPart = parseInt(integerPart, 10).toLocaleString();

    // Pad the decimal part with zeros if necessary
    if (precision > 0) {
        decimalPart = decimalPart.padEnd(precision, "0");
    }

    // Combine integer and decimal parts
    let formattedNum = precision > 0 ? `${integerPart}.${decimalPart}` : integerPart;

    // Wrap in parentheses if the original number was negative
    if (num < 0) {
        formattedNum = `(${formattedNum})`;
    }

    // Optionally, prepend a dollar sign
    // formattedNum = `$${formattedNum}`;

    return formattedNum;
}

function bbox(axis, childElement, firstChildElement) {
    const offset = axis === 'x'
        ? childElement.getBoundingClientRect().left
        : childElement.getBoundingClientRect().top;

    const firstOffset = axis === 'x'
        ? firstChildElement.getBoundingClientRect().left
        : firstChildElement.getBoundingClientRect().top;

    const delta = offset - firstOffset;
    const size = axis === 'x'
        ? childElement.offsetWidth
        : childElement.offsetHeight;

    return { element: childElement, a: delta, b: delta + size };
}

function hitTest(bboxes, value) {

    let hitElement = undefined;

    for (const bbox of bboxes) {
        if (value >= bbox.a && value <= bbox.b) {
            hitElement = bbox.element;
            break;
        }
    }

    return hitElement;
}

function TickSpacing(majorTick, majorUnit, unitMultiplier) {
    this.majorTick = majorTick;
    this.majorUnit = majorUnit;
    this.unitMultiplier = unitMultiplier;
}

function findSpacing(rulerLengthBP) {

    if (rulerLengthBP < 10) {
        return new TickSpacing(1, "", 1);
    }


    // How many zeroes?
    var nZeroes = Math.floor(log10(rulerLengthBP));
    var majorUnit = "";
    var unitMultiplier = 1;
    if (nZeroes > 9) {
        majorUnit = "gb";
        unitMultiplier = 1000000000;
    }
    if (nZeroes > 6) {
        majorUnit = "mb";
        unitMultiplier = 1000000;
    } else if (nZeroes > 3) {
        majorUnit = "kb";
        unitMultiplier = 1000;
    }

    var nMajorTicks = rulerLengthBP / Math.pow(10, nZeroes - 1);
    if (nMajorTicks < 25) {
        return new TickSpacing(Math.pow(10, nZeroes - 1), majorUnit, unitMultiplier);
    } else {
        return new TickSpacing(Math.pow(10, nZeroes) / 2, majorUnit, unitMultiplier);
    }

    function log10(x) {
        var dn = Math.log(10);
        return Math.log(x) / dn;
    }
}

function canvasTransformWithContext(ctx) {
    ctx.setTransform(0, 1, 1, 0, 0, 0)
}

function labelTransformWithContext(context, exe) {
    context.translate(exe, 0);
    context.scale(-1, 1);
    context.translate(-exe, 0);
}

function identityTransformWithContext(context) {
    // 3x2 matrix. column major. (sx 0 0 sy tx ty).
    context.setTransform(1, 0, 0, 1, 0, 0);
}

function noopTransformWithContext(ctx) {

}

export default Ruler;
