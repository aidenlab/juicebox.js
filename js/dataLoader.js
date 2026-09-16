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

import igv from 'igv'
import {FileUtils} from 'igv-utils'
import Dataset, { HiCDataset } from './hicDataset.js'
import State from './hicState.js'
import Genome from './genome.js'
import {extractName, presentError, errorMessage, isBotChallenge} from "./utils.js"
import {isFile} from "./fileUtils.js"
import HICEvent from './hicEvent.js'
import EventBus from './eventBus.js'
import nvi from './nvi.js'
import * as hicUtils from './hicUtils.js'
import {getLayoutDimensions} from './layoutController.js'
import Track2D from './track2D.js'

import {decodeState} from "./sessionCodec.js"
import {mapTrackConfig} from "./urlMapper.js"
import {isolationReasons, isSynchable} from "./syncGroup.js"

/**
 * How this module reports a `config.state` that is neither a state token nor a
 * state object. `decodeState` returns the default view either way; saying so is
 * kept out of the codec, which is pure by design and has no business raising an
 * `alert`.
 */
function reportUnknownStateType() {
    alert('config.state is of unknown type');
    console.error('config.state is of unknown type');
}

/**
 * DataLoader handles all data loading responsibilities for HICBrowser.
 * Extracted from HICBrowser to separate data loading concerns.
 *
 * This class manages:
 * - Hi-C file loading (main and control)
 * - Live contact map loading (via hic-straw LiveContactMap)
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
     * The `alert` callback handed to hic-straw, which is not an alert channel.
     *
     * It has exactly one caller in the library -- `hicFile.getNormalizationVector`,
     * when the requested vector is absent at this chromosome and resolution --
     * and that is a *substitution*, the same event `imageTileSource` reports one
     * layer up. Genuine read errors in hic-straw throw; they do not come through
     * here. So this announces in the widget like every other substitution, and
     * raises no modal (#372, ADR-0012 decision 4).
     *
     * hic-straw hands over a formatted sentence rather than the pieces, so the
     * reason is rebuilt from what the browser already knows: `state.normalization`
     * is what was asked for at the moment the vector was refused.
     *
     * And it is sticky, which is #600 restated. The issue was filed while this
     * hook was still believed to be a read-failure channel, and asked for the
     * widget update to be deleted; decision 4 retired that premise, leaving the
     * opposite defect -- the widget read `NONE` while canonical state still read
     * `KR`, so the next render pass re-asked for a vector the file had already
     * refused. `browser.substituteNormalization` is where the rest of that rule
     * lives, shared with the mid-render caller in `createWidgets`; the guard on
     * an absent or already-`NONE` request is its, not this hook's.
     *
     * @returns {(str: string) => void} the callback, closed over this browser
     */
    #announceStrawSubstitution() {
        return () => this.browser.substituteNormalization(this.browser.state?.normalization, 'NONE');
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

        this.browser.clearDataset();
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

            const dataset = await Dataset.loadDataset(
                Object.assign({alert: this.#announceStrawSubstitution()}, config));
            dataset.name = name;

            const previousGenomeId = this.browser.genome ? this.browser.genome.id : undefined;
            this.browser.genome = new Genome(dataset.genomeId, dataset.chromosomes);

            if (this.browser.genome.id !== previousGenomeId) {
                // Use coordinator instead of event bus for explicit, traceable genome change handling
                this.browser.coordinator.onGenomeChange(this.browser.genome.id);
                // Still post to event bus for cross-browser synchronization (if needed)
                EventBus.globalBus.post(HICEvent("GenomeChange", this.browser.genome.id));
            }

            // A rung installs the dataset and then hands its state to
            // `setState`, the chokepoint -- in that order, because `clampXY`
            // reads the dataset. Until #559 the install carried the state with
            // it, unvalidated. The `config.locus` rung hid that: it went on to
            // `parseGotoInput` and never reached `setState`, so the raw state
            // stood. ADR-0009 decision 1.
            //
            // There were four rungs until #566. A `config.synchState` rung sat
            // between `config.state` and the fallback, and was the 2017
            // mechanism for syncing a newly created panel to its siblings. It
            // was superseded three months later by the sync step at the end of
            // this method -- sync on map load, not on browser creation -- and
            // was unreachable besides, since `clearDataset()` above runs before
            // a guard that needs a dataset. Nothing had supplied the key in the
            // nine years since. See the amendment to ADR-0009.
            //
            // No rung keeps hold of what it handed over. The chokepoint installs
            // a *clone* (#558), so the object passed in stops being the state in
            // force the moment it is accepted -- and on the `locus` rung it is a
            // whole-genome default while the browser sits at the requested
            // locus. What `onMapLoaded` publishes is read back off the browser
            // for that reason.
            if (config.locus) {
                this.browser.setActiveDataset(dataset);
                await this.browser.setState(State.default());
                await this.browser.parseGotoInput(config.locus);
            } else if (config.state) {
                this.browser.setActiveDataset(dataset);
                await this.browser.setState(decodeState(config.state, reportUnknownStateType));
            } else {
                this.browser.setActiveDataset(dataset);
                await this.browser.setState(State.default());
            }

            // The state in force, not the one handed to the chokepoint.
            this.browser.coordinator.onMapLoaded(dataset, this.browser.state, dataset.datasetType);

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
                    this.browser.coordinator.onNormVectorIndexLoad(dataset);
                }
            } else if (dataset.getNormVectorIndex) {
                dataset.getNormVectorIndex(config)
                    .then(normVectorIndex => {
                        if (!config.isControl) {
                            this.browser.coordinator.onNormVectorIndexLoad(dataset);
                        }
                    });
            }

            // This browser's own registry: syncing is scoped to one embed, so a
            // dataset arriving here never reaches across to another container.
            const registry = this.browser.registry;

            registry.sync(); // Sync browsers to ensure all browsers are updated with the new dataset

            // Find a browser to sync with, if any: one this panel would pair
            // with, so the pairing rule's two questions -- `isSynchable` and
            // `canSyncWith` -- and not the control-map predicate below. Until
            // #637 this filter ignored the *peer's* `synchable`, so a newcomer
            // adopted the view of an opted-out panel it is in no group with,
            // and wore the isolation mark while the host heard nothing. This
            // panel's own opt-out is `syncState`'s guard. ADR-0016 decision 2.
            const peer = registry.browsers.find(
                b => b !== this.browser &&
                     isSynchable(b) &&
                     b.dataset.canSyncWith(this.browser.dataset)
            );
            if (peer) {
                await this.browser.syncState(peer.getSyncState());
            } else {
                // Reported exactly when the panel wears the isolation mark, and
                // in its words, so the host's log and the screen agree (#637).
                // That rule is what stays quiet in the empty room -- a first
                // panel loading into an empty registry finds no peer and that is
                // not a refusal (#626) -- and for a panel the host opted out,
                // which the host needs no telling about even though the person
                // looking at the screen does.
                //
                // Asked over the registry *and* this browser: `createBrowser`
                // loads before it registers, so a newcomer is not in the list yet.
                const browsers = registry.browsers.includes(this.browser) ? registry.browsers : [...registry.browsers, this.browser];
                const reason = isolationReasons(browsers).get(this.browser);
                if (undefined !== reason && isSynchable(this.browser)) {
                    // The panels the message is about: the synchable company,
                    // one id per panel. Opted-out panels are not in it.
                    const others = registry.browsers.filter(b => b !== this.browser && isSynchable(b));
                    this.browser.coordinator.onSyncRefused({
                        reason: 'no-compatible-peer',
                        message: reason,
                        genomeId: this.browser.dataset.genomeId,
                        peerGenomeIds: others.map(b => b.dataset.genomeId)
                    });
                }
            }

            return dataset;
        } catch (error) {
            this.browser.contactMapLabel.textContent = "";
            this.browser.contactMapLabel.title = "";
            config.name = name;

            // `clearDataset()` stripped this browser from its peers but left its
            // own set standing (#492), for the load to address the group on its
            // way past. A load that fails never reaches the recompute above, so
            // it runs here: the open maps have changed, whatever state this
            // browser is left in. #635.
            this.browser.registry.sync();

            // A bot challenge is the one failure the host app cannot explain to the user, since the
            // tell is a response header it never sees. Everything else is left to the host, which
            // may already report the rethrow — see issue #441.
            if (isBotChallenge(error)) {
                presentError(this.browser.registry, "Error loading map", error);
            }

            throw error;
        } finally {
            this.browser.stopSpinner();
            if (!noUpdates) {
                this.browser.userInteractionShield.style.display = 'none';
            }
        }
    }

    /**
     * Load a live contact map via hic-straw LiveContactMap.
     * Routes through HiCDataset → Straw → LiveContactMap (HicFile interface).
     *
     * NOTE: public API function
     *
     * @param {Object} config - Configuration object with:
     *   - liveContactMap: A LiveContactMap instance (already init'd or will be init'd via HiCDataset)
     *   - name: Display name
     *   - locus: Optional locus string to navigate to (defaults to data extent)
     *   - state: Optional initial state
     * @param {boolean} noUpdates - If true, don't trigger UI updates
     * @returns {Promise<HiCDataset>}
     */
    async loadLiveContactMap(config, noUpdates) {
        this.browser.clearDataset();

        try {
            this.browser.contactMatrixView.startSpinner();
            if (!noUpdates) {
                this.browser.userInteractionShield.style.display = 'block';
            }

            const lcm = config.liveContactMap;

            // The live map's counterpart to `extractName`, which the file path
            // uses to name a map after the file behind its URL. A live map has
            // no URL to be named after, so this is the same load-stage question
            // with the only answer available -- not a config default the
            // normalize stage could have applied, since a live map config is a
            // runtime argument and never part of a session (#536).
            const name = config.name || 'Live Contact Map';
            this.browser.contactMapLabel.textContent = name;
            this.browser.contactMapLabel.title = name;

            // Route through HiCDataset → Straw → lcm (HicFile interface)
            const dataset = new HiCDataset({ liveContactMap: lcm });
            await dataset.init();

            const previousGenomeId = this.browser.genome ? this.browser.genome.id : undefined;
            this.browser.genome = new Genome(dataset.genomeId, dataset.chromosomes);

            if (this.browser.genome.id !== previousGenomeId) {
                this.browser.coordinator.onGenomeChange(this.browser.genome.id);
                EventBus.globalBus.post(HICEvent("GenomeChange", this.browser.genome.id));
            }

            // The same ladder the file path walks. It used to be spelled
            // differently here and had lost the unknown-type rung, so a numeric
            // `state` crashed in `State.parse` on this path and opened the
            // default view on the other. #504.
            this.browser.setActiveDataset(dataset);
            await this.browser.setState(decodeState(config.state, reportUnknownStateType));

            // Navigate to the data region so it fills the viewport. A locus
            // string is 1-based -- `parseLocusString` subtracts one -- and the
            // extent is 0-based, so the start gains the one back, as the locus
            // box and the gene lookup do. The end needs nothing: a 1-based
            // inclusive end is a 0-based exclusive one. #567.
            const locus = config.locus || `${lcm.chromosomes[1].name}:${lcm.genomicStart + 1}-${lcm.genomicEnd}`;
            await this.browser.parseGotoInput(locus);

            // The same expression the file path uses. This said 'livecontactmap'
            // until #471 -- a fourth value, in a third vocabulary, published on
            // the one path where the dataset itself already says 'live'. So the
            // coordinator told hosts one thing and `dataset.datasetType` another,
            // about the same load. Nobody could have been reading it: no doc ever
            // named it, and the JSDoc it contradicted named "main"/"control".
            //
            // And the same state expression, for the same reason the file path
            // gives: `parseGotoInput` above has just moved the browser off the
            // decoded state, which was a clone ago in any case.
            this.browser.coordinator.onMapLoaded(dataset, this.browser.state, dataset.datasetType);

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

            const controlDataset = await Dataset.loadDataset(
                Object.assign({alert: this.#announceStrawSubstitution()}, config));

            controlDataset.name = name;

            if (!this.browser.dataset || this.browser.dataset.isCompatible(controlDataset)) {
                this.browser.controlDataset = controlDataset;
                if (this.browser.dataset) {
                    this.browser.contactMapLabel.textContent = "A: " + this.browser.dataset.name;
                }
                this.browser.controlMapLabel.textContent = "B: " + controlDataset.name;
                this.browser.controlMapLabel.title = controlDataset.name;

                //For the control dataset, block until the norm vector index is loaded
                if (controlDataset.getNormVectorIndex) {
                    await controlDataset.getNormVectorIndex(config);
                }
                this.browser.coordinator.onControlMapLoaded(this.browser.controlDataset);

                if (!noUpdates) {
                    await this.browser.update();
                }

                return controlDataset;
            } else {
                this.browser.registry.presentAlert(
                    '"B" map genome (' + controlDataset.genomeId + ') does not match "A" map genome (' +
                    this.browser.genome.id + ')'
                );
                return undefined;
            }
        } catch (error) {
            // Same reasoning as loadHicFile: report only the failure the host app cannot explain.
            if (isBotChallenge(error)) {
                presentError(this.browser.registry, "Error loading control map", error);
            }

            throw error;
        } finally {
            this.browser.userInteractionShield.style.display = 'none';
            this.browser.stopSpinner();
        }
    }

    /**
     * Load tracks (1D and 2D) from configuration, reporting a failure in this
     * embed's alert dialog.
     *
     * It catches and resolves rather than rejecting, and that is contract:
     * `HICBrowser.loadTracks` is published surface, two hosts call it, and what
     * they observe is that a bad track raises a modal and the promise settles.
     * The body is `loadTracksOrThrow` below, which is what the target-set
     * fan-out calls -- N loads reported once, on the host's own notification
     * surface, cannot be built over a loader that swallows. #615.
     *
     * @param {Array<Object>} configs - Array of track configuration objects
     * @returns {Promise<void>}
     */
    async loadTracks(configs) {
        const errorPrefix = configs.length === 1 ?
            `Error loading track ${configs[0].name}` :
            "Error loading tracks";

        try {
            await this.loadTracksOrThrow(configs);
        } catch (error) {
            presentError(this.browser.registry, errorPrefix, error);
            console.error(error);
        }
    }

    /**
     * The load, rejecting on failure: `loadTracks` above without the reporting.
     *
     * Internal in the sense the registry's `releaseSlot` is -- not declared
     * surface, and reached from one place: `HICBrowser.loadTracksOrThrow`, which
     * the target-set fan-out calls. #615.
     *
     * Every track loads concurrently and settles on its own (#663, ADR-0017
     * decision 6). Each 1D track is a pending track from the start: its
     * placeholder row is reserved before any track is fetched, becomes the
     * track pair when that track loads, and is removed if it fails (#664,
     * decision 3). The map spinner is not raised -- the rows are the indicator.
     * The promise still settles only once every track in `configs` has; then the
     * failures, if any, are thrown as one error.
     *
     * A load cannot be cancelled, so a track that settles after its placeholder
     * is gone is discarded silently: not laid out, not reported (#665, ADR-0017
     * decision 8). A dismissed row is gone for its own track; a browser disposed
     * or reset -- a restore replacing the session disposes it -- is gone for the
     * whole load, 2D tracks and all. A load of a single track throws
     * that track's own error, so the one-track report reads exactly as it always
     * has.
     *
     * The one error of a multi-track load is a plain `Error` whose message is
     * already phrased for the user -- one `name: reason` per failed track, in
     * session order -- and carries no `code`. A host reports it as it stands.
     * A bot challenge is named per track and explained once, at the end.
     *
     * @param {Array<Object>} configs - Array of track configuration objects
     * @returns {Promise<void>}
     */
    async loadTracksOrThrow(configs) {

        const prepared = configs.map(config => {
            try {
                return {config, is2D: this.#prepareTrack(config)};
            } catch (error) {
                return {config, error};
            }
        });

        const {layoutController} = this.browser;

        const oneD = prepared.filter(({error, is2D}) => !error && !is2D);
        const placeholders = layoutController.reservePendingTracks(oneD.map(({config}) => config));
        oneD.forEach((entry, i) => entry.placeholder = placeholders[i]);

        const loads = prepared.map(({config, error, is2D, placeholder}) => {
            if (error) {
                return Promise.reject(error);
            } else if (is2D) {
                return this.#loadTrack2D(config);
            } else {
                return this.#loadTrack1D(config, layoutController, placeholder);
            }
        });

        // Sized for the reserved rows before any of them is filled, so the map
        // is laid out once for this load.
        const reserved = placeholders.length > 0 ? this.browser.updateLayout() : undefined;

        const settled = await Promise.allSettled(loads);
        await reserved;

        if (!this.#isCurrent(layoutController)) {
            return;
        }

        const failures = [];
        const tracks2D = [];

        settled.forEach((outcome, i) => {
            if ('rejected' === outcome.status) {
                failures.push({config: configs[i], error: outcome.reason});
            } else if (outcome.value?.track2D) {
                tracks2D.push(outcome.value.track2D);
            }
        });

        if (tracks2D.length > 0) {
            this.browser.tracks2D = this.browser.tracks2D.concat(tracks2D);
            this.browser.coordinator.onTrackLoad2D(this.browser.tracks2D);
        }

        if (1 === configs.length && 1 === failures.length) {
            throw failures[0].error;
        } else if (failures.length > 0) {
            // Session order, 2D failures included, so the report reads like the session does.
            const lines = failures.map(({config, error}) => isBotChallenge(error) ?
                `${extractName(config)}: blocked by bot protection` :
                `${extractName(config)}: ${errorMessage(error)}`);
            const challenge = failures.find(({error}) => isBotChallenge(error));
            if (challenge) {
                lines.push(errorMessage(challenge.error));
            }
            throw Error(lines.join('; '));
        }
    }

    /**
     * What a track config needs before its load starts, and whether it is 2D.
     * Synchronous, so a load's placeholder rows are reserved before anything is
     * fetched.
     *
     * @param {Object} config - a track configuration object
     * @returns {boolean} - whether the track is a 2D track
     */
    #prepareTrack(config) {
        const fileName = isFile(config.url)
            ? config.url.name
            : config.filename || FileUtils.getFilename(config.url);

        const extension = hicUtils.getExtension(fileName);

        if (['fasta', 'fa'].includes(extension)) {
            config.type = config.format = 'sequence';
        }

        // What the *load* discovers, and only that: a missing `max` means
        // autoscale, and the height comes from the live layout. Neither
        // is a question a session document can answer.
        //
        // The annotation colour and display mode used to be defaulted
        // here too, conditioned on `config.type === 'annotation'`. They
        // were a second copy of two `normalizeTrackConfigs` rules, kept
        // through #533 because a track added at runtime met no normalize
        // stage. It meets one at `HICBrowser.loadTracks` now, so the copy
        // is gone and this loader defaults nothing a config carries
        // (#536).
        if (config.max === undefined) {
            config.autoscale = true;
        }

        const { trackHeight } = getLayoutDimensions();
        config.height = trackHeight;

        // 2D tracks: bedpe/interact by format or extension, or a juicebox
        // loops/peaks list (.txt) for which igv.js can't infer a 1D format.
        // Note: hicUtils.getExtension() strips .txt as an aux extension, so
        // test the raw filename rather than `extension` for the .txt case.
        const lowerName = fileName.toLowerCase();
        return ['bedpe', 'interact'].includes(config.format)
            || ['bedpe', 'interact'].includes(extension)
            || (config.format === undefined
                && (lowerName.endsWith('.txt') || lowerName.endsWith('.txt.gz')));
    }

    /**
     * Load one 1D track into its placeholder row: the row becomes the track
     * pair on load and is removed on failure. A track whose row has gone
     * meanwhile -- dismissed, cleared, or its browser torn down -- is dropped,
     * and so is its failure: it resolves rather than rejects.
     *
     * @param {Object} config - a 1D track configuration object
     * @param {LayoutController} layoutController - the layout the row was reserved in
     * @param {PendingTrackPair} placeholder - the row reserved for it
     * @returns {Promise<void>}
     */
    async #loadTrack1D(config, layoutController, placeholder) {

        const rowIsGone = () => !this.#isCurrent(layoutController) || !layoutController.hasPendingTrack(placeholder);

        let trackPair;
        try {
            // igv reads the track through its own bundled loaders, which juicebox cannot
            // reach into — the config's `url` is the only lever. mapTrackConfig carries the
            // original alongside so toJSON can serialize it. See issue #450.
            const track = await igv.createTrack(mapTrackConfig(config), this.browser);

            if (typeof track.postInit === 'function') {
                await track.postInit();
            }

            if (rowIsGone()) {
                return;
            }
            trackPair = layoutController.fillPendingTrack(placeholder, track);
        } catch (error) {
            if (rowIsGone()) {
                return;
            }
            layoutController.removePendingTrack(placeholder);
            await this.browser.updateLayout();
            throw error;
        }

        // The row was sized when it was reserved, so nothing else moves: only
        // this pair is drawn, not the whole browser.
        await trackPair.updateViews();
    }

    /**
     * Whether the browser a load started in is still there to write to: not
     * disposed, and not reset since -- a reset builds a new layout, so the one
     * the load reserved its rows in is gone.
     */
    #isCurrent(layoutController) {
        return !this.browser.isDisposed && this.browser.layoutController === layoutController;
    }

    /**
     * Load one 2D track. It has no row and no indicator (ADR-0017 decision 7);
     * it is added to the browser's 2D tracks with the rest of its load.
     *
     * @param {Object} config - a 2D track configuration object
     * @returns {Promise<{track2D: Object}>}
     */
    async #loadTrack2D(config) {
        const track2D = await Track2D.loadTrack2D(config, this.browser.genome);
        return {track2D};
    }

    /**
     * Load a normalization vector file.
     *
     * @param {string} url - URL of the normalization vector file
     * @returns {Promise<Object|undefined>} - The normalization vectors object
     */
    async loadNormalizationFile(url) {
        if (!this.browser.dataset) {
            return;
        }

        // Normalization files are only supported for Hi-C datasets
        if (!this.browser.dataset.hicFile) {
            console.warn("Normalization files are only supported for Hi-C datasets");
            return;
        }

        this.browser.coordinator.onNormalizationFileLoad("start");

        const normVectors = await this.browser.dataset.hicFile.readNormalizationVectorFile(
            url,
            this.browser.dataset.chromosomes
        );

        for (let type of normVectors['types']) {
            if (!this.browser.dataset.normalizationTypes) {
                this.browser.dataset.normalizationTypes = [];
            }
            if (!this.browser.dataset.normalizationTypes.includes(type)) {
                this.browser.dataset.normalizationTypes.push(type);
            }
            this.browser.coordinator.onNormVectorIndexLoad(this.browser.dataset);
        }

        this.browser.coordinator.onNormalizationFileLoad("stop");

        return normVectors;
    }
}

export default DataLoader;

