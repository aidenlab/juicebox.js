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

import igv from '../node_modules/igv/dist/igv.esm.js'
import {Alert, InputDialog, DOMUtils} from '../node_modules/igv-ui/dist/igv-ui.js'
import {FileUtils} from '../node_modules/igv-utils/src/index.js'
import * as hicUtils from './hicUtils.js'
import {Globals} from "./globals.js"
import EventBus from "./eventBus.js"
import Track2D from './track2D.js'
import LayoutController, {getLayoutDimensions, setViewportSize} from './layoutController.js'
import HICEvent from './hicEvent.js'
import Dataset from './hicDataset.js'
import Genome from './genome.js'
import State from './hicState.js'
import { geneSearch } from './geneSearch.js'
import {defaultSize, getAllBrowsers, syncBrowsers} from "./createBrowser.js"
import {isFile} from "./fileUtils.js"
import {setTrackReorderArrowColors} from "./trackPair.js"
import nvi from './nvi.js'
import {extractName, presentError} from "./utils.js"
import BrowserUIManager from "./browserUIManager.js"
import SpinnerManager from "./services/spinnerManager.js"
import CrosshairManager from "./services/crosshairManager.js"
import MenuManager from "./services/menuManager.js"
import CoordinateTransformer from "./services/coordinateTransformer.js"
import LocusParser from "./services/locusParser.js"
import ZoomCalculator from "./services/zoomCalculator.js"
import NavigationService from "./services/navigationService.js"
import StateManager from "./services/stateManager.js"
import BrowserLifecycleManager from "./services/browserLifecycleManager.js"

const DEFAULT_PIXEL_SIZE = 1
const MAX_PIXEL_SIZE = 128
const DEFAULT_ANNOTATION_COLOR = "rgb(22, 129, 198)"

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

        this.isMobile = hicUtils.isMobile();

        this.rootElement = document.createElement('div');
        this.rootElement.className = 'hic-root unselect';
        appContainer.appendChild(this.rootElement);


        if (config.width && config.height) {
            setViewportSize(config.width, config.height)
        }

        this.layoutController = new LayoutController(this, this.rootElement);

        this.inputDialog = new InputDialog(appContainer, this);

        // Initialize service managers (menu manager first as it's used early)
        this.menuManager = new MenuManager(this.rootElement, this);
        this.menuElement = this.menuManager.createMenu(this.rootElement);
        this.menuElement.style.display = 'none';

        // Initialize UI components through BrowserUIManager
        this.ui = new BrowserUIManager(this);

        // Get the contact matrix view from UI manager
        this.contactMatrixView = this.ui.getComponent('contactMatrix');

        // prevent user interaction during lengthy data loads
        this.userInteractionShield = document.createElement('div');
        this.userInteractionShield.className = 'hic-root-prevent-interaction';
        this.rootElement.appendChild(this.userInteractionShield);
        this.userInteractionShield.style.display = 'none';

        // Initialize remaining service managers
        this.spinnerManager = new SpinnerManager(this.contactMatrixView, this.userInteractionShield);
        this.crosshairManager = new CrosshairManager(this.contactMatrixView, this.layoutController, this);
        this.navigationService = new NavigationService(this);
        this.stateManager = new StateManager(this);
        this.lifecycleManager = new BrowserLifecycleManager(this);

        this.hideCrosshairs();
    }

    async init(config) {
        this.pending = new Map();
        this.eventBus.hold();
        this.contactMatrixView.disableUpdates = true;

        try {
            this.contactMatrixView.startSpinner();
            this.userInteractionShield.style.display = 'block';

            await this.loadHicFile(config, true);

            if (config.controlUrl) {
                await this.loadHicControlFile({
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
                this.eventBus.post({ type: "DisplayMode", data: config.displayMode });
            }

            if (config.colorScale) {
                if (config.normalization) {
                    this.state.normalization = config.normalization;
                }
                this.contactMatrixView.setColorScale(config.colorScale);
                this.eventBus.post({ type: "ColorScale", data: this.contactMatrixView.getColorScale() });
            }

            const promises = [];

            if (config.tracks) {
                promises.push(this.loadTracks(config.tracks));
            }

            if (config.normVectorFiles) {
                config.normVectorFiles.forEach(nv => {
                    promises.push(this.loadNormalizationFile(nv));
                });
            }

            await Promise.all(promises);

            if (config.normalization) {
                const normalizations = await this.getNormalizationOptions();
                const validNormalizations = new Set(normalizations);
                this.state.normalization = validNormalizations.has(config.normalization) ? config.normalization : 'NONE';
            }

            const tmp = this.contactMatrixView.colorScaleThresholdCache;
            this.eventBus.release();
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
        return this.menuManager.createMenu(rootElement);
    }

    toggleTrackLabelAndGutterState() {
        this.showTrackLabelAndGutter = !this.showTrackLabelAndGutter
    }

    toggleMenu() {
        this.menuManager.toggleMenu();
    }

    showMenu() {
        this.menuManager.showMenu();
    }

    hideMenu() {
        this.menuManager.hideMenu();
    }

    startSpinner() {
        this.spinnerManager.startSpinner();
    }

    stopSpinner() {
        this.spinnerManager.stopSpinner();
    }

    async setDisplayMode(mode) {
        await this.contactMatrixView.setDisplayMode(mode)
        this.eventBus.post(HICEvent("DisplayMode", mode))
    }

    getDisplayMode() {
        return this.contactMatrixView ? this.contactMatrixView.displayMode : undefined
    }

    async getNormalizationOptions() {

        if (!this.dataset) return []

        const baseOptions = await this.dataset.getNormalizationOptions()
        if (this.controlDataset) {
            let controlOptions = await this.controlDataset.getNormalizationOptions()
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
        if (!this.dataset) return []

        const baseResolutions = this.dataset.bpResolutions.map(function (resolution, index) {
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
        return this.dataset && this.state && this.dataset.isWholeGenome(this.state.chr1)
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
        this.crosshairManager.updateCrosshairs({ x, y, xNormalized, yNormalized });
    }

    setCustomCrosshairsHandler(crosshairsHandler) {
        this.crosshairManager.setCustomCrosshairsHandler(crosshairsHandler);
    }

    hideCrosshairs() {
        this.crosshairManager.hideCrosshairs();
    }

    showCrosshairs() {
        this.crosshairManager.showCrosshairs();
    }

    genomicState(axis) {
        return CoordinateTransformer.genomicState(this.dataset, this.state, this.contactMatrixView, this.genome, axis);
    }

    /**
     * Load a list of 1D genome tracks (wig, etc).
     *
     * NOTE: public API function
     *
     * @param configs
     */
    async loadTracks(configs) {
        const errorPrefix = configs.length === 1 ? `Error loading track ${configs[0].name}` : "Error loading tracks";

        try {
            this.contactMatrixView.startSpinner();

            const tracks = [];
            const promises2D = [];

            for (let config of configs) {
                const fileName = isFile(config.url)
                    ? config.url.name
                    : config.filename || await FileUtils.getFilename(config.url);

                const extension = hicUtils.getExtension(fileName);

                if (['fasta', 'fa'].includes(extension)) {
                    config.type = config.format = 'sequence';
                }

                if (!config.format) {
                    config.format = igv.TrackUtils.inferFileFormat(fileName);
                }

                if (config.type === 'annotation') {
                    config.displayMode = 'COLLAPSED';
                    if (config.color === DEFAULT_ANNOTATION_COLOR) {
                        delete config.color;
                    }
                }

                if (config.max === undefined) {
                    config.autoscale = true;
                }

                const { trackHeight } = getLayoutDimensions()
                config.height = trackHeight;

                if (config.format === undefined || ['bedpe', 'interact'].includes(config.format)) {
                    promises2D.push(Track2D.loadTrack2D(config, this.genome));
                } else {
                    const track = await igv.createTrack(config, this);

                    if (typeof track.postInit === 'function') {
                        await track.postInit();
                    }

                    tracks.push(track);
                }
            }

            if (tracks.length > 0) {
                this.layoutController.updateLayoutWithTracks(tracks);

                const gearContainer = document.querySelector('.hic-igv-right-hand-gutter');
                if (this.showTrackLabelAndGutter) {
                    gearContainer.style.display = 'block';
                } else {
                    gearContainer.style.display = 'none';
                }

                await this.updateLayout();
            }

            if (promises2D.length > 0) {
                const tracks2D = await Promise.all(promises2D);
                if (tracks2D && tracks2D.length > 0) {
                    this.tracks2D = this.tracks2D.concat(tracks2D);
                    this.eventBus.post(HICEvent("TrackLoad2D", this.tracks2D));
                }
            }

        } catch (error) {
            presentError(errorPrefix, error);
            console.error(error);

        } finally {
            this.contactMatrixView.stopSpinner();
        }
    }

    async loadNormalizationFile(url) {

        if (!this.dataset) return
        this.eventBus.post(HICEvent("NormalizationFileLoad", "start"))

        const normVectors = await this.dataset.hicFile.readNormalizationVectorFile(url, this.dataset.chromosomes)
        for (let type of normVectors['types']) {
            if (!this.dataset.normalizationTypes) {
                this.dataset.normalizationTypes = []
            }
            if (!this.dataset.normalizationTypes.includes(type)) {
                this.dataset.normalizationTypes.push(type)
            }
            this.eventBus.post(HICEvent("NormVectorIndexLoad", this.dataset))
        }

        return normVectors
    }

    /**
     * Render the XY pair of tracks.
     *
     * @param xy
     */
    async renderTrackXY(xy) {

        try {
            this.startSpinner()
            await xy.updateViews()
        } finally {
            this.stopSpinner()
        }
    }

    reset() {
        this.lifecycleManager.reset();
    }

    clearSession() {
        this.lifecycleManager.clearSession();
    }

    /**
     * Remove reference to self from all synchedBrowsers lists.
     */
    unsyncSelf() {
        this.lifecycleManager.unsyncSelf();
    }

    /**
     * Remove the reference browser from this collection of synched browsers
     * @param browser
     */
    unsync(browser) {
        this.lifecycleManager.unsync(browser);
    }

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

        if (!config.url) {
            console.log("No .hic url specified")
            return undefined
        }

        this.clearSession()

        try {

            this.contactMatrixView.startSpinner()
            if (!noUpdates) {
                this.userInteractionShield.style.display = 'block';
            }

            const name = extractName(config)
            const prefix = this.controlDataset ? "A: " : ""
            this.contactMapLabel.textContent = prefix + name;
            this.contactMapLabel.title = name
            config.name = name

            const hicFileAlert = str => {
                this.eventBus.post(HICEvent('NormalizationExternalChange', 'NONE'))
                Alert.presentAlert(str)
            }

            this.dataset = await Dataset.loadDataset(Object.assign({alert: hicFileAlert}, config))
            this.dataset.name = name

            const previousGenomeId = this.genome ? this.genome.id : undefined
            this.genome = new Genome(this.dataset.genomeId, this.dataset.chromosomes)

            if (this.genome.id !== previousGenomeId) {
                EventBus.globalBus.post(HICEvent("GenomeChange", this.genome.id))
            }

            if (config.locus) {
                this.state = State.default(config)
                await this.parseGotoInput(config.locus)
            } else if (config.state) {

                if (typeof config.state === 'string') {
                    await this.setState( State.parse(config.state) )
                } else if (typeof config.state === 'object') {
                    await this.setState( State.fromJSON(config.state) )
                } else {
                    alert('config.state is of unknown type')
                    console.error('config.state is of unknown type')
                }


            } else if (config.synchState && this.canBeSynched(config.synchState)) {
                await this.syncState(config.synchState)
            } else {
                await this.setState(State.default(config))
            }

            this.eventBus.post(HICEvent("MapLoad", this.dataset))

            // Initiate loading of the norm vector index, but don't block if the "nvi" parameter is not available.
            // Let it load in the background

            // If nvi is not supplied, try lookup table of known values
            if (!config.nvi && typeof config.url === "string") {
                const url = new URL(config.url)
                const key = encodeURIComponent(url.hostname + url.pathname)
                if (nvi.hasOwnProperty(key)) {
                    config.nvi = nvi[key]
                }
            }

            if (config.nvi) {
                await this.dataset.getNormVectorIndex(config)
                this.eventBus.post(HICEvent("NormVectorIndexLoad", this.dataset))
            } else {

                this.dataset.getNormVectorIndex(config)
                    .then(normVectorIndex => {
                        if (!config.isControl) {
                            this.eventBus.post(HICEvent("NormVectorIndexLoad", this.dataset))
                        }
                    })
            }

            syncBrowsers()

            // Find a browser to sync with, if any
            const compatibleBrowsers = getAllBrowsers().filter(b => b !== this && b.dataset && b.dataset.isCompatible(this.dataset))
            if (compatibleBrowsers.length > 0) {
                await this.syncState(compatibleBrowsers[0].getSyncState())
            }

        } catch (error) {
            this.contactMapLabel.textContent = "";
            this.contactMapLabel.title = "";
            config.name = name
            throw error
        } finally {
            this.stopSpinner()
            if (!noUpdates) {
                this.userInteractionShield.style.display = 'none';
            }
        }
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

        try {
            this.userInteractionShield.style.display = 'block';
            this.contactMatrixView.startSpinner()
            this.controlUrl = config.url
            const name = extractName(config)
            config.name = name

            const hicFileAlert = str => {
                this.eventBus.post(HICEvent('NormalizationExternalChange', 'NONE'))
                Alert.presentAlert(str)
            }

            const controlDataset = await Dataset.loadDataset(Object.assign({alert: hicFileAlert}, config))

            controlDataset.name = name

            if (!this.dataset || this.dataset.isCompatible(controlDataset)) {
                this.controlDataset = controlDataset
                if (this.dataset) {
                    this.contactMapLabel.textContent = "A: " + this.dataset.name;
                }
                this.controlMapLabel.textContent = "B: " + controlDataset.name
                this.controlMapLabel.title = controlDataset.name

                //For the control dataset, block until the norm vector index is loaded
                await controlDataset.getNormVectorIndex(config)
                this.eventBus.post(HICEvent("ControlMapLoad", this.controlDataset))

                if (!noUpdates) {
                    this.update()
                }
            } else {
                Alert.presentAlert('"B" map genome (' + controlDataset.genomeId + ') does not match "A" map genome (' + this.genome.id + ')')
            }
        } finally {
            this.userInteractionShield.style.display = 'none';
            this.stopSpinner()
        }
    }

    async parseGotoInput(input) {
        const loci = input.trim().split(' ');

        let xLocus = this.parseLocusString(loci[0]) || await this.lookupFeatureOrGene(loci[0]);

        if (!xLocus) {
            console.error(`No feature found with name ${loci[ 0 ]}`)
            alert(`No feature found with name ${loci[ 0 ]}`)
            return;
        }

        let yLocus = loci[1] ? this.parseLocusString(loci[1]) : { ...xLocus }
        if (!yLocus) {
            yLocus = { ...xLocus }
        }

        if (xLocus.wholeChr && yLocus.wholeChr || 'All' === xLocus.chr && 'All' === yLocus.chr) {
            await this.setChromosomes(xLocus, yLocus)
        } else {
            this.goto(xLocus.chr, xLocus.start, xLocus.end, yLocus.chr, yLocus.start, yLocus.end)
        }
    }

    parseLocusString(locus) {
        return LocusParser.parseLocusString(locus, this.genome);
    }

    async lookupFeatureOrGene(name) {
        return LocusParser.lookupFeatureOrGene(name, this.genome, this.state);
    }

    goto(chr1, bpX, bpXMax, chr2, bpY, bpYMax) {
        this.navigationService.goto(chr1, bpX, bpXMax, chr2, bpY, bpYMax);
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
        return this.navigationService.findMatchingZoomIndex(targetResolution, resolutionArray);
    }

    /**
     * @param scaleFactor Values range from greater then 1 to decimal values less then one
     *                    Value > 1 are magnification (zoom in)
     *                    Decimal values (.9, .75, .25, etc.) are minification (zoom out)
     * @param anchorPx -- anchor position in pixels (should not move after transformation)
     * @param anchorPy
     */
    async pinchZoom(anchorPx, anchorPy, scaleFactor) {
        return this.navigationService.pinchZoom(anchorPx, anchorPy, scaleFactor);
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
        return this.navigationService.zoomAndCenter(direction, centerPX, centerPY);
    }

    /**
     * Set the current zoom state and opctionally center over supplied coordinates.
     * @param zoom - index to the datasets resolution array (dataset.bpResolutions)
     * @returns {Promise<void>}
     */
    async setZoom(zoom) {
        return this.navigationService.setZoom(zoom);
    }

    async setChromosomes(xLocus, yLocus) {

        const { index:chr1Index } = this.genome.getChromosome(xLocus.chr)
        const { index:chr2Index } = this.genome.getChromosome(yLocus.chr)

        this.state.chr1 = Math.min(chr1Index, chr2Index)
        this.state.x = 0

        this.state.chr2 = Math.max(chr1Index, chr2Index)
        this.state.y = 0

        this.state.locus =
            {
                x: { chr: xLocus.chr, start: xLocus.start, end: xLocus.end },
                y: { chr: yLocus.chr, start: yLocus.start, end: yLocus.end }
            };

        if (xLocus.wholeChr && yLocus.wholeChr) {
            this.state.zoom = await this.minZoom(this.state.chr1, this.state.chr2)
            const minPS = await this.minPixelSize(this.state.chr1, this.state.chr2, this.state.zoom)
            this.state.pixelSize = Math.min(100, Math.max(DEFAULT_PIXEL_SIZE, minPS))
        } else {
            // Whole Genome
            this.state.zoom = 0
            const minPS = await this.minPixelSize(this.state.chr1, this.state.chr2, this.state.zoom)
            this.state.pixelSize = Math.max(this.state.pixelSize, minPS)

        }

        await this.update(HICEvent("LocusChange", {state: this.state, resolutionChanged: true, chrChanged: true}))

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
        return this.stateManager.setState(state);
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
        return this.stateManager.syncState(targetState);
    }

    setNormalization(normalization) {

        this.state.normalization = normalization
        this.eventBus.post(HICEvent("NormalizationChange", this.state.normalization))
    }

    shiftPixels(dx, dy) {

        if (undefined === this.dataset) {
            console.warn('dataset is undefined')
            return
        }

        this.state.panShift(dx, dy, this, this.dataset, this.contactMatrixView.getViewDimensions())

        const locusChangeEvent = HICEvent("LocusChange", {
            state: this.state,
            resolutionChanged: false,
            dragging: true,
            chrChanged: false
        })
        locusChangeEvent.dragging = true

        this.update(locusChangeEvent)
        this.eventBus.post(locusChangeEvent)
    }

    /**
     * Update the maps and tracks.  This method can be called from the browser event thread repeatedly, for example
     * while mouse dragging.  If called while an update is in progress queue the event for processing later.  It
     * is only neccessary to queue the most recent recently received event, so a simple instance variable will suffice
     * for the queue.
     *
     * @param event
     */
    async update(event) {

        if (this.updating) {
            const type = event ? event.type : "NONE"
            this.pending.set(type, event)
        } else {
            this.updating = true
            try {

                this.startSpinner()
                if (event !== undefined && "LocusChange" === event.type) {
                    this.layoutController.xAxisRuler.locusChange(event)
                    this.layoutController.yAxisRuler.locusChange(event)
                }

                const promises = []

                for (let xyTrackRenderPair of this.trackPairs) {
                    promises.push(this.renderTrackXY(xyTrackRenderPair))
                }
                promises.push(this.contactMatrixView.update(event))
                await Promise.all(promises)

                if (event && event.propogate) {
                    let syncState1 = this.getSyncState()
                    for (const browser of [...this.synchedBrowsers]) {
                        browser.syncState(syncState1)
                    }
                }

            } finally {
                this.updating = false
                if (this.pending.size > 0) {
                    const events = []
                    for (let [k, v] of this.pending) {
                        events.push(v)
                    }
                    this.pending.clear()
                    for (let e of events) {
                        this.update(e)
                    }
                }
                if (event) {
                    // possibly, unless update was called from an event post (infinite loop)
                    this.eventBus.post(event)
                }
                this.stopSpinner()
            }
        }
    }

    repaintMatrix() {
        this.contactMatrixView.imageTileCache = {}
        this.contactMatrixView.initialImage = undefined
        this.contactMatrixView.update()
    }

    resolution() {
        return CoordinateTransformer.resolution(this.dataset, this.state);
    }

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
        return ZoomCalculator.minZoom(chr1, chr2, this.dataset, this.contactMatrixView);
    }

    async minPixelSize(chr1, chr2, zoomIndex) {
        return ZoomCalculator.minPixelSize(chr1, chr2, zoomIndex, this.dataset, this.contactMatrixView);
    }
}

export { MAX_PIXEL_SIZE, DEFAULT_PIXEL_SIZE }
export default HICBrowser

