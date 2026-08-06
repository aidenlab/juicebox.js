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
        this.rulers = {
            x: browser.layoutController.xAxisRuler,
            y: browser.layoutController.yAxisRuler
        };
        // Both set by adoptWidgets(). The coordinator is constructed before the
        // widgets because their observer closures notify it directly -- see
        // createWidgets().
        this.widgets = undefined;
        this.contactMatrixView = undefined;
        this.externalCallbacks = {
            onMapLoaded: [],
            onControlMapLoaded: [],
            onLocusChange: [],
            onGenomeChange: [],
            onBackgroundColorChange: [],
            onForegroundColorChange: []
        };
    }

    /**
     * Take ownership of the record returned by createWidgets().
     *
     * The coordinator fans out to widgets, rulers and the contact matrix view, and
     * CONTEXT.md keeps those three apart -- so the contact matrix view is held on
     * its own rather than filed under `widgets`. The record also carries the sweep-
     * zoom gesture helper and the image tile source, which are none of the three:
     * the contact matrix view owns them and the coordinator never touches them.
     *
     * @param {Object} record - the record returned by createWidgets()
     */
    adoptWidgets(record) {
        const { contactMatrixView, sweepZoom, imageTileSource, ...widgets } = record;
        this.contactMatrixView = contactMatrixView;
        this.widgets = widgets;
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
        if (!this.contactMatrixView.mouseHandlersEnabled) {
            this.contactMatrixView.addTouchHandlers(this.contactMatrixView.viewportElement);
            this.contactMatrixView.addMouseHandlers(this.contactMatrixView.viewportElement);
            this.contactMatrixView.mouseHandlersEnabled = true;
        }
        this.contactMatrixView.clearImageCaches({thresholds: true});

        // 2. Update chromosome selector
        if (this.widgets.chromosomeSelector) {
            this.widgets.chromosomeSelector.respondToDataLoadWithDataset(dataset);
        }

        // 3. Update rulers
        if (this.rulers.x) {
            this.rulers.x.wholeGenomeLayout(
                this.rulers.x.axisElement,
                this.rulers.x.wholeGenomeContainerElement,
                this.rulers.x.axis,
                dataset
            );
            this.rulers.x.update();
        }
        if (this.rulers.y) {
            this.rulers.y.wholeGenomeLayout(
                this.rulers.y.axisElement,
                this.rulers.y.wholeGenomeContainerElement,
                this.rulers.y.axis,
                dataset
            );
            this.rulers.y.update();
        }

        // 4. The normalization widget is updated by onNormVectorIndexLoad,
        // which the map-load path calls immediately after this. It had a
        // MapLoad dispatch here that its handler never had a branch for.

        // 5. Update resolution selector
        if (this.widgets.resolutionSelector) {
            this.browser.resolutionLocked = false;
            this.widgets.resolutionSelector.setResolutionLock(false);
            this.widgets.resolutionSelector.updateResolutions(this.browser.state.zoom);
        }

        // 6. Update color scale widget
        if (this.widgets.colorScaleWidget) {
            this.widgets.colorScaleWidget.updateMapBackgroundColor(
                this.browser.contactMatrixView.backgroundColor
            );
        }

        // 7. Update control map widget
        if (this.widgets.controlMapWidget && !this.browser.controlDataset) {
            this.widgets.controlMapWidget.hide();
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
        if (this.widgets.controlMapWidget) {
            this.widgets.controlMapWidget.updateDisplayMode(this.browser.getDisplayMode());
            this.widgets.controlMapWidget.show();
        }

        if (this.widgets.resolutionSelector) {
            this.widgets.resolutionSelector.updateResolutions(this.browser.state.zoom);
        }

        // ContactMatrixView also needs to know about control map
        this.contactMatrixView.clearImageCaches({thresholds: true});

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
        if (this.widgets.chromosomeSelector) {
            this.widgets.chromosomeSelector.respondToLocusChangeWithState(state);
        }

        // 2. Update scrollbar widget
        if (this.widgets.scrollbar) {
            this.widgets.scrollbar.updateForState(state);
        }

        // 3. Update resolution selector
        if (this.widgets.resolutionSelector) {
            if (resolutionChanged) {
                this.browser.resolutionLocked = false;
                this.widgets.resolutionSelector.setResolutionLock(false);
            }
            if (chrChanged !== false) {
                const isWholeGenome = this.browser.dataset.isWholeGenome(state.chr1);
                this.widgets.resolutionSelector.updateLabelForWholeGenome(isWholeGenome);
                this.widgets.resolutionSelector.updateResolutions(state.zoom);
            } else {
                this.widgets.resolutionSelector.setSelectedResolution(state.zoom);
            }
        }

        // 4. Update locus goto widget
        if (this.widgets.locusGoto) {
            this.widgets.locusGoto.updateForState(state);
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
        this.contactMatrixView.receiveEvent({ type: "NormalizationChange", data: normalization });
        // NormalizationWidget updates via selector change, no direct notification needed
    }

    /**
     * Orchestrate component updates when display mode changes.
     * 
     * @param {string} mode - The display mode ("A", "B", "AOB", "BOA", "AMB")
     */
    onDisplayMode(mode) {
        if (this.widgets.colorScaleWidget) {
            this.widgets.colorScaleWidget.updateForColorScale(
                this.browser.contactMatrixView.getColorScale(mode)
            );
        }

        if (this.widgets.controlMapWidget) {
            this.widgets.controlMapWidget.updateDisplayMode(mode);
        }
    }

    /**
     * Orchestrate component updates when color scale changes.
     * 
     * @param {ColorScale|RatioColorScale} colorScale - The color scale instance
     */
    onColorScale(colorScale) {
        if (this.widgets.colorScaleWidget) {
            this.widgets.colorScaleWidget.updateForColorScale(colorScale);
        }
    }

    /**
     * Orchestrate component updates when 2D tracks are loaded.
     * 
     * @param {Array} tracks2D - Array of 2D track instances
     */
    onTrackLoad2D(tracks2D) {
        this.contactMatrixView.receiveEvent({ type: "TrackLoad2D", data: tracks2D });
    }

    /**
     * Orchestrate component updates when 2D track state changes.
     * 
     * @param {Object|Array} trackData - Track state data
     */
    onTrackState2D(trackData) {
        this.contactMatrixView.receiveEvent({ type: "TrackState2D", data: trackData });
    }

    /**
     * Orchestrate component updates when normalization vector index is loaded.
     * 
     * @param {Dataset} dataset - The dataset with loaded normalization vectors
     */
    onNormVectorIndexLoad(dataset) {
        if (this.widgets.normalizationWidget) {
            this.widgets.normalizationWidget.updateOptions();
            this.widgets.normalizationWidget.stopNotReady();
        }
    }

    /**
     * Orchestrate component updates for normalization file load status.
     * 
     * @param {string} status - Load status ("start" or "stop")
     */
    onNormalizationFileLoad(status) {
        if (this.widgets.normalizationWidget) {
            if (status === "start") {
                this.widgets.normalizationWidget.startNotReady();
            } else {
                this.widgets.normalizationWidget.stopNotReady();
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
        if (this.widgets.normalizationWidget) {
            // Use programmatic update method to prevent feedback loop
            this.widgets.normalizationWidget.setNormalizationProgrammatically(normalization);
        }
    }

    /**
     * Orchestrate component updates when colors change.
     */
    onColorChange() {
        this.contactMatrixView.receiveEvent({ type: "ColorChange" });
    }

    /**
     * Notify external callbacks when background color changes.
     *
     * @param {{r: number, g: number, b: number}} rgb - The new background color
     */
    onBackgroundColorChange(rgb) {
        for (const callback of this.externalCallbacks.onBackgroundColorChange) {
            callback({ rgb, browser: this.browser });
        }
    }

    /**
     * Notify external callbacks when foreground color changes.
     *
     * @param {{r: number, g: number, b: number}} rgb - The new foreground color
     */
    onForegroundColorChange(rgb) {
        for (const callback of this.externalCallbacks.onForegroundColorChange) {
            callback({ rgb, browser: this.browser });
        }
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
        this._updateRulerHighlightingForMousePosition(this.rulers.x, xy);
        this._updateRulerHighlightingForMousePosition(this.rulers.y, xy);
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
     * Orchestrate component updates when the genome changes.
     * 
     * This method is called when a new genome is loaded (e.g., when loading a Hi-C file
     * with a different genome assembly). 
     * 
     * Note: Component updates (like chromosome selector) happen automatically when the
     * dataset loads via onMapLoaded(), so we don't need to update them here. This method
     * primarily exists to notify external callbacks (e.g., Spacewalk integration) so they
     * can coordinate locus setting after a genome change.
     *
     * @param {string} genomeId - The ID of the new genome (e.g., "hg38", "mm10")
     */
    onGenomeChange(genomeId) {
        this.externalCallbacks.onGenomeChange.forEach(callback => {
            try {
                callback({ genomeId });
            } catch (error) {
                console.error('Error in onGenomeChange callback:', error);
            }
        });
    }
}

export default BrowserCoordinator;
