/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Broad Institute
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

import {makeDraggable, UIUtils} from '../node_modules/igv-ui/dist/igv-ui.js'

class TrackGearPopup {

    constructor(parentElement) {
        // Popover container
        this.popoverElement = document.createElement('div');
        this.popoverElement.className = 'jb-igv-menu-popup';
        parentElement.appendChild(this.popoverElement);

        // Popover header
        const popoverHeaderElement = document.createElement('div');
        popoverHeaderElement.className = 'jb-igv-menu-popup-header';
        this.popoverElement.appendChild(popoverHeaderElement);

        // Attach close handler
        UIUtils.attachDialogCloseHandlerWithParent(popoverHeaderElement, () => {
            this.popoverElement.style.display = 'none';
        });

        // Popover content
        this.popoverContentElement = document.createElement('div');
        this.popoverElement.appendChild(this.popoverContentElement);

        // Make draggable
        makeDraggable(this.popoverElement, popoverHeaderElement);

        // Prevent click propagation
        popoverHeaderElement.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
        });
    }

    presentMenuList(dx, dy, list) {
        TrackGearPopup.hideAllMenuPopups();

        if (list.length > 0) {
            // Clear popover content
            this.popoverContentElement.innerHTML = '';

            const updatedList = trackMenuItemListHelper(list, this.popoverElement);

            for (const item of updatedList) {
                if (item.init) {
                    item.init();
                }


                // Remove the border-top class from the first item
                if (updatedList.indexOf(item) === 0) {
                    item.element.classList.remove('igv-track-menu-border-top');
                }

                // Add 'jb-igv-menu-popup-shim' if applicable
                if (
                    !item.element.classList.contains('igv-track-menu-border-top') &&
                    !item.element.classList.contains('jb-igv-menu-popup-check-container') &&
                    item.element.tagName === 'DIV'
                ) {
                    item.element.classList.add('jb-igv-menu-popup-shim');
                }

                // Append element to the popover content
                this.popoverContentElement.appendChild(item.element);
            }

            // Position and display the popover
            this.popoverElement.style.left = `${dx}px`;
            this.popoverElement.style.top = `${dy}px`;
            this.popoverElement.style.display = 'block';
        }
    }

    dispose() {
        this.popoverElement.innerHTML = '';
        this.popoverContentElement.innerHTML = '';

        for (let key of Object.keys(this)) {
            this[key] = undefined;
        }
    }

    static hideAllMenuPopups() {
        const popups = document.querySelectorAll('.jb-igv-menu-popup');
        for (let popup of popups) {
            popup.style.display = 'none';
        }
    }

}

function trackMenuItemListHelper(itemList, popoverElement) {

    let results = []

    if (itemList.length > 0) {

        results = itemList.map((item, i) => {
            let element;
            
            if (item.name) {
                element = document.createElement('div');
                element.textContent = item.name;
            } else if (item.element) {
                element = item.element instanceof HTMLElement ? item.element.cloneNode(true) : item.element;
            } else if (typeof item.label === 'string') {
                element = document.createElement('div');
                element.innerHTML = item.label;
            } else if (typeof item === 'string') {
                if (item.startsWith("<")) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = item;
                    element = tempDiv.firstElementChild;
                } else {
                    element = document.createElement('div');
                    element.textContent = item;
                }
            }

            // Add top border class to the first item
            if (i === 0 && element) {
                element.classList.add('igv-track-menu-border-top');
            }

            // Add click, touchend, and mouseup event listeners if item has a click handler
            if (item.click && element) {
                const eventHandler = e => {
                    e.preventDefault();
                    e.stopPropagation();
                    item.click(e);
                    popoverElement.style.display = 'none';
                };

                element.addEventListener('click', eventHandler);
                element.addEventListener('touchend', eventHandler);
                element.addEventListener('mouseup', e => {
                    e.preventDefault();
                    e.stopPropagation();
                });
            }

            return { element, init: item.init || undefined };
        });
    }

    return results;
}

export default TrackGearPopup

