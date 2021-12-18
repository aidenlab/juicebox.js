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
import $ from '../vendor/jquery-3.3.1.slim.js'

class ControlMapWidget {

    constructor(browser, $hic_navbar_container) {

        this.browser = browser;

        const $parent = $hic_navbar_container.find("div[id$='lower-hic-nav-bar-widget-container']");

        this.$container = $('<div class="hic-control-map-selector-container">');
        this.$container.hide();
        $parent.append(this.$container);

        // select
        this.$select = $('<select>');
        this.$select.attr('name', 'control_map_selector');
        this.$container.append(this.$select);

        // a-b toggle icon
        const $toggle_container = $('<div>');
        this.$container.append($toggle_container);

        // cycle button
        const $cycle_container = $('<div>');
        this.$container.append($cycle_container);

        this.controlMapHash = new ControlMapHash(browser, this.$select, $toggle_container, $cycle_container, toggle_arrows_up(), toggle_arrows_down());

        const self = this;

        browser.eventBus.subscribe("ControlMapLoad", function (event) {
            self.controlMapHash.updateOptions(browser.getDisplayMode());
            self.$container.show();
        });

        browser.eventBus.subscribe("MapLoad", function (event) {
            if (!browser.controlDataset) {
                self.$container.hide();
            }
        });

        browser.eventBus.subscribe("DisplayMode", function (event) {
            self.controlMapHash.updateOptions(event.data);
        });

    }

    toggleDisplayMode() {
        this.controlMapHash.toggleDisplayMode();
    }

    toggleDisplayModeCycle() {
        this.controlMapHash.toggleDisplayModeCycle();
    }

    getDisplayModeCycle() {
        return this.controlMapHash.cycleID;
    }
}


class ControlMapHash {

    constructor(browser, $select, $toggle, $cycle, $img_a, $img_b) {

        const self = this

        this.browser = browser;
        this.$select = $select;
        this.$toggle = $toggle;
        this.$cycle = $cycle;

        // a arrow
        this.$img_a = $img_a;
        this.$toggle.append(this.$img_a);

        // b arrow
        this.$img_b = $img_b;
        this.$toggle.append(this.$img_b);

        const A = {title: 'A', value: 'A', other: 'B', $hidden: $img_b, $shown: $img_a};
        const B = {title: 'B', value: 'B', other: 'A', $hidden: $img_a, $shown: $img_b};
        const AOB = {title: 'A/B', value: 'AOB', other: 'BOA', $hidden: $img_b, $shown: $img_a};
        const BOA = {title: 'B/A', value: 'BOA', other: 'AOB', $hidden: $img_a, $shown: $img_b};

        this.hash =
            {
                'A': A,
                'B': B,
                'AOB': AOB,
                'BOA': BOA
            };

        this.$select.on('change', function (e) {
            let value;

            self.disableDisplayModeCycle();

            value = $(this).val();
            self.setDisplayMode(value);
        });

        this.$toggle.on('click', function (e) {
            self.disableDisplayModeCycle();
            self.toggleDisplayMode();
        });

        // cycle outline
        this.$cycle_outline = cycle_outline();
        $cycle.append(this.$cycle_outline);

        // cycle solid
        this.$cycle_solid = cycle_solid();
        $cycle.append(this.$cycle_solid);
        this.$cycle_solid.hide();

        $cycle.on('click', function () {
            self.toggleDisplayModeCycle();
        });

        $cycle.hide();

    }

    disableDisplayModeCycle  () {

        if (this.cycleID) {

            clearTimeout(this.cycleID);
            this.cycleID = undefined;

            this.$cycle_solid.hide();
            this.$cycle_outline.show();
        }

    }

    toggleDisplayModeCycle  () {
        let self = this;

        if (this.cycleID) {

            this.disableDisplayModeCycle();
        } else {

            doToggle()

            this.$cycle_solid.show();
            this.$cycle_outline.hide();
        }

        function doToggle() {
            self.cycleID = setTimeout(async function () {
                await self.toggleDisplayMode()
                doToggle()
            }, 2500)
        }

    }

    async toggleDisplayMode  () {

        let displayModeOld,
            displayModeNew,
            str;

        displayModeOld = this.browser.getDisplayMode();

        // render new display mode
        displayModeNew = this.hash[displayModeOld].other;
        await this.browser.setDisplayMode(displayModeNew);

        // update exchange icon
        this.hash[displayModeNew].$hidden.hide();
        this.hash[displayModeNew].$shown.show();

        // update select element
        str = 'option[value=' + displayModeNew + ']';

        this.$select.find(str).prop('selected', true);

    }

    setDisplayMode (displayMode) {

        setDisplayModeHelper.call(this, displayMode);

        this.browser.setDisplayMode(displayMode);
    }

    updateOptions  (displayMode) {
        let self = this;

        this.$img_a.hide();
        this.$img_b.hide();

        this.$select.empty();

        Object.keys(this.hash).forEach(function (key) {
            let item,
                option;

            item = self.hash[key];

            option = $('<option>').attr('title', item.title).attr('value', item.value).text(item.title);

            if (displayMode === item.value) {

                option.attr('selected', true);
                item.$shown.show();

                setDisplayModeHelper.call(self, displayMode);
            }

            self.$select.append(option);
        });
    }
}

function setDisplayModeHelper(displayMode) {

    this.hash[displayMode].$hidden.hide();
    this.hash[displayMode].$shown.show();

    this.$cycle.show();
    this.$toggle.show();

    // if ('A' === displayMode || 'B' === displayMode) {
    //     this.$cycle.show();
    //     this.$toggle.show();
    // } else {
    //     this.$cycle.hide();
    //     this.$toggle.hide();
    // }

}

function toggle_arrows_up() {
    let str,
        a;

    str = '<svg width="34px" height="34px" viewBox="0 0 34 34" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n' +
        '    <!-- Generator: Sketch 51 (57462) - http://www.bohemiancoding.com/sketch -->\n' +
        '    <title>Toggle Maps</title>\n' +
        '    <desc>Created with Sketch.</desc>\n' +
        '    <defs></defs>\n' +
        '    <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">\n' +
        '        <g id="Group">\n' +
        '            <rect id="Rectangle" stroke="#A6A6A6" stroke-width="1.25201381" fill="#F8F8F8" x="0.626006904" y="0.626006904" width="32.7479862" height="32.7479862" rx="3.91254315"></rect>\n' +
        '            <g id="arrows" transform="translate(6.533947, 7.003452)" fill-rule="nonzero" stroke="#5F5F5F" stroke-width="0.626006904">\n' +
        '                <path d="M25.9411017,8.76431329 L11.8559464,8.76431329 L11.8559464,6.88629258 C11.8559464,6.05237313 10.8440845,5.63114873 10.2529383,6.22229488 L7.12290378,9.3523294 C6.75622024,9.71905207 6.75622024,10.3136021 7.12290378,10.6802857 L10.2529383,13.8103202 C10.8409153,14.3982581 11.8559464,13.9850935 11.8559464,13.1463616 L11.8559464,11.2683409 L25.9411017,11.2683409 C26.4597093,11.2683409 26.8801121,10.8479381 26.8801121,10.3293306 L26.8801121,9.70332365 C26.8801121,9.18471605 26.4597093,8.76431329 25.9411017,8.76431329 Z" id="down-arrow" fill="#F8F8F8" transform="translate(16.864002, 10.016110) rotate(-90.000000) translate(-16.864002, -10.016110) "></path>\n' +
        '                <path d="M13.1470856,8.76431329 L-0.938069748,8.76431329 L-0.938069748,6.88629258 C-0.938069748,6.05237313 -1.94993166,5.63114873 -2.5410778,6.22229488 L-5.67111233,9.3523294 C-6.03779587,9.71905207 -6.03779587,10.3136021 -5.67111233,10.6802857 L-2.5410778,13.8103202 C-1.95310082,14.3982581 -0.938069748,13.9850935 -0.938069748,13.1463616 L-0.938069748,11.2683409 L13.1470856,11.2683409 C13.6656932,11.2683409 14.086096,10.8479381 14.086096,10.3293306 L14.086096,9.70332365 C14.086096,9.18471605 13.6656932,8.76431329 13.1470856,8.76431329 Z" id="up-arrow" fill="#5F5F5F" transform="translate(4.069985, 10.016110) scale(1, -1) rotate(-90.000000) translate(-4.069985, -10.016110) "></path>\n' +
        '            </g>\n' +
        '        </g>\n' +
        '    </g>\n' +
        '</svg>';

    a = str.split('\n').join(' ');

    return $(a);
}

function toggle_arrows_down() {
    let str,
        b;

    str = '<svg width="34px" height="34px" viewBox="0 0 34 34" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n' +
        '    <!-- Generator: Sketch 51 (57462) - http://www.bohemiancoding.com/sketch -->\n' +
        '    <title>Toggle Maps</title>\n' +
        '    <desc>Created with Sketch.</desc>\n' +
        '    <defs></defs>\n' +
        '    <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">\n' +
        '        <g id="Group">\n' +
        '            <rect id="Rectangle" stroke="#A6A6A6" stroke-width="1.25201381" fill="#F8F8F8" x="0.626006904" y="0.626006904" width="32.7479862" height="32.7479862" rx="3.91254315"></rect>\n' +
        '            <g id="arrows" transform="translate(6.533947, 7.003452)" fill-rule="nonzero" stroke="#5F5F5F" stroke-width="0.626006904">\n' +
        '                <path d="M25.9411017,8.76431329 L11.8559464,8.76431329 L11.8559464,6.88629258 C11.8559464,6.05237313 10.8440845,5.63114873 10.2529383,6.22229488 L7.12290378,9.3523294 C6.75622024,9.71905207 6.75622024,10.3136021 7.12290378,10.6802857 L10.2529383,13.8103202 C10.8409153,14.3982581 11.8559464,13.9850935 11.8559464,13.1463616 L11.8559464,11.2683409 L25.9411017,11.2683409 C26.4597093,11.2683409 26.8801121,10.8479381 26.8801121,10.3293306 L26.8801121,9.70332365 C26.8801121,9.18471605 26.4597093,8.76431329 25.9411017,8.76431329 Z" id="down-arrow" fill="#5F5F5F" transform="translate(16.864002, 10.016110) rotate(-90.000000) translate(-16.864002, -10.016110) "></path>\n' +
        '                <path d="M13.1470856,8.76431329 L-0.938069748,8.76431329 L-0.938069748,6.88629258 C-0.938069748,6.05237313 -1.94993166,5.63114873 -2.5410778,6.22229488 L-5.67111233,9.3523294 C-6.03779587,9.71905207 -6.03779587,10.3136021 -5.67111233,10.6802857 L-2.5410778,13.8103202 C-1.95310082,14.3982581 -0.938069748,13.9850935 -0.938069748,13.1463616 L-0.938069748,11.2683409 L13.1470856,11.2683409 C13.6656932,11.2683409 14.086096,10.8479381 14.086096,10.3293306 L14.086096,9.70332365 C14.086096,9.18471605 13.6656932,8.76431329 13.1470856,8.76431329 Z" id="up-arrow" fill="#F8F8F8" transform="translate(4.069985, 10.016110) scale(1, -1) rotate(-90.000000) translate(-4.069985, -10.016110) "></path>\n' +
        '            </g>\n' +
        '        </g>\n' +
        '    </g>\n' +
        '</svg>';

    b = str.split('\n').join(' ');

    return $(b);
}

function cycle_outline() {
    let str,
        b;

    str = '<svg width="34px" height="34px" viewBox="0 0 34 34" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n' +
        '    <!-- Generator: Sketch 51 (57462) - http://www.bohemiancoding.com/sketch -->\n' +
        '    <title>Cycle Maps</title>\n' +
        '    <desc>Created with Sketch.</desc>\n' +
        '    <defs></defs>\n' +
        '    <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">\n' +
        '        <g id="Group" fill="#F8F8F8">\n' +
        '            <rect id="Rectangle" stroke="#A6A6A6" stroke-width="1.25201381" x="0.626006904" y="0.626006904" width="32.7479862" height="32.7479862" rx="3.91254315"></rect>\n' +
        '            <g id="circle-notch-group" transform="translate(5.947066, 6.103567)" fill-rule="nonzero" stroke="#5F5F5F" stroke-width="0.75">\n' +
        '                <path d="M12.5012159,1.07356655 L12.5012159,1.81734411 C12.5012159,2.29971235 12.8262916,2.71738683 13.2908449,2.84717621 C16.7518005,3.81392183 19.2875784,6.98762275 19.2875784,10.7595067 C19.2875784,15.2996349 15.6133435,18.9745898 11.072508,18.9745898 C6.53238683,18.9745898 2.85743758,15.3003493 2.85743758,10.7595067 C2.85743758,6.98815851 5.39276905,3.81401113 8.85408182,2.84717621 C9.31872442,2.71738683 9.64380011,2.29962306 9.64380011,1.81721016 L9.64380011,1.07392373 C9.64380011,0.372561009 8.98150471,-0.138381443 8.30233269,0.0365908983 C3.5094195,1.27117502 -0.0270343765,5.6342771 0.00015572077,10.8189768 C0.0323016485,16.9379636 4.97728293,21.8448684 11.0963496,21.8319654 C17.2005487,21.819107 22.1449942,16.8667067 22.1449942,10.7595067 C22.1449942,5.5968181 18.611621,1.2595221 13.831209,0.0336441837 C13.1565464,-0.139363681 12.5012159,0.377070376 12.5012159,1.07356655 Z" id="circle-notch---solid"></path>\n' +
        '            </g>\n' +
        '        </g>\n' +
        '    </g>\n' +
        '</svg>';

    b = str.split('\n').join(' ');

    return $(b);

}

function cycle_solid() {
    let str,
        b;

    str = '<svg width="34px" height="34px" viewBox="0 0 34 34" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n' +
        '    <!-- Generator: Sketch 51 (57462) - http://www.bohemiancoding.com/sketch -->\n' +
        '    <title>Cycle Maps</title>\n' +
        '    <desc>Created with Sketch.</desc>\n' +
        '    <defs></defs>\n' +
        '    <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">\n' +
        '        <g id="Group">\n' +
        '            <rect id="Rectangle" stroke="#A6A6A6" stroke-width="1.25201381" fill="#F8F8F8" x="0.626006904" y="0.626006904" width="32.7479862" height="32.7479862" rx="3.91254315"></rect>\n' +
        '            <g id="circle-notch-group" transform="translate(5.947066, 6.103567)" fill="#5F5F5F" fill-rule="nonzero">\n' +
        '                <path d="M12.5012159,1.07356655 L12.5012159,1.81734411 C12.5012159,2.29971235 12.8262916,2.71738683 13.2908449,2.84717621 C16.7518005,3.81392183 19.2875784,6.98762275 19.2875784,10.7595067 C19.2875784,15.2996349 15.6133435,18.9745898 11.072508,18.9745898 C6.53238683,18.9745898 2.85743758,15.3003493 2.85743758,10.7595067 C2.85743758,6.98815851 5.39276905,3.81401113 8.85408182,2.84717621 C9.31872442,2.71738683 9.64380011,2.29962306 9.64380011,1.81721016 L9.64380011,1.07392373 C9.64380011,0.372561009 8.98150471,-0.138381443 8.30233269,0.0365908983 C3.5094195,1.27117502 -0.0270343765,5.6342771 0.00015572077,10.8189768 C0.0323016485,16.9379636 4.97728293,21.8448684 11.0963496,21.8319654 C17.2005487,21.819107 22.1449942,16.8667067 22.1449942,10.7595067 C22.1449942,5.5968181 18.611621,1.2595221 13.831209,0.0336441837 C13.1565464,-0.139363681 12.5012159,0.377070376 12.5012159,1.07356655 Z" id="circle-notch---solid"></path>\n' +
        '            </g>\n' +
        '        </g>\n' +
        '    </g>\n' +
        '</svg>';

    b = str.split('\n').join(' ');

    return $(b);

}

export default ControlMapWidget
