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
 * Creates and manages the chromosome selector UI component
 */
class ChromosomeSelector {
    constructor(browser, container) {
        this.browser = browser;
        this.container = container;
        this.xAxisSelector = container.querySelector("select[name='x-axis-selector']");
        this.yAxisSelector = container.querySelector("select[name='y-axis-selector']");

        this.initialize();
    }

    initialize() {
        // Sync selectors when either changes
        this.xAxisSelector.addEventListener('change', () => this.syncSelectors(this.xAxisSelector, this.yAxisSelector));
        this.yAxisSelector.addEventListener('change', () => this.syncSelectors(this.yAxisSelector, this.xAxisSelector));

        // Handle chromosome swap button click
        const nextDiv = this.yAxisSelector.nextElementSibling;
        if (nextDiv) {
            nextDiv.addEventListener('click', async () => {
                const chrX = this.browser.dataset.chromosomes[parseInt(this.xAxisSelector.value, 10)];
                const chrY = this.browser.dataset.chromosomes[parseInt(this.yAxisSelector.value, 10)];

                const xLocus = this.browser.parseLocusString(chrX.name);
                const yLocus = this.browser.parseLocusString(chrY.name);

                await this.browser.setChromosomes(xLocus, yLocus);
            });
        }

        // Subscribe to browser events
        this.browser.eventBus.subscribe("MapLoad", (event) => {
            // Handle both old format (event.data is dataset) and new format (event.data.dataset)
            const dataset = event.data.dataset || event.data;
            this.respondToDataLoadWithDataset(dataset);
        });

        this.browser.eventBus.subscribe("LocusChange", (event) => {
            this.respondToLocusChangeWithState(event.data.state);
        });
    }

    syncSelectors(sourceSelector, targetSelector) {
        const value = sourceSelector.value;
        if (parseInt(value, 10) === 0 || parseInt(targetSelector.value, 10) === 0) {
            targetSelector.value = value;
        }
    }

    respondToDataLoadWithDataset(dataset) {
        const { chromosomes } = dataset;
        const options = chromosomes.map(({ name }, index) => `<option value="${index}">${name}</option>`).join('');
        this.xAxisSelector.innerHTML = options;
        this.yAxisSelector.innerHTML = options;

        this.xAxisSelector.value = this.browser.state.chr1;
        this.yAxisSelector.value = this.browser.state.chr2;
    }

    respondToLocusChangeWithState(state) {
        if (!this.xAxisSelector.options.length || !this.yAxisSelector.options.length) return;

        this.xAxisSelector.value = state.chr1;
        this.yAxisSelector.value = state.chr2;
    }
}

export default ChromosomeSelector; 