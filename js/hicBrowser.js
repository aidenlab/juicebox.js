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
 * @author Jim Robinson
 */

import {InputDialog, DOMUtils} from '../node_modules/igv-ui/dist/igv-ui.js'
import * as hicUtils from './hicUtils.js'
import {Globals} from "./globals.js"
import EventBus from "./eventBus.js"
import LayoutController, {setViewportSize} from './layoutController.js'
import { geneSearch } from './geneSearch.js'
import {getAllBrowsers} from "./createBrowser.js"
import {setTrackReorderArrowColors} from "./trackPair.js"
import BrowserUIManager from "./browserUIManager.js"
import NotificationCoordinator from "./notificationCoordinator.js"
import StateManager from "./stateManager.js"
import InteractionHandler from "./interactionHandler.js"
import DataLoader from "./dataLoader.js"
import RenderCoordinator from "./renderCoordinator.js"

const DEFAULT_PIXEL_SIZE = 1
const MAX_PIXEL_SIZE = 128

class HICBrowser {

    constructor(appContainer, config) {
        this.config = config;
        this.figureMode = config.figureMode || config.miniMode; // Mini mode for backward compatibility
        this.resolutionLocked = false;
        this.eventBus = new EventBus();

        this.showTrackLabelAndGutter = true;

        this.id = `browser_${DOMUtils.guid()}`;
        this.trackPairs = [];
        this.tracks2D = [];
        this.normVectorFiles = [];

        this.synchable = config.synchable !== false;
        this.synchedBrowsers = new Set();

        // Initialize state manager for dataset/state management
        this.stateManager = new StateManager(this);

        this.isMobile = hicUtils.isMobile();

        this.rootElement = document.createElement('div');
        this.rootElement.className = 'hic-root unselect';
        appContainer.appendChild(this.rootElement);


        if (config.width && config.height) {
            setViewportSize(config.width, config.height)
        }

        this.layoutController = new LayoutController(this, this.rootElement);

        this.inputDialog = new InputDialog(appContainer, this);

        this.menuElement = this.createMenu(this.rootElement);
        this.menuElement.style.display = 'none';

        // Initialize UI components through BrowserUIManager
        this.ui = new BrowserUIManager(this);

        // Get the contact matrix view from UI manager
        this.contactMatrixView = this.ui.getComponent('contactMatrix');

        // Initialize notification coordinator for UI updates
        this.notifications = new NotificationCoordinator(this);

        // Initialize interaction handler for user interactions
        this.interactions = new InteractionHandler(this);

        // Initialize data loader for data loading operations
        this.dataLoader = new DataLoader(this);

        // Initialize render coordinator for rendering operations
        this.renderCoordinator = new RenderCoordinator(this);

        // prevent user interaction during lengthy data loads
        this.userInteractionShield = document.createElement('div');
        this.userInteractionShield.className = 'hic-root-prevent-interaction';
        this.rootElement.appendChild(this.userInteractionShield);
        this.userInteractionShield.style.display = 'none';

        this.hideCrosshairs();
    }

    async init(config) {
        this.renderCoordinator.init();

        this.contactMatrixView.disableUpdates = true;

        try {
            this.contactMatrixView.startSpinner();
            this.userInteractionShield.style.display = 'block';

            await this.dataLoader.loadHicFile(config, true);

            if (config.controlUrl) {
                await this.dataLoader.loadHicControlFile({
                    url: config.controlUrl,
                    name: config.controlName,
                    nvi: config.controlNvi,
                    isControl: true
                }, true);
            }

            if (config.cycle) {
                config.displayMode = "A";
            }

            if (config.displayMode) {
                this.contactMatrixView.displayMode = config.displayMode;
                this.notifyDisplayMode(config.displayMode);
            }

            if (config.colorScale) {
                if (config.normalization) {
                    this.state.normalization = config.normalization;
                }
                this.contactMatrixView.setColorScale(config.colorScale);
                this.notifyColorScale(this.contactMatrixView.getColorScale());
            }

            const promises = [];

            if (config.tracks) {
                promises.push(this.dataLoader.loadTracks(config.tracks));
            }

            if (config.normVectorFiles) {
                config.normVectorFiles.forEach(nv => {
                    promises.push(this.dataLoader.loadNormalizationFile(nv));
                });
            }

            await Promise.all(promises);

            if (config.normalization) {
                const normalizations = await this.getNormalizationOptions();
                const validNormalizations = new Set(normalizations);
                this.state.normalization = validNormalizations.has(config.normalization) ? config.normalization : 'NONE';
            }

            // No longer need hold/release - notifications happen directly
            const tmp = this.contactMatrixView.colorScaleThresholdCache;
            this.contactMatrixView.colorScaleThresholdCache = tmp;

            if (config.cycle) {
                this.ui.getComponent('controlMap').toggleDisplayModeCycle();
            } else {
                await this.update();
            }

        } finally {
            this.contactMatrixView.stopSpinner();
            this.userInteractionShield.style.display = 'none';
            this.contactMatrixView.disableUpdates = false;
            this.contactMatrixView.update();
        }
    }

    createMenu(rootElement) {
        const html = `
        <div class="hic-menu" style="display: none;">
            <div class="hic-menu-close-button">
                <i class="fa fa-times"></i>
            </div>
            <div class="hic-chromosome-selector-widget-container">
                <div>Chromosomes</div>
                <div>
                    <select name="x-axis-selector"></select>
                    <select name="y-axis-selector"></select>
                    <div></div>
                </div>
            </div>
            <div class="hic-annotation-presentation-button-container">
                <button type="button">2D Annotations</button>
            </div>
        </div>`;

        const template = document.createElement('template');
        template.innerHTML = html.trim();
        const menuElement = template.content.firstChild;

        rootElement.appendChild(menuElement);

        const closeButton = menuElement.querySelector(".fa-times");
        closeButton.addEventListener('click', () => this.toggleMenu());

        return menuElement;
    }

    toggleTrackLabelAndGutterState() {
        this.showTrackLabelAndGutter = !this.showTrackLabelAndGutter
    }

    toggleMenu() {
        if (this.menuElement.style.display === "flex") {
            this.hideMenu();
        } else {
            this.showMenu();
        }
    }

    showMenu() {
        this.menuElement.style.display = "flex";
    }

    hideMenu() {
        this.menuElement.style.display = "none";
    }

    startSpinner() {
        this.contactMatrixView.startSpinner()
    }

    stopSpinner() {
        this.contactMatrixView.stopSpinner()
    }

    async setDisplayMode(mode) {
        await this.contactMatrixView.setDisplayMode(mode)
        this.notifyDisplayMode(mode)
    }

    getDisplayMode() {
        return this.contactMatrixView ? this.contactMatrixView.displayMode : undefined
    }

    async getNormalizationOptions() {

        if (!this.activeDataset) return []

        const baseOptions = this.activeDataset.getNormalizationOptions ?
            await this.activeDataset.getNormalizationOptions() : ['NONE'];
        if (this.controlDataset) {
            let controlOptions = this.controlDataset.getNormalizationOptions ?
                await this.controlDataset.getNormalizationOptions() : ['NONE'];
            controlOptions = new Set(controlOptions)
            return baseOptions.filter(base => controlOptions.has(base))
        } else {
            return baseOptions
        }
    }

    /**
     * Return usable resolutions, that is the union of resolutions between dataset and controlDataset.
     * @returns {{index: *, binSize: *}[]|Array}
     */
    getResolutions() {
        if (!this.activeDataset) return []

        const baseResolutions = this.activeDataset.bpResolutions.map(function (resolution, index) {
            return {index: index, binSize: resolution}
        })
        if (this.controlDataset) {
            let controlResolutions = new Set(this.controlDataset.bpResolutions)
            return baseResolutions.filter(base => controlResolutions.has(base.binSize))
        } else {
            return baseResolutions
        }
    }

    isWholeGenome() {
        return this.activeDataset && this.activeState && this.activeDataset.isWholeGenome(this.activeState.chr1)
    }

    getColorScale() {

        if (!this.contactMatrixView) return undefined

        switch (this.getDisplayMode()) {
            case 'AOB':
            case 'BOA':
                return this.contactMatrixView.ratioColorScale
            case 'AMB':
                return this.contactMatrixView.diffColorScale
            default:
                return this.contactMatrixView.colorScale
        }
    }

    setColorScaleThreshold(threshold) {
        this.contactMatrixView.setColorScaleThreshold(threshold)
    }

    updateCrosshairs({ x, y, xNormalized, yNormalized }) {

        const xGuide = y < 0 ? { left: '0px' } : { top: `${y}px`, left: '0px' };
        this.contactMatrixView.xGuideElement.style.left = xGuide.left;
        if (xGuide.top !== undefined) this.contactMatrixView.xGuideElement.style.top = xGuide.top;

        this.layoutController.xTrackGuideElement.style.left = xGuide.left;
        if (xGuide.top !== undefined) this.layoutController.xTrackGuideElement.style.top = xGuide.top;

        const yGuide = x < 0 ? { top: '0px' } : { top: '0px', left: `${x}px` };
        this.contactMatrixView.yGuideElement.style.top = yGuide.top;
        if (yGuide.left !== undefined) this.contactMatrixView.yGuideElement.style.left = yGuide.left;

        this.layoutController.yTrackGuideElement.style.top = yGuide.top;
        if (yGuide.left !== undefined) this.layoutController.yTrackGuideElement.style.left = yGuide.left;

        if (this.customCrosshairsHandler) {
            const { x: stateX, y: stateY, pixelSize } = this.state;
            const resolution = this.resolution();

            const xBP = (stateX + (x / pixelSize)) * resolution;
            const yBP = (stateY + (y / pixelSize)) * resolution;

            const { startBP: startXBP, endBP: endXBP } = this.genomicState('x');
            const { startBP: startYBP, endBP: endYBP } = this.genomicState('y');

            this.customCrosshairsHandler({
                xBP,
                yBP,
                startXBP,
                startYBP,
                endXBP,
                endYBP,
                interpolantX: xNormalized,
                interpolantY: yNormalized
            });
        }
    }

    setCustomCrosshairsHandler(crosshairsHandler) {
        this.customCrosshairsHandler = crosshairsHandler
    }

    hideCrosshairs() {
        this.contactMatrixView.xGuideElement.style.display = 'none';
        this.layoutController.xTrackGuideElement.style.display = 'none';

        this.contactMatrixView.yGuideElement.style.display = 'none';
        this.layoutController.yTrackGuideElement.style.display = 'none';
    }

    /**
     * Notification methods delegate to NotificationCoordinator.
     * These methods are kept for backward compatibility and to maintain the public API.
     */

    notifyMapLoaded(dataset, state, datasetType) {
        this.notifications.notifyMapLoaded(dataset, state, datasetType);
    }

    notifyControlMapLoaded(controlDataset) {
        this.notifications.notifyControlMapLoaded(controlDataset);
    }

    notifyLocusChange(eventData) {
        this.notifications.notifyLocusChange(eventData);
    }

    notifyNormalizationChange(normalization) {
        this.notifications.notifyNormalizationChange(normalization);
    }

    notifyDisplayMode(mode) {
        this.notifications.notifyDisplayMode(mode);
    }

    notifyColorScale(colorScale) {
        this.notifications.notifyColorScale(colorScale);
    }

    notifyTrackLoad2D(tracks2D) {
        this.notifications.notifyTrackLoad2D(tracks2D);
    }

    notifyTrackState2D(trackData) {
        this.notifications.notifyTrackState2D(trackData);
    }

    notifyNormVectorIndexLoad(dataset) {
        this.notifications.notifyNormVectorIndexLoad(dataset);
    }

    notifyNormalizationFileLoad(status) {
        this.notifications.notifyNormalizationFileLoad(status);
    }

    notifyNormalizationExternalChange(normalization) {
        this.notifications.notifyNormalizationExternalChange(normalization);
    }

    notifyColorChange() {
        this.notifications.notifyColorChange();
    }

    notifyUpdateContactMapMousePosition(xy) {
        this.notifications.notifyUpdateContactMapMousePosition(xy);
    }

    showCrosshairs() {
        this.contactMatrixView.xGuideElement.style.display = 'block';
        this.layoutController.xTrackGuideElement.style.display = 'block';

        this.contactMatrixView.yGuideElement.style.display = 'block';
        this.layoutController.yTrackGuideElement.style.display = 'block';
    }

    genomicState(axis) {

        let width = this.contactMatrixView.getViewDimensions().width
        let resolution = this.dataset.bpResolutions[this.state.zoom]
        const bpp =
            (this.dataset.chromosomes[this.state.chr1].name.toLowerCase() === "all") ?
                this.genome.getGenomeLength() / width :
                resolution / this.state.pixelSize

        const gs =
            {
                bpp
            }

        if (axis === "x") {
            gs.chromosome = this.dataset.chromosomes[this.state.chr1]
            gs.startBP = this.state.x * resolution
            gs.endBP = gs.startBP + bpp * width
        } else {
            gs.chromosome = this.dataset.chromosomes[this.state.chr2]
            gs.startBP = this.state.y * resolution
            gs.endBP = gs.startBP + bpp * this.contactMatrixView.getViewDimensions().height
        }
        return gs
    }

    /**
     * Load a list of 1D genome tracks (wig, etc).
     *
     * NOTE: public API function
     *
     * @param configs
     */
    async loadTracks(configs) {
        return this.dataLoader.loadTracks(configs);
    }

    async loadNormalizationFile(url) {
        return this.dataLoader.loadNormalizationFile(url);
    }

    /**
     * Render the XY pair of tracks.
     * Delegates to RenderCoordinator.
     *
     * @param xy
     */
    async renderTrackXY(xy) {
        return this.renderCoordinator.renderTrackXY(xy);
    }

    /**
     * Set the active dataset and state
     * @param {Dataset} dataset - The dataset to activate
     * @param {State} state - The state to use with this dataset
     */
    /**
     * State management methods delegate to StateManager.
     * These methods are kept for backward compatibility and to maintain the public API.
     */

    setActiveDataset(dataset, state) {
        this.stateManager.setActiveDataset(dataset, state);
    }

    /**
     * Backward compatibility: getter for dataset property
     * Returns activeDataset (the primary dataset, not control)
     */
    get dataset() {
        return this.stateManager.getActiveDataset();
    }

    /**
     * Backward compatibility: setter for dataset property
     */
    set dataset(value) {
        this.stateManager.setActiveDataset(value, undefined);
    }

    /**
     * Backward compatibility: getter for state property
     */
    get state() {
        return this.stateManager.getActiveState();
    }

    /**
     * Backward compatibility: setter for state property
     * Note: Direct assignment bypasses validation. Use setState() for proper state management.
     */
    set state(value) {
        // Direct assignment - store directly without validation
        // This is for backward compatibility only
        if (value) {
            this.stateManager.activeState = value;
        } else {
            this.stateManager.activeState = undefined;
        }
    }

    /**
     * Getter for activeDataset (backward compatibility)
     */
    get activeDataset() {
        return this.stateManager.getActiveDataset();
    }

    /**
     * Setter for activeDataset (backward compatibility)
     */
    set activeDataset(value) {
        this.stateManager.setActiveDataset(value, undefined);
    }

    /**
     * Getter for activeState (backward compatibility)
     */
    get activeState() {
        return this.stateManager.getActiveState();
    }

    /**
     * Setter for activeState (backward compatibility)
     * Note: Direct assignment bypasses validation. Use setState() for proper state management.
     */
    set activeState(value) {
        // Direct assignment - store directly without validation
        // This is for backward compatibility only
        if (value) {
            this.stateManager.activeState = value;
        } else {
            this.stateManager.activeState = undefined;
        }
    }

    /**
     * Getter for controlDataset (backward compatibility)
     */
    get controlDataset() {
        return this.stateManager.getControlDataset();
    }

    /**
     * Setter for controlDataset (backward compatibility)
     */
    set controlDataset(value) {
        this.stateManager.setControlDataset(value);
    }

    reset() {
        this.layoutController.removeAllTrackXYPairs()
        this.contactMatrixView.clearImageCaches()
        this.tracks2D = []
        this.tracks = []
        this.contactMapLabel.textContent = "";
        this.contactMapLabel.title = "";
        this.controlMapLabel.textContent = "";
        this.controlMapLabel.title = "";
        this.stateManager.clearState();
        this.unsyncSelf()
    }

    clearSession() {
        // Clear current datasets.
        this.stateManager.clearState();
        this.setDisplayMode('A')
        this.unsyncSelf()
    }

    /**
     * Remove reference to self from all synchedBrowsers lists.
     */
    unsyncSelf() {
        const allBrowsers = getAllBrowsers()
        for (let b of allBrowsers) {
            b.unsync(this)
        }
    }

    /**
     * Remove the reference browser from this collection of synched browsers
     * @param browser
     */
    unsync(browser) {
        const list = [...this.synchedBrowsers]
        this.synchedBrowsers = new Set(list.filter(b => b !== browser))
    }

    /**
     * Data loading methods delegate to DataLoader.
     * These methods are kept for backward compatibility and to maintain the public API.
     */

    /**
     * Load a .hic file
     *
     * NOTE: public API function
     *
     * @return a promise for a dataset
     * @param config
     * @param noUpdates
     */
    async loadHicFile(config, noUpdates) {
        return this.dataLoader.loadHicFile(config, noUpdates);
    }

    /**
     * Load a live map dataset
     *
     * NOTE: public API function
     *
     * @param {Object} config - Configuration object
     * @param {boolean} noUpdates - If true, don't trigger UI updates
     * @returns {Promise<LiveMapDataset>}
     */
    async loadLiveMapDataset(config, noUpdates) {
        return this.dataLoader.loadLiveMapDataset(config, noUpdates);
    }

    /**
     * Load a .hic file for a control map
     *
     * NOTE: public API function
     *
     * @return a promise for a dataset
     * @param config
     */
    async loadHicControlFile(config, noUpdates) {
        return this.dataLoader.loadHicControlFile(config, noUpdates);
    }

    async parseGotoInput(input) {
        return this.interactions.parseGotoInput(input);
    }

    parseLocusString(locus) {
        return this.interactions.parseLocusString(locus);
    }

    async lookupFeatureOrGene(name) {

        const trimmedName = name.trim();
        const upperName = trimmedName.toUpperCase();

        if (this.genome.featureDB.has(upperName)) {
            Globals.selectedGene = trimmedName
            this.state.selectedGene = Globals.selectedGene
            const {chr, start, end } = this.genome.featureDB.get(upperName)

            // Internally, loci are 0-based. parseLocusString() assumes and user-provided locus which is 1-based
            return this.parseLocusString(`${chr}:${start + 1}-${end}`)
        }

        const geneResult = await geneSearch(this.genome.id, trimmedName);
        if (geneResult) {
            Globals.selectedGene = trimmedName;
            this.state.selectedGene = Globals.selectedGene;
            return this.parseLocusString(geneResult)
        }

        return undefined;  // No match found
    }

    /**
     * Interaction methods delegate to InteractionHandler.
     * These methods are kept for backward compatibility and to maintain the public API.
     */

    async goto(chr1, bpX, bpXMax, chr2, bpY, bpYMax) {
        return this.interactions.goto(chr1, bpX, bpXMax, chr2, bpY, bpYMax);
    }

    /**
     * Find the closest matching zoom index (index into the dataset resolutions array) for the target resolution.
     *
     * resolutionAraay can be either
     *   (1) an array of bin sizes
     *   (2) an array of objects with index and bin size
     * @param targetResolution
     * @param resolutionArray
     * @returns {number}
     */
    findMatchingZoomIndex(targetResolution, resolutionArray) {
        return this.interactions.findMatchingZoomIndex(targetResolution, resolutionArray);
    }

    /**
     * @param scaleFactor Values range from greater then 1 to decimal values less then one
     *                    Value > 1 are magnification (zoom in)
     *                    Decimal values (.9, .75, .25, etc.) are minification (zoom out)
     * @param anchorPx -- anchor position in pixels (should not move after transformation)
     * @param anchorPy
     */
    async pinchZoom(anchorPx, anchorPy, scaleFactor) {
        return this.interactions.pinchZoom(anchorPx, anchorPy, scaleFactor);
    }

    // Zoom in response to a double-click
    /**
     * Zoom and center on bins at given screen coordinates.  Supports double-click zoom, pinch zoom.
     * @param direction
     * @param centerPX  screen coordinate to center on
     * @param centerPY  screen coordinate to center on
     * @returns {Promise<void>}
     */
    async zoomAndCenter(direction, centerPX, centerPY) {
        return this.interactions.zoomAndCenter(direction, centerPX, centerPY);
    }

    /**
     * Set the current zoom state and opctionally center over supplied coordinates.
     * @param zoom - index to the datasets resolution array (dataset.bpResolutions)
     * @returns {Promise<void>}
     */
    async setZoom(zoom) {
        return this.interactions.setZoom(zoom);
    }

    async setChromosomes(xLocus, yLocus) {
        return this.interactions.setChromosomes(xLocus, yLocus);
    }

    /**
     * Called on loading tracks
     * @returns {Promise<void>}
     */
    async updateLayout() {

        this.state.clampXY(this.dataset, this.contactMatrixView.getViewDimensions())

        for (const trackXYPair of this.trackPairs) {

            trackXYPair.x.viewportElement.style.order = `${this.trackPairs.indexOf(trackXYPair)}`
            trackXYPair.y.viewportElement.style.order = `${this.trackPairs.indexOf(trackXYPair)}`

            trackXYPair.x.syncCanvas()
            trackXYPair.y.syncCanvas()

        }

        this.layoutController.xAxisRuler.update()
        this.layoutController.yAxisRuler.update()

        setTrackReorderArrowColors(this.trackPairs)

        await this.update()

    }

    /**
     * Set the matrix state.  Used to restore state from a bookmark
     * @param state  browser state
     */
    async setState(state) {
        const { chrChanged, resolutionChanged } = await this.stateManager.setState(state);

        const eventData = {
            state: this.state,
            resolutionChanged,
            chrChanged
        };
        await this.update();
        this.notifyLocusChange(eventData);
    }

    /**
     * Return a modified state object used for synching.  Other datasets might have different chromosome ordering
     * and resolution arrays
     */
    getSyncState() {
        return this.stateManager.getSyncState();
    }

    /**
     * Return true if this browser can be synced to the given state
     * @param syncState
     */
    canBeSynched(syncState) {
        return this.stateManager.canBeSynched(syncState);
    }

    async syncState(targetState) {
        if (!targetState || false === this.synchable) {
            return;
        }

        if (!this.dataset) {
            return;
        }

        const { zoomChanged, chrChanged } = await this.stateManager.syncState(targetState);

        // For sync, we don't want to propagate back to other browsers (would cause infinite loop)
        // So we update without syncing
        await this.update(false);
        
        // Notify UI components (scrollbars, locus display, etc.) of the state change
        // This ensures synchronized browsers update their UI elements properly
        const eventData = {
            state: this.state,
            resolutionChanged: zoomChanged,
            chrChanged
        };
        this.notifyLocusChange(eventData);
    }

    setNormalization(normalization) {
        this.stateManager.setNormalization(normalization);
        this.notifyNormalizationChange(this.stateManager.getNormalization());
    }

    async shiftPixels(dx, dy) {
        return this.interactions.shiftPixels(dx, dy);
    }

    /**
     * Pure rendering method - repaints all visual components.
     * Delegates to RenderCoordinator.
     */
    async repaint() {
        return this.renderCoordinator.repaint();
    }

    /**
     * Synchronize this browser's state to other synched browsers.
     * Called separately from rendering to keep concerns separated.
     */
    syncToOtherBrowsers() {
        if (this.synchedBrowsers.size === 0) {
            return; // Nothing to sync
        }

        const syncState = this.getSyncState()
        for (const browser of [...this.synchedBrowsers]) {
            browser.syncState(syncState)
        }
    }

    /**
     * Public API for updating/repainting the browser.
     * Delegates to RenderCoordinator.
     *
     * @param shouldSync - Whether to synchronize state to other browsers (default: true)
     *                     Set to false when called from syncState() to avoid infinite loops
     */
    async update(shouldSync = true) {
        return this.renderCoordinator.update(shouldSync);
    }

    repaintMatrix() {
        this.contactMatrixView.imageTileCache = {}
        this.contactMatrixView.initialImage = undefined
        this.contactMatrixView.update()
    }

    resolution() {
        return this.dataset.bpResolutions[this.state.zoom]
    };

    toJSON() {

        if (!(this.dataset && this.dataset.url)) return "{}"   // URL is required

        const jsonOBJ = {}

        jsonOBJ.backgroundColor = this.contactMatrixView.stringifyBackgroundColor()
        jsonOBJ.url = this.dataset.url
        if (this.dataset.name) {
            jsonOBJ.name = this.dataset.name
        }

        jsonOBJ.state = this.state.toJSON()

        jsonOBJ.colorScale = this.contactMatrixView.getColorScale().stringify()
        if (Globals.selectedGene) {
            jsonOBJ.selectedGene = Globals.selectedGene
        }
        let nviString = this.dataset.hicFile.config.nvi
        if (nviString) {
            jsonOBJ.nvi = nviString
        }
        if (this.controlDataset) {
            jsonOBJ.controlUrl = this.controlUrl
            if (this.controlDataset.name) {
                jsonOBJ.controlName = this.controlDataset.name
            }
            const displayMode = this.getDisplayMode()
            if (displayMode) {
                jsonOBJ.displayMode = this.getDisplayMode()
            }
            nviString = this.controlDataset.hicFile.config.nvi
            if (nviString) {
                jsonOBJ.controlNvi = nviString
            }
            const controlMapWidget = this.ui.getComponent('controlMap');
            if (controlMapWidget.getDisplayModeCycle() !== undefined) {
                jsonOBJ.cycle = true
            }
        }

        if (this.trackPairs.length > 0 || this.tracks2D.length > 0) {
            let tracks = []
            jsonOBJ.tracks = tracks
            for (let trackRenderer of this.trackPairs) {

                const track = trackRenderer.x.track
                const config = track.config

                if (typeof config.url === "string") {

                    const t = {url: config.url}

                    if (config.type) {
                        t.type = config.type
                    }
                    if (config.format) {
                        t.format = config.format
                    }
                    if (track.name) {
                        t.name = track.name
                    }
                    if (track.dataRange) {
                        t.min = track.dataRange.min
                        t.max = track.dataRange.max
                    }
                    if (track.color) {
                        t.color = track.color
                    }
                    tracks.push(t)
                } else if ('sequence' === config.type) {
                    tracks.push({type: 'sequence', format: 'sequence'})
                }

            }
            for (const track2D of this.tracks2D) {
                if (typeof track2D.config.url === "string") {
                    tracks.push(track2D.toJSON())
                }
            }
        }

        return jsonOBJ
    }

    async minZoom(chr1, chr2) {

        if (!this.activeDataset) {
            throw new Error("Dataset not available for minZoom calculation");
        }

        const chromosome1 = this.activeDataset.chromosomes[chr1]
        const chromosome2 = this.activeDataset.chromosomes[chr2]

        if (!chromosome1 || !chromosome2) {
            throw new Error(`Invalid chromosome indices: ${chr1}, ${chr2}`);
        }

        const { width, height } = this.contactMatrixView.getViewDimensions()
        const binSize = Math.max(chromosome1.size / width, chromosome2.size / height)

        const matrix = await this.activeDataset.getMatrix(chr1, chr2)
        if (!matrix) {
            throw new Error(`Data not avaiable for chromosomes ${chromosome1.name} - ${chromosome2.name}`)
        }
        return matrix.findZoomForResolution(binSize)
    }

    async minPixelSize(chr1, chr2, zoomIndex) {

        if (!this.activeDataset) {
            // If dataset not yet set, return default minimum
            return DEFAULT_PIXEL_SIZE;
        }

        // bp
        if (!this.activeDataset.chromosomes || !this.activeDataset.chromosomes[chr1] || !this.activeDataset.chromosomes[chr2]) {
            console.warn(`Invalid chromosome indices or chromosomes array not initialized: ${chr1}, ${chr2}`);
            return DEFAULT_PIXEL_SIZE;
        }

        const chr1Length = this.activeDataset.chromosomes[chr1].size
        const chr2Length = this.activeDataset.chromosomes[chr2].size

        const matrix = await this.activeDataset.getMatrix(chr1, chr2)
        if (!matrix) {
            console.warn(`Matrix not available for chromosomes ${chr1}, ${chr2}`);
            return DEFAULT_PIXEL_SIZE;
        }

        const zoomData = matrix.getZoomDataByIndex(zoomIndex, "BP");
        if (!zoomData || !zoomData.zoom) {
            // Fallback: try to get zoom data for index 0, or use dataset resolution
            const fallbackZoomData = matrix.getZoomDataByIndex(0, "BP");
            if (!fallbackZoomData || !fallbackZoomData.zoom) {
                // Last resort: use dataset resolution directly
                const binSize = this.activeDataset.bpResolutions[zoomIndex] || this.activeDataset.bpResolutions[0] || 1000;
                const nBins1 = chr1Length / binSize;
                const nBins2 = chr2Length / binSize;
                const { width, height } = this.contactMatrixView.getViewDimensions();
                return Math.min(width / nBins1, height / nBins2);
            }
            const zoom = fallbackZoomData.zoom;
            const nBins1 = chr1Length / zoom.binSize;
            const nBins2 = chr2Length / zoom.binSize;
            const { width, height } = this.contactMatrixView.getViewDimensions();
            return Math.min(width / nBins1, height / nBins2);
        }

        const { zoom } = zoomData;

        // bin = bp * bin/bp = bin
        const nBins1 = chr1Length / zoom.binSize
        const nBins2 = chr2Length / zoom.binSize

        const { width, height } = this.contactMatrixView.getViewDimensions()

        // pixel/bin
        return Math.min(width / nBins1, height / nBins2)

    }
}

export { MAX_PIXEL_SIZE, DEFAULT_PIXEL_SIZE }
export default HICBrowser

