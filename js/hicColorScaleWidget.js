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
import $ from '../vendor/jquery-3.3.1.slim.js'
import {IGVColor, DOMUtils, StringUtils} from '../node_modules/igv-utils/src/index.js'
import { ColorPicker, createColorSwatchSelector, GenericContainer} from '../node_modules/igv-ui/dist/igv-ui.js'
import RatioColorScale, {defaultRatioColorScaleConfig} from './ratioColorScale.js'
import ContactMatrixView from "./contactMatrixView.js";
import ColorScale from "./colorScale.js";

class ColorScaleWidget {

    constructor(browser, $hic_navbar_container) {

        this.browser = browser;

        const $container = $hic_navbar_container.find("div[id$='lower-hic-nav-bar-widget-container']");

        this.$container = $('<div class="hic-colorscale-widget-container">');
        $container.append(this.$container);

        // contact map background color picker
        const {r: _r, g: _g, b: _b} = ContactMatrixView.defaultBackgroundColor
        this.$mapBackgroundColorpickerButton = colorSwatch(IGVColor.rgbColor(_r, _g, _b))
        this.$container.append(this.$mapBackgroundColorpickerButton);
        this.backgroundColorpicker = createColorPicker(browser, this.$mapBackgroundColorpickerButton, undefined)

        // '-' color swatch
        const {r: nr, g: ng, b: nb} = defaultRatioColorScaleConfig.negative
        this.$minusButton = colorSwatch(IGVColor.rgbColor(nr, ng, nb));
        this.$container.append(this.$minusButton)
        this.minusColorPicker = createColorPicker(browser, this.$minusButton, '-')
        this.$minusButton.hide()

        // '+' color swatch
        const {r, g, b} = defaultRatioColorScaleConfig.positive
        this.$plusButton = colorSwatch(IGVColor.rgbColor(r, g, b));
        this.$container.append(this.$plusButton)
        this.plusColorPicker = createColorPicker(browser, this.$plusButton, '+')

        this.$minusButton.on('click', () => presentColorPicker(this.minusColorPicker, this.plusColorPicker, this.backgroundColorpicker))
        this.$plusButton.on('click', () => presentColorPicker(this.plusColorPicker, this.minusColorPicker, this.backgroundColorpicker))
        this.$mapBackgroundColorpickerButton.on('click', () => presentColorPicker(this.backgroundColorpicker, this.minusColorPicker, this.plusColorPicker))

        // threshold
        this.$high_colorscale_input = $('<input>', {'type': 'text', 'placeholder': '', 'title': 'color scale input'});
        this.$container.append(this.$high_colorscale_input);
        this.$high_colorscale_input.on('change', function (e) {
            var numeric;
            numeric = StringUtils.numberUnFormatter($(this).val());
            if (isNaN(numeric)) {
                // do nothing
            } else {
                browser.setColorScaleThreshold(numeric);
            }
        });

        // threshold -
        let $fa = $("<i>", {class: 'fa fa-minus', 'aria-hidden': 'true', 'title': 'negative threshold'});
        $fa.on('click', () => this.$high_colorscale_input.val(updateThreshold(browser, 0.5)));
        this.$container.append($fa);

        // threshold +
        $fa = $("<i>", {class: 'fa fa-plus', 'aria-hidden': 'true', 'title': 'positive threshold'});
        $fa.on('click', () => this.$high_colorscale_input.val(updateThreshold(browser, 2.0)));
        this.$container.append($fa);

        const handleColorScaleEvent = event => {

            if (event.data instanceof ColorScale) {

                const {threshold} = event.data
                this.$high_colorscale_input.val(threshold)

                paintSwatch(this.$plusButton, event.data)

            } else if (event.data instanceof RatioColorScale) {

                const {threshold, negativeScale, positiveScale} = event.data

                this.$high_colorscale_input.val(threshold)

                paintSwatch(this.$minusButton, negativeScale)
                paintSwatch(this.$plusButton, positiveScale)
            }

        }

        this.browser.eventBus.subscribe("ColorScale", handleColorScaleEvent);

        const handleDisplayModeEvent = event => {

            if ("AOB" === event.data || "BOA" === event.data) {

                this.$minusButton.show();

                const {negativeScale, positiveScale} = this.browser.contactMatrixView.ratioColorScale
                paintSwatch(this.$minusButton, negativeScale)
                paintSwatch(this.$plusButton, positiveScale)

            } else {
                this.$minusButton.hide();
                paintSwatch(this.$plusButton, this.browser.contactMatrixView.colorScale)
            }
        }

        this.browser.eventBus.subscribe("DisplayMode", handleDisplayModeEvent)

        this.browser.eventBus.subscribe("MapLoad", (ignore) => {
            paintSwatch(this.$mapBackgroundColorpickerButton, this.browser.contactMatrixView.backgroundColor)
        });

    }
}

function paintSwatch($swatch, {r, g, b}) {
    $swatch.get(0).style.backgroundColor = IGVColor.rgbToHex(IGVColor.rgbColor(r, g, b))
}

const updateThreshold = (browser, scaleFactor) => {
    const colorScale = browser.getColorScale();
    browser.setColorScaleThreshold(colorScale.getThreshold() * scaleFactor);
    return StringUtils.numberFormatter(colorScale.getThreshold());
}

function createColorPicker(browser, $parent, type) {

    let defaultColors
    let colorHandler
    if (undefined === type) {

        const { r, g, b } = ContactMatrixView.defaultBackgroundColor
        defaultColors = [ IGVColor.rgbToHex(IGVColor.rgbColor(r, g, b)) ]

        colorHandler = hexString => {
            $parent.get(0).style.backgroundColor = hexString
            const [r, g, b] = IGVColor.hexToRgb(hexString).split('(').pop().split(')').shift().split(',').map(str => parseInt(str, 10))
            browser.contactMatrixView.setBackgroundColor({r, g, b})

        }

    } else {

        defaultColors = [defaultRatioColorScaleConfig.negative, defaultRatioColorScaleConfig.positive].map(({ r, g, b }) => IGVColor.rgbToHex(IGVColor.rgbColor(r, g, b)))

        colorHandler = hexString => {
            $parent.get(0).style.backgroundColor = hexString
            const [r, g, b] = IGVColor.hexToRgb(hexString).split('(').pop().split(')').shift().split(',').map(str => parseInt(str, 10))
            browser.getColorScale().setColorComponents({r, g, b}, type)
            browser.repaintMatrix()
        }

    }

    const config =
        {
            parent: $parent.get(0),
            top: 64,
            left: 64,
            width: 432,
            defaultColors,
            colorHandler
        }

    return new ColorPicker(config)

}

function presentColorPicker(presentable, hideableA, hideableB){
    hideableA.hide()
    hideableB.hide()
    presentable.show()
}

function colorSwatch(rgbString) {
    const swatch = DOMUtils.div({ class: 'igv-ui-color-swatch' })
    swatch.style.backgroundColor = IGVColor.rgbToHex(rgbString)
    return $(swatch)
}


export default ColorScaleWidget
