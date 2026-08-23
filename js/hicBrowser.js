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

import {InputDialog, DOMUtils} from 'igv-ui'
import * as hicUtils from './hicUtils.js'
import EventBus from "./eventBus.js"
import LayoutController, {setViewportSize} from './layoutController.js'
import { geneSearch } from './geneSearch.js'
import {registryForContainer} from "./browserRegistry.js"
import {setTrackReorderArrowColors} from "./trackPair.js"
import createWidgets from "./createWidgets.js"
import BrowserCoordinator from "./browserCoordinator.js"
import InteractionHandler from "./interactionHandler.js"
import DataLoader from "./dataLoader.js"
import {normalizeTrackConfigs} from "./normalizeSession.js"
import {unmappedUrl} from "./urlMapper.js"
import {isSynchable} from "./syncGroup.js"

const DEFAULT_PIXEL_SIZE = 1
const MAX_PIXEL_SIZE = 128

/**
 * Thrown when a published method is called on a browser that has been disposed.
 *
 * Named, and exported, because it is the one behavioural change in #493 a host
 * can observe: `dispose()` leaves a zombie the host may still hold -- juicebox-web
 * holds `browser` across several call sites -- and decision 6 of ADR-0005 is
 * that this fails visibly rather than drifting. An exception appears in the
 * host's console in development; a silent no-op appears as a blank panel in
 * production.
 */
class DisposedBrowserError extends Error {

    constructor(browserId, methodName) {
        super(`${browserId}.${methodName}() was called after dispose()`)
        this.name = 'DisposedBrowserError'
    }
}

class HICBrowser {

    /**
     * Set by `dispose()`, read by the guard on every published method. Private
     * so that "is this browser alive?" is not itself published surface -- a
     * host that wants to know is a host that has kept a zombie.
     */
    #disposed = false

    /**
     * The view in force -- chromosomes, zoom, bin origin, pixel size.
     *
     * Private, and that is the whole of #563's behaviour change: the field is
     * readable through `state` and its `activeState` alias, and **the field**
     * is written only by `setState`, the chokepoint. The setters that used to
     * stand beside those getters were commented "direct assignment bypasses
     * validation" and had no production caller (ADR-0009 fact 2); reading is
     * plausible host behaviour and stays, writing is not and goes (decision 7).
     *
     * The field, not the object. The getter hands back the live `State`, so
     * `browser.state.normalization = x` still writes canonical state from
     * outside -- and two production sites do exactly that, `createWidgets`'
     * `normalizationUnavailable` and `init`. `normalization` is not one of the
     * canonical six and `setView` does not take it; what it has instead is one
     * enforcer, `#resolveNormalization`. See `docs/state-manipulation.md`.
     */
    #state

    constructor(appContainer, config) {
        this.#construct(appContainer, config);
    }

    /**
     * Everything a browser is made of, in one method so that `reset()` can run
     * it a second time on the same instance. Decision 1 of ADR-0005: the
     * dispose-and-reconstruct happens *inside* the object, so a host reference
     * taken before a reset is still a live browser after it.
     *
     * The contract with `dispose()` is that this is the list it undoes. A field
     * installed here that outlives a `dispose()` is a leak; a field assigned
     * anywhere *else* survives a reconstruction, which is why
     * `customCrosshairsHandler` is named here even though its value is nothing.
     *
     * @param {string} [id] - the identity to build under. Only `reset()` passes
     *   one, and it passes the browser's existing id. Element ids are minted
     *   from it here, so a reconstruction that took a fresh guid and had it
     *   overwritten afterwards would leave the browser named differently from
     *   its own DOM.
     */
    #construct(appContainer, config, id = `browser_${DOMUtils.guid()}`) {

        // The back-pointer, per decision 9 of ADR-0004: `setCurrentBrowser` and
        // `deleteBrowser` are handed a browser and nothing else, so this is how
        // they find the registry to act on. Set here rather than by whoever
        // registers the browser, so it holds for a browser's whole life --
        // including during `init()`, which loads a dataset and so consults it.
        this.registry = registryForContainer(appContainer);

        // Read, not decided: everything below the entry seam takes the config as
        // `normalizeSession` resolved it. `figureMode` absorbed the legacy
        // `miniMode` spelling there in #536; this line used to be the `||` that
        // did it, and was the only reader that thought a mini map was a figure.
        this.config = config;
        this.figureMode = config.figureMode;
        this.resolutionLocked = false;
        this.eventBus = new EventBus();

        this.showTrackLabelAndGutter = true;

        this.id = id;
        this.trackPairs = [];
        this.tracks2D = [];
        this.normVectorFiles = [];

        // Stub for igv@3 compatibility — FeatureTrack rendering reads
        // browser.qtlSelections.hasPhenotype(). Juicebox doesn't do QTL.
        this.qtlSelections = { hasPhenotype: () => false, isEmpty: () => true };

        // Stub for igv@3 compatibility — SequenceTrack reads browser.nucleotideColors[base].
        this.nucleotideColors = {
            "A": "rgb(  0, 200,   0)", "a": "rgb(  0, 200,   0)",
            "C": "rgb(  0,   0, 200)", "c": "rgb(  0,   0, 200)",
            "T": "rgb(255,   0,   0)", "t": "rgb(255,   0,   0)",
            "G": "rgb(209, 113,   5)", "g": "rgb(209, 113,   5)",
            "N": "rgb( 80,  80,  80)", "n": "rgb( 80,  80,  80)",
        };

        // `config.synchable !== false` until #536, which is a default and so
        // belongs to the stage that defaults. The session-level `syncDatasets`
        // opt-out is resolved into this same field up there.
        this.synchable = config.synchable;
        this.synchedBrowsers = new Set();

        // The three fields `StateManager` used to hold, held plainly (#563,
        // ADR-0009 decisions 7 and 8). It was twelve methods, eight of them
        // field get/set re-wrapped by ten accessors here; the four that carried
        // behaviour left in #559 through #562, and what is left is a dataset, a
        // state and a control dataset.
        //
        // `dataset` and `controlDataset` are writable fields because they were
        // writable accessors; `#state` is private because the state is written
        // in exactly one place, `setState`, the chokepoint. Declared here rather
        // than only on first write so that `'state' in browser` is true from
        // construction -- the public surface test asserts presence, not value.
        this.dataset = undefined;
        this.controlDataset = undefined;
        this.#state = undefined;

        this.isMobile = hicUtils.isMobile();

        // Declared, not merely absent: `setCustomCrosshairsHandler` is the one
        // published method that installs a field outside this method, and the
        // handler it takes closes over the view a reconstruction throws away.
        this.customCrosshairsHandler = undefined;

        /**
         * Everything this browser installs *outside* `rootElement`'s subtree.
         *
         * Every delete path removes `rootElement` and nothing else, so a node
         * put anywhere else is a node nobody removes. `inputDialog` is the only
         * member today and was leaking one dialog per browser per session
         * restore; the record is the point rather than the dialog, so that a
         * field added to this constructor has one obvious place to add its
         * cleanup. Decision 4 of ADR-0005.
         */
        this.externalElements = [];

        this.rootElement = document.createElement('div');
        this.rootElement.className = 'hic-root unselect';
        appContainer.appendChild(this.rootElement);


        if (config.width && config.height) {
            setViewportSize(this.rootElement, config.width, config.height)
        }

        this.layoutController = new LayoutController(this, this.rootElement);

        // Into the host's container, not `rootElement`: a modal's stacking
        // context is why it lives out there. Recorded on the way in.
        this.inputDialog = new InputDialog(appContainer, this);
        this.externalElements.push(this.inputDialog.container);

        this.menuElement = this.createMenu(this.rootElement);
        this.menuElement.style.display = 'none';

        // The coordinator is built first: the widgets' observer closures notify it
        // directly, so it must exist before createWidgets() runs.
        this.coordinator = new BrowserCoordinator(this);
        const widgets = createWidgets(this);
        this.coordinator.adoptWidgets(widgets);
        this.contactMatrixView = widgets.contactMatrixView;

        // Initialize interaction handler for user interactions
        this.interactions = new InteractionHandler(this);

        // Initialize data loader for data loading operations
        this.dataLoader = new DataLoader(this);

        // Re-entrancy guard for update(). Rapid callers (mouse drag) coalesce into
        // a single trailing update rather than queuing one per event.
        this.updating = false;
        this.pendingUpdate = undefined;

        // prevent user interaction during lengthy data loads
        this.userInteractionShield = document.createElement('div');
        this.userInteractionShield.className = 'hic-root-prevent-interaction';
        this.rootElement.appendChild(this.userInteractionShield);
        this.userInteractionShield.style.display = 'none';

        this.hideCrosshairs();
    }

    async init(config) {
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

            // No `if (config.cycle) config.displayMode = "A"` here since #536:
            // writing one config field from another is the normalize stage's,
            // and this one wrote it onto the host's own object mid-init.
            if (config.displayMode) {
                this.contactMatrixView.displayMode = config.displayMode;
                this.coordinator.onDisplayMode(config.displayMode);
            }

            if (config.colorScale) {
                if (config.normalization) {
                    this.state.normalization = config.normalization;
                }
                this.contactMatrixView.setColorScale(config.colorScale);
                this.coordinator.onColorScale(this.contactMatrixView.getColorScale());
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

            // The one config field still checked below the seam, and it stays
            // here on purpose: the set it is checked against is the loaded
            // dataset's, so the question cannot be asked before the load. It
            // falls back to `NONE` rather than rejecting -- a saved link naming
            // a normalization this map does not carry still opens. Recorded in
            // CONTEXT.md as a load-stage rule, not part of the resolved schema.
            //
            // The rule itself lives in `#resolveNormalization` and
            // is spelled out once (#561, ADR-0009 decision 5). It used to be
            // written out a second time here, as its own `Set` and its own
            // fallback, and this copy ran *after* restore -- so of the two
            // enforcers the duplicate was the one that won. What stays here is
            // the question, not the answer: which field is being asked about,
            // and when.
            if (config.normalization) {
                this.state.normalization = await this.#resolveNormalization(config.normalization);
            }

            if (config.cycle) {
                this.coordinator.widgets.controlMapWidget.toggleDisplayModeCycle();
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
        this.coordinator.onDisplayMode(mode)
    }

    getDisplayMode() {
        return this.contactMatrixView ? this.contactMatrixView.displayMode : undefined
    }

    async getNormalizationOptions() {

        if (!this.dataset) return []

        const baseOptions = this.dataset.getNormalizationOptions ?
            await this.dataset.getNormalizationOptions() : ['NONE'];
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
        return this.contactMatrixView?.getColorScale()
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
        this.#assertNotDisposed('setCustomCrosshairsHandler')
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
     * A track's own entry, and so the one place a track config that was never
     * part of a session is resolved: `normalizeTrackConfigs` is the same stage a
     * session's tracks meet, so a shortcut URL expands and the document defaults
     * apply whichever direction a track arrives from (#536). Tracks that *were*
     * part of a session reach `DataLoader.loadTracks` from `init()` below,
     * already resolved and not through here.
     *
     * @param configs
     */
    async loadTracks(configs) {
        this.#assertNotDisposed('loadTracks');
        return this.dataLoader.loadTracks(normalizeTrackConfigs(configs));
    }

    async loadNormalizationFile(url) {
        return this.dataLoader.loadNormalizationFile(url);
    }

    /**
     * Set the primary dataset. The dataset only: a state reaches the browser
     * through `setState`, the chokepoint, and never alongside the dataset
     * (#559, ADR-0009 decision 1).
     *
     * @param {Dataset} dataset - The dataset to activate
     */
    setActiveDataset(dataset) {
        this.dataset = dataset;
    }

    /**
     * The primary dataset -- the "A" map, as opposed to `controlDataset` -- and
     * the view in force.
     *
     * `dataset`/`state` is the vocabulary internal code reads; `activeDataset`
     * and `activeState` below are aliases for it. See #468.
     *
     * Both dataset names are load-bearing outside this repo: juicebox-web reads
     * `dataset` (3 sites) and so does Spacewalk (`juicebox/hicMapState.js`),
     * while Spacewalk reads `activeDataset` from `juicebox/juiceboxPanel.js`.
     * Neither name can simply win.
     *
     * `dataset` and `controlDataset` are plain fields, assigned in the
     * constructor (#563). Only `state` keeps an accessor, and only a getter:
     * the state has one writer, `setState`.
     */
    get state() {
        return this.#state;
    }

    /** Alias for `dataset`. Retained for host apps -- Spacewalk reads it (juicebox/juiceboxPanel.js, 4 sites). */
    get activeDataset() {
        return this.dataset;
    }

    /** Alias for `dataset`. Retained for host apps -- Spacewalk reads it (juicebox/juiceboxPanel.js, 4 sites). */
    set activeDataset(value) {
        this.dataset = value;
    }

    /**
     * Alias for `state`. Kept as published surface alongside `activeDataset`:
     * no host we can measure reads it, and this repo cannot see the ones it
     * cannot measure -- ADR-0003's "no measurable consumer is not no consumer",
     * which is why the getters survived #563 and only the setters went.
     */
    get activeState() {
        return this.state;
    }

    /**
     * Tear this browser down: the counterpart of the constructor.
     *
     * NOTE: public API function
     *
     * The single teardown path -- `registry.delete()` and `registry.deleteAll()`
     * both come here, which is what makes the four verbs of ADR-0005's context
     * table agree. It removes what the constructor installed, in both places it
     * installed it, gives up the browser's peers and its registry slot, and
     * clears the bus the browser owns.
     *
     * It deliberately does *not* touch `EventBus.globalBus`: those
     * registrations belong to the host and outlive every browser on the page.
     *
     * Idempotent, and the only method still callable afterwards -- a host that
     * tears down twice is doing the right thing twice.
     */
    dispose() {

        if (this.#disposed) {
            return;
        }

        this.#disposed = true;

        this.unsyncSelf();

        // The outbound half of the same edge, and only on this path: membership
        // is a pair of references, and a host keeps its browser across call
        // sites (juicebox-web holds one from `getCurrentBrowser()`), so a zombie
        // still holding its old peers pins every live browser's object graph.
        // `clearDataset()` deliberately does not do this -- that browser is
        // still on the page and gets re-paired by `registry.sync()`. #492.
        this.synchedBrowsers = new Set();

        for (const element of this.externalElements) {
            element.remove();
        }
        this.externalElements = [];

        // The other thing installed outside `rootElement`: the contact matrix
        // view's document-level gesture handlers, which removing an element
        // cannot take with it. #494.
        this.contactMatrixView.dispose();

        this.rootElement.remove();

        // The per-browser bus dies with the browser, so clearing it is what
        // releases the host handlers still attached to it -- Spacewalk's
        // DidHideCrosshairs subscription is a live retention path today.
        this.eventBus.clear();

        this.registry.releaseSlot(this);
    }

    /**
     * Refuse a published call on a disposed browser. Decision 6 of ADR-0005.
     */
    #assertNotDisposed(methodName) {
        if (this.#disposed) {
            throw new DisposedBrowserError(this.id, methodName);
        }
    }

    /**
     * Put this browser back to how it was constructed, without becoming a
     * different browser.
     *
     * NOTE: public API function
     *
     * Dispose-then-construct on the same instance, per decision 1 of ADR-0005.
     * The object, its `id` and its registry slot survive, because juicebox-web
     * does
     *
     *     const browser = hic.getCurrentBrowser()
     *     browser.reset();
     *     await browser.loadHicFile(config);
     *     controlMapDropdown.enableIfMapLoaded(browser)
     *
     * -- one reference held across three lines and then handed onward. That is
     * what makes this non-breaking; returning a new browser would not be.
     *
     * `dispose()` is the teardown half, so this cannot drift from the delete
     * paths. What is restored afterwards is the three things `dispose()` gives
     * up that a *reset* browser has not actually lost: its place among its
     * siblings, its registry slot, and being the current browser.
     *
     * The sync group is not restored: `reset()` has always unsynced, and the
     * registry re-pairs on the next `sync()`.
     */
    reset() {

        this.#assertNotDisposed('reset')

        const {config, id, registry} = this
        const appContainer = this.rootElement.parentElement
        const slot = registry.browsers.indexOf(this)
        const wasCurrent = registry.currentBrowser === this

        // The node to re-insert before, and it has to be one that survives the
        // teardown: `rootElement`'s immediate sibling is this browser's own
        // dialog, which `dispose()` removes. Skipping this browser's external
        // elements lands on the next browser's root, or on nothing.
        // Only `rootElement` is placed: the dialog beside it is a modal, and
        // where it sits among its siblings is not something anyone can see.
        const mine = new Set(this.externalElements)
        let anchor = this.rootElement.nextSibling
        while (anchor && mine.has(anchor)) {
            anchor = anchor.nextSibling
        }

        // Deselected first, and for the same reason `deleteAll` does it:
        // `releaseSlot` falls the selection through to a survivor, so disposing
        // the current browser posts a `BrowserSelect` naming a sibling -- and
        // juicebox-web subscribes to that event. A reset does not change which
        // browser is selected, so it should post nothing at all.
        if (wasCurrent) {
            registry.select(undefined)
        }

        this.dispose()

        // The one place this flag is cleared. A reset browser is alive again,
        // and the guard on every published method has to see that.
        this.#disposed = false

        this.#construct(appContainer, config, id)

        // Reconstruction appends, so the panels of a two-panel embed would
        // visibly swap without this. Decision 3.
        appContainer.insertBefore(this.rootElement, anchor)

        // Not registered before the reset -- during `init()`, or in a test --
        // so there is no slot to take back and nothing to select.
        if (-1 !== slot) {
            registry.reclaimSlot(this, slot, wasCurrent)
        }
    }

    /**
     * The soft clear a dataset load runs on its way in: the browser and its DOM
     * stay, only the data goes. Internal only -- not on the public API manifest.
     */
    clearDataset() {
        // Clear current datasets. The state goes with them: a browser with no
        // dataset has no view, and `setState` is the only way one comes back.
        this.dataset = undefined;
        this.#state = undefined;
        this.controlDataset = undefined;
        this.setDisplayMode('A')
        this.unsyncSelf()
    }

    /**
     * Remove reference to self from all synchedBrowsers lists.
     */
    unsyncSelf() {
        for (let b of this.registry.browsers) {
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
        this.#assertNotDisposed('loadHicFile');
        return this.dataLoader.loadHicFile(config, noUpdates);
    }

    /**
     * Load a live contact map via hic-straw LiveContactMap.
     *
     * NOTE: public API function
     *
     * @param {Object} config - Configuration with liveContactMap, name, locus, state
     * @param {boolean} noUpdates - If true, don't trigger UI updates
     * @returns {Promise<HiCDataset>}
     */
    async loadLiveContactMap(config, noUpdates) {
        this.#assertNotDisposed('loadLiveContactMap');
        return this.dataLoader.loadLiveContactMap(config, noUpdates);
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
        this.#assertNotDisposed('loadHicControlFile');
        return this.dataLoader.loadHicControlFile(config, noUpdates);
    }

    async parseGotoInput(input) {
        this.#assertNotDisposed('parseGotoInput');
        return this.interactions.parseGotoInput(input);
    }

    parseLocusString(locus) {
        return this.interactions.parseLocusString(locus);
    }

    async lookupFeatureOrGene(name) {

        const trimmedName = name.trim();
        const upperName = trimmedName.toUpperCase();

        if (this.genome.featureDB.has(upperName)) {
            this.registry.selectedGene = trimmedName
            this.state.selectedGene = trimmedName
            const {chr, start, end } = this.genome.featureDB.get(upperName)

            // Internally, loci are 0-based. parseLocusString() assumes and user-provided locus which is 1-based
            return this.parseLocusString(`${chr}:${start + 1}-${end}`)
        }

        const geneResult = await geneSearch(this.genome.id, trimmedName);
        if (geneResult) {
            this.registry.selectedGene = trimmedName;
            this.state.selectedGene = trimmedName;
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
     *
     * It does **not** clamp. The `clampXY` call that stood here was the clamp's
     * second enforcer, and `updateLayout` runs only when tracks change — so a
     * restored session carrying a track was clamped incidentally and a bare map
     * restore never was, and the same saved session opened two ways depending on
     * whether it had a track. Restore goes through the chokepoint now, which
     * clamps every time; this call would only be able to disagree with it.
     * #558, ADR-0009 decision 4.
     *
     * @returns {Promise<void>}
     */
    async updateLayout() {

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
     * Restore a saved view. **The chokepoint, and a translator like every other
     * mutation path** (#558, ADR-0009 decisions 2 and 4).
     *
     * This is the one writer of the state field. It used to be two methods --
     * this one, and `StateManager.setState` behind it -- and #563 folded them
     * together: the manager was a wrapper re-wrapped by ten accessors here, and
     * once the behaviour left there was nothing on the far side of the
     * delegation but the field itself.
     *
     * The six canonical fields arrive off the incoming state and are handed to
     * `State.setView`. Restore used to clone and apply a bare
     * `Math.max(pixelSize, minPixelSize)` floor of its own, which meant a saved
     * view skipped the `MAX_PIXEL_SIZE` cap and the x/y clamp that every gesture
     * path gets. It no longer does.
     *
     * **A restored state is clamped silently, never rejected.** That is the same
     * rule the normalize stage one seam over follows (ADR-0006, #466): defaults
     * and coerces, never refuses. The cost is deliberate and is in the release
     * notes -- a saved view at `pixelSize=1e9`, or with an origin past the end of
     * the chromosome, now opens somewhere different. Rejecting instead would
     * turn a link that renders something into a link that renders nothing.
     *
     * The clone is what is mutated, so the caller's state object is left alone:
     * `dataLoader` hands the same instance to `coordinator.onMapLoaded`.
     *
     * The dataset must already be installed -- `clampXY` reads its chromosome
     * table and resolution ladder. All three production callers set it first,
     * one line earlier; #559 makes that ordering explicit at the call sites.
     *
     * `resolutionChanged` is computed against the state going out of force, the
     * same comparison `chrChanged` beside it makes, and for the same reason
     * (#560, ADR-0009 decision 3). It used to be `true` unconditionally, so
     * every restore announced a resolution change whether or not the resolution
     * moved. What that announcement costs is the resolution lock: the
     * coordinator releases it whenever the flag is set
     * (`browserCoordinator.onLocusChange`), and it is handed on to external
     * `onLocusChange` callbacks as contract. The repaint itself is not at stake
     * -- `update()` runs on every restore, flag or no.
     *
     * The seventh field, `normalization`, is settled after `setView` rather than
     * through it (#561, ADR-0009 decision 5): it is not one of the canonical six
     * and it is validated against the dataset rather than against the view. See
     * `#resolveNormalization` for why restore is the only place the question
     * can be asked.
     *
     * Locus is not cached -- consumers derive it via state.getLocus().
     *
     * @param state  browser state
     */
    async setState(state) {

        // Both flags are asked of the state going out of force, in its own
        // vocabulary: `_detectChromosomeChange` and `_detectResolutionChange`
        // are the predicates `setView` itself uses, so the answer here and the
        // answer on every gesture path cannot drift apart. No state in force is
        // a change on both counts -- there is nothing to have been unchanged
        // from, and `clearDataset()` nulls the state at the top of every load,
        // so the first restore of a load lands there.
        const chrChanged = !this.#state ||
            this.#state._detectChromosomeChange(state.chr1, state.chr2);

        const resolutionChanged = !this.#state ||
            this.#state._detectResolutionChange(state.zoom);

        const restored = state.clone();

        // `setView`'s return is deliberately discarded. It runs on the clone,
        // which already holds the incoming chromosomes and the incoming zoom, so
        // its `chrChanged` and its `resolutionChanged` are both always false --
        // the comparisons that mean anything are against the outgoing value of
        // the state field, which are the ones computed above.
        //
        // The clone carries the incoming chr1/chr2 before `setView` runs, so
        // `_adjustPixelSize` consults `minPixelSize` with the same arguments the
        // hand-rolled floor above it used to.
        await restored.setView(
            state.chr1, state.chr2, state.x, state.y, state.zoom, state.pixelSize,
            this,
            this.dataset,
            this.contactMatrixView.getViewDimensions()
        );

        restored.normalization = await this.#resolveNormalization(restored.normalization);

        this.#state = restored;

        const eventData = {
            state: this.state,
            resolutionChanged,
            chrChanged
        };
        await this.update();
        this.coordinator.onLocusChange(eventData);
    }

    /**
     * The normalization a restored state can actually be rendered with (#561,
     * ADR-0009 decision 5).
     *
     * **Restore is the first moment this question can be asked, and the last
     * moment it can be asked cheaply.** The set of valid normalizations does not
     * exist until a dataset is loaded -- which is why candidate 9 found
     * `config.normalization` to be one of exactly three fields the normalize
     * stage provably cannot resolve, and left it alone. Downstream of here the
     * answer is still knowable but no longer actionable: `imageTileSource`
     * discovers the missing vector per tile, mid-render, and draws `NONE`
     * without the canonical state ever admitting it changed. So the state that
     * comes out of the chokepoint names a normalization the dataset has, and the
     * render path stops being where the substitution silently happens.
     *
     * It is the same invariant as the clamp, at the same moment, and it follows
     * the same rule: **coerce, never reject.** A saved link naming a
     * normalization this map does not carry still opens, on `NONE` -- the
     * fallback every `.hic` file offers. Refusing would turn a link that renders
     * something into a link that renders nothing.
     *
     * **This is validation only.** #372 -- "a normalization that is not
     * available renders without one and the user is not told" -- narrows to its
     * notification half and stays open; no error surface belongs here.
     *
     * `NONE` short-circuits, and not merely as an optimization: on a real
     * `.hic` file `getNormalizationOptions` reads the normalization vector index
     * off the wire, so asking would put a network read on every restore to buy
     * an answer that is already known. A state with no normalization at all is
     * `NONE` for the same reason `State`'s constructor defaults it there.
     *
     * A dataset that cannot answer is not a licence to skip the check:
     * `getNormalizationOptions` already answers `['NONE']` for a dataset without
     * the method, and that is a sincere answer -- such a dataset offers nothing
     * else. The one case that genuinely cannot be asked is no dataset at all,
     * and the requested value stands there rather than being coerced against a
     * set that was never consulted.
     *
     * It has two callers, not one: `init` resolves a top-level
     * `config.normalization` here too. That field is not part of any saved state
     * -- it is a config field a host sets alongside a map -- so it cannot arrive
     * through `setState`, but it is the same question against the same set, and
     * candidate 6's premise is that an invariant has one enforcer or none.
     *
     * Private, because both callers are inside this class and `js/publicApi.js`
     * is the manifest of what a host may reach. It was public on `StateManager`,
     * which was not published surface at all; landing it on `HICBrowser`
     * unmarked would have made it contract by accident, which ADR-0003's
     * "absence is not permission" is precisely about.
     *
     * @param {string|undefined} requested - The normalization asked for
     * @returns {Promise<string>} - A normalization the loaded dataset offers
     */
    async #resolveNormalization(requested) {

        if (undefined === requested || 'NONE' === requested) {
            return 'NONE';
        }

        if (!this.dataset) {
            return requested;
        }

        const available = await this.getNormalizationOptions();

        if (available.includes(requested)) {
            return requested;
        }

        // The fallback is read out of the offered set rather than assumed to be
        // `NONE`. Every `.hic` file seeds its normalization list with `NONE`, so
        // on a single map the two are the same answer -- but with a control map
        // loaded this set is an *intersection* of two files' lists, and an
        // intersection is an expression rather than a guarantee. Where it does
        // hold `NONE`, or where it is empty and there is nothing to name, `NONE`
        // is both the answer and what the render path would have drawn anyway.
        if (0 === available.length || available.includes('NONE')) {
            return 'NONE';
        }

        return available[0];
    }

    /**
     * Return a modified state object used for synching.  Other datasets might have different chromosome ordering
     * and resolution arrays.
     *
     * The projection itself is `State.getSyncState(dataset)`; what is here is
     * the "is there anything to publish yet" question, which is about the
     * browser rather than about the view.
     */
    getSyncState() {
        if (!this.dataset || !this.state) {
            return undefined;
        }
        return this.state.getSyncState(this.dataset);
    }

    /**
     * Take a sync state published by a sibling browser.
     *
     * The guard is `isSynchable` from `syncGroup.js` -- the same expression
     * `pairSynchable` and `canBeSynched` read, so #562 left the `synchable`
     * rule written down once. The guard itself stays here rather than being
     * left to the callers: `syncToOtherBrowsers` walks `synchedBrowsers`, a set
     * `registry.sync()` last rebuilt, so a browser whose host flipped
     * `synchable` since then is still in it. That was master's behaviour and
     * the ticket does not change what syncing does.
     */
    async syncState(targetState) {
        if (!targetState || !isSynchable(this) || !this.state) {
            return;
        }

        const { zoomChanged, chrChanged } = await this.state.sync(targetState, this, this.genome, this.dataset);

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
        this.coordinator.onLocusChange(eventData);
    }

    setNormalization(normalization) {
        if (this.#state) {
            this.#state.normalization = normalization;
        }
        this.coordinator.onNormalizationChange(this.#state?.normalization);
    }

    async shiftPixels(dx, dy) {
        await this.interactions.shiftPixels(dx, dy);
    }

    /**
     * Pure rendering method - repaints all visual components.
     * Reads state directly from browser state, no parameters needed.
     * This is the core rendering logic, separate from the update coordination
     * (spinner, re-entrancy, sync) in update().
     */
    async repaint() {

        if (!this.dataset || !this.state) {
            return; // Can't render without dataset and state
        }

        const pseudoEvent = {
            type: "LocusChange",
            data: { state: this.state }
        };
        this.layoutController.xAxisRuler.locusChange(pseudoEvent);
        this.layoutController.yAxisRuler.locusChange(pseudoEvent);

        // Render all tracks and contact matrix in parallel
        const promises = this.trackPairs.map(xy => xy.updateViews());
        promises.push(this.contactMatrixView.update());
        await Promise.all(promises);
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
     *
     * Handles queuing for rapid calls (e.g. during a mouse drag). A call arriving
     * while an update is in flight is remembered rather than run, and only the most
     * recent one runs when the in-flight update finishes.
     *
     * One spinner start/stop pair per call, and nothing inside repaint() starts
     * another. A trailing update is awaited inside the finally, before the outer
     * stop, so its pair nests within the outer one and the shared count never
     * reaches zero mid-drag -- the spinner goes up once and comes down once.
     *
     * @param shouldSync - Whether to synchronize state to other browsers (default: true)
     *                     Set to false when called from syncState() to avoid infinite loops
     */
    async update(shouldSync = true) {

        if (this.updating) {
            this.pendingUpdate = { shouldSync };
            return;
        }

        this.updating = true;
        try {
            this.startSpinner();
            await this.repaint();
            if (shouldSync) {
                this.syncToOtherBrowsers();
            }
        } finally {
            this.updating = false;
            const queued = this.pendingUpdate;
            if (queued) {
                this.pendingUpdate = undefined;
                await this.update(queued.shouldSync);
            }
            this.stopSpinner();
        }
    }

    repaintMatrix() {
        this.contactMatrixView.clearImageCaches()
        this.contactMatrixView.update()
    }

    resolution() {
        return this.dataset.bpResolutions[this.state.zoom]
    };

    /**
     * Serialize this browser as a session entry, or `null` when it has no map.
     *
     * A browser with no dataset names nothing a session can restore, and `null`
     * is what says so to the registry, which drops it. It used to be the string
     * `"{}"`, which was neither a browser nor distinguishable from one: the
     * defaults pass on restore assigned properties to a string primitive and
     * the whole session failed to reload. ADR-0006 decision 6, #500.
     */
    toJSON() {

        if (!(this.dataset && this.dataset.url)) return null   // URL is required

        const jsonOBJ = {}

        jsonOBJ.backgroundColor = this.contactMatrixView.stringifyBackgroundColor()
        jsonOBJ.url = this.dataset.url
        if (this.dataset.name) {
            jsonOBJ.name = this.dataset.name
        }

        jsonOBJ.state = this.state.toJSON()

        jsonOBJ.colorScale = this.contactMatrixView.getColorScale().stringify()
        if (this.registry.selectedGene) {
            jsonOBJ.selectedGene = this.registry.selectedGene
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
            const controlMapWidget = this.coordinator.widgets.controlMapWidget;
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

                // The original URL, not the one igv was given: with a dev proxy registered those
                // differ, and a session must never carry a dev-server path. See issue #450.
                const url = unmappedUrl(config)

                if (typeof url === "string") {

                    const t = {url}

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

        if (!this.dataset) {
            throw new Error("Dataset not available for minZoom calculation");
        }

        const chromosome1 = this.dataset.chromosomes[chr1]
        const chromosome2 = this.dataset.chromosomes[chr2]

        if (!chromosome1 || !chromosome2) {
            throw new Error(`Invalid chromosome indices: ${chr1}, ${chr2}`);
        }

        const { width, height } = this.contactMatrixView.getViewDimensions()
        const binSize = Math.max(chromosome1.size / width, chromosome2.size / height)

        const matrix = await this.dataset.getMatrix(chr1, chr2)
        if (!matrix) {
            throw new Error(`Data not avaiable for chromosomes ${chromosome1.name} - ${chromosome2.name}`)
        }
        return matrix.findZoomForResolution(binSize)
    }

    async minPixelSize(chr1, chr2, zoomIndex) {

        if (!this.dataset) {
            // If dataset not yet set, return default minimum
            return DEFAULT_PIXEL_SIZE;
        }

        // bp
        if (!this.dataset.chromosomes || !this.dataset.chromosomes[chr1] || !this.dataset.chromosomes[chr2]) {
            console.warn(`Invalid chromosome indices or chromosomes array not initialized: ${chr1}, ${chr2}`);
            return DEFAULT_PIXEL_SIZE;
        }

        const chr1Length = this.dataset.chromosomes[chr1].size
        const chr2Length = this.dataset.chromosomes[chr2].size

        const matrix = await this.dataset.getMatrix(chr1, chr2)
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
                const binSize = this.dataset.bpResolutions[zoomIndex] || this.dataset.bpResolutions[0] || 1000;
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

export { MAX_PIXEL_SIZE, DEFAULT_PIXEL_SIZE, DisposedBrowserError }
export default HICBrowser

