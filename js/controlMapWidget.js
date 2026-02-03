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

        // Note: MapLoad and ControlMapLoad subscriptions removed - now handled by BrowserCoordinator
        // Control map widget is updated via coordinator.onMapLoaded() and coordinator.onControlMapLoaded()

        browser.eventBus.subscribe("DisplayMode", (event) => {
            this.controlMapHash.updateOptions(event.data);
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

        this.hash = {
            'A': { title: 'A', value: 'A', other: 'B', hidden: this.imgB, shown: this.imgA },
            'B': { title: 'B', value: 'B', other: 'A', hidden: this.imgA, shown: this.imgB },
            'AOB': { title: 'A/B', value: 'AOB', other: 'BOA', hidden: this.imgB, shown: this.imgA },
            'BOA': { title: 'B/A', value: 'BOA', other: 'AOB', hidden: this.imgA, shown: this.imgB }
        };

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

function toggleArrowsUp() {
    const svg = document.createElement('div');
    svg.innerHTML = '<svg>...</svg>'; // Simplified for brevity
    return svg;
}

function toggleArrowsDown() {
    const svg = document.createElement('div');
    svg.innerHTML = '<svg>...</svg>'; // Simplified for brevity
    return svg;
}

function cycleOutline() {
    const svg = document.createElement('div');
    svg.innerHTML = '<svg>...</svg>'; // Simplified for brevity
    return svg;
}

function cycleSolid() {
    const svg = document.createElement('div');
    svg.innerHTML = '<svg>...</svg>'; // Simplified for brevity
    return svg;
}

export default ControlMapWidget;
