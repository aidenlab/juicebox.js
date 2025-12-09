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

import igv from '../node_modules/igv/dist/igv.esm.js'
import {Alert} from '../node_modules/igv-ui/dist/igv-ui.js'
import {FileUtils} from '../node_modules/igv-utils/src/index.js'
import Dataset from './hicDataset.js'
import LiveMapDataset from './liveMapDataset.js'
import State from './hicState.js'
import Genome from './genome.js'
import {extractName, presentError} from "./utils.js"
import {isFile} from "./fileUtils.js"
import {getAllBrowsers, syncBrowsers} from "./createBrowser.js"
import HICEvent from './hicEvent.js'
import EventBus from './eventBus.js'
import nvi from './nvi.js'
import * as hicUtils from './hicUtils.js'
import {getLayoutDimensions} from './layoutController.js'
import Track2D from './track2D.js'

import {DEFAULT_ANNOTATION_COLOR} from "./urlUtils.js"
import {inferFileFormatFromName} from "./igvjs-utils.js"

/**
 * DataLoader handles all data loading responsibilities for HICBrowser.
 * Extracted from HICBrowser to separate data loading concerns.
 *
 * This class manages:
 * - Hi-C file loading (main and control)
 * - Live map dataset loading
 * - Track loading (1D and 2D)
 * - Normalization vector file loading
 */
class DataLoader {

    /**
     * @param {HICBrowser} browser - The browser instance this loader serves
     */
    constructor(browser) {
        this.browser = browser;
    }

    /**
     * Load a .hic file
     *
     * NOTE: public API function
     *
     * @param {Object} config - Configuration object with url, name, locus, state, etc.
     * @param {boolean} noUpdates - If true, don't trigger UI updates
     * @returns {Promise<Dataset|undefined>} - The loaded dataset
     */
    async loadHicFile(config, noUpdates) {
        if (!config.url) {
            console.log("No .hic url specified");
            return undefined;
        }

        this.browser.clearSession();
        let name
        try {
            this.browser.contactMatrixView.startSpinner();
            if (!noUpdates) {
                this.browser.userInteractionShield.style.display = 'block';
            }

            name = extractName(config);
            const prefix = this.browser.controlDataset ? "A: " : "";
            this.browser.contactMapLabel.textContent = prefix + name;
            this.browser.contactMapLabel.title = name;
            config.name = name;

            const hicFileAlert = str => {
                this.browser.notifyNormalizationExternalChange('NONE');
                Alert.presentAlert(str);
            };

            const dataset = await Dataset.loadDataset(Object.assign({alert: hicFileAlert}, config));
            dataset.name = name;

            const previousGenomeId = this.browser.genome ? this.browser.genome.id : undefined;
            this.browser.genome = new Genome(dataset.genomeId, dataset.chromosomes);

            if (this.browser.genome.id !== previousGenomeId) {
                EventBus.globalBus.post(HICEvent("GenomeChange", this.browser.genome.id));
            }

            let state;
            if (config.locus) {
                state = State.default(config);
                this.browser.setActiveDataset(dataset, state);
                await this.browser.parseGotoInput(config.locus);
            } else if (config.state) {
                if (typeof config.state === 'string') {
                    state = State.parse(config.state);
                } else if (typeof config.state === 'object') {
                    state = State.fromJSON(config.state);
                } else {
                    alert('config.state is of unknown type');
                    console.error('config.state is of unknown type');
                    state = State.default(config);
                }

                // Set active dataset before setState so configureLocus can access bpResolutions
                this.browser.setActiveDataset(dataset, state);
                await this.browser.setState(state);
            } else if (config.synchState && this.browser.canBeSynched(config.synchState)) {
                await this.browser.syncState(config.synchState);
                state = this.browser.activeState;
                // syncState already sets activeDataset, but ensure it's set with current dataset
                if (this.browser.activeDataset !== dataset) {
                    this.browser.setActiveDataset(dataset, state);
                }
            } else {
                state = State.default(config);
                // Set active dataset before setState so configureLocus can access bpResolutions
                this.browser.setActiveDataset(dataset, state);
                await this.browser.setState(state);
            }

            this.browser.notifyMapLoaded(dataset, state, dataset.datasetType);

            // Initiate loading of the norm vector index, but don't block if the "nvi" parameter is not available.
            // Let it load in the background

            // If nvi is not supplied, try lookup table of known values
            if (!config.nvi && typeof config.url === "string") {
                const url = new URL(config.url);
                const key = encodeURIComponent(url.hostname + url.pathname);
                if (nvi.hasOwnProperty(key)) {
                    config.nvi = nvi[key];
                }
            }

            if (config.nvi && dataset.getNormVectorIndex) {
                await dataset.getNormVectorIndex(config);
                if (!config.isControl) {
                    this.browser.notifyNormVectorIndexLoad(dataset);
                }
            } else if (dataset.getNormVectorIndex) {
                dataset.getNormVectorIndex(config)
                    .then(normVectorIndex => {
                        if (!config.isControl) {
                            this.browser.notifyNormVectorIndexLoad(dataset);
                        }
                    });
            }

            syncBrowsers(); // Sync browsers to ensure all browsers are updated with the new dataset

            // Find a browser to sync with, if any
            const compatibleBrowsers = getAllBrowsers().filter(
                b => b !== this.browser &&
                     b.activeDataset &&
                     b.activeDataset.isCompatible(this.browser.activeDataset)
            );
            if (compatibleBrowsers.length > 0) {
                await this.browser.syncState(compatibleBrowsers[0].getSyncState());
            }

            return dataset;
        } catch (error) {
            this.browser.contactMapLabel.textContent = "";
            this.browser.contactMapLabel.title = "";
            config.name = name;
            throw error;
        } finally {
            this.browser.stopSpinner();
            if (!noUpdates) {
                this.browser.userInteractionShield.style.display = 'none';
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
        this.browser.clearSession();

        try {
            this.browser.contactMatrixView.startSpinner();
            if (!noUpdates) {
                this.browser.userInteractionShield.style.display = 'block';
            }

            const name = config.name || 'Live Map';
            this.browser.contactMapLabel.textContent = name;
            this.browser.contactMapLabel.title = name;

            const dataset = new LiveMapDataset(config);
            await dataset.init();

            const previousGenomeId = this.browser.genome ? this.browser.genome.id : undefined;
            this.browser.genome = new Genome(dataset.genomeId, dataset.chromosomes);

            if (this.browser.genome.id !== previousGenomeId) {
                EventBus.globalBus.post(HICEvent("GenomeChange", this.browser.genome.id));
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
            this.browser.setActiveDataset(dataset, state);
            await this.browser.setState(state);

            this.browser.notifyMapLoaded(dataset, state, dataset.datasetType);

            return dataset;
        } catch (error) {
            this.browser.contactMapLabel.textContent = "";
            this.browser.contactMapLabel.title = "";
            throw error;
        } finally {
            this.browser.stopSpinner();
            if (!noUpdates) {
                this.browser.userInteractionShield.style.display = 'none';
            }
        }
    }

    /**
     * Load a .hic file for a control map
     *
     * NOTE: public API function
     *
     * @param {Object} config - Configuration object with url, name, nvi, etc.
     * @param {boolean} noUpdates - If true, don't trigger UI updates
     * @returns {Promise<Dataset|undefined>} - The loaded control dataset
     */
    async loadHicControlFile(config, noUpdates) {
        try {
            this.browser.userInteractionShield.style.display = 'block';
            this.browser.contactMatrixView.startSpinner();
            this.browser.controlUrl = config.url;
            const name = extractName(config);
            config.name = name;

            const hicFileAlert = str => {
                this.browser.notifyNormalizationExternalChange('NONE');
                Alert.presentAlert(str);
            };

            const controlDataset = await Dataset.loadDataset(Object.assign({alert: hicFileAlert}, config));

            controlDataset.name = name;

            if (!this.browser.activeDataset || this.browser.activeDataset.isCompatible(controlDataset)) {
                this.browser.controlDataset = controlDataset;
                if (this.browser.activeDataset) {
                    this.browser.contactMapLabel.textContent = "A: " + this.browser.activeDataset.name;
                }
                this.browser.controlMapLabel.textContent = "B: " + controlDataset.name;
                this.browser.controlMapLabel.title = controlDataset.name;

                //For the control dataset, block until the norm vector index is loaded
                if (controlDataset.getNormVectorIndex) {
                    await controlDataset.getNormVectorIndex(config);
                }
                this.browser.notifyControlMapLoaded(this.browser.controlDataset);

                if (!noUpdates) {
                    await this.browser.update();
                }

                return controlDataset;
            } else {
                Alert.presentAlert(
                    '"B" map genome (' + controlDataset.genomeId + ') does not match "A" map genome (' +
                    this.browser.genome.id + ')'
                );
                return undefined;
            }
        } finally {
            this.browser.userInteractionShield.style.display = 'none';
            this.browser.stopSpinner();
        }
    }

    /**
     * Load tracks (1D and 2D) from configuration.
     *
     * @param {Array<Object>} configs - Array of track configuration objects
     * @returns {Promise<void>}
     */
    async loadTracks(configs) {
        const errorPrefix = configs.length === 1 ?
            `Error loading track ${configs[0].name}` :
            "Error loading tracks";

        try {
            this.browser.contactMatrixView.startSpinner();

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
                    config.format = inferFileFormatFromName(fileName);
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

                const { trackHeight } = getLayoutDimensions();
                config.height = trackHeight;

                if (config.format === undefined || ['bedpe', 'interact'].includes(config.format)) {
                    promises2D.push(Track2D.loadTrack2D(config, this.browser.genome));
                } else {
                    const track = await igv.createTrack(config, this.browser);

                    if (typeof track.postInit === 'function') {
                        await track.postInit();
                    }

                    tracks.push(track);
                }
            }

            if (tracks.length > 0) {
                this.browser.layoutController.updateLayoutWithTracks(tracks);

                const gearContainer = document.querySelector('.hic-igv-right-hand-gutter');
                if (this.browser.showTrackLabelAndGutter) {
                    gearContainer.style.display = 'block';
                } else {
                    gearContainer.style.display = 'none';
                }

                await this.browser.updateLayout();
            }

            if (promises2D.length > 0) {
                const tracks2D = await Promise.all(promises2D);
                if (tracks2D && tracks2D.length > 0) {
                    this.browser.tracks2D = this.browser.tracks2D.concat(tracks2D);
                    this.browser.notifyTrackLoad2D(this.browser.tracks2D);
                }
            }

        } catch (error) {
            presentError(errorPrefix, error);
            console.error(error);
        } finally {
            this.browser.contactMatrixView.stopSpinner();
        }
    }

    /**
     * Load a normalization vector file.
     *
     * @param {string} url - URL of the normalization vector file
     * @returns {Promise<Object|undefined>} - The normalization vectors object
     */
    async loadNormalizationFile(url) {
        if (!this.browser.activeDataset) {
            return;
        }

        // Normalization files are only supported for Hi-C datasets
        if (!this.browser.activeDataset.hicFile) {
            console.warn("Normalization files are only supported for Hi-C datasets");
            return;
        }

        this.browser.notifyNormalizationFileLoad("start");

        const normVectors = await this.browser.activeDataset.hicFile.readNormalizationVectorFile(
            url,
            this.browser.activeDataset.chromosomes
        );

        for (let type of normVectors['types']) {
            if (!this.browser.activeDataset.normalizationTypes) {
                this.browser.activeDataset.normalizationTypes = [];
            }
            if (!this.browser.activeDataset.normalizationTypes.includes(type)) {
                this.browser.activeDataset.normalizationTypes.push(type);
            }
            this.browser.notifyNormVectorIndexLoad(this.browser.activeDataset);
        }

        this.browser.notifyNormalizationFileLoad("stop");

        return normVectors;
    }
}

export default DataLoader;

