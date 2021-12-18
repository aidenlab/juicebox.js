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
 * Created by dat on 3/4/17.
 */
import $ from '../vendor/jquery-3.3.1.slim.js'
import {StringUtils} from '../node_modules/igv-utils/src/index.js'

class ResolutionSelector {

    constructor(browser, $hic_navbar_container) {

        this.browser = browser;

        const $parent = $hic_navbar_container.find("div[id$='upper-hic-nav-bar-widget-container']");

        this.$container = $("<div>", {class: 'hic-resolution-selector-container', title: 'Resolution'});
        $parent.append(this.$container);

        // label container
        this.$label_container = $('<div id="hic-resolution-label-container">');
        this.$container.append(this.$label_container);

        // Resolution (kb)
        this.$label = $("<div>");
        this.$label_container.append(this.$label);
        this.$label.text('Resolution (kb)');
        this.$label.hide();

        // lock/unlock
        this.$resolution_lock = $('<i id="hic-resolution-lock" class="fa fa-unlock" aria-hidden="true">');
        this.$label_container.append(this.$resolution_lock);
        this.$label_container.on('click', () => {
            this.browser.resolutionLocked = !(this.browser.resolutionLocked);
            this.setResolutionLock(this.browser.resolutionLocked);
        });

        this.$resolution_selector = $('<select name="select">');
        this.$container.append(this.$resolution_selector);

        this.$resolution_selector.attr('name', 'resolution_selector');

        this.$resolution_selector.on('change', () => {
            const zoomIndex = parseInt(this.$resolution_selector.val());
            this.browser.setZoom(zoomIndex);
        });


        this.browser.eventBus.subscribe("LocusChange", this);
        this.browser.eventBus.subscribe("MapLoad", this);
        this.browser.eventBus.subscribe("ControlMapLoad", this);
    }

    setResolutionLock(resolutionLocked) {
        this.$resolution_lock.removeClass((true === resolutionLocked) ? 'fa-unlock' : 'fa-lock');
        this.$resolution_lock.addClass((true === resolutionLocked) ? 'fa-lock' : 'fa-unlock');
    }

    receiveEvent(event) {

        const browser = this.browser;

        if (event.type === "LocusChange") {
            if (true === event.data.resolutionChanged) {
                browser.resolutionLocked = false;
                this.setResolutionLock(browser.resolutionLocked);
            }

            if (event.data.chrChanged !== false) {  // Default true
                const isWholeGenome = browser.dataset.isWholeGenome(event.data.state.chr1);
                this.$label.text(isWholeGenome ? 'Resolution (mb)' : 'Resolution (kb)');
                updateResolutions.call(this, browser.state.zoom);
            } else {
                const selectedIndex = browser.state.zoom;
                this.$resolution_selector
                    .find('option')
                    .filter(function (index) {
                        return index === selectedIndex;
                    })
                    .prop('selected', true);
            }

        } else if (event.type === "MapLoad") {
            browser.resolutionLocked = false;
            this.setResolutionLock(false);
            updateResolutions.call(this, browser.state.zoom);
        } else if (event.type === "ControlMapLoad") {
            updateResolutions.call(this, browser.state.zoom)
        }

        async function updateResolutions(zoomIndex) {

            const resolutions = browser.isWholeGenome() ?
                [{index: 0, binSize: browser.dataset.wholeGenomeResolution}] :
                browser.getResolutions();
            let htmlString = '';
            for (let resolution of resolutions) {
                const binSize = resolution.binSize;
                const index = resolution.index;
                let divisor;
                let unit;
                if (binSize >= 1e6) {
                    divisor = 1e6
                    unit = 'mb'
                } else if (binSize >= 1e3) {
                    divisor = 1e3
                    unit = 'kb'
                } else {
                    divisor = 1
                    unit = 'bp'
                }
                const pretty = StringUtils.numberFormatter(Math.round(binSize / divisor)) + ' ' + unit;
                const selected = zoomIndex === resolution.index;
                htmlString += '<option' + ' data-resolution=' + binSize.toString() + ' value=' + index + (selected ? ' selected' : '') + '>' + pretty + '</option>';

            }
            this.$resolution_selector.empty();
            this.$resolution_selector.append(htmlString);
        }


    }
}

export default ResolutionSelector
