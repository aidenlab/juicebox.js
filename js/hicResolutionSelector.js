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
import { StringUtils } from '../node_modules/igv-utils/src/index.js';

class ResolutionSelector {

    constructor(browser, hicNavbarContainer) {
        this.browser = browser;

        const parentElement = hicNavbarContainer.querySelector("div[id$='upper-hic-nav-bar-widget-container']");

        this.containerElement = document.createElement('div');
        this.containerElement.className = 'hic-resolution-selector-container';
        this.containerElement.title = 'Resolution';
        parentElement.appendChild(this.containerElement);

        // label container
        this.labelContainerElement = document.createElement('div');
        this.labelContainerElement.id = 'hic-resolution-label-container';
        this.containerElement.appendChild(this.labelContainerElement);

        // Resolution (kb)
        this.labelElement = document.createElement('div');
        this.labelElement.textContent = 'Resolution (kb)';
        this.labelElement.style.display = 'none';
        this.labelContainerElement.appendChild(this.labelElement);

        // lock/unlock
        this.resolutionLockElement = document.createElement('i');
        this.resolutionLockElement.id = 'hic-resolution-lock';
        this.resolutionLockElement.className = 'fa fa-unlock';
        this.resolutionLockElement.setAttribute('aria-hidden', 'true');
        this.labelContainerElement.appendChild(this.resolutionLockElement);
        this.labelContainerElement.addEventListener('click', () => {
            this.browser.resolutionLocked = !this.browser.resolutionLocked;
            this.setResolutionLock(this.browser.resolutionLocked);
        });

        this.resolutionSelectorElement = document.createElement('select');
        this.resolutionSelectorElement.name = 'resolution_selector';
        this.containerElement.appendChild(this.resolutionSelectorElement);

        this.resolutionSelectorElement.addEventListener('change', () => {
            const zoomIndex = parseInt(this.resolutionSelectorElement.value);
            this.browser.setZoom(zoomIndex);
        });

        // Note: MapLoad, ControlMapLoad, and LocusChange subscriptions removed - now handled by BrowserCoordinator
        // These components are updated directly via coordinator methods
    }

    setResolutionLock(resolutionLocked) {
        this.resolutionLockElement.classList.remove(resolutionLocked ? 'fa-unlock' : 'fa-lock');
        this.resolutionLockElement.classList.add(resolutionLocked ? 'fa-lock' : 'fa-unlock');
    }

    receiveEvent(event) {
        const browser = this.browser;

        if (event.type === "LocusChange") {
            if (event.data.resolutionChanged) {
                browser.resolutionLocked = false;
                this.setResolutionLock(browser.resolutionLocked);
            }

            if (event.data.chrChanged !== false) {
                const isWholeGenome = browser.dataset.isWholeGenome(event.data.state.chr1);
                this.labelElement.textContent = isWholeGenome ? 'Resolution (mb)' : 'Resolution (kb)';
                this.updateResolutions(browser.state.zoom);
            } else {
                const selectedIndex = browser.state.zoom;
                Array.from(this.resolutionSelectorElement.options).forEach((option, index) => {
                    option.selected = index === selectedIndex;
                });
            }
        } else if (event.type === "MapLoad") {
            browser.resolutionLocked = false;
            this.setResolutionLock(false);
            this.updateResolutions(browser.state.zoom);
        } else if (event.type === "ControlMapLoad") {
            this.updateResolutions(browser.state.zoom);
        }
    }

    async updateResolutions(zoomIndex) {
        const browser = this.browser;
        const resolutions = browser.isWholeGenome() ?
            [{ index: 0, binSize: browser.dataset.wholeGenomeResolution }] :
            browser.getResolutions();
        this.resolutionSelectorElement.innerHTML = '';

        resolutions.forEach(resolution => {
            const binSize = resolution.binSize;
            const index = resolution.index;
            let divisor, unit;
            if (binSize >= 1e6) {
                divisor = 1e6;
                unit = 'mb';
            } else if (binSize >= 1e3) {
                divisor = 1e3;
                unit = 'kb';
            } else {
                divisor = 1;
                unit = 'bp';
            }

            const pretty = `${StringUtils.numberFormatter(Math.round(binSize / divisor))} ${unit}`;
            const option = document.createElement('option');
            option.dataset.resolution = binSize;
            option.value = index;
            option.textContent = pretty;
            if (zoomIndex === index) option.selected = true;
            this.resolutionSelectorElement.appendChild(option);
        });
    }

    /**
     * Update the label text based on whether we're in whole-genome view.
     * @param {boolean} isWholeGenome - True if in whole-genome view
     */
    updateLabelForWholeGenome(isWholeGenome) {
        if (this.labelElement) {
            this.labelElement.textContent = isWholeGenome ? 'Resolution (mb)' : 'Resolution (kb)';
        }
    }

    /**
     * Set the selected resolution by zoom index.
     * @param {number} zoomIndex - The zoom index to select
     */
    setSelectedResolution(zoomIndex) {
        Array.from(this.resolutionSelectorElement.options).forEach((option, index) => {
            option.selected = index === zoomIndex;
        });
    }
}

export default ResolutionSelector;
