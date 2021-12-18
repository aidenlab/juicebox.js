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

    constructor(browser, $container) {

        this.browser = browser;

        this.$x_axis_selector = $container.find("select[name='x-axis-selector']");
        this.$y_axis_selector = $container.find("select[name='y-axis-selector']");

        this.$x_axis_selector.on('change', () => {

            const str = this.$x_axis_selector.val();

            if (0 === parseInt(str, 10)) {
                this.$y_axis_selector.val(str);
            } else if (0 === parseInt(this.$y_axis_selector.val(), 10)) {
                this.$y_axis_selector.val(str);
            }

        });

        this.$y_axis_selector.on('change', () => {

            const str = this.$y_axis_selector.val();

            if (0 === parseInt(str, 10)) {
                this.$x_axis_selector.val(str);
            } else if (0 === parseInt(this.$x_axis_selector.val(), 10)) {
                this.$x_axis_selector.val(str);
            }

        });

        this.$y_axis_selector.next('div').on('click', async () => {
            const chr1Index = parseInt(this.$x_axis_selector.find('option:selected').val(), 10);
            const chr2Index = parseInt(this.$y_axis_selector.find('option:selected').val(), 10);
            await browser.setChromosomes(chr1Index, chr2Index);
        });

        this.dataLoadConfig =
            {
                receiveEvent: event => {
                    if (event.type === "MapLoad") {
                        this.respondToDataLoadWithDataset(event.data);
                    }
                }
            };

        browser.eventBus.subscribe("MapLoad", this.dataLoadConfig);

        this.locusChangeConfig =
            {
                receiveEvent: event => {
                    if (event.type === "LocusChange") {
                        this.respondToLocusChangeWithState(event.data.state);
                    }
                }
            };

        browser.eventBus.subscribe("LocusChange", this.locusChangeConfig);

    }

    respondToDataLoadWithDataset(dataset) {

        var elements,
            str,
            $xFound,
            $yFound;

        this.$x_axis_selector.empty();
        this.$y_axis_selector.empty();

        elements = dataset.chromosomes.map(({name}, index) => `<option value=${index.toString()}>${name}</option>`);

        this.$x_axis_selector.append(elements.join(''));
        this.$y_axis_selector.append(elements.join(''));

        str = 'option[value=' + this.browser.state.chr1.toString() + ']';
        $xFound = this.$x_axis_selector.find(str);
        $xFound.prop('selected', true);

        str = 'option[value=' + this.browser.state.chr2.toString() + ']';
        $yFound = this.$y_axis_selector.find(str);
        $yFound.prop('selected', true);
    }

    respondToLocusChangeWithState(state) {
        var self = this,
            ssx,
            ssy,
            $xFound,
            $yFound,
            chr1,
            chr2;

        $xFound = this.$x_axis_selector.find('option');
        $yFound = this.$y_axis_selector.find('option');

        // this happens when the first dataset is loaded.
        if (0 === $xFound.length || 0 === $yFound.length) {
            return;
        }

        $xFound = this.$x_axis_selector.find('option:selected');
        $yFound = this.$y_axis_selector.find('option:selected');

        $xFound.prop('selected', false);
        $yFound.prop('selected', false);

        // chr1 = parseInt($xFound.val(), 10);
        // chr2 = parseInt($yFound.val(), 10);
        // // It is the pair of chromosomes that is important,  1-2 == 2-1,  so update only if the pair does not match
        // if (false === ((chr1 === state.chr1 && chr2 === state.chr2) || (chr1 === state.chr2 && chr2 === state.chr1))) {
        //     ssx = 'option[value=' + state.chr1.toString() + ']';
        //     this.$x_axis_selector.find(ssx).attr('selected', 'selected');
        //
        //     ssx = 'option[value=' + state.chr2.toString() + ']';
        //     this.$y_axis_selector.find(ssx).attr('selected', 'selected');
        // }

        ssx = 'option[value=' + state.chr1.toString() + ']';
        ssy = 'option[value=' + state.chr2.toString() + ']';

        this.$x_axis_selector.find(ssx).prop('selected', true);
        this.$y_axis_selector.find(ssy).prop('selected', true);

    }
}

export default ChromosomeSelectorWidget

