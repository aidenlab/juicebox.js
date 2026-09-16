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

class ControlMapWidget {

    constructor(browser, hicNavbarContainer) {
        this.browser = browser;

        const parent = hicNavbarContainer.querySelector("div[id$='lower-hic-nav-bar-widget-container']");

        this.container = document.createElement('div');
        this.container.className = 'hic-control-map-selector-container';
        this.container.style.display = 'none';
        parent.appendChild(this.container);

        this.select = document.createElement('select');
        this.select.name = 'control_map_selector';
        this.container.appendChild(this.select);

        const toggleContainer = document.createElement('div');
        this.container.appendChild(toggleContainer);

        const cycleContainer = document.createElement('div');
        this.container.appendChild(cycleContainer);

        this.controlMapHash = new ControlMapHash(browser, this.select, toggleContainer, cycleContainer, toggleArrowsUp(), toggleArrowsDown());

        // This widget has no eventBus subscriptions. BrowserCoordinator drives
        // every update, calling updateDisplayMode directly from onDisplayMode
        // and onControlMapLoaded, and show/hide from onMapLoaded.
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

    /**
     * Hide the control map widget container.
     */
    hide() {
        this.container.style.display = 'none';
    }

    /**
     * Show the control map widget container.
     */
    show() {
        this.container.style.display = 'block';
    }

    /**
     * Update the display mode options.
     * @param {string} displayMode - The current display mode
     */
    updateDisplayMode(displayMode) {
        this.controlMapHash.updateOptions(displayMode);
    }
}

/**
 * The display modes the control map widget offers, and how each behaves under
 * the A/B toggle.
 *
 * `other` is where the toggle button goes from here, and it also drives the
 * auto-cycle: a mode whose `other` is itself would cycle forever without
 * moving. A-B has no counterpart the way A/B has B/A -- B-A is not a display
 * mode -- so it toggles back to the primary map.
 *
 * `leads` names the map the mode reads first, which picks the arrow shown on
 * the toggle button.
 */
const displayModeOptions = {
    'A': {title: 'A', value: 'A', other: 'B', leads: 'A'},
    'B': {title: 'B', value: 'B', other: 'A', leads: 'B'},
    'AOB': {title: 'A/B', value: 'AOB', other: 'BOA', leads: 'A'},
    'BOA': {title: 'B/A', value: 'BOA', other: 'AOB', leads: 'B'},
    'AMB': {title: 'A-B', value: 'AMB', other: 'A', leads: 'A'}
}

class ControlMapHash {

    constructor(browser, select, toggle, cycle, imgA, imgB) {
        this.browser = browser;
        this.select = select;
        this.toggle = toggle;
        this.cycle = cycle;

        this.imgA = imgA;
        this.toggle.appendChild(this.imgA);

        this.imgB = imgB;
        this.toggle.appendChild(this.imgB);

        this.hash = Object.fromEntries(Object.entries(displayModeOptions).map(([mode, option]) => [
            mode,
            'A' === option.leads
                ? {...option, hidden: this.imgB, shown: this.imgA}
                : {...option, hidden: this.imgA, shown: this.imgB}
        ]));

        this.select.addEventListener('change', (e) => {
            this.disableDisplayModeCycle();
            this.setDisplayMode(e.target.value);
        });

        this.toggle.addEventListener('click', () => {
            this.disableDisplayModeCycle();
            this.toggleDisplayMode();
        });

        this.cycleOutline = cycleOutline();
        cycle.appendChild(this.cycleOutline);

        this.cycleSolid = cycleSolid();
        cycle.appendChild(this.cycleSolid);
        this.cycleSolid.style.display = 'none';

        cycle.addEventListener('click', () => {
            this.toggleDisplayModeCycle();
        });

        cycle.style.display = 'none';
    }

    disableDisplayModeCycle() {
        if (this.cycleID) {
            clearTimeout(this.cycleID);
            this.cycleID = undefined;
            this.cycleSolid.style.display = 'none';
            this.cycleOutline.style.display = 'block';
        }
    }

    toggleDisplayModeCycle() {
        if (this.cycleID) {
            this.disableDisplayModeCycle();
        } else {
            this.doToggle();
            this.cycleSolid.style.display = 'block';
            this.cycleOutline.style.display = 'none';
        }
    }

    async doToggle() {
        this.cycleID = setTimeout(async () => {
            await this.toggleDisplayMode();
            this.doToggle();
        }, 2500);
    }

    async toggleDisplayMode() {
        const oldMode = this.browser.getDisplayMode();
        const newMode = this.hash[oldMode].other;
        await this.browser.setDisplayMode(newMode);
        this.hash[newMode].hidden.style.display = 'none';
        this.hash[newMode].shown.style.display = 'block';
        this.select.value = newMode;
    }

    setDisplayMode(mode) {
        this.hash[mode].hidden.style.display = 'none';
        this.hash[mode].shown.style.display = 'block';
        this.browser.setDisplayMode(mode);
    }

    updateOptions(displayMode) {
        this.imgA.style.display = 'none';
        this.imgB.style.display = 'none';
        this.select.innerHTML = '';

        Object.keys(this.hash).forEach((key) => {
            const item = this.hash[key];
            const option = document.createElement('option');
            option.value = item.value;
            option.textContent = item.title;
            if (displayMode === item.value) {
                option.selected = true;
                item.shown.style.display = 'block';
            }
            this.select.appendChild(option);
        });
    }
}

// Every icon carries its own width, height and viewBox. An unsized <svg> takes
// the browser default of 300x150, and the toggle arrows sit inside the A/B
// click target -- an unsized arrow spreads that target invisibly across the
// locus box and the row below it (#673).
function svgElement(markup) {
    const template = document.createElement('template');
    template.innerHTML = markup.trim();
    return template.content.firstElementChild;
}

function toggleArrowsUp() {
    return svgElement(`
<svg width="34px" height="34px" viewBox="0 0 34 34" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <title>Toggle Maps</title>
    <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g>
            <rect stroke="#A6A6A6" stroke-width="1.25201381" fill="#F8F8F8" x="0.626006904" y="0.626006904" width="32.7479862" height="32.7479862" rx="3.91254315"></rect>
            <g transform="translate(6.533947, 7.003452)" fill-rule="nonzero" stroke="#5F5F5F" stroke-width="0.626006904">
                <path d="M25.9411017,8.76431329 L11.8559464,8.76431329 L11.8559464,6.88629258 C11.8559464,6.05237313 10.8440845,5.63114873 10.2529383,6.22229488 L7.12290378,9.3523294 C6.75622024,9.71905207 6.75622024,10.3136021 7.12290378,10.6802857 L10.2529383,13.8103202 C10.8409153,14.3982581 11.8559464,13.9850935 11.8559464,13.1463616 L11.8559464,11.2683409 L25.9411017,11.2683409 C26.4597093,11.2683409 26.8801121,10.8479381 26.8801121,10.3293306 L26.8801121,9.70332365 C26.8801121,9.18471605 26.4597093,8.76431329 25.9411017,8.76431329 Z" fill="#F8F8F8" transform="translate(16.864002, 10.016110) rotate(-90.000000) translate(-16.864002, -10.016110) "></path>
                <path d="M13.1470856,8.76431329 L-0.938069748,8.76431329 L-0.938069748,6.88629258 C-0.938069748,6.05237313 -1.94993166,5.63114873 -2.5410778,6.22229488 L-5.67111233,9.3523294 C-6.03779587,9.71905207 -6.03779587,10.3136021 -5.67111233,10.6802857 L-2.5410778,13.8103202 C-1.95310082,14.3982581 -0.938069748,13.9850935 -0.938069748,13.1463616 L-0.938069748,11.2683409 L13.1470856,11.2683409 C13.6656932,11.2683409 14.086096,10.8479381 14.086096,10.3293306 L14.086096,9.70332365 C14.086096,9.18471605 13.6656932,8.76431329 13.1470856,8.76431329 Z" fill="#5F5F5F" transform="translate(4.069985, 10.016110) scale(1, -1) rotate(-90.000000) translate(-4.069985, -10.016110) "></path>
            </g>
        </g>
    </g>
</svg>`);
}

function toggleArrowsDown() {
    return svgElement(`
<svg width="34px" height="34px" viewBox="0 0 34 34" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <title>Toggle Maps</title>
    <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g>
            <rect stroke="#A6A6A6" stroke-width="1.25201381" fill="#F8F8F8" x="0.626006904" y="0.626006904" width="32.7479862" height="32.7479862" rx="3.91254315"></rect>
            <g transform="translate(6.533947, 7.003452)" fill-rule="nonzero" stroke="#5F5F5F" stroke-width="0.626006904">
                <path d="M25.9411017,8.76431329 L11.8559464,8.76431329 L11.8559464,6.88629258 C11.8559464,6.05237313 10.8440845,5.63114873 10.2529383,6.22229488 L7.12290378,9.3523294 C6.75622024,9.71905207 6.75622024,10.3136021 7.12290378,10.6802857 L10.2529383,13.8103202 C10.8409153,14.3982581 11.8559464,13.9850935 11.8559464,13.1463616 L11.8559464,11.2683409 L25.9411017,11.2683409 C26.4597093,11.2683409 26.8801121,10.8479381 26.8801121,10.3293306 L26.8801121,9.70332365 C26.8801121,9.18471605 26.4597093,8.76431329 25.9411017,8.76431329 Z" fill="#5F5F5F" transform="translate(16.864002, 10.016110) rotate(-90.000000) translate(-16.864002, -10.016110) "></path>
                <path d="M13.1470856,8.76431329 L-0.938069748,8.76431329 L-0.938069748,6.88629258 C-0.938069748,6.05237313 -1.94993166,5.63114873 -2.5410778,6.22229488 L-5.67111233,9.3523294 C-6.03779587,9.71905207 -6.03779587,10.3136021 -5.67111233,10.6802857 L-2.5410778,13.8103202 C-1.95310082,14.3982581 -0.938069748,13.9850935 -0.938069748,13.1463616 L-0.938069748,11.2683409 L13.1470856,11.2683409 C13.6656932,11.2683409 14.086096,10.8479381 14.086096,10.3293306 L14.086096,9.70332365 C14.086096,9.18471605 13.6656932,8.76431329 13.1470856,8.76431329 Z" fill="#F8F8F8" transform="translate(4.069985, 10.016110) scale(1, -1) rotate(-90.000000) translate(-4.069985, -10.016110) "></path>
            </g>
        </g>
    </g>
</svg>`);
}

function cycleOutline() {
    return svgElement(`
<svg width="34px" height="34px" viewBox="0 0 34 34" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <title>Cycle Maps</title>
    <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g fill="#F8F8F8">
            <rect stroke="#A6A6A6" stroke-width="1.25201381" x="0.626006904" y="0.626006904" width="32.7479862" height="32.7479862" rx="3.91254315"></rect>
            <g transform="translate(5.947066, 6.103567)" fill-rule="nonzero" stroke="#5F5F5F" stroke-width="0.75">
                <path d="M12.5012159,1.07356655 L12.5012159,1.81734411 C12.5012159,2.29971235 12.8262916,2.71738683 13.2908449,2.84717621 C16.7518005,3.81392183 19.2875784,6.98762275 19.2875784,10.7595067 C19.2875784,15.2996349 15.6133435,18.9745898 11.072508,18.9745898 C6.53238683,18.9745898 2.85743758,15.3003493 2.85743758,10.7595067 C2.85743758,6.98815851 5.39276905,3.81401113 8.85408182,2.84717621 C9.31872442,2.71738683 9.64380011,2.29962306 9.64380011,1.81721016 L9.64380011,1.07392373 C9.64380011,0.372561009 8.98150471,-0.138381443 8.30233269,0.0365908983 C3.5094195,1.27117502 -0.0270343765,5.6342771 0.00015572077,10.8189768 C0.0323016485,16.9379636 4.97728293,21.8448684 11.0963496,21.8319654 C17.2005487,21.819107 22.1449942,16.8667067 22.1449942,10.7595067 C22.1449942,5.5968181 18.611621,1.2595221 13.831209,0.0336441837 C13.1565464,-0.139363681 12.5012159,0.377070376 12.5012159,1.07356655 Z"></path>
            </g>
        </g>
    </g>
</svg>`);
}

function cycleSolid() {
    return svgElement(`
<svg width="34px" height="34px" viewBox="0 0 34 34" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <title>Cycle Maps</title>
    <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g>
            <rect stroke="#A6A6A6" stroke-width="1.25201381" fill="#F8F8F8" x="0.626006904" y="0.626006904" width="32.7479862" height="32.7479862" rx="3.91254315"></rect>
            <g transform="translate(5.947066, 6.103567)" fill="#5F5F5F" fill-rule="nonzero">
                <path d="M12.5012159,1.07356655 L12.5012159,1.81734411 C12.5012159,2.29971235 12.8262916,2.71738683 13.2908449,2.84717621 C16.7518005,3.81392183 19.2875784,6.98762275 19.2875784,10.7595067 C19.2875784,15.2996349 15.6133435,18.9745898 11.072508,18.9745898 C6.53238683,18.9745898 2.85743758,15.3003493 2.85743758,10.7595067 C2.85743758,6.98815851 5.39276905,3.81401113 8.85408182,2.84717621 C9.31872442,2.71738683 9.64380011,2.29962306 9.64380011,1.81721016 L9.64380011,1.07392373 C9.64380011,0.372561009 8.98150471,-0.138381443 8.30233269,0.0365908983 C3.5094195,1.27117502 -0.0270343765,5.6342771 0.00015572077,10.8189768 C0.0323016485,16.9379636 4.97728293,21.8448684 11.0963496,21.8319654 C17.2005487,21.819107 22.1449942,16.8667067 22.1449942,10.7595067 C22.1449942,5.5968181 18.611621,1.2595221 13.831209,0.0336441837 C13.1565464,-0.139363681 12.5012159,0.377070376 12.5012159,1.07356655 Z"></path>
            </g>
        </g>
    </g>
</svg>`);
}

export {displayModeOptions};

export default ControlMapWidget;
