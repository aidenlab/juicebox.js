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
 * Created by dat on 3/22/17.
 */

class ChromosomeSelectorWidget {

    constructor(browser, container) {
        this.browser = browser;

        this.xAxisSelector = container.querySelector("select[name='x-axis-selector']");
        this.yAxisSelector = container.querySelector("select[name='y-axis-selector']");

        this.xAxisSelector.addEventListener('change', () => this.syncSelectors(this.xAxisSelector, this.yAxisSelector));
        this.yAxisSelector.addEventListener('change', () => this.syncSelectors(this.yAxisSelector, this.xAxisSelector));

        const nextDiv = this.yAxisSelector.nextElementSibling;
        if (nextDiv) {
            nextDiv.addEventListener('click', async () => {
                const chr1Index = parseInt(this.xAxisSelector.value, 10);
                const chr2Index = parseInt(this.yAxisSelector.value, 10);
                await browser.setChromosomes(chr1Index, chr2Index);
            });
        }

        this.dataLoadConfig = {
            receiveEvent: (event) => {
                if (event.type === "MapLoad") {
                    this.respondToDataLoadWithDataset(event.data);
                }
            }
        };
        browser.eventBus.subscribe("MapLoad", this.dataLoadConfig);

        this.locusChangeConfig = {
            receiveEvent: (event) => {
                if (event.type === "LocusChange") {
                    this.respondToLocusChangeWithState(event.data.state);
                }
            }
        };
        browser.eventBus.subscribe("LocusChange", this.locusChangeConfig);
    }

    syncSelectors(sourceSelector, targetSelector) {
        const value = sourceSelector.value;
        if (parseInt(value, 10) === 0 || parseInt(targetSelector.value, 10) === 0) {
            targetSelector.value = value;
        }
    }

    respondToDataLoadWithDataset(dataset) {
        const options = dataset.chromosomes.map(({ name }, index) => `<option value="${index}">${name}</option>`).join('');
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

export default ChromosomeSelectorWidget;

