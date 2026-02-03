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
 * BrowserCoordinator handles all browser component orchestration.
 * 
 * This class replaces the event bus pattern for internal orchestration with explicit,
 * traceable method calls. It coordinates updates to UI components when browser state changes,
 * providing a clear API for both internal updates and external integration.
 * 
 * Benefits:
 * - Explicit: Can see exactly what happens in one place
 * - Traceable: Easy to set breakpoints and debug
 * - Testable: Can mock components easily
 * - External integration: Clear API for external apps (e.g., Spacewalk)
 * - No magic: Everything is explicit, no hidden subscriptions
 */
class BrowserCoordinator {

    /**
     * @param {HICBrowser} browser - The browser instance this coordinator serves
     */
    constructor(browser) {
        this.browser = browser;
        this.components = this._initializeComponents();
        this.externalCallbacks = {
            onMapLoaded: [],
            onControlMapLoaded: [],
            onLocusChange: [],
            onGenomeChange: []
        };
    }

    /**
     * Initialize component references explicitly.
     * This makes it clear which components the coordinator orchestrates.
     * 
     * @returns {Object} - Object containing all component references
     * @private
     */
    _initializeComponents() {
        return {
            contactMatrix: this.browser.contactMatrixView,
            chromosomeSelector: this.browser.ui.getComponent('chromosomeSelector'),
            rulers: {
                x: this.browser.layoutController.xAxisRuler,
                y: this.browser.layoutController.yAxisRuler
            },
            resolutionSelector: this.browser.ui.getComponent('resolutionSelector'),
            normalizationWidget: this.browser.ui.getComponent('normalization'),
            colorScaleWidget: this.browser.ui.getComponent('colorScaleWidget'),
            controlMapWidget: this.browser.ui.getComponent('controlMap'),
            locusGoto: this.browser.ui.getComponent('locusGoto'),
            scrollbar: this.browser.ui.getComponent('scrollbar')
        };
    }

    /**
     * Orchestrate component updates when a map is loaded.
     * 
     * This method explicitly calls each component that needs to be updated,
     * making it easy to see what happens and debug issues.
     * 
     * @param {Dataset} dataset - The loaded dataset
     * @param {State} state - The current state
     * @param {string} datasetType - Type of dataset (e.g., "main", "control")
     */
    onMapLoaded(dataset, state, datasetType) {
        // 1. Initialize contact matrix view
        if (!this.components.contactMatrix.mouseHandlersEnabled) {
            this.components.contactMatrix.addTouchHandlers(this.components.contactMatrix.viewportElement);
            this.components.contactMatrix.addMouseHandlers(this.components.contactMatrix.viewportElement);
            this.components.contactMatrix.mouseHandlersEnabled = true;
        }
        this.components.contactMatrix.clearImageCaches();
        this.components.contactMatrix.colorScaleThresholdCache = {};

        // 2. Update chromosome selector
        if (this.components.chromosomeSelector) {
            this.components.chromosomeSelector.respondToDataLoadWithDataset(dataset);
        }

        // 3. Update rulers
        if (this.components.rulers.x) {
            this.components.rulers.x.wholeGenomeLayout(
                this.components.rulers.x.axisElement,
                this.components.rulers.x.wholeGenomeContainerElement,
                this.components.rulers.x.axis,
                dataset
            );
            this.components.rulers.x.update();
        }
        if (this.components.rulers.y) {
            this.components.rulers.y.wholeGenomeLayout(
                this.components.rulers.y.axisElement,
                this.components.rulers.y.wholeGenomeContainerElement,
                this.components.rulers.y.axis,
                dataset
            );
            this.components.rulers.y.update();
        }

        // 4. Update normalization widget
        if (this.components.normalizationWidget) {
            this.components.normalizationWidget.receiveEvent({
                type: "MapLoad",
                data: { dataset, state, datasetType }
            });
        }

        // 5. Update resolution selector
        if (this.components.resolutionSelector) {
            this.browser.resolutionLocked = false;
            this.components.resolutionSelector.setResolutionLock(false);
            this.components.resolutionSelector.updateResolutions(this.browser.state.zoom);
        }

        // 6. Update color scale widget
        if (this.components.colorScaleWidget) {
            this.components.colorScaleWidget.updateMapBackgroundColor(
                this.browser.contactMatrixView.backgroundColor
            );
        }

        // 7. Update control map widget
        if (this.components.controlMapWidget && !this.browser.controlDataset) {
            this.components.controlMapWidget.hide();
        }

        // 8. Notify external callbacks
        for (const callback of this.externalCallbacks.onMapLoaded) {
            callback({ dataset, state, datasetType, browser: this.browser });
        }
    }

    /**
     * Orchestrate component updates when a control map is loaded.
     * 
     * @param {Dataset} controlDataset - The loaded control dataset
     */
    onControlMapLoaded(controlDataset) {
        if (this.components.controlMapWidget) {
            this.components.controlMapWidget.updateDisplayMode(this.browser.getDisplayMode());
            this.components.controlMapWidget.show();
        }

        if (this.components.resolutionSelector) {
            this.components.resolutionSelector.updateResolutions(this.browser.state.zoom);
        }

        // ContactMatrixView also needs to know about control map
        this.components.contactMatrix.clearImageCaches();
        this.components.contactMatrix.colorScaleThresholdCache = {};

        // Notify external callbacks
        for (const callback of this.externalCallbacks.onControlMapLoaded) {
            callback({ controlDataset, browser: this.browser });
        }
    }

    /**
     * Orchestrate component updates when the locus changes.
     * 
     * @param {Object} eventData - Event data containing state and change flags
     * @param {State} eventData.state - The new state
     * @param {boolean} eventData.resolutionChanged - Whether resolution changed
     * @param {boolean} eventData.chrChanged - Whether chromosome changed
     * @param {boolean} eventData.dragging - Whether currently dragging
     */
    onLocusChange(eventData) {
        const { state, resolutionChanged, chrChanged } = eventData;

        // 1. Update chromosome selector
        if (this.components.chromosomeSelector) {
            this.components.chromosomeSelector.respondToLocusChangeWithState(state);
        }

        // 2. Update scrollbar widget
        if (this.components.scrollbar && !this.components.scrollbar.isDragging) {
            this.components.scrollbar.receiveEvent({
                type: "LocusChange",
                data: { state }
            });
        }

        // 3. Update resolution selector
        if (this.components.resolutionSelector) {
            if (resolutionChanged) {
                this.browser.resolutionLocked = false;
                this.components.resolutionSelector.setResolutionLock(false);
            }
            if (chrChanged !== false) {
                const isWholeGenome = this.browser.dataset.isWholeGenome(state.chr1);
                this.components.resolutionSelector.updateLabelForWholeGenome(isWholeGenome);
                this.components.resolutionSelector.updateResolutions(state.zoom);
            } else {
                this.components.resolutionSelector.setSelectedResolution(state.zoom);
            }
        }

        // 4. Update locus goto widget
        if (this.components.locusGoto) {
            this.components.locusGoto.receiveEvent({
                type: "LocusChange",
                data: { state }
            });
        }

        // 5. Notify external callbacks
        for (const callback of this.externalCallbacks.onLocusChange) {
            callback({ state, changes: { resolutionChanged, chrChanged }, browser: this.browser });
        }
    }

    /**
     * Orchestrate component updates when normalization changes.
     * 
     * @param {string} normalization - The normalization type
     */
    onNormalizationChange(normalization) {
        this.components.contactMatrix.receiveEvent({ type: "NormalizationChange", data: normalization });
        // NormalizationWidget updates via selector change, no direct notification needed
    }

    /**
     * Orchestrate component updates when display mode changes.
     * 
     * @param {string} mode - The display mode ("A", "B", "AOB", "BOA")
     */
    onDisplayMode(mode) {
        if (this.components.colorScaleWidget) {
            this.components.colorScaleWidget.updateForDisplayMode(
                mode,
                this.browser.contactMatrixView.ratioColorScale,
                this.browser.contactMatrixView.colorScale
            );
        }

        if (this.components.controlMapWidget) {
            this.components.controlMapWidget.updateDisplayMode(mode);
        }
    }

    /**
     * Orchestrate component updates when color scale changes.
     * 
     * @param {ColorScale|RatioColorScale} colorScale - The color scale instance
     */
    onColorScale(colorScale) {
        if (this.components.colorScaleWidget) {
            this.components.colorScaleWidget.updateForColorScale(colorScale);
        }
    }

    /**
     * Orchestrate component updates when 2D tracks are loaded.
     * 
     * @param {Array} tracks2D - Array of 2D track instances
     */
    onTrackLoad2D(tracks2D) {
        this.components.contactMatrix.receiveEvent({ type: "TrackLoad2D", data: tracks2D });
    }

    /**
     * Orchestrate component updates when 2D track state changes.
     * 
     * @param {Object|Array} trackData - Track state data
     */
    onTrackState2D(trackData) {
        this.components.contactMatrix.receiveEvent({ type: "TrackState2D", data: trackData });
    }

    /**
     * Orchestrate component updates when normalization vector index is loaded.
     * 
     * @param {Dataset} dataset - The dataset with loaded normalization vectors
     */
    onNormVectorIndexLoad(dataset) {
        if (this.components.normalizationWidget) {
            this.components.normalizationWidget.updateOptions();
            this.components.normalizationWidget.stopNotReady();
        }
    }

    /**
     * Orchestrate component updates for normalization file load status.
     * 
     * @param {string} status - Load status ("start" or "stop")
     */
    onNormalizationFileLoad(status) {
        if (this.components.normalizationWidget) {
            if (status === "start") {
                this.components.normalizationWidget.startNotReady();
            } else {
                this.components.normalizationWidget.stopNotReady();
            }
        }
    }

    /**
     * Orchestrate component updates when normalization changes externally.
     * 
     * Uses a programmatic update method that prevents feedback loops by ensuring
     * the change event listener doesn't trigger when we programmatically set the value.
     * 
     * @param {string} normalization - The normalization type
     */
    onNormalizationExternalChange(normalization) {
        if (this.components.normalizationWidget) {
            // Use programmatic update method to prevent feedback loop
            this.components.normalizationWidget.setNormalizationProgrammatically(normalization);
        }
    }

    /**
     * Orchestrate component updates when colors change.
     */
    onColorChange() {
        this.components.contactMatrix.receiveEvent({ type: "ColorChange" });
    }

    /**
     * Orchestrate component updates when contact map mouse position changes.
     * Updates ruler highlighting based on mouse position.
     * 
     * @param {Object} xy - Mouse position coordinates
     * @param {number} xy.x - X coordinate
     * @param {number} xy.y - Y coordinate
     */
    onUpdateContactMapMousePosition(xy) {
        // Update ruler highlighting for mouse position
        this._updateRulerHighlightingForMousePosition(this.components.rulers.x, xy);
        this._updateRulerHighlightingForMousePosition(this.components.rulers.y, xy);
    }

    /**
     * Private helper: Update ruler highlighting for mouse position.
     * 
     * @param {Object} ruler - Ruler instance (x or y axis)
     * @param {Object} xy - Mouse position coordinates
     * @private
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
     * Register an external callback for a specific event.
     * 
     * This provides a clear API for external applications (e.g., Spacewalk) to hook into
     * browser events without needing to understand the internal event system.
     * 
     * @param {string} event - Event name ('onMapLoaded', 'onControlMapLoaded', 'onLocusChange', 'onGenomeChange')
     * @param {Function} callback - Callback function to call when event occurs
     * @returns {Function} - Unsubscribe function to remove the callback
     * @throws {Error} - If event name is unknown
     * 
     * @example
     * const unsubscribe = browser.coordinator.addCallback('onMapLoaded', (data) => {
     *     console.log('Map loaded:', data.dataset.name);
     * });
     * // Later...
     * unsubscribe();
     */
    addCallback(event, callback) {
        if (!this.externalCallbacks[event]) {
            throw new Error(
                `Unknown event: ${event}. Available: ${Object.keys(this.externalCallbacks).join(', ')}`
            );
        }
        this.externalCallbacks[event].push(callback);
        return () => {
            const index = this.externalCallbacks[event].indexOf(callback);
            if (index > -1) {
                this.externalCallbacks[event].splice(index, 1);
            }
        };
    }

    /**
     * Get all registered callbacks for a specific event.
     * Useful for debugging and introspection.
     * 
     * @param {string} event - Event name
     * @returns {Array<Function>} - Array of callback functions
     */
    getCallbacksFor(event) {
        return this.externalCallbacks[event] || [];
    }

    /**
     * Orchestrate component updates when the genome changes.
     * 
     * This method is called when a new genome is loaded (e.g., when loading a Hi-C file
     * with a different genome assembly). 
     * 
     * Note: Component updates (like chromosome selector) happen automatically when the
     * dataset loads via onMapLoaded(), so we don't need to update them here. This method
     * primarily exists to notify external callbacks (e.g., Spacewalk integration) so they
     * can coordinate locus setting before configureLocus() runs.
     * 
     * @param {string} genomeId - The ID of the new genome (e.g., "hg38", "mm10")
     */
    onGenomeChange(genomeId) {
        // Notify external callbacks (e.g., Spacewalk integration)
        // This allows external code to set locus before configureLocus() derives a default
        this.externalCallbacks.onGenomeChange.forEach(callback => {
            try {
                callback({ genomeId });
            } catch (error) {
                console.error('Error in onGenomeChange callback:', error);
            }
        });
    }

    /**
     * List all components managed by this coordinator.
     * Useful for debugging and introspection.
     * 
     * @returns {Array<string>} - Array of component names
     */
    listComponents() {
        return Object.keys(this.components);
    }
}

export default BrowserCoordinator;
