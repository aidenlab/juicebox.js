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

import igv from './igv/igv.js'
import {Alert} from '../node_modules/igv-ui/dist/igv-ui.js'
import {DOMUtils, FileUtils, TrackUtils} from '../node_modules/igv-utils/src/index.js'
import $ from '../vendor/jquery-3.3.1.slim.js'
import * as hicUtils from './hicUtils.js'
import {Globals} from "./globals.js";
import EventBus from "./eventBus.js";
import Track2D from './track2D.js'
import LayoutController, {getNavbarContainer, getNavbarHeight, trackHeight} from './layoutController.js'
import HICEvent from './hicEvent.js'
import Dataset from './hicDataset.js'
import Genome from './genome.js'
import State from './hicState.js'
import geneSearch from './geneSearch.js'
import LocusGoto from "./hicLocusGoto.js";
import ResolutionSelector from "./hicResolutionSelector.js";
import ColorScaleWidget from "./hicColorScaleWidget.js";
import ControlMapWidget from "./controlMapWidget.js";
import NormalizationWidget from "./normalizationWidget.js";
import ChromosomeSelectorWidget from "./chromosomeSelectorWidget.js";
import AnnotationWidget from "./annotationWidget.js";
import SweepZoom from "./sweepZoom.js";
import ScrollbarWidget from "./scrollbarWidget.js";
import ContactMatrixView from "./contactMatrixView.js";
import ColorScale, {defaultColorScaleConfig} from "./colorScale.js";
import RatioColorScale, {defaultRatioColorScaleConfig} from "./ratioColorScale.js";
import {getAllBrowsers, syncBrowsers} from "./createBrowser.js";
import {InputDialog} from '../node_modules/igv-ui/dist/igv-ui.js'

const DEFAULT_PIXEL_SIZE = 1
const MAX_PIXEL_SIZE = 12;
const DEFAULT_ANNOTATION_COLOR = "rgb(22, 129, 198)";

class HICBrowser {

    constructor($app_container, config) {

        this.config = config;
        this.figureMode = config.figureMode || config.miniMode;    // Mini mode for backward compatibility
        this.resolutionLocked = false;
        this.eventBus = new EventBus();

        this.showTrackLabelAndGutter = true;

        this.id = `browser_${DOMUtils.guid()}`;
        this.trackPairs = [];
        this.tracks2D = [];
        this.normVectorFiles = [];

        this.synchable = config.synchable !== false;
        this.synchedBrowsers = [];

        this.isMobile = hicUtils.isMobile();

        this.$root = $('<div class="hic-root unselect">');

        if (config.width) {
            this.$root.css("width", String(config.width));
        }
        if (config.height) {
            this.$root.css("height", String(config.height + getNavbarHeight()));
        }

        $app_container.append(this.$root);

        this.layoutController = new LayoutController(this, this.$root);

        // nav bar related objects
        this.locusGoto = new LocusGoto(this, getNavbarContainer(this));
        this.resolutionSelector = new ResolutionSelector(this, getNavbarContainer(this));
        this.resolutionSelector.setResolutionLock(this.resolutionLocked);
        this.colorscaleWidget = new ColorScaleWidget(this, getNavbarContainer(this));
        this.controlMapWidget = new ControlMapWidget(this, getNavbarContainer(this));
        this.normalizationSelector = new NormalizationWidget(this, getNavbarContainer(this));
        this.inputDialog = new InputDialog($app_container.get(0), this);

        // contact map container related objects
        const sweepZoom = new SweepZoom(this, this.layoutController.getContactMatrixViewport());
        const scrollbarWidget = new ScrollbarWidget(this, this.layoutController.getXAxisScrollbarContainer(), this.layoutController.getYAxisScrollbarContainer());

        const colorScale = new ColorScale(defaultColorScaleConfig);

        const ratioColorScale = new RatioColorScale(defaultRatioColorScaleConfig.threshold);
        ratioColorScale.setColorComponents(defaultRatioColorScaleConfig.negative, '-')
        ratioColorScale.setColorComponents(defaultRatioColorScaleConfig.positive, '+')
        const backgroundColor = config.backgroundColor || ContactMatrixView.defaultBackgroundColor
        this.contactMatrixView = new ContactMatrixView(this, this.layoutController.getContactMatrixViewport(), sweepZoom, scrollbarWidget, colorScale, ratioColorScale, backgroundColor);

        this.$menu = this.createMenu(this.$root);
        this.$menu.hide();

        this.chromosomeSelector = new ChromosomeSelectorWidget(this, this.$menu.find('.hic-chromosome-selector-widget-container'));

        const annotation2DWidgetConfig =
            {
                title: '2D Annotations',
                alertMessage: 'No 2D annotations currently loaded for this map'
            };

        this.annotation2DWidget = new AnnotationWidget(this, this.$menu.find(".hic-annotation-presentation-button-container"), annotation2DWidgetConfig, () => this.tracks2D);

        // prevent user interaction during lengthy data loads
        this.$user_interaction_shield = $('<div>', {class: 'hic-root-prevent-interaction'});
        this.$root.append(this.$user_interaction_shield);
        this.$user_interaction_shield.hide();

        this.hideCrosshairs();


        //this.eventBus.subscribe("LocusChange", this);
    }

    async init(config) {

        this.state = config.state ? config.state : State.default()
        this.pending = new Map();
        this.eventBus.hold();
        this.contactMatrixView.disableUpdates = true;

        try {
            this.contactMatrixView.startSpinner();
            this.$user_interaction_shield.show();

            // if (!config.name) config.name = await extractName(config)
            // const prefix = hasControl ? "A: " : "";
            // browser.$contactMaplabel.text(prefix + config.name);
            // browser.$contactMaplabel.attr('title', config.name);

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
                config.displayMode = "A"
            }

            if (config.displayMode) {
                this.contactMatrixView.displayMode = config.displayMode;
                this.eventBus.post({type: "DisplayMode", data: config.displayMode});
            }
            if (config.colorScale) {
                // This must be done after dataset load
                this.contactMatrixView.setColorScale(config.colorScale);
                this.eventBus.post({type: "ColorScale", data: this.contactMatrixView.getColorScale()});
            }
            if(config.locus) {
                await this.parseGotoInput(config.locus)
            }

            var promises = [];
            if (config.tracks) {
                promises.push(this.loadTracks(config.tracks))
            }

            if (config.normVectorFiles) {
                config.normVectorFiles.forEach(function (nv) {
                    promises.push(this.loadNormalizationFile(nv));
                })
            }
            await Promise.all(promises);

            const tmp = this.contactMatrixView.colorScaleThresholdCache;
            this.eventBus.release()
            this.contactMatrixView.colorScaleThresholdCache = tmp

            if (config.cycle) {
                this.controlMapWidget.toggleDisplayModeCycle();
            } else {
                await this.update()
            }

        } finally {
            this.contactMatrixView.stopSpinner();
            this.$user_interaction_shield.hide();
            this.contactMatrixView.disableUpdates = false;
            this.contactMatrixView.update();
        }

    }

    createMenu($root) {

        const html =
            `<div class="hic-menu" style="display: none;">
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

        $root.append($(html));

        const $menu = $root.find(".hic-menu");

        const $fa = $root.find(".fa-times");
        $fa.on('click', () => this.toggleMenu());

        return $menu;

    }

    toggleTrackLabelAndGutterState() {
        this.showTrackLabelAndGutter = !this.showTrackLabelAndGutter;
    }

    toggleMenu() {
        if (this.$menu.is(':visible')) {
            this.hideMenu();
        } else {
            this.showMenu();
        }
    }

    showMenu() {
        this.$menu.show();
    }

    hideMenu() {
        this.$menu.hide();
    };

    startSpinner() {
        this.contactMatrixView.startSpinner();
    }

    stopSpinner() {
        this.contactMatrixView.stopSpinner();
    }

    async setDisplayMode(mode) {
        await this.contactMatrixView.setDisplayMode(mode);
        this.eventBus.post(HICEvent("DisplayMode", mode));
    }

    getDisplayMode() {
        return this.contactMatrixView ? this.contactMatrixView.displayMode : undefined;
    }

    toggleDisplayMode() {
        this.controlMapWidget.toggleDisplayMode();
    }

    async getNormalizationOptions() {

        if (!this.dataset) return [];

        const baseOptions = await this.dataset.getNormalizationOptions();
        if (this.controlDataset) {
            let controlOptions = await this.controlDataset.getNormalizationOptions();
            controlOptions = new Set(controlOptions);
            return baseOptions.filter(base => controlOptions.has(base));
        } else {
            return baseOptions;
        }
    }

    /**
     * Return usable resolutions, that is the union of resolutions between dataset and controlDataset.
     * @returns {{index: *, binSize: *}[]|Array}
     */
    getResolutions() {
        if (!this.dataset) return [];

        const baseResolutions = this.dataset.bpResolutions.map(function (resolution, index) {
            return {index: index, binSize: resolution}
        });
        if (this.controlDataset) {
            let controlResolutions = new Set(this.controlDataset.bpResolutions);
            return baseResolutions.filter(base => controlResolutions.has(base.binSize));
        } else {
            return baseResolutions;
        }
    }

    isWholeGenome() {
        return this.dataset && this.state && this.dataset.isWholeGenome(this.state.chr1)
    }

    getColorScale() {

        if (!this.contactMatrixView) return undefined;

        switch (this.getDisplayMode()) {
            case 'AOB':
            case 'BOA':
                return this.contactMatrixView.ratioColorScale;
            case 'AMB':
                return this.contactMatrixView.diffColorScale;
            default:
                return this.contactMatrixView.colorScale;
        }
    }

    setColorScaleThreshold(threshold) {
        this.contactMatrixView.setColorScaleThreshold(threshold);
    }

    updateCrosshairs({x, y, xNormalized, yNormalized}) {

        const xGuide = y < 0 ? {left: 0} : {top: y, left: 0};
        this.contactMatrixView.$x_guide.css(xGuide);
        this.layoutController.$x_track_guide.css(xGuide);

        const yGuide = x < 0 ? {top: 0} : {top: 0, left: x};
        this.contactMatrixView.$y_guide.css(yGuide);
        this.layoutController.$y_track_guide.css(yGuide);

        if (this.customCrosshairsHandler) {

            const {x: stateX, y: stateY, pixelSize} = this.state;
            const resolution = this.resolution();

            const xBP = (stateX + (x / pixelSize)) * resolution;
            const yBP = (stateY + (y / pixelSize)) * resolution;

            let {startBP: startXBP, endBP: endXBP} = this.genomicState('x');
            let {startBP: startYBP, endBP: endYBP} = this.genomicState('y');

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
        this.customCrosshairsHandler = crosshairsHandler;
    }

    hideCrosshairs() {

        this.contactMatrixView.$x_guide.hide();
        this.layoutController.$x_track_guide.hide();

        this.contactMatrixView.$y_guide.hide();
        this.layoutController.$y_track_guide.hide();

    }

    showCrosshairs() {

        this.contactMatrixView.$x_guide.show();
        this.layoutController.$x_track_guide.show();

        this.contactMatrixView.$y_guide.show();
        this.layoutController.$y_track_guide.show();
    }

    genomicState(axis) {

        let width = this.contactMatrixView.getViewDimensions().width
        let resolution = this.dataset.bpResolutions[this.state.zoom];
        const bpp =
            (this.dataset.chromosomes[this.state.chr1].name.toLowerCase() === "all") ?
                this.genome.getGenomeLength() / width :
                resolution / this.state.pixelSize

        const gs = {
            bpp: bpp
        };

        if (axis === "x") {
            gs.chromosome = this.dataset.chromosomes[this.state.chr1];
            gs.startBP = this.state.x * resolution;
            gs.endBP = gs.startBP + bpp * width;
        } else {
            gs.chromosome = this.dataset.chromosomes[this.state.chr2];
            gs.startBP = this.state.y * resolution;
            gs.endBP = gs.startBP + bpp * this.contactMatrixView.getViewDimensions().height;
        }
        return gs;
    }


    /**
     * Load a list of 1D genome tracks (wig, etc).
     *
     * NOTE: public API function
     *
     * @param configs
     */
    async loadTracks(configs) {

        // If loading a single track remember its name, for error message
        const errorPrefix = 1 === configs.length ? ("Error loading track " + configs[0].name) : "Error loading tracks";

        try {
            this.contactMatrixView.startSpinner();

            const tracks = [];
            const promises2D = [];

            for (let config of /*trackConfigurations*/configs) {

                const fileName = await FileUtils.getFilenameExtended(config.url);

                if(!config.format) {
                    config.format = TrackUtils.inferFileFormat(fileName)
                }

                if ("annotation" === config.type && config.color === DEFAULT_ANNOTATION_COLOR) {
                    delete config.color;
                }

                if (config.max === undefined) {
                    config.autoscale = true;
                }

                // config.height = ("annotation" === config.type) ? annotationTrackHeight : wigTrackHeight;
                config.height = trackHeight;

                if (undefined === config.format || "bedpe" === config.format || "interact" === config.format) {
                    // Assume this is a 2D track
                    promises2D.push(Track2D.loadTrack2D(config, this.genome));
                } else {
                    const track = await igv.createTrack(config, this);
                    tracks.push(track)
                }
            }

            if (tracks.length > 0) {

                this.layoutController.tracksLoaded(tracks);

                const $gear_container = $('.hic-igv-right-hand-gutter');
                if (true === this.showTrackLabelAndGutter) {
                    $gear_container.show();
                } else {
                    $gear_container.hide();
                }

                await this.updateLayout();
            }

            if (promises2D.length > 0) {

                const tracks2D = await Promise.all(promises2D)
                if (tracks2D && tracks2D.length > 0) {
                    this.tracks2D = this.tracks2D.concat(tracks2D);
                    this.eventBus.post(HICEvent("TrackLoad2D", this.tracks2D));
                }

            }

        } catch (error) {
            presentError(errorPrefix, error);
            console.error(error)

        } finally {
            this.contactMatrixView.stopSpinner();
        }
    }

    async loadNormalizationFile(url) {

        if (!this.dataset) return;
        this.eventBus.post(HICEvent("NormalizationFileLoad", "start"));

        const normVectors = await this.dataset.hicFile.readNormalizationVectorFile(url, this.dataset.chromosomes)
        for (let type of normVectors['types']) {
            if (!this.dataset.normalizationTypes) {
                this.dataset.normalizationTypes = [];
            }
            if (!this.dataset.normalizationTypes.includes(type)) {
                this.dataset.normalizationTypes.push(type);
            }
            this.eventBus.post(HICEvent("NormVectorIndexLoad", this.dataset));
        }

        return normVectors;
    }

    /**
     * Render the XY pair of tracks.
     *
     * @param xy
     */
    async renderTrackXY(xy) {

        try {
            this.startSpinner()
            await xy.updateViews();
        } finally {
            this.stopSpinner()
        }
    }

    reset() {
        this.layoutController.removeAllTrackXYPairs();
        this.contactMatrixView.clearImageCaches();
        this.tracks2D = [];
        this.tracks = [];
        this.$contactMaplabel.text("");
        this.$contactMaplabel.attr('title', "");
        this.$controlMaplabel.text("");
        this.$controlMaplabel.attr('title', "");
        this.dataset = undefined;
        this.controlDataset = undefined;
        this.unsyncSelf();
    }

    clearSession() {
        // Clear current datasets.
        this.dataset = undefined;
        this.controlDataset = undefined;
        this.setDisplayMode('A');
        this.unsyncSelf();
    }

    /**
     * Remove reference to self from all synchedBrowsers lists.
     */
    unsyncSelf() {
        const allBrowsers = getAllBrowsers();
        for (let b of allBrowsers) {
            b.unsync(this);
        }
    }

    /**
     * Remove the reference browser from this collection of synched browsers
     * @param browser
     */
    unsync(browser) {
        this.synchedBrowsers = this.synchedBrowsers.filter(b => b != browser);
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
            console.log("No .hic url specified");
            return undefined;
        }

        this.clearSession();

        try {

            this.contactMatrixView.startSpinner();
            if (!noUpdates) {
                this.$user_interaction_shield.show();
            }

            const name = extractName(config)
            const prefix = this.controlDataset ? "A: " : "";
            this.$contactMaplabel.text(prefix + name);
            this.$contactMaplabel.attr('title', name);
            config.name = name;

            this.dataset = await Dataset.loadDataset(config)
            this.dataset.name = name

            const previousGenomeId = this.genome ? this.genome.id : undefined;
            this.genome = new Genome(this.dataset.genomeId, this.dataset.chromosomes);

            // TODO -- this is not going to work with browsers on different assemblies on the same page.
            //igv.browser.genome = this.genome;

            if (this.genome.id !== previousGenomeId) {
                EventBus.globalBus.post(HICEvent("GenomeChange", this.genome.id));
            }
            this.eventBus.post(HICEvent("MapLoad", this.dataset));

            if (config.state) {
                if (!config.state.hasOwnProperty("chr1")) {
                    config.state = State.parse(config.state);
                }
                await this.setState(config.state);
            } else if (config.synchState && this.canBeSynched(config.synchState)) {
                this.syncState(config.synchState);
            } else {
                await this.setState(State.default(this.config));
            }


            // Initiate loading of the norm vector index, but don't block if the "nvi" parameter is not available.
            // Let it load in the background
            const eventBus = this.eventBus

            // If nvi is not supplied, try reading it from remote lambda service
            if (!config.nvi && typeof config.url === "string") {
                const url = new URL(config.url)
                const key = encodeURIComponent(url.hostname + url.pathname)
                const nviResponse = await fetch('https://t5dvc6kn3f.execute-api.us-east-1.amazonaws.com/dev/nvi/' + key)
                if (nviResponse.status === 200) {
                    const nvi = await nviResponse.text()
                    if (nvi) {
                        config.nvi = nvi
                    }
                }
            }

            if (config.nvi) {
                await this.dataset.getNormVectorIndex(config)
                eventBus.post(HICEvent("NormVectorIndexLoad", this.dataset));
            } else {
                const dataset = this.dataset
                dataset.getNormVectorIndex(config)
                    .then(function (normVectorIndex) {
                        if (!config.isControl) {
                            eventBus.post(HICEvent("NormVectorIndexLoad", dataset));
                        }
                    })
            }

            syncBrowsers();

            // Find a browser to sync with, if any
            const compatibleBrowsers = getAllBrowsers().filter(b => b != this &&
                b.dataset && b.dataset.isCompatible(this.dataset));
            if (compatibleBrowsers.length > 0) {
                this.syncState(compatibleBrowsers[0].getSyncState());
            }

        } catch (error) {
            this.$contactMaplabel.text('');
            this.$contactMaplabel.attr('');
            config.name = name;
            throw error;
        } finally {
            this.stopSpinner();
            if (!noUpdates) {
                this.$user_interaction_shield.hide();
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
            this.$user_interaction_shield.show()
            this.contactMatrixView.startSpinner()
            this.controlUrl = config.url
            const name = extractName(config)
            config.name = name

            const controlDataset = await Dataset.loadDataset(config)
            controlDataset.name = name

            if (!this.dataset || this.dataset.isCompatible(controlDataset)) {
                this.controlDataset = controlDataset;
                if (this.dataset) {
                    this.$contactMaplabel.text("A: " + this.dataset.name);
                }
                this.$controlMaplabel.text("B: " + controlDataset.name);
                this.$controlMaplabel.attr('title', controlDataset.name);

                //For the control dataset, block until the norm vector index is loaded
                await controlDataset.getNormVectorIndex(config)
                this.eventBus.post(HICEvent("ControlMapLoad", this.controlDataset));

                if (!noUpdates) {
                    this.update();
                }
            } else {
                Alert.presentAlert('"B" map genome (' + controlDataset.genomeId + ') does not match "A" map genome (' + this.genome.id + ')');
            }
        } finally {
            this.$user_interaction_shield.hide();
            this.stopSpinner();
        }
    }

    async parseGotoInput(string) {

        let xLocus;
        let yLocus;
        const loci = string.split(' ');
        if (loci.length === 1) {
            xLocus = this.parseLocusString(loci[0]);
            yLocus = xLocus;
        } else {
            xLocus = this.parseLocusString(loci[0]);
            yLocus = this.parseLocusString(loci[1]);
            if (yLocus === undefined) yLocus = xLocus;
        }

        if (xLocus === undefined) {
            // Try a gene name search.
            const result = await geneSearch(this.genome.id, loci[0].trim())

            if (result) {
                Globals.selectedGene = loci[0].trim();
                xLocus = this.parseLocusString(result);
                yLocus = xLocus;
                this.state.selectedGene = Globals.selectedGene;
                this.goto(xLocus.chr, xLocus.start, xLocus.end, yLocus.chr, yLocus.start, yLocus.end, 5000);
            } else {
                alert('No feature found with name "' + loci[0] + '"');
            }

        } else {

            if (xLocus.wholeChr && yLocus.wholeChr) {
                await this.setChromosomes(xLocus.chr, yLocus.chr);
            } else {
                this.goto(xLocus.chr, xLocus.start, xLocus.end, yLocus.chr, yLocus.start, yLocus.end);
            }
        }

    };

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
        const isObject = resolutionArray.length > 0 && resolutionArray[0].index !== undefined;
        for (let z = resolutionArray.length - 1; z > 0; z--) {
            const binSize = isObject ? resolutionArray[z].binSize : resolutionArray[z];
            const index = isObject ? resolutionArray[z].index : z;
            if (binSize >= targetResolution) {
                return index;
            }
        }
        return 0;
    };

    parseLocusString(locus) {

        const locusObject = {};
        const parts = locus.trim().split(':');
        const chromosome = this.genome.getChromosome(parts[0].toLowerCase());

        if (!chromosome) {
            return undefined;
        } else {
            locusObject.chr = chromosome.index;
        }

        if (parts.length === 1) {
            // Chromosome name only
            locusObject.start = 0;
            locusObject.end = this.dataset.chromosomes[locusObject.chr].size;
            locusObject.wholeChr = true;
        } else {
            const extent = parts[1].split("-");
            let numeric = extent[0].replace(/\,/g, '');
            locusObject.start = isNaN(numeric) ? undefined : parseInt(numeric, 10) - 1;
            if (extent.length == 2) {
                numeric = extent[1].replace(/\,/g, '');
                locusObject.end = isNaN(numeric) ? undefined : parseInt(numeric, 10);
            }
        }
        return locusObject;
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
            await this.zoomAndCenter(1, anchorPx, anchorPy);
        } else {
            try {
                this.startSpinner()

                const bpResolutions = this.getResolutions();
                const currentResolution = bpResolutions[this.state.zoom];

                let newBinSize
                let newZoom
                let newPixelSize
                let zoomChanged

                if (this.resolutionLocked ||
                    (this.state.zoom === bpResolutions.length - 1 && scaleFactor > 1) ||
                    (this.state.zoom === 0 && scaleFactor < 1)) {
                    // Can't change resolution level, must adjust pixel size
                    newBinSize = currentResolution.binSize;
                    newPixelSize = Math.min(MAX_PIXEL_SIZE, this.state.pixelSize * scaleFactor);
                    newZoom = this.state.zoom;
                    zoomChanged = false;
                } else {
                    const targetBinSize = (currentResolution.binSize / this.state.pixelSize) / scaleFactor;
                    newZoom = this.findMatchingZoomIndex(targetBinSize, bpResolutions);
                    newBinSize = bpResolutions[newZoom].binSize;
                    zoomChanged = newZoom !== this.state.zoom;
                    newPixelSize = Math.min(MAX_PIXEL_SIZE, newBinSize / targetBinSize);
                }
                const z = await this.minZoom(this.state.chr1, this.state.chr2)


                if (!this.resolutionLocked && scaleFactor < 1 && newZoom < z) {
                    // Zoom out to whole genome
                    this.setChromosomes(0, 0);
                } else {

                    const minPS = await this.minPixelSize(this.state.chr1, this.state.chr2, newZoom)

                    const state = this.state;

                    newPixelSize = Math.max(newPixelSize, minPS);

                    // Genomic anchor  -- this position should remain at anchorPx, anchorPy after state change
                    const gx = (state.x + anchorPx / state.pixelSize) * currentResolution.binSize;
                    const gy = (state.y + anchorPy / state.pixelSize) * currentResolution.binSize;

                    state.x = gx / newBinSize - anchorPx / newPixelSize;
                    state.y = gy / newBinSize - anchorPy / newPixelSize;

                    state.zoom = newZoom;
                    state.pixelSize = newPixelSize;

                    this.clamp();

                    this.contactMatrixView.zoomIn(anchorPx, anchorPy, 1 / scaleFactor)

                    let event = HICEvent("LocusChange", {
                        state: state,
                        resolutionChanged: zoomChanged,
                        chrChanged: false
                    })

                    this.update(event);
                    //this.eventBus.post(event);
                }
            } finally {
                this.stopSpinner()
            }
        }

    }

    // TODO -- apparently not used.  Where is this handled?
    // async wheelClickZoom(direction, centerPX, centerPY) {
    //     if (this.resolutionLocked || this.state.chr1 === 0) {   // Resolution locked OR whole genome view
    //         this.zoomAndCenter(direction, centerPX, centerPY);
    //     } else {
    //         const z = await minZoom.call(this, this.state.chr1, this.state.chr2)
    //         var newZoom = this.state.zoom + direction;
    //         if (direction < 0 && newZoom < z) {
    //             this.setChromosomes(0, 0);
    //         } else {
    //             this.zoomAndCenter(direction, centerPX, centerPY);
    //         }
    //
    //     }
    // }

    // Zoom in response to a double-click
    /**
     * Zoom and center on bins at given screen coordinates.  Supports double-click zoom, pinch zoom.
     * @param direction
     * @param centerPX  screen coordinate to center on
     * @param centerPY  screen coordinate to center on
     * @returns {Promise<void>}
     */
    async zoomAndCenter(direction, centerPX, centerPY) {

        if (!this.dataset) return;

        if (this.dataset.isWholeGenome(this.state.chr1) && direction > 0) {
            // jump from whole genome to chromosome
            const genomeCoordX = centerPX * this.dataset.wholeGenomeResolution / this.state.pixelSize;
            const genomeCoordY = centerPY * this.dataset.wholeGenomeResolution / this.state.pixelSize;
            const chrX = this.genome.getChromsosomeForCoordinate(genomeCoordX);
            const chrY = this.genome.getChromsosomeForCoordinate(genomeCoordY);
            this.setChromosomes(chrX.index, chrY.index);
        } else {
            const resolutions = this.getResolutions();
            const viewDimensions = this.contactMatrixView.getViewDimensions()
            const dx = centerPX === undefined ? 0 : centerPX - viewDimensions.width / 2
            const dy = centerPY === undefined ? 0 : centerPY - viewDimensions.height / 2

            this.state.x += (dx / this.state.pixelSize);
            this.state.y += (dy / this.state.pixelSize);

            if (this.resolutionLocked ||
                (direction > 0 && this.state.zoom === resolutions[resolutions.length - 1].index) ||
                (direction < 0 && this.state.zoom === resolutions[0].index)) {

                const minPS = await this.minPixelSize(this.state.chr1, this.state.chr2, this.state.zoom)
                const state = this.state;
                const newPixelSize = Math.max(Math.min(MAX_PIXEL_SIZE, state.pixelSize * (direction > 0 ? 2 : 0.5)), minPS);

                const shiftRatio = (newPixelSize - state.pixelSize) / newPixelSize;
                state.pixelSize = newPixelSize;
                state.x += shiftRatio * (viewDimensions.width / state.pixelSize);
                state.y += shiftRatio * (viewDimensions.height / state.pixelSize);

                this.clamp();

                let event = HICEvent("LocusChange", {
                    state: state,
                    resolutionChanged: false,
                    chrChanged: false
                })

                this.update(event);
                //this.eventBus.post(event);

            } else {
                let i;
                for (i = 0; i < resolutions.length; i++) {
                    if (this.state.zoom === resolutions[i].index) break;
                }
                if (i !== undefined) {
                    const newZoom = resolutions[i + direction].index;
                    this.setZoom(newZoom);
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

        try {

            // Shift x,y to maintain center, if possible
            const bpResolutions = this.dataset.bpResolutions;
            const currentResolution = bpResolutions[this.state.zoom];
            const viewDimensions = this.contactMatrixView.getViewDimensions();
            const xCenter = this.state.x + viewDimensions.width / (2 * this.state.pixelSize);    // center in bins
            const yCenter = this.state.y + viewDimensions.height / (2 * this.state.pixelSize);    // center in bins

            const newResolution = bpResolutions[zoom];
            const newXCenter = xCenter * (currentResolution / newResolution);
            const newYCenter = yCenter * (currentResolution / newResolution);
            const minPS = await this.minPixelSize(this.state.chr1, this.state.chr2, zoom)
            const state = this.state;
            const newPixelSize = Math.max(DEFAULT_PIXEL_SIZE, minPS);
            const zoomChanged = (state.zoom !== zoom);

            state.zoom = zoom;
            state.x = Math.max(0, newXCenter - viewDimensions.width / (2 * newPixelSize));
            state.y = Math.max(0, newYCenter - viewDimensions.height / (2 * newPixelSize));
            state.pixelSize = newPixelSize;
            this.clamp();

            await this.contactMatrixView.zoomIn()

            let event = HICEvent("LocusChange", {
                state: state,
                resolutionChanged: zoomChanged,
                chrChanged: false
            })

            this.update(event);
            //this.eventBus.post(event);

        } finally {
            // this.stopSpinner()
        }

    };

    async setChromosomes(chr1, chr2) {

        try {
            this.startSpinner()

            const z = await this.minZoom(chr1, chr2)
            this.state.chr1 = Math.min(chr1, chr2);
            this.state.chr2 = Math.max(chr1, chr2);
            this.state.x = 0;
            this.state.y = 0;
            this.state.zoom = z;

            const minPS = await this.minPixelSize(this.state.chr1, this.state.chr2, this.state.zoom)
            this.state.pixelSize = Math.min(100, Math.max(DEFAULT_PIXEL_SIZE, minPS));

            let event = HICEvent("LocusChange", {state: this.state, resolutionChanged: true, chrChanged: true})

            this.update(event);
            //this.eventBus.post(event);

        } finally {
            this.stopSpinner()
        }
    }

    /**
     * Called on loading tracks
     * @returns {Promise<void>}
     */
    async updateLayout() {

        this.clamp();

        this.trackPairs.forEach(function (xyTrackRenderPair, index) {
            sync(xyTrackRenderPair.x, index);
            sync(xyTrackRenderPair.y, index);
        });

        function sync(trackRenderer, index) {
            trackRenderer.$viewport.css({order: index});
            trackRenderer.syncCanvas();
        }

        this.layoutController.xAxisRuler.update();
        this.layoutController.yAxisRuler.update();

        await this.update();

    }


    /**
     * Set the matrix state.  Used to restore state from a bookmark
     * @param state  browser state
     */
    async setState(state) {

        const chrChanged = !this.state || this.state.chr1 !== state.chr1 || this.state.chr2 !== state.chr2;
        this.state = state;
        // Possibly adjust pixel size
        const minPS = await this.minPixelSize(this.state.chr1, this.state.chr2, this.state.zoom)
        this.state.pixelSize = Math.max(state.pixelSize, minPS);

        let hicEvent = new HICEvent("LocusChange", {
            state: this.state,
            resolutionChanged: true,
            chrChanged: chrChanged
        })

        this.update(hicEvent);
        this.eventBus.post(hicEvent);
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
            binX: this.state.x,            // TODO -- tranlsate to lower right corner
            binY: this.state.y,
            pixelSize: this.state.pixelSize
        };
    }

    /**
     * Return true if this browser can be synched to the given state
     * @param syncState
     */
    canBeSynched(syncState) {

        if(false === this.synchable) return false;   // Explicitly not synchable

        return this.dataset &&
            (this.dataset.getChrIndexFromName(syncState.chr1Name) !== undefined) &&
            (this.dataset.getChrIndexFromName(syncState.chr2Name) !== undefined);

    }

    /**
     * Used to synch state with other browsers
     * @param state  browser state
     */
    syncState(syncState) {

        if(!syncState || false === this.synchable) return;

        if (!this.dataset) return;

        var chr1 = this.genome.getChromosome(syncState.chr1Name),
            chr2 = this.genome.getChromosome(syncState.chr2Name),
            zoom = this.dataset.getZoomIndexForBinSize(syncState.binSize, "BP"),
            x = syncState.binX,
            y = syncState.binY,
            pixelSize = syncState.pixelSize;

        if (!(chr1 && chr2)) {
            return;   // Can't be synched.
        }

        if (zoom === undefined) {
            // Get the closest zoom available and adjust pixel size.   TODO -- cache this somehow
            zoom = this.findMatchingZoomIndex(syncState.binSize, this.dataset.bpResolutions);

            // Compute equivalent in basepairs / pixel
            pixelSize = (syncState.pixelSize / syncState.binSize) * this.dataset.bpResolutions[zoom];

            // Translate bins so that origin is unchanged in basepairs
            x = (syncState.binX / syncState.pixelSize) * pixelSize;
            y = (syncState.binY / syncState.pixelSize) * pixelSize;

            if (pixelSize > MAX_PIXEL_SIZE) {
                console.log("Cannot synch map " + this.dataset.name + " (resolution " + syncState.binSize + " not available)");
                return;
            }
        }


        const zoomChanged = (this.state.zoom !== zoom);
        const chrChanged = (this.state.chr1 !== chr1.index || this.state.chr2 !== chr2.index);
        this.state.chr1 = chr1.index;
        this.state.chr2 = chr2.index;
        this.state.zoom = zoom;
        this.state.x = x;
        this.state.y = y;
        this.state.pixelSize = pixelSize;

        let event = HICEvent("LocusChange", {
            state: this.state,
            resolutionChanged: zoomChanged,
            chrChanged: chrChanged
        }, false)

        this.update(event)
        //this.eventBus.post(event);

    }

    setNormalization(normalization) {

        this.state.normalization = normalization;
        this.eventBus.post(HICEvent("NormalizationChange", this.state.normalization))
    }

    shiftPixels(dx, dy) {

        if (!this.dataset) return;
        this.state.x += (dx / this.state.pixelSize);
        this.state.y += (dy / this.state.pixelSize);
        this.clamp();

        const locusChangeEvent = HICEvent("LocusChange", {
            state: this.state,
            resolutionChanged: false,
            dragging: true,
            chrChanged: false
        });
        locusChangeEvent.dragging = true;

        this.update(locusChangeEvent);
        this.eventBus.post(locusChangeEvent);
    }

    goto(chr1, bpX, bpXMax, chr2, bpY, bpYMax, minResolution) {

        const viewDimensions = this.contactMatrixView.getViewDimensions();
        const bpResolutions = this.getResolutions();
        const currentResolution = bpResolutions[this.state.zoom].binSize;
        const viewWidth = viewDimensions.width;

        if (!bpXMax) {
            bpX = Math.max(0, bpX - Math.floor(viewWidth * currentResolution / 2));
            bpXMax = bpX + viewWidth * currentResolution;
        }
        if (!bpYMax) {
            bpY = Math.max(0, bpY - Math.floor(viewDimensions.height * currentResolution / 2));
            bpYMax = bpY + viewDimensions.height * currentResolution;
        }

        let targetResolution = Math.max((bpXMax - bpX) / viewDimensions.width, (bpYMax - bpY) / viewDimensions.height);

        if (minResolution && targetResolution < minResolution) {
            const maxExtent = viewWidth * minResolution;
            const xCenter = (bpX + bpXMax) / 2;
            const yCenter = (bpY + bpYMax) / 2;
            bpX = Math.max(xCenter - maxExtent / 2);
            bpY = Math.max(0, yCenter - maxExtent / 2);
            targetResolution = minResolution;
        }

        let zoomChanged;
        let newZoom;
        if (true === this.resolutionLocked && minResolution === undefined) {
            zoomChanged = false;
            newZoom = this.state.zoom;
        } else {
            newZoom = this.findMatchingZoomIndex(targetResolution, bpResolutions);
            zoomChanged = (newZoom !== this.state.zoom);
        }

        const newResolution = bpResolutions[newZoom].binSize;
        const newPixelSize = Math.min(MAX_PIXEL_SIZE, Math.max(1, newResolution / targetResolution));
        const newXBin = bpX / newResolution;
        const newYBin = bpY / newResolution;

        const chrChanged = !this.state || this.state.chr1 !== chr1 || this.state.chr2 !== chr2;
        this.state.chr1 = chr1;
        this.state.chr2 = chr2;
        this.state.zoom = newZoom;
        this.state.x = newXBin;
        this.state.y = newYBin;
        this.state.pixelSize = newPixelSize;

        this.contactMatrixView.clearImageCaches();


        let event = HICEvent("LocusChange", {
            state: this.state,
            resolutionChanged: zoomChanged,
            chrChanged: chrChanged
        })

        this.update(event);
        //this.eventBus.post(event);

    }

    clamp() {
        var viewDimensions = this.contactMatrixView.getViewDimensions(),
            chr1Length = this.dataset.chromosomes[this.state.chr1].size,
            chr2Length = this.dataset.chromosomes[this.state.chr2].size,
            binSize = this.dataset.bpResolutions[this.state.zoom],
            maxX = (chr1Length / binSize) - (viewDimensions.width / this.state.pixelSize),
            maxY = (chr2Length / binSize) - (viewDimensions.height / this.state.pixelSize);

        // Negative maxX, maxY indicates pixelSize is not enough to fill view.  In this case we clamp x, y to 0,0
        maxX = Math.max(0, maxX);
        maxY = Math.max(0, maxY);


        this.state.x = Math.min(Math.max(0, this.state.x), maxX);
        this.state.y = Math.min(Math.max(0, this.state.y), maxY);
    }

    receiveEvent(event) {
        // if ("LocusChange" === event.type) {
        //     if (event.propogate) {
        //         for (let browser of this.synchedBrowsers) {
        //             browser.syncState(this.getSyncState());
        //         }
        //     }
        //     this.update(event);
        // }
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
            const type = event ? event.type : "NONE";
            this.pending.set(type, event);
        } else {
            this.updating = true;
            try {

                this.startSpinner();
                if (event !== undefined && "LocusChange" === event.type) {
                    this.layoutController.xAxisRuler.locusChange(event);
                    this.layoutController.yAxisRuler.locusChange(event);
                }

                const promises = []

                for (let xyTrackRenderPair of this.trackPairs) {
                    promises.push(this.renderTrackXY(xyTrackRenderPair));
                }
                promises.push(this.contactMatrixView.update(event));
                await Promise.all(promises);

                if (event && event.propogate) {
                    let syncState1 = this.getSyncState();
                    for (let browser of this.synchedBrowsers) {
                        browser.syncState(syncState1);
                    }
                }

            } finally {
                this.updating = false;
                if (this.pending.size > 0) {
                    const events = []
                    for (let [k, v] of this.pending) {
                        events.push(v);
                    }
                    this.pending.clear();
                    for (let e of events) {
                        this.update(e)
                    }
                }
                if (event) {
                    // possibly, unless update was called from an event post (infinite loop)
                    this.eventBus.post(event)
                }
                this.stopSpinner();
            }
        }
    }

    repaintMatrix() {
        this.contactMatrixView.imageTileCache = {};
        this.contactMatrixView.initialImage = undefined;
        this.contactMatrixView.update();
    }

    resolution() {
        return this.dataset.bpResolutions[this.state.zoom];
    };


    toJSON() {

        if (!(this.dataset && this.dataset.url)) return "{}";   // URL is required

        const jsonOBJ = {};

        jsonOBJ.backgroundColor = this.contactMatrixView.stringifyBackgroundColor()
        jsonOBJ.url = this.dataset.url;
        if (this.dataset.name) {
            jsonOBJ.name = this.dataset.name;
        }
        jsonOBJ.state = this.state.stringify();
        jsonOBJ.colorScale = this.contactMatrixView.getColorScale().stringify();
        if (Globals.selectedGene) {
            jsonOBJ.selectedGene = Globals.selectedGene;
        }
        let nviString = getNviString(this.dataset);
        if (nviString) {
            jsonOBJ.nvi = nviString;
        }
        if (this.controlDataset) {
            jsonOBJ.controlUrl = this.controlUrl;
            if (this.controlDataset.name) {
                jsonOBJ.controlName = this.controlDataset.name;
            }
            const displayMode = this.getDisplayMode();
            if (displayMode) {
                jsonOBJ.displayMode = this.getDisplayMode();
            }
            nviString = getNviString(this.controlDataset);
            if (nviString) {
                jsonOBJ.controlNvi = nviString;
            }
            if (this.controlMapWidget.getDisplayModeCycle() !== undefined) {
                jsonOBJ.cycle = true;
            }
        }

        if (this.trackPairs.length > 0 || this.tracks2D.length > 0) {
            let tracks = [];
            jsonOBJ.tracks = tracks;
            for (let trackRenderer of this.trackPairs) {
                const track = trackRenderer.x.track;
                const config = track.config;
                if (typeof config.url === "string") {
                    const t = {
                        url: config.url
                    }
                    if (track.name) {
                        t.name = track.name;
                    }
                    if (track.dataRange) {
                        t.min = track.dataRange.min;
                        t.max = track.dataRange.max;
                    }
                    if (track.color) {
                        t.color = track.color;
                    }
                    tracks.push(t);
                }

            }
            for (let track of this.tracks2D) {
                var config = track.config;
                if (typeof config.url === "string") {
                    const t = {
                        url: config.url
                    }
                    if (track.name) {
                        t.name = track.name;
                    }
                    if (track.color) {
                        t.color = track.color;
                    }
                    tracks.push(t);
                }
            }
        }

        return jsonOBJ;
    }


    async minZoom(chr1, chr2) {

        const viewDimensions = this.contactMatrixView.getViewDimensions();
        const chromosome1 = this.dataset.chromosomes[chr1]
        const chromosome2 = this.dataset.chromosomes[chr2];
        const chr1Length = chromosome1.size;
        const chr2Length = chromosome2.size;
        const binSize = Math.max(chr1Length / viewDimensions.width, chr2Length / viewDimensions.height);

        const matrix = await this.dataset.getMatrix(chr1, chr2)
        if (!matrix) {
            throw new Error(`Data not avaiable for chromosomes ${chromosome1.name} - ${chromosome2.name}`);
        }
        return matrix.findZoomForResolution(binSize);
    }

    async minPixelSize(chr1, chr2, z) {

        const viewDimensions = this.contactMatrixView.getViewDimensions();
        const chr1Length = this.dataset.chromosomes[chr1].size;
        const chr2Length = this.dataset.chromosomes[chr2].size;

        const matrix = await this.dataset.getMatrix(chr1, chr2)
        const zd = matrix.getZoomDataByIndex(z, "BP");
        const binSize = zd.zoom.binSize;
        const nBins1 = chr1Length / binSize;
        const nBins2 = chr2Length / binSize;
        return (Math.min(viewDimensions.width / nBins1, viewDimensions.height / nBins2));

    }
}


function extractName(config) {
    if (config.name === undefined) {
        const urlOrFile = config.url;
        if (FileUtils.isFilePath(urlOrFile)) {
            return urlOrFile.name;
        } else {
            const str = urlOrFile.split('?').shift();
            const idx = urlOrFile.lastIndexOf("/");
            return idx > 0 ? str.substring(idx + 1) : str;
        }
    } else {
        return config.name;
    }
}

function getNviString(dataset) {

    return dataset.hicFile.config.nvi
    // if (dataset.hicFile.normalizationVectorIndexRange) {
    //     var range = dataset.hicFile.normalizationVectorIndexRange,
    //         nviString = String(range.start) + "," + String(range.size);
    //     return nviString
    // } else {
    //     return undefined;
    // }
}

// parseUri 1.2.2
// (c) Steven Levithan <stevenlevithan.com>
// MIT License

function parseUri(str) {
    var o = parseUri.options,
        m = o.parser[o.strictMode ? "strict" : "loose"].exec(str),
        uri = {},
        i = 14;

    while (i--) uri[o.key[i]] = m[i] || "";

    uri[o.q.name] = {};
    uri[o.key[12]].replace(o.q.parser, function ($0, $1, $2) {
        if ($1) uri[o.q.name][$1] = $2;
    });

    return uri;
}

parseUri.options = {
    strictMode: false,
    key: ["source", "protocol", "authority", "userInfo", "user", "password", "host", "port", "relative", "path", "directory", "file", "query", "anchor"],
    q: {
        name: "queryKey",
        parser: /(?:^|&)([^&=]*)=?([^&]*)/g
    },
    parser: {
        strict: /^(?:([^:\/?#]+):)?(?:\/\/((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?))?((((?:[^?#\/]*\/)*)([^?#]*))(?:\?([^#]*))?(?:#(.*))?)/,
        loose: /^(?:(?![^:@]+:[^:@\/]*@)([^:\/?#.]+):)?(?:\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/
    }
};

function replaceAll(str, target, replacement) {
    return str.split(target).join(replacement);
}

function presentError(prefix, error) {
    const httpMessages = {
        "401": "Access unauthorized",
        "403": "Access forbidden",
        "404": "Not found"
    }
    var msg = error.message;
    if (httpMessages.hasOwnProperty(msg)) {
        msg = httpMessages[msg];
    }
    Alert.presentAlert(prefix + ": " + msg);

}

export default HICBrowser

