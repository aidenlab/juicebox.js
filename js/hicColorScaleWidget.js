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
 * Created by dat on 3/3/17.
 */
import { IGVColor, StringUtils } from '../node_modules/igv-utils/src/index.js';
import { DOMUtils, ColorPicker } from '../node_modules/igv-ui/dist/igv-ui.js';
import RatioColorScale, { defaultRatioColorScaleConfig } from './ratioColorScale.js';
import ContactMatrixView from "./contactMatrixView.js";
import ColorScale from "./colorScale.js";
import {parseRgbString} from "./utils.js"

class ColorScaleWidget {

    constructor(browser, hicNavbarContainer) {
        this.browser = browser;

        const container = hicNavbarContainer.querySelector("div[id$='lower-hic-nav-bar-widget-container']");

        this.container = document.createElement('div');
        this.container.className = 'hic-colorscale-widget-container';
        container.appendChild(this.container);

        const { r: _r, g: _g, b: _b } = ContactMatrixView.defaultBackgroundColor;
        this.mapBackgroundColorpickerButton = colorSwatch(IGVColor.rgbColor(_r, _g, _b));
        this.container.appendChild(this.mapBackgroundColorpickerButton);
        this.backgroundColorpicker = createColorPicker(browser, this.mapBackgroundColorpickerButton);

        const { r: nr, g: ng, b: nb } = defaultRatioColorScaleConfig.negative;
        this.minusButton = colorSwatch(IGVColor.rgbColor(nr, ng, nb));
        this.container.appendChild(this.minusButton);
        this.minusColorPicker = createColorPicker(browser, this.minusButton, '-');
        this.minusButton.style.display = 'none';

        const { r, g, b } = defaultRatioColorScaleConfig.positive;
        this.plusButton = colorSwatch(IGVColor.rgbColor(r, g, b));
        this.container.appendChild(this.plusButton);
        this.plusColorPicker = createColorPicker(browser, this.plusButton, '+');

        this.minusButton.addEventListener('click', () => presentColorPicker(this.minusColorPicker, this.plusColorPicker, this.backgroundColorpicker));
        this.plusButton.addEventListener('click', () => presentColorPicker(this.plusColorPicker, this.minusColorPicker, this.backgroundColorpicker));
        this.mapBackgroundColorpickerButton.addEventListener('click', () => presentColorPicker(this.backgroundColorpicker, this.minusColorPicker, this.plusColorPicker));

        this.highColorscaleInput = document.createElement('input');
        this.highColorscaleInput.type = 'text';
        this.highColorscaleInput.title = 'color scale input';
        this.container.appendChild(this.highColorscaleInput);
        this.highColorscaleInput.addEventListener('change', (e) => {
            const numeric = StringUtils.numberUnFormatter(e.target.value);
            if (!isNaN(numeric)) {
                browser.setColorScaleThreshold(numeric);
            }
        });

        const minusIcon = createIconButton('fa-minus', 'negative threshold', () => this.highColorscaleInput.value = updateThreshold(browser, 0.5));
        this.container.appendChild(minusIcon);

        const plusIcon = createIconButton('fa-plus', 'positive threshold', () => this.highColorscaleInput.value = updateThreshold(browser, 2.0));
        this.container.appendChild(plusIcon);

        browser.eventBus.subscribe("ColorScale", (event) => {
            if (event.data instanceof ColorScale) {
                this.highColorscaleInput.value = event.data.threshold;
                paintSwatch(this.plusButton, event.data);
            } else if (event.data instanceof RatioColorScale) {
                this.highColorscaleInput.value = event.data.threshold;
                paintSwatch(this.minusButton, event.data.negativeScale);
                paintSwatch(this.plusButton, event.data.positiveScale);
            }
        });

        browser.eventBus.subscribe("DisplayMode", (event) => {
            if (event.data === "AOB" || event.data === "BOA") {
                this.minusButton.style.display = 'block';
                paintSwatch(this.minusButton, browser.contactMatrixView.ratioColorScale.negativeScale);
                paintSwatch(this.plusButton, browser.contactMatrixView.ratioColorScale.positiveScale);
            } else {
                this.minusButton.style.display = 'none';
                paintSwatch(this.plusButton, browser.contactMatrixView.colorScale);
            }
        });

        browser.eventBus.subscribe("MapLoad", () => {
            paintSwatch(this.mapBackgroundColorpickerButton, browser.contactMatrixView.backgroundColor);
        });
    }

    /**
     * Update the map background color swatch.
     * @param {{r: number, g: number, b: number}} backgroundColor - RGB color object
     */
    updateMapBackgroundColor(backgroundColor) {
        if (this.mapBackgroundColorpickerButton) {
            paintSwatch(this.mapBackgroundColorpickerButton, backgroundColor);
        }
    }

    /**
     * Update the widget for display mode changes.
     * Shows/hides the minus button and updates swatches based on mode.
     * @param {string} mode - Display mode ("AOB", "BOA", "A", or "B")
     * @param {RatioColorScale} ratioColorScale - Ratio color scale for AOB/BOA modes
     * @param {ColorScale} colorScale - Standard color scale for A/B modes
     */
    updateForDisplayMode(mode, ratioColorScale, colorScale) {
        if (!this.minusButton || !this.plusButton) {
            return;
        }

        if (mode === "AOB" || mode === "BOA") {
            this.minusButton.style.display = 'block';
            paintSwatch(this.minusButton, ratioColorScale.negativeScale);
            paintSwatch(this.plusButton, ratioColorScale.positiveScale);
        } else {
            this.minusButton.style.display = 'none';
            paintSwatch(this.plusButton, colorScale);
        }
    }

    /**
     * Update the widget for color scale changes.
     * Handles both standard ColorScale and RatioColorScale instances.
     * @param {ColorScale|RatioColorScale} colorScale - The color scale to display
     */
    updateForColorScale(colorScale) {
        if (!this.highColorscaleInput || !this.plusButton) {
            return;
        }

        if (colorScale instanceof ColorScale) {
            this.highColorscaleInput.value = colorScale.threshold;
            paintSwatch(this.plusButton, colorScale);
        } else if (colorScale instanceof RatioColorScale) {
            this.highColorscaleInput.value = colorScale.threshold;
            if (this.minusButton) {
                paintSwatch(this.minusButton, colorScale.negativeScale);
            }
            paintSwatch(this.plusButton, colorScale.positiveScale);
        }
    }
}

function paintSwatch(swatch, { r, g, b }) {
    swatch.style.backgroundColor = IGVColor.rgbToHex(IGVColor.rgbColor(r, g, b));
}

function updateThreshold(browser, scaleFactor) {
    const colorScale = browser.getColorScale();
    browser.setColorScaleThreshold(colorScale.getThreshold() * scaleFactor);
    return StringUtils.numberFormatter(colorScale.getThreshold());
}

function createColorPicker(browser, parent, type) {
    let defaultColors, colorHandler;
    if (!type) {
        const { r, g, b } = ContactMatrixView.defaultBackgroundColor;
        defaultColors = [IGVColor.rgbToHex(IGVColor.rgbColor(r, g, b))];
        colorHandler = (hex) => {
            parent.style.backgroundColor = hex;
            const rgbString = IGVColor.hexToRgb(hex)
            const [r, g, b] = parseRgbString(rgbString)
            browser.contactMatrixView.setBackgroundColor({ r, g, b });
        };
    } else {
        defaultColors = [defaultRatioColorScaleConfig.negative, defaultRatioColorScaleConfig.positive].map(({ r, g, b }) => IGVColor.rgbToHex(IGVColor.rgbColor(r, g, b)));
        colorHandler = (hex) => {
            parent.style.backgroundColor = hex;
            const rgbString = IGVColor.hexToRgb(hex)
            const [r, g, b] = parseRgbString(rgbString)
            browser.getColorScale().setColorComponents({ r, g, b }, type);
            browser.repaintMatrix();
        };
    }
    return new ColorPicker({ parent, top: 64, left: 64, width: 432, defaultColors, colorHandler });
}

function presentColorPicker(presentable, hideableA, hideableB) {
    hideableA.hide()
    hideableB.hide()
    presentable.show()
}

function colorSwatch(rgbString) {
    const swatch = DOMUtils.div({ class: 'igv-ui-color-swatch' });
    swatch.style.backgroundColor = IGVColor.rgbToHex(rgbString);
    return swatch;
}

function createIconButton(iconClass, title, onClick) {
    const icon = document.createElement('i');
    icon.className = `fa ${iconClass}`;
    icon.title = title;
    icon.addEventListener('click', onClick);
    return icon;
}

export default ColorScaleWidget;
