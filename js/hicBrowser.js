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
import LiveMapDataset from './liveMapDataset.js'
import Genome from './genome.js'
import State from './hicState.js'
import { geneSearch } from './geneSearch.js'
import {defaultSize, getAllBrowsers, syncBrowsers} from "./createBrowser.js"
import {isFile} from "./fileUtils.js"
import {setTrackReorderArrowColors} from "./trackPair.js"
import nvi from './nvi.js'
import {extractName, presentError} from "./utils.js"
import BrowserUIManager from "./browserUIManager.js"

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

        // Unified dataset/state system
        this.activeDataset = undefined;
        this.activeState = undefined;
        
        // Control dataset (for A/B comparisons)
        this.controlDataset = undefined;

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

        // prevent user interaction during lengthy data loads
        this.userInteractionShield = document.createElement('div');
        this.userInteractionShield.className = 'hic-root-prevent-interaction';
        this.rootElement.appendChild(this.userInteractionShield);
        this.userInteractionShield.style.display = 'none';

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
        this.eventBus.post(HICEvent("DisplayMode", mode))
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

        if (!this.activeDataset) return
        // Normalization files are only supported for Hi-C datasets
        if (!this.activeDataset.hicFile) {
            console.warn("Normalization files are only supported for Hi-C datasets");
            return;
        }
        this.eventBus.post(HICEvent("NormalizationFileLoad", "start"))

        const normVectors = await this.activeDataset.hicFile.readNormalizationVectorFile(url, this.activeDataset.chromosomes)
        for (let type of normVectors['types']) {
            if (!this.activeDataset.normalizationTypes) {
                this.activeDataset.normalizationTypes = []
            }
            if (!this.activeDataset.normalizationTypes.includes(type)) {
                this.activeDataset.normalizationTypes.push(type)
            }
            this.eventBus.post(HICEvent("NormVectorIndexLoad", this.activeDataset))
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

    /**
     * Set the active dataset and state
     * @param {Dataset} dataset - The dataset to activate
     * @param {State} state - The state to use with this dataset
     */
    setActiveDataset(dataset, state) {
        this.activeDataset = dataset;
        if (state) {
            this.activeState = state;
        }
    }

    /**
     * Backward compatibility: getter for dataset property
     * Returns activeDataset (the primary dataset, not control)
     */
    get dataset() {
        return this.activeDataset;
    }

    /**
     * Backward compatibility: setter for dataset property
     */
    set dataset(value) {
        this.activeDataset = value;
    }

    /**
     * Backward compatibility: getter for state property
     */
    get state() {
        return this.activeState;
    }

    /**
     * Backward compatibility: setter for state property
     */
    set state(value) {
        this.activeState = value;
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
        this.activeDataset = undefined;
        this.activeState = undefined;
        this.controlDataset = undefined;
        this.unsyncSelf()
    }

    clearSession() {
        // Clear current datasets.
        this.activeDataset = undefined;
        this.activeState = undefined;
        this.controlDataset = undefined;
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

            const dataset = await Dataset.loadDataset(Object.assign({alert: hicFileAlert}, config))
            dataset.name = name

            const previousGenomeId = this.genome ? this.genome.id : undefined
            this.genome = new Genome(dataset.genomeId, dataset.chromosomes)

            if (this.genome.id !== previousGenomeId) {
                EventBus.globalBus.post(HICEvent("GenomeChange", this.genome.id))
            }

            let state;
            if (config.locus) {
                state = State.default(config)
                this.setActiveDataset(dataset, state);
                await this.parseGotoInput(config.locus)
            } else if (config.state) {

                if (typeof config.state === 'string') {
                    state = State.parse(config.state);
                } else if (typeof config.state === 'object') {
                    state = State.fromJSON(config.state);
                } else {
                    alert('config.state is of unknown type')
                    console.error('config.state is of unknown type')
                    state = State.default(config);
                }
                
                // Set active dataset before setState so configureLocus can access bpResolutions
                this.setActiveDataset(dataset, state);
                await this.setState(state)

            } else if (config.synchState && this.canBeSynched(config.synchState)) {
                await this.syncState(config.synchState)
                state = this.activeState;
                // syncState already sets activeDataset, but ensure it's set with current dataset
                if (this.activeDataset !== dataset) {
                    this.setActiveDataset(dataset, state);
                }
            } else {
                state = State.default(config);
                // Set active dataset before setState so configureLocus can access bpResolutions
                this.setActiveDataset(dataset, state);
                await this.setState(state)
            }

            this.eventBus.post(HICEvent("MapLoad", { dataset: dataset, state: state, datasetType: dataset.datasetType }))

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

            if (config.nvi && dataset.getNormVectorIndex) {
                await dataset.getNormVectorIndex(config)
                this.eventBus.post(HICEvent("NormVectorIndexLoad", dataset))
            } else if (dataset.getNormVectorIndex) {

                dataset.getNormVectorIndex(config)
                    .then(normVectorIndex => {
                        if (!config.isControl) {
                            this.eventBus.post(HICEvent("NormVectorIndexLoad", dataset))
                        }
                    })
            }

            syncBrowsers()

            // Find a browser to sync with, if any
            const compatibleBrowsers = getAllBrowsers().filter(b => b !== this && b.activeDataset && b.activeDataset.isCompatible(this.activeDataset))
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
     * Load a live map dataset
     *
     * NOTE: public API function
     *
     * @param {Object} config - Configuration object with:
     *   - contactRecordList: Array of contact records OR
     *   - contactMatrix: 2D array of contact totals
     *   - chromosomes: Array of chromosome definitions
     *   - genomeId: Genome identifier
     *   - bpResolutions: Array of available resolutions
     *   - name: Dataset name
     *   - binSize: Bin size (if using contactMatrix)
     *   - state: Optional initial state
     * @param {boolean} noUpdates - If true, don't trigger UI updates
     * @returns {Promise<LiveMapDataset>}
     */
    async loadLiveMapDataset(config, noUpdates) {
        this.clearSession();

        try {
            this.contactMatrixView.startSpinner();
            if (!noUpdates) {
                this.userInteractionShield.style.display = 'block';
            }

            const name = config.name || 'Live Map';
            this.contactMapLabel.textContent = name;
            this.contactMapLabel.title = name;

            const dataset = new LiveMapDataset(config);
            await dataset.init();

            const previousGenomeId = this.genome ? this.genome.id : undefined;
            this.genome = new Genome(dataset.genomeId, dataset.chromosomes);

            if (this.genome.id !== previousGenomeId) {
                EventBus.globalBus.post(HICEvent("GenomeChange", this.genome.id));
            }

            let state;
            if (config.state) {
                if (typeof config.state === 'string') {
                    state = State.parse(config.state);
                } else if (typeof config.state === 'object') {
                    state = State.fromJSON(config.state);
                } else {
                    state = State.default(config);
                }
            } else {
                state = State.default(config);
            }

            // Set active dataset BEFORE setState, since setState calls minPixelSize
            // which requires this.dataset to be available
            // Ensure dataset is fully initialized
            if (!dataset.chromosomes || dataset.chromosomes.length === 0) {
                throw new Error("LiveMapDataset chromosomes array is not initialized");
            }
            this.setActiveDataset(dataset, state);
            await this.setState(state);

            this.eventBus.post(HICEvent("MapLoad", { dataset: dataset, state: state, datasetType: dataset.datasetType }));

        } catch (error) {
            this.contactMapLabel.textContent = "";
            this.contactMapLabel.title = "";
            throw error;
        } finally {
            this.stopSpinner();
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

            if (!this.activeDataset || this.activeDataset.isCompatible(controlDataset)) {
                this.controlDataset = controlDataset
                if (this.activeDataset) {
                    this.contactMapLabel.textContent = "A: " + this.activeDataset.name;
                }
                this.controlMapLabel.textContent = "B: " + controlDataset.name
                this.controlMapLabel.title = controlDataset.name

                //For the control dataset, block until the norm vector index is loaded
                if (controlDataset.getNormVectorIndex) {
                    await controlDataset.getNormVectorIndex(config)
                }
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
        const [chrName, range] = locus.trim().toLowerCase().split(':');
        const chromosome = this.genome.getChromosome(chrName);

        if (!chromosome) {
            return undefined;
        }

        const locusObject =
            {
                chr: chromosome.name,
                wholeChr: (undefined === range && 'All' !== chromosome.name)
            };

        if (true === locusObject.wholeChr || 'All' === chromosome.name) {
            // Chromosome name only or All: Set to whole range
            locusObject.start = 0;
            locusObject.end = chromosome.size
        } else {

            const [startStr, endStr] = range.split('-').map(part => part.replace(/,/g, ''));

            // Internally, loci are 0-based.
            locusObject.start = isNaN(startStr) ? undefined : parseInt(startStr, 10) - 1;
            locusObject.end = isNaN(endStr) ? undefined : parseInt(endStr, 10);

        }

        return locusObject;
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

    goto(chr1, bpX, bpXMax, chr2, bpY, bpYMax) {

        const { width, height } = this.contactMatrixView.getViewDimensions()
        const { chrChanged, resolutionChanged } = this.state.updateWithLoci(chr1, bpX, bpXMax, chr2, bpY, bpYMax, this, width, height)

        this.contactMatrixView.clearImageCaches()

        this.update(HICEvent("LocusChange", { state: this.state, resolutionChanged, chrChanged }))

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
        const isObject = resolutionArray.length > 0 && resolutionArray[0].index !== undefined
        for (let z = resolutionArray.length - 1; z > 0; z--) {
            const binSize = isObject ? resolutionArray[z].binSize : resolutionArray[z]
            const index = isObject ? resolutionArray[z].index : z
            if (binSize >= targetResolution) {
                return index
            }
        }
        return 0
    };

    /**
     * @param scaleFactor Values range from greater then 1 to decimal values less then one
     *                    Value > 1 are magnification (zoom in)
     *                    Decimal values (.9, .75, .25, etc.) are minification (zoom out)
     * @param anchorPx -- anchor position in pixels (should not move after transformation)
     * @param anchorPy
     */
    async pinchZoom(anchorPx, anchorPy, scaleFactor) {

        if (this.state.chr1 === 0) {
            await this.zoomAndCenter(1, anchorPx, anchorPy)
        } else {
            try {
                this.startSpinner()

                const bpResolutions = this.getResolutions()
                const currentResolution = bpResolutions[this.state.zoom]

                let newBinSize
                let newZoom
                let newPixelSize
                let resolutionChanged

                if (this.resolutionLocked ||
                    (this.state.zoom === bpResolutions.length - 1 && scaleFactor > 1) ||
                    (this.state.zoom === 0 && scaleFactor < 1)) {
                    // Can't change resolution level, must adjust pixel size
                    newBinSize = currentResolution.binSize
                    newPixelSize = Math.min(MAX_PIXEL_SIZE, this.state.pixelSize * scaleFactor)
                    newZoom = this.state.zoom
                    resolutionChanged = false
                } else {
                    const targetBinSize = (currentResolution.binSize / this.state.pixelSize) / scaleFactor
                    newZoom = this.findMatchingZoomIndex(targetBinSize, bpResolutions)
                    newBinSize = bpResolutions[newZoom].binSize
                    resolutionChanged = newZoom !== this.state.zoom
                    newPixelSize = Math.min(MAX_PIXEL_SIZE, newBinSize / targetBinSize)
                }
                const z = await this.minZoom(this.state.chr1, this.state.chr2)


                if (!this.resolutionLocked && scaleFactor < 1 && newZoom < z) {
                    // Zoom out to whole genome
                    const xLocus = this.parseLocusString('1')
                    const yLocus = { xLocus }
                    await this.setChromosomes(xLocus, yLocus)
                } else {

                    await this.state.panWithZoom(newZoom, newPixelSize, anchorPx, anchorPy, newBinSize, this, this.dataset, this.contactMatrixView.getViewDimensions(), bpResolutions)

                    await this.contactMatrixView.zoomIn(anchorPx, anchorPy, 1/scaleFactor)

                    await this.update(HICEvent("LocusChange", { state: this.state, resolutionChanged, chrChanged: false }))
                }
            } finally {
                this.stopSpinner()
            }
        }

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

        if (undefined === this.dataset) {
            console.warn('Dataset is undefined')
            return
        }

        if (this.dataset.isWholeGenome(this.state.chr1) && direction > 0) {
            // jump from whole genome to chromosome
            const genomeCoordX = centerPX * this.dataset.wholeGenomeResolution / this.state.pixelSize
            const genomeCoordY = centerPY * this.dataset.wholeGenomeResolution / this.state.pixelSize
            const chrX = this.genome.getChromosomeForCoordinate(genomeCoordX)
            const chrY = this.genome.getChromosomeForCoordinate(genomeCoordY)
            const xLocus = { chr: chrX.name, start: 0, end: chrX.size, wholeChr: true }
            const yLocus = { chr: chrY.name, start: 0, end: chrY.size, wholeChr: true }
            await this.setChromosomes(xLocus, yLocus)
        } else {

            const { width, height } = this.contactMatrixView.getViewDimensions()

            const dx = centerPX === undefined ? 0 : centerPX - width / 2
            this.state.x += (dx / this.state.pixelSize)

            const dy = centerPY === undefined ? 0 : centerPY - height / 2
            this.state.y += (dy / this.state.pixelSize)

            const resolutions = this.getResolutions()
            const directionPositive = direction > 0 && this.state.zoom === resolutions[resolutions.length - 1].index
            const directionNegative = direction < 0 && this.state.zoom === resolutions[0].index
            if (this.resolutionLocked || directionPositive || directionNegative) {

                const minPS = await this.minPixelSize(this.state.chr1, this.state.chr2, this.state.zoom)

                const newPixelSize = Math.max(Math.min(MAX_PIXEL_SIZE, this.state.pixelSize * (direction > 0 ? 2 : 0.5)), minPS)

                const shiftRatio = (newPixelSize - this.state.pixelSize) / newPixelSize

                this.state.pixelSize = newPixelSize


                this.state.x += shiftRatio * (width / this.state.pixelSize)
                this.state.y += shiftRatio * (height / this.state.pixelSize)

                this.state.clampXY(this.dataset, this.contactMatrixView.getViewDimensions())

                this.state.configureLocus(this, this.dataset, { width, height })

                this.update(HICEvent("LocusChange", {state: this.state, resolutionChanged: false, chrChanged: false}))

            } else {
                let i
                for (i = 0; i < resolutions.length; i++) {
                    if (this.state.zoom === resolutions[i].index) break
                }
                if (i) {
                    const newZoom = resolutions[i + direction].index
                    this.setZoom(newZoom)
                }
            }
        }
    }

    /**
     * Set the current zoom state and opctionally center over supplied coordinates.
     * @param zoom - index to the datasets resolution array (dataset.bpResolutions)
     * @returns {Promise<void>}
     */
    async setZoom(zoom) {

        const resolutionChanged = await this.state.setWithZoom(zoom, this.contactMatrixView.getViewDimensions(), this, this.dataset)

        await this.contactMatrixView.zoomIn()

        this.update(HICEvent("LocusChange", { state: this.state, resolutionChanged, chrChanged: false }))

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

        const chrChanged = !this.state || this.state.chr1 !== state.chr1 || this.state.chr2 !== state.chr2

        this.state = state.clone()

        // Possibly adjust pixel size
        const minPS = await this.minPixelSize(this.state.chr1, this.state.chr2, this.state.zoom)
        this.state.pixelSize = Math.max(state.pixelSize, minPS)

        // Derive locus if none is present in source state
        if (undefined === state.locus) {
            const viewDimensions = this.contactMatrixView.getViewDimensions();
            this.state.configureLocus(this, this.activeDataset, viewDimensions)
        }

        const hicEvent = new HICEvent("LocusChange", { state: this.state, resolutionChanged: true, chrChanged })
        this.update(hicEvent)
        this.eventBus.post(hicEvent)
    }

    /**
     * Return a modified state object used for synching.  Other datasets might have different chromosome ordering
     * and resolution arrays
     */
    getSyncState() {
        return {
            chr1Name: this.dataset.chromosomes[this.state.chr1].name,
            chr2Name: this.dataset.chromosomes[this.state.chr2].name,
            binSize: this.dataset.bpResolutions[this.state.zoom],
            binX: this.state.x,            // TODO: translate to lower right corner
            binY: this.state.y,
            pixelSize: this.state.pixelSize
        }
    }

    /**
     * Return true if this browser can be synced to the given state
     * @param syncState
     */
    canBeSynched(syncState) {

        if (false === this.synchable) return false   // Explicitly not synchable

        return this.dataset &&
            (this.dataset.getChrIndexFromName(syncState.chr1Name) !== undefined) &&
            (this.dataset.getChrIndexFromName(syncState.chr2Name) !== undefined)

    }

    async syncState(targetState) {

        if (!targetState || false === this.synchable) return

        if (!this.dataset) return

        const { zoomChanged, chrChanged } = this.state.sync(targetState, this, this.genome, this.dataset)

        const payload = { state: this.state, resolutionChanged: zoomChanged, chrChanged }
        this.update(HICEvent("LocusChange", payload, false))

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
        const { zoom } = matrix.getZoomDataByIndex(zoomIndex, "BP")

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

