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
 */

import {hitTestBbox} from "./utils.js"

/**
 * NotificationCoordinator handles all UI component notifications.
 * Extracted from HICBrowser to separate UI coordination concerns.
 * 
 * This class coordinates updates to UI components when browser state changes,
 * following the Explicit Notification Method pattern.
 */
class NotificationCoordinator {

    /**
     * @param {HICBrowser} browser - The browser instance this coordinator serves
     */
    constructor(browser) {
        this.browser = browser;
    }

    /**
     * Private helper: Get a UI component by name.
     * 
     * @param {string} componentName - The name of the component to retrieve
     * @returns {Object|undefined} - The component instance, or undefined if not found
     */
    _getUIComponent(componentName) {
        return this.browser.ui.getComponent(componentName);
    }

    /**
     * Private helper: Initialize ContactMatrixView when a map is loaded.
     * Enables mouse handlers and clears caches.
     */
    _initializeContactMatrixViewForMapLoad() {
        const contactMatrixView = this.browser.contactMatrixView;
        if (!contactMatrixView.mouseHandlersEnabled) {
            contactMatrixView.addTouchHandlers(contactMatrixView.viewportElement);
            contactMatrixView.addMouseHandlers(contactMatrixView.viewportElement);
            contactMatrixView.mouseHandlersEnabled = true;
        }
        contactMatrixView.clearImageCaches();
        contactMatrixView.colorScaleThresholdCache = {};
    }

    /**
     * Private helper: Update chromosome selector when a map is loaded.
     */
    _updateChromosomeSelectorForMapLoad(dataset) {
        const chromosomeSelector = this._getUIComponent('chromosomeSelector');
        if (chromosomeSelector) {
            chromosomeSelector.respondToDataLoadWithDataset(dataset);
        }
    }

    /**
     * Private helper: Update rulers when a map is loaded.
     */
    _updateRulersForMapLoad(dataset) {
        const layoutController = this.browser.layoutController;
        const xRuler = layoutController.xAxisRuler;
        if (xRuler) {
            xRuler.wholeGenomeLayout(xRuler.axisElement, xRuler.wholeGenomeContainerElement, xRuler.axis, dataset);
            xRuler.update();
        }
        const yRuler = layoutController.yAxisRuler;
        if (yRuler) {
            yRuler.wholeGenomeLayout(yRuler.axisElement, yRuler.wholeGenomeContainerElement, yRuler.axis, dataset);
            yRuler.update();
        }
    }

    /**
     * Private helper: Update normalization widget when a map is loaded.
     */
    _updateNormalizationWidgetForMapLoad(data) {
        const normalizationWidget = this._getUIComponent('normalization');
        if (normalizationWidget) {
            normalizationWidget.receiveEvent({ type: "MapLoad", data });
        }
    }

    /**
     * Private helper: Update resolution selector when a map is loaded.
     */
    _updateResolutionSelectorForMapLoad() {
        const resolutionSelector = this._getUIComponent('resolutionSelector');
        if (resolutionSelector) {
            this.browser.resolutionLocked = false;
            resolutionSelector.setResolutionLock(false);
            resolutionSelector.updateResolutions(this.browser.state.zoom);
        }
    }

    /**
     * Private helper: Update color scale widget when a map is loaded.
     */
    _updateColorScaleWidgetForMapLoad() {
        const colorScaleWidget = this._getUIComponent('colorScaleWidget');
        if (colorScaleWidget) {
            colorScaleWidget.updateMapBackgroundColor(this.browser.contactMatrixView.backgroundColor);
        }
    }

    /**
     * Private helper: Update control map widget when a map is loaded.
     */
    _updateControlMapWidgetForMapLoad() {
        const controlMapWidget = this._getUIComponent('controlMap');
        if (controlMapWidget && !this.browser.controlDataset) {
            controlMapWidget.hide();
        }
    }

    /**
     * Notify all UI components that a map has been loaded.
     * 
     * @param {Dataset} dataset - The loaded dataset
     * @param {State} state - The current state
     * @param {string} datasetType - Type of dataset (e.g., "main", "control")
     */
    notifyMapLoaded(dataset, state, datasetType) {
        const data = { dataset, state, datasetType };

        this._initializeContactMatrixViewForMapLoad();
        this._updateChromosomeSelectorForMapLoad(dataset);
        this._updateRulersForMapLoad(dataset);
        this._updateNormalizationWidgetForMapLoad(data);
        this._updateResolutionSelectorForMapLoad();
        this._updateColorScaleWidgetForMapLoad();
        this._updateControlMapWidgetForMapLoad();

        // Note: locusGoto is notified via notifyLocusChange() which is called from setState()
        // after the locus is properly configured. Don't notify here as state.locus might not exist yet.
    }

    /**
     * Notify UI components that a control map has been loaded.
     * 
     * @param {Dataset} controlDataset - The loaded control dataset
     */
    notifyControlMapLoaded(controlDataset) {
        const controlMapWidget = this._getUIComponent('controlMap');
        if (controlMapWidget) {
            controlMapWidget.updateDisplayMode(this.browser.getDisplayMode());
            controlMapWidget.show();
        }

        const resolutionSelector = this._getUIComponent('resolutionSelector');
        if (resolutionSelector) {
            resolutionSelector.updateResolutions(this.browser.state.zoom);
        }

        // ContactMatrixView also needs to know about control map
        const contactMatrixView = this.browser.contactMatrixView;
        contactMatrixView.clearImageCaches();
        contactMatrixView.colorScaleThresholdCache = {};
    }

    /**
     * Private helper: Update chromosome selector when locus changes.
     */
    _updateChromosomeSelectorForLocusChange(state) {
        const chromosomeSelector = this._getUIComponent('chromosomeSelector');
        if (chromosomeSelector) {
            chromosomeSelector.respondToLocusChangeWithState(state);
        }
    }

    /**
     * Private helper: Update scrollbar widget when locus changes.
     */
    _updateScrollbarForLocusChange(state) {
        const scrollbarWidget = this._getUIComponent('scrollbar');
        if (scrollbarWidget && !scrollbarWidget.isDragging) {
            scrollbarWidget.receiveEvent({ type: "LocusChange", data: { state } });
        }
    }

    /**
     * Private helper: Update resolution selector when locus changes.
     */
    _updateResolutionSelectorForLocusChange(state, resolutionChanged, chrChanged) {
        const resolutionSelector = this._getUIComponent('resolutionSelector');
        if (!resolutionSelector) {
            return;
        }

        if (resolutionChanged) {
            this.browser.resolutionLocked = false;
            resolutionSelector.setResolutionLock(false);
        }

        if (chrChanged !== false) {
            const isWholeGenome = this.browser.dataset.isWholeGenome(state.chr1);
            resolutionSelector.updateLabelForWholeGenome(isWholeGenome);
            resolutionSelector.updateResolutions(state.zoom);
        } else {
            resolutionSelector.setSelectedResolution(state.zoom);
        }
    }

    /**
     * Private helper: Update locus goto widget when locus changes.
     */
    _updateLocusGotoForLocusChange(state) {
        const locusGoto = this._getUIComponent('locusGoto');
        if (locusGoto) {
            locusGoto.receiveEvent({ type: "LocusChange", data: { state } });
        }
    }

    /**
     * Notify UI components that the locus has changed.
     * 
     * @param {Object} eventData - Event data containing state and change flags
     * @param {State} eventData.state - The new state
     * @param {boolean} eventData.resolutionChanged - Whether resolution changed
     * @param {boolean} eventData.chrChanged - Whether chromosome changed
     * @param {boolean} eventData.dragging - Whether currently dragging
     */
    notifyLocusChange(eventData) {
        const { state, resolutionChanged, chrChanged, dragging } = eventData;

        // ContactMatrixView - only clear caches if not a locus change
        // (locus changes don't require cache clearing)

        this._updateChromosomeSelectorForLocusChange(state);
        this._updateScrollbarForLocusChange(state);
        this._updateResolutionSelectorForLocusChange(state, resolutionChanged, chrChanged);
        this._updateLocusGotoForLocusChange(state);

        // Rulers are updated directly in update() method, not here
    }

    /**
     * Notify UI components that normalization has changed.
     * 
     * @param {string} normalization - The normalization type
     */
    notifyNormalizationChange(normalization) {
        // ContactMatrixView
        this.browser.contactMatrixView.receiveEvent({ type: "NormalizationChange", data: normalization });

        // NormalizationWidget - no direct notification needed, it updates via selector change
    }

    /**
     * Private helper: Update color scale widget for display mode changes.
     */
    _updateColorScaleWidgetForDisplayMode(mode) {
        const colorScaleWidget = this._getUIComponent('colorScaleWidget');
        if (colorScaleWidget) {
            const contactMatrixView = this.browser.contactMatrixView;
            colorScaleWidget.updateForDisplayMode(
                mode,
                contactMatrixView.ratioColorScale,
                contactMatrixView.colorScale
            );
        }
    }

    /**
     * Private helper: Update control map widget for display mode changes.
     */
    _updateControlMapWidgetForDisplayMode(mode) {
        const controlMapWidget = this._getUIComponent('controlMap');
        if (controlMapWidget) {
            controlMapWidget.updateDisplayMode(mode);
        }
    }

    /**
     * Notify UI components that display mode has changed.
     * 
     * @param {string} mode - The display mode ("A", "B", "AOB", "BOA")
     */
    notifyDisplayMode(mode) {
        this._updateColorScaleWidgetForDisplayMode(mode);
        this._updateControlMapWidgetForDisplayMode(mode);
    }

    /**
     * Notify UI components that color scale has changed.
     * 
     * @param {ColorScale|RatioColorScale} colorScale - The color scale instance
     */
    notifyColorScale(colorScale) {
        const colorScaleWidget = this._getUIComponent('colorScaleWidget');
        if (colorScaleWidget) {
            colorScaleWidget.updateForColorScale(colorScale);
        }
    }

    /**
     * Notify UI components that 2D tracks have been loaded.
     * 
     * @param {Array} tracks2D - Array of 2D track instances
     */
    notifyTrackLoad2D(tracks2D) {
        this.browser.contactMatrixView.receiveEvent({ type: "TrackLoad2D", data: tracks2D });
    }

    /**
     * Notify UI components that 2D track state has changed.
     * 
     * @param {Object|Array} trackData - Track state data
     */
    notifyTrackState2D(trackData) {
        this.browser.contactMatrixView.receiveEvent({ type: "TrackState2D", data: trackData });
    }

    /**
     * Notify UI components that normalization vector index has been loaded.
     * 
     * @param {Dataset} dataset - The dataset with loaded normalization vectors
     */
    notifyNormVectorIndexLoad(dataset) {
        const normalizationWidget = this._getUIComponent('normalization');
        if (normalizationWidget) {
            normalizationWidget.updateOptions();
            normalizationWidget.stopNotReady();
        }
    }

    /**
     * Notify UI components about normalization file load status.
     * 
     * @param {string} status - Load status ("start" or "stop")
     */
    notifyNormalizationFileLoad(status) {
        const normalizationWidget = this._getUIComponent('normalization');
        if (normalizationWidget) {
            if (status === "start") {
                normalizationWidget.startNotReady();
            } else {
                normalizationWidget.stopNotReady();
            }
        }
    }

    /**
     * Notify UI components that normalization has changed externally.
     * 
     * @param {string} normalization - The normalization type
     */
    notifyNormalizationExternalChange(normalization) {
        const normalizationWidget = this._getUIComponent('normalization');
        if (normalizationWidget) {
            Array.from(normalizationWidget.normalizationSelector.options).forEach(option => {
                option.selected = option.value === normalization;
            });
        }
    }

    /**
     * Notify UI components that colors have changed.
     */
    notifyColorChange() {
        this.browser.contactMatrixView.receiveEvent({ type: "ColorChange" });
    }

    /**
     * Private helper: Update ruler highlighting for mouse position.
     */
    _updateRulerHighlightingForMousePosition(ruler, xy) {
        if (!ruler || !ruler.bboxes) {
            return;
        }

        ruler.unhighlightWholeChromosome();
        const offset = ruler.axis === 'x' ? xy.x : xy.y;
        const element = hitTestBbox(ruler.bboxes, offset);
        if (element) {
            element.classList.add('hic-whole-genome-chromosome-highlight');
        }
    }

    /**
     * Notify UI components that contact map mouse position has changed.
     * 
     * @param {Object} xy - Mouse position coordinates
     * @param {number} xy.x - X coordinate
     * @param {number} xy.y - Y coordinate
     */
    notifyUpdateContactMapMousePosition(xy) {
        const layoutController = this.browser.layoutController;
        this._updateRulerHighlightingForMousePosition(layoutController.xAxisRuler, xy);
        this._updateRulerHighlightingForMousePosition(layoutController.yAxisRuler, xy);
    }
}

export default NotificationCoordinator;

