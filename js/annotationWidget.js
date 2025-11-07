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

import { Alert, createColorSwatchSelector } from '../node_modules/igv-ui/dist/igv-ui.js';
import { makeDraggable } from '../node_modules/igv-ui/dist/igv-ui.js';
import HICEvent from './hicEvent.js';
import Track2D from './track2D.js';

class AnnotationWidget {
    constructor(browser, container, { title, alertMessage }, trackListRetrievalCallback) {
        this.browser = browser;
        this.trackListRetrievalCallback = trackListRetrievalCallback;

        this.annotationPresentationButton(container, alertMessage);
        this.annotationPanel(browser.rootElement, title);
    }

    updateBody(tracks) {

        this.annotationPanelElement.querySelectorAll('.hic-annotation-row-container').forEach(el => el.remove());

        if (tracks[0] instanceof Track2D) {
            for (let i = tracks.length - 1; i >= 0; i--) {
                this.annotationPanelRow(this.annotationPanelElement, tracks[i]);
            }
        } else {
            for (const trackRenderer of tracks) {
                this.annotationPanelRow(this.annotationPanelElement, trackRenderer);
            }
        }
    }

    annotationPresentationButton(parent, alertMessage) {
        const button = parent.querySelector('button');

        button.addEventListener('click', () => {
            const list = this.trackListRetrievalCallback();

            if (list.length > 0) {
                this.updateBody(this.trackListRetrievalCallback());
                this.annotationPanelElement.style.display =
                    this.annotationPanelElement.style.display === 'none' ? 'flex' : 'none';
            } else {
                Alert.presentAlert(alertMessage);
            }

            this.browser.hideMenu();
        });
    }

    annotationPanel(parent, title) {
        this.annotationPanelElement = document.createElement('div');
        this.annotationPanelElement.className = 'hic-annotation-panel-container';
        parent.appendChild(this.annotationPanelElement);

        const panelHeader = document.createElement('div');
        panelHeader.className = 'hic-annotation-panel-header';
        this.annotationPanelElement.appendChild(panelHeader);

        const titleDiv = document.createElement('div');
        titleDiv.textContent = title;
        panelHeader.appendChild(titleDiv);

        const closeButtonDiv = document.createElement('div');
        closeButtonDiv.className = 'hic-menu-close-button';
        panelHeader.appendChild(closeButtonDiv);

        const closeIcon = document.createElement('i');
        closeIcon.className = 'fa fa-times';
        closeButtonDiv.appendChild(closeIcon);

        closeIcon.addEventListener('click', () => {
            this.annotationPanelElement.style.display =
                this.annotationPanelElement.style.display === 'none' ? 'flex' : 'none';
        });

        makeDraggable(this.annotationPanelElement, panelHeader);
        this.annotationPanelElement.style.display = 'none';
    }

    annotationPanelRow(container, track) {
        const isTrack2D = track instanceof Track2D;
        const trackList = this.trackListRetrievalCallback();

        let trackRenderer
        if (false === isTrack2D) {
            trackRenderer = track.x.track.trackView
        }

        const rowContainer = document.createElement('div');
        rowContainer.className = 'hic-annotation-row-container';
        container.appendChild(rowContainer);

        const row = document.createElement('div');
        row.className = 'hic-annotation-modal-row';
        rowContainer.appendChild(row);

        const trackName = document.createElement('div');
        trackName.textContent = isTrack2D ? track.config.name : track.x.track.config.name;
        row.appendChild(trackName);

        if (isTrack2D) {
            const visibilityIcon = document.createElement('i');
            visibilityIcon.className = track.isVisible ? 'fa fa-eye fa-lg' : 'fa fa-eye-slash fa-lg';
            row.appendChild(visibilityIcon);

            visibilityIcon.addEventListener('click', () => {
                track.isVisible = !track.isVisible;
                visibilityIcon.className = track.isVisible ? 'fa fa-eye fa-lg' : 'fa fa-eye-slash fa-lg';

                this.browser.contactMatrixView.clearImageCaches();
                this.browser.contactMatrixView.update();
            });
        }

        if (isTrack2D) {
            const displayModeIcon = document.createElement('div');
            displayModeIcon.className = 'matrix-diagonal-widget-container';

            switch (track.displayMode) {
                case 'lower':
                    displayModeIcon.classList.add('matrix-diagonal-widget-lower');
                    break;
                case 'upper':
                    displayModeIcon.classList.add('matrix-diagonal-widget-upper');
                    break;
                default:
                    displayModeIcon.classList.add('matrix-diagonal-widget-all');
            }

            displayModeIcon.addEventListener('click', () => {
                this.displayModeHandler(displayModeIcon, track);
                this.browser.contactMatrixView.clearImageCaches();
                this.browser.contactMatrixView.update();
            });

            row.appendChild(displayModeIcon);
        }

        const colorpickerContainer = createAnnotationPanelColorpickerContainer(rowContainer, {width: (29 * 24 + 2)}, () => {
            const nextElement = row.nextElementSibling;
            if (nextElement && nextElement.classList.contains('hic-color-swatch-container')) {
                nextElement.style.display = nextElement.style.display === 'none' ? 'flex' : 'none';
            }
        });

        const colorpickerButton = this.annotationColorSwatch(isTrack2D ? track.getColor() : track.x.track.color);
        row.appendChild(colorpickerButton);

        colorpickerButton.addEventListener('click', () => {
            const nextElement = row.nextElementSibling;
            if (nextElement && nextElement.classList.contains('hic-color-swatch-container')) {
                nextElement.style.display = nextElement.style.display === 'none' ? 'flex' : 'none';
            }
        });

        colorpickerContainer.style.display = 'none';

        const colorHandler = color => {
            const swatch = row.querySelector('.fa-square');
            if (swatch) {
                swatch.style.color = color;
            }

            if (isTrack2D) {
                track.color = color;
                this.browser.notifyTrackState2D(track);
            } else {
                trackRenderer.setColor(color);
            }
        };

        createColorSwatchSelector(colorpickerContainer, colorHandler);

        // track up/down
        const upDownContainer = document.createElement('div');
        upDownContainer.className = 'up-down-arrow-container';
        row.appendChild(upDownContainer);

        const upTrack = document.createElement('i');
        upTrack.className = 'fa fa-arrow-up';
        upTrack.setAttribute('aria-hidden', 'true');
        upDownContainer.appendChild(upTrack);

        const downTrack = document.createElement('i');
        downTrack.className = 'fa fa-arrow-down';
        downTrack.setAttribute('aria-hidden', 'true');
        upDownContainer.appendChild(downTrack);

        const hiddenColor = '#f7f7f7'
        if (trackList.length === 1) {
            upTrack.style.color = hiddenColor;
            downTrack.style.color = hiddenColor;
        } else if (track === trackList[0]) {
            const arrow = isTrack2D ? downTrack : upTrack;
            arrow.style.color = hiddenColor;
        } else if (track === trackList[trackList.length - 1]) {
            const arrow = isTrack2D ? upTrack : downTrack;
            arrow.style.color = hiddenColor;
        }

        const index = trackList.indexOf(track);

        const moveUp = () => {
            const temp = trackList[index + 1];
            trackList[index + 1] = trackList[index];
            trackList[index] = temp;

            if (isTrack2D) {
                this.browser.notifyTrackState2D(trackList);
                this.updateBody(trackList);
            } else {
                this.browser.updateLayout();
                this.updateBody(trackList);
            }
        };

        const moveDown = () => {
            const temp = trackList[index - 1];
            trackList[index - 1] = trackList[index];
            trackList[index] = temp;

            if (isTrack2D) {
                this.browser.notifyTrackState2D(trackList);
                this.updateBody(trackList);
            } else {
                this.browser.updateLayout();
                this.updateBody(trackList);
            }
        };

        upTrack.addEventListener('click', isTrack2D ? moveUp : moveDown);
        downTrack.addEventListener('click', isTrack2D ? moveDown : moveUp);


        const deleteIcon = document.createElement('i');
        deleteIcon.className = 'fa fa-trash-o fa-lg';
        row.appendChild(deleteIcon);

        deleteIcon.addEventListener('click', () => {
            const index = trackList.indexOf(track);
            if (isTrack2D) {
                trackList.splice(index, 1);
                this.browser.contactMatrixView.clearImageCaches();
                this.browser.contactMatrixView.update();
                this.browser.notifyTrackLoad2D(trackList);
            } else {
                this.browser.layoutController.removeTrackXYPair(track.x.track.trackRenderPair);
            }

            this.updateBody(trackList);
        });
    }

    displayModeHandler(icon, track2D) {
        if (icon.classList.contains('matrix-diagonal-widget-all')) {
            icon.classList.replace('matrix-diagonal-widget-all', 'matrix-diagonal-widget-lower');
            track2D.displayMode = 'lower';
        } else if (icon.classList.contains('matrix-diagonal-widget-lower')) {
            icon.classList.replace('matrix-diagonal-widget-lower', 'matrix-diagonal-widget-upper');
            track2D.displayMode = 'upper';
        } else {
            icon.classList.replace('matrix-diagonal-widget-upper', 'matrix-diagonal-widget-all');
            track2D.displayMode = undefined;
        }
    }

    annotationColorSwatch(color) {
        const swatch = document.createElement('div');
        swatch.className = 'igv-color-swatch';

        const icon = document.createElement('i');
        icon.className = 'fa fa-square fa-lg';
        icon.style.color = color;
        swatch.appendChild(icon);

        return swatch;
    }
}

function createAnnotationPanelColorpickerContainer(parent, size, closeHandler) {

    const container = document.createElement('div');
    container.className = 'hic-color-swatch-container';
    parent.appendChild(container);

    // width
    if (size && size.width) {
        container.style.width = `${size.width}px`;
    }

    // height
    if (size && size.height) {
        container.style.height = `${size.height}px`;
    }

    // header
    const header = document.createElement('div');
    container.appendChild(header);

    // close button
    const closeButton = document.createElement('i');
    closeButton.className = 'fa fa-times';
    header.appendChild(closeButton);

    closeButton.addEventListener('click', () => {
        closeHandler();
    });

    return container;
}

export default AnnotationWidget;
