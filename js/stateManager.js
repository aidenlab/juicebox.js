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

/**
 * StateManager handles all state management responsibilities for HICBrowser.
 * Extracted from HICBrowser to separate state management concerns.
 * 
 * This class manages:
 * - Active dataset and state
 * - State transitions and validation
 * - Cross-browser synchronization state
 * - State normalization and pixel size adjustments
 */
class StateManager {

    /**
     * @param {HICBrowser} browser - The browser instance this manager serves
     */
    constructor(browser) {
        this.browser = browser;
        
        // State properties
        this.activeDataset = undefined;
        this.activeState = undefined;
        this.controlDataset = undefined;
    }

    /**
     * Install the active dataset. **The dataset and nothing else** -- state
     * arrives only through `setState`, the chokepoint (#559, ADR-0009
     * decision 1).
     *
     * This took a second `state` parameter until #559, and assigned it to
     * `this.activeState` with no validation at all, from five `dataLoader` call
     * sites. That was the live bypass of the mutation invariant -- not the
     * `browser.state = x` setters the review card names, which have no
     * production callers -- and it carried no warning comment while running on
     * every load.
     *
     * Routing the assignment through the chokepoint *inside* this setter was
     * the rejected alternative: it hides a chokepoint call in a method named
     * for something else, which is how the door was built the first time.
     * Dropping the parameter makes the ordering explicit at each call site --
     * install the dataset, then hand the state to `setState`, which needs the
     * dataset already in place because `clampXY` reads its chromosome table.
     *
     * @param {Dataset} dataset - The dataset to set as active
     */
    setActiveDataset(dataset) {
        this.activeDataset = dataset;
    }

    /**
     * Get the active dataset.
     * 
     * @returns {Dataset|undefined} - The active dataset
     */
    getActiveDataset() {
        return this.activeDataset;
    }

    /**
     * Get the active state.
     * 
     * @returns {State|undefined} - The active state
     */
    getActiveState() {
        return this.activeState;
    }

    /**
     * Restore a saved view. **A translator, like every other mutation path**
     * (#558, ADR-0009 decisions 2 and 4).
     *
     * The six canonical fields arrive off the incoming state and are handed to
     * `State.setView`, the one chokepoint. Restore used to clone and apply a
     * bare `Math.max(pixelSize, minPixelSize)` floor of its own, which meant a
     * saved view skipped the `MAX_PIXEL_SIZE` cap and the x/y clamp that every
     * gesture path gets. It no longer does.
     *
     * **A restored state is clamped silently, never rejected.** That is the same
     * rule the normalize stage one seam over follows (ADR-0006, #466): defaults
     * and coerces, never refuses. The cost is deliberate and is in the release
     * notes — a saved view at `pixelSize=1e9`, or with an origin past the end of
     * the chromosome, now opens somewhere different. Rejecting instead would
     * turn a link that renders something into a link that renders nothing.
     *
     * The clone is what is mutated, so the caller's state object is left alone:
     * `dataLoader` hands the same instance to `coordinator.onMapLoaded`.
     *
     * The dataset must already be installed — `clampXY` reads its chromosome
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
     * — `hicBrowser.setState` calls `update()` on every restore, flag or no.
     *
     * The seventh field, `normalization`, is settled after `setView` rather than
     * through it (#561, ADR-0009 decision 5): it is not one of the canonical six
     * and it is validated against the dataset rather than against the view. See
     * `resolveNormalization` for why restore is the only place the question can
     * be asked.
     *
     * Locus is not cached — consumers derive it via state.getLocus().
     */
    async setState(state) {
        // Both flags are asked of the state going out of force, in its own
        // vocabulary: `_detectChromosomeChange` and `_detectResolutionChange`
        // are the predicates `setView` itself uses, so the answer here and the
        // answer on every gesture path cannot drift apart. No state in force is
        // a change on both counts — there is nothing to have been unchanged
        // from, and `clearDataset()` nulls the state at the top of every load,
        // so the first restore of a load lands there.
        const chrChanged = !this.activeState ||
            this.activeState._detectChromosomeChange(state.chr1, state.chr2);

        const resolutionChanged = !this.activeState ||
            this.activeState._detectResolutionChange(state.zoom);

        const restored = state.clone();

        // `setView`'s return is deliberately discarded. It runs on the clone,
        // which already holds the incoming chromosomes and the incoming zoom, so
        // its `chrChanged` and its `resolutionChanged` are both always false —
        // the comparisons that mean anything are against the outgoing value of
        // `this.activeState`, which are the ones computed above.
        //
        // The clone carries the incoming chr1/chr2 before `setView` runs, so
        // `_adjustPixelSize` consults `browser.minPixelSize` with the same
        // arguments the hand-rolled floor above it used to.
        await restored.setView(
            state.chr1, state.chr2, state.x, state.y, state.zoom, state.pixelSize,
            this.browser,
            this.activeDataset,
            this.browser.contactMatrixView.getViewDimensions()
        );

        restored.normalization = await this.resolveNormalization(restored.normalization);

        this.activeState = restored;

        return {
            chrChanged,
            resolutionChanged
        };
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
     * `browser.getNormalizationOptions` already answers `['NONE']` for a dataset
     * without the method, and that is a sincere answer -- such a dataset offers
     * nothing else. The one case that genuinely cannot be asked is no dataset at
     * all, and the requested value stands there rather than being coerced
     * against a set that was never consulted.
     *
     * Public rather than private because it is **the** enforcer, and the load
     * stage has a second thing to ask it: `hicBrowser.init` resolves a
     * top-level `config.normalization` here too. That field is not part of any
     * saved state -- it is a config field a host sets alongside a map -- so it
     * cannot arrive through `setState`, but it is the same question against the
     * same set, and candidate 6's premise is that an invariant has one enforcer
     * or none.
     *
     * @param {string|undefined} requested - The normalization asked for
     * @returns {Promise<string>} - A normalization the loaded dataset offers
     */
    async resolveNormalization(requested) {

        if (undefined === requested || 'NONE' === requested) {
            return 'NONE';
        }

        if (!this.activeDataset) {
            return requested;
        }

        const available = await this.browser.getNormalizationOptions();

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
     * Set the control dataset (for A/B comparisons).
     * 
     * @param {Dataset} dataset - The control dataset
     */
    setControlDataset(dataset) {
        this.controlDataset = dataset;
    }

    /**
     * Get the control dataset.
     * 
     * @returns {Dataset|undefined} - The control dataset
     */
    getControlDataset() {
        return this.controlDataset;
    }

    /**
     * Clear all state (dataset and state).
     */
    clearState() {
        this.activeDataset = undefined;
        this.activeState = undefined;
        this.controlDataset = undefined;
    }

    /**
     * Return a modified state object used for synching.
     * Other datasets might have different chromosome ordering and resolution arrays.
     * 
     * @returns {Object} - Sync state object with chromosome names and bin coordinates
     */
    getSyncState() {
        if (!this.activeDataset || !this.activeState) {
            return undefined;
        }

        return {
            chr1Name: this.activeDataset.chromosomes[this.activeState.chr1].name,
            chr2Name: this.activeDataset.chromosomes[this.activeState.chr2].name,
            binSize: this.activeDataset.bpResolutions[this.activeState.zoom],
            binX: this.activeState.x,
            binY: this.activeState.y,
            pixelSize: this.activeState.pixelSize
        };
    }

    /**
     * Return true if this browser can be synced to the given state.
     * 
     * @param {Object} syncState - The sync state to check compatibility with
     * @returns {boolean} - True if browser can sync to the given state
     */
    canBeSynched(syncState) {
        if (false === this.browser.synchable) {
            return false; // Explicitly not synchable
        }

        if (!this.activeDataset) {
            return false;
        }

        return (
            this.activeDataset.getChrIndexFromName(syncState.chr1Name) !== undefined &&
            this.activeDataset.getChrIndexFromName(syncState.chr2Name) !== undefined
        );
    }

    /**
     * Sync this browser's state to match a target sync state.
     * This method updates the state to match another browser's state for synchronization.
     * 
     * @param {Object} targetState - The target sync state to sync to
     * @returns {Promise<{zoomChanged: boolean, chrChanged: boolean}>} - Change flags
     */
    async syncState(targetState) {
        if (!targetState || false === this.browser.synchable) {
            return { zoomChanged: false, chrChanged: false };
        }

        if (!this.activeDataset || !this.activeState) {
            return { zoomChanged: false, chrChanged: false };
        }

        const { zoomChanged, chrChanged } = await this.activeState.sync(
            targetState, 
            this.browser, 
            this.browser.genome, 
            this.activeDataset
        );

        return { zoomChanged, chrChanged };
    }

    /**
     * Set normalization on the active state.
     * 
     * @param {string} normalization - The normalization type
     */
    setNormalization(normalization) {
        if (this.activeState) {
            this.activeState.normalization = normalization;
        }
    }

    /**
     * Get normalization from the active state.
     * 
     * @returns {string|undefined} - The normalization type
     */
    getNormalization() {
        return this.activeState ? this.activeState.normalization : undefined;
    }
}

export default StateManager;

