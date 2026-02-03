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
 * Created by dat on 3/21/17.
 */
class NormalizationWidget {

    constructor(browser, hicNavBarContainer) {
        this.browser = browser;

        const parent = hicNavBarContainer.querySelector("div[id$='lower-hic-nav-bar-widget-container']");

        this.container = document.createElement('div');
        this.container.className = 'hic-normalization-selector-container';
        this.container.title = 'Normalization';
        parent.appendChild(this.container);

        let label = document.createElement('div');
        label.textContent = 'Norm';
        this.container.appendChild(label);

        this.normalizationSelector = document.createElement('select');
        this.normalizationSelector.name = 'normalization_selector';
        this._changeHandler = () => {
            // Only process change events if not programmatically updating
            if (!this._isProgrammaticUpdate) {
                this.browser.setNormalization(this.normalizationSelector.value);
            }
        };
        this.normalizationSelector.addEventListener('change', this._changeHandler);
        this.container.appendChild(this.normalizationSelector);

        this.spinner = document.createElement('div');
        this.spinner.textContent = 'Loading ...';
        this.container.appendChild(this.spinner);
        this.spinner.style.display = 'none';

        // Note: MapLoad subscription removed - now handled by BrowserCoordinator
        // NormVectorIndexLoad, NormalizationFileLoad, and NormalizationExternalChange 
        // are still posted to eventBus for cross-browser synchronization
        this.browser.eventBus.subscribe("NormVectorIndexLoad", this);
        this.browser.eventBus.subscribe("NormalizationFileLoad", this);
        this.browser.eventBus.subscribe("NormalizationExternalChange", this);
    }

    startNotReady() {
        this.normalizationSelector.style.display = 'none';
        this.spinner.style.display = 'block';
    }

    stopNotReady() {
        this.spinner.style.display = 'none';
        this.normalizationSelector.style.display = 'block';
    }

    receiveEvent(event) {
        if ("NormVectorIndexLoad" === event.type) {
            this.updateOptions();
            this.stopNotReady();
        } else if ("NormalizationFileLoad" === event.type) {
            if (event.data === "start") {
                this.startNotReady();
            } else {
                this.stopNotReady();
            }
        } else if ("NormalizationExternalChange" === event.type) {
            this.setNormalizationProgrammatically(event.data);
        }
    }

    /**
     * Set the normalization selector value programmatically without triggering change events.
     * This prevents feedback loops when the normalization is changed externally.
     * 
     * @param {string} normalization - The normalization value to set
     */
    setNormalizationProgrammatically(normalization) {
        this._isProgrammaticUpdate = true;
        try {
            Array.from(this.normalizationSelector.options).forEach(option => {
                option.selected = option.value === normalization;
            });
        } finally {
            // Always reset the flag, even if an error occurs
            this._isProgrammaticUpdate = false;
        }
    }

    async updateOptions() {
        const labels = {
            NONE: 'None',
            VC: 'Coverage',
            VC_SQRT: 'Coverage - Sqrt',
            KR: 'Balanced',
            INTER_VC: 'Interchromosomal Coverage',
            INTER_VC_SQRT: 'Interchromosomal Coverage - Sqrt',
            INTER_KR: 'Interchromosomal Balanced',
            GW_VC: 'Genome-wide Coverage',
            GW_VC_SQRT: 'Genome-wide Coverage - Sqrt',
            GW_KR: 'Genome-wide Balanced'
        };

        const norm = this.browser.state.normalization;
        const normalizationTypes = await this.browser.getNormalizationOptions();
        if (normalizationTypes) {
            this.normalizationSelector.innerHTML = '';
            normalizationTypes.forEach(normalization => {
                const option = document.createElement('option');
                option.value = normalization;
                option.textContent = labels[normalization] || normalization;
                if (norm === normalization) {
                    option.selected = true;
                }
                this.normalizationSelector.appendChild(option);
            });
        }
    }
}

export default NormalizationWidget;
