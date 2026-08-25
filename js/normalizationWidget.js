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
 * The three reasons a normalization substitution happens, as the user reads
 * them.
 *
 * Three literals rather than three code paths (ADR-0012): the substitution is
 * one event, but the user's remedy is not. A vector the file does not carry at
 * all leaves nothing to do; a vector both maps carry whose *intersection* drops
 * it comes back when the control map is unloaded; a vector missing only at this
 * chromosome and resolution comes back on a pan or a zoom. A marker that said
 * the same sentence in all three cases would be the `title`-only surface
 * ADR-0012 rejected, wearing an icon.
 *
 * `requested` is what was asked for, `effective` what is actually being drawn.
 * Both are named, because "KR is unavailable" does not say what you are looking
 * at instead.
 */
const substitutionReason = {

    notInFile: (requested, effective) =>
        `${requested} normalization is not available in this map. Showing ${effective}.`,

    notInBothMaps: (requested, effective) =>
        `${requested} normalization is not available in both maps. Showing ${effective}. Unload the control map to use it.`,

    notAtThisView: (requested, effective) =>
        `${requested} normalization is not available at this chromosome and resolution. Showing ${effective}. Pan or zoom to a view that has it.`
}

/** The container's title when nothing has been substituted. */
const NO_SUBSTITUTION_TITLE = 'Normalization'

/**
 * The part of a view a substitution's reason is about: which chromosome pair,
 * at which resolution. Not the whole state -- x and y are deliberately absent,
 * because a pan cannot make any of the three reasons false.
 */
const viewScope = ({chr1, chr2, zoom}) => ({chr1, chr2, zoom})

const sameScope = (a, b) => a.chr1 === b.chr1 && a.chr2 === b.chr2 && a.zoom === b.zoom

/**
 * Created by dat on 3/21/17.
 *
 * Also the surface on which a *substitution* is announced (#372, ADR-0012): a
 * marker beside the selector plus the reason in the container's `title`. The
 * reason is transient and lives only here -- it is not an eighth canonical
 * state field, and it is cleared by any of the three things that can make it
 * false.
 */
class NormalizationWidget {

    constructor(browser, hicNavBarContainer) {
        this.browser = browser;

        const parent = hicNavBarContainer.querySelector("div[id$='lower-hic-nav-bar-widget-container']");

        this.container = document.createElement('div');
        this.container.className = 'hic-normalization-selector-container';
        this.container.title = NO_SUBSTITUTION_TITLE;
        parent.appendChild(this.container);

        let label = document.createElement('div');
        label.textContent = 'Norm';
        this.container.appendChild(label);

        this.normalizationSelector = document.createElement('select');
        this.normalizationSelector.name = 'normalization_selector';
        this._changeHandler = () => {
            // Only process change events if not programmatically updating
            if (!this._isProgrammaticUpdate) {
                // The user has answered the question the announcement asked, so
                // whatever it said is no longer true. Cleared here rather than
                // in the coordinator because a selection is the widget's own
                // event; `onNormalizationChange` clears the same thing for a
                // host that calls `setNormalization` without touching the UI.
                this.clearSubstitution();
                this.browser.setNormalization(this.normalizationSelector.value);
            }
        };
        this.normalizationSelector.addEventListener('change', this._changeHandler);
        this.container.appendChild(this.normalizationSelector);

        // Hidden until something is substituted. A marker rather than a bare
        // `title`: a title is invisible on touch and offers nothing to notice,
        // which is the silence #372 has been open about since 2022. An
        // information glyph rather than a warning one, and amber rather than
        // red, because a substitution is not a failure (ADR-0012).
        this.substitutionMarker = document.createElement('i');
        this.substitutionMarker.className = 'fa fa-info-circle hic-normalization-substitution-marker';
        this.substitutionMarker.style.display = 'none';
        this.substitutionMarker.setAttribute('role', 'button');
        this.substitutionMarker.setAttribute('tabindex', '0');
        this.container.appendChild(this.substitutionMarker);

        // The reason, as text on the page. The marker alone only says "look
        // here"; a `title` alone is a hover delay on a small glyph and nothing
        // at all on touch. Clicking is the affordance that actually answers the
        // question, and it is a note rather than a dialog because ADR-0012 is
        // that a substitution is not an error.
        this.substitutionNote = document.createElement('div');
        this.substitutionNote.className = 'hic-normalization-substitution-note';
        this.substitutionNote.style.display = 'none';
        this.container.appendChild(this.substitutionNote);

        this.substitutionMarker.addEventListener('click', event => {
            event.stopPropagation();
            this.toggleSubstitutionNote();
        });

        /** The view the standing announcement is about, or undefined if there is none. */
        this.substitutionScope = undefined;

        this.spinner = document.createElement('div');
        this.spinner.textContent = 'Loading ...';
        this.container.appendChild(this.spinner);
        this.spinner.style.display = 'none';

    }

    /**
     * Announce that this view is being drawn with a normalization other than
     * the one asked for.
     *
     * @param {string} reason - one of `substitutionReason`, already worded
     * @param {{chr1: number, chr2: number, zoom: number}} scope - the view it is
     *        about, so a later chromosome or zoom change can tell it is stale
     */
    announceSubstitution(reason, scope) {
        this.substitutionScope = viewScope(scope);
        this.container.title = reason;
        // On the marker too, not merely inherited from the container: the marker
        // is what a user points at, and an ancestor's title is a slower, vaguer
        // answer to the same gesture.
        this.substitutionMarker.title = reason;
        this.substitutionMarker.style.display = 'block';
        // A new reason starts closed. Leaving the previous note open would leave
        // the old sentence on screen under a marker that now means something
        // else.
        this.substitutionNote.textContent = reason;
        this.substitutionNote.style.display = 'none';
    }

    /** Show the reason as text, or put it away. The marker's click handler. */
    toggleSubstitutionNote() {
        const showing = 'none' !== this.substitutionNote.style.display;
        this.substitutionNote.style.display = showing ? 'none' : 'block';
    }

    /** Take the announcement down, whatever it said. Idempotent. */
    clearSubstitution() {
        this.substitutionScope = undefined;
        this.container.title = NO_SUBSTITUTION_TITLE;
        this.substitutionMarker.title = '';
        this.substitutionMarker.style.display = 'none';
        this.substitutionNote.textContent = '';
        this.substitutionNote.style.display = 'none';
    }

    /**
     * Clear the announcement if the view has moved off the one it was about.
     *
     * Scope comparison rather than the `chrChanged`/`resolutionChanged` flags:
     * a substitution is announced from inside the same load that raises those
     * flags, so a flag-driven clear would take the announcement down in the
     * same breath it went up. Comparing the view is also the honest rule -- a
     * pan cannot make the reason false, and does not clear it.
     *
     * @param {{chr1: number, chr2: number, zoom: number}} state - the view now
     */
    clearSubstitutionIfStale(state) {
        if (!this.substitutionScope) return;
        if (!sameScope(this.substitutionScope, viewScope(state))) {
            this.clearSubstitution();
        }
    }

    startNotReady() {
        this.normalizationSelector.style.display = 'none';
        this.spinner.style.display = 'block';
    }

    stopNotReady() {
        this.spinner.style.display = 'none';
        this.normalizationSelector.style.display = 'block';
    }

    /**
     * Set the normalization selector value programmatically without triggering change events.
     * This prevents feedback loops when the normalization is changed externally.
     * 
     * @param {string} normalization - The normalization value to set
     */
    setNormalizationProgrammatically(normalization) {
        this._isProgrammaticUpdate = true;
        try {
            Array.from(this.normalizationSelector.options).forEach(option => {
                option.selected = option.value === normalization;
            });
        } finally {
            // Always reset the flag, even if an error occurs
            this._isProgrammaticUpdate = false;
        }
    }

    async updateOptions() {
        const labels = {
            NONE: 'None',
            VC: 'Coverage',
            VC_SQRT: 'Coverage - Sqrt',
            KR: 'Balanced',
            INTER_VC: 'Interchromosomal Coverage',
            INTER_VC_SQRT: 'Interchromosomal Coverage - Sqrt',
            INTER_KR: 'Interchromosomal Balanced',
            GW_VC: 'Genome-wide Coverage',
            GW_VC_SQRT: 'Genome-wide Coverage - Sqrt',
            GW_KR: 'Genome-wide Balanced'
        };

        const norm = this.browser.state.normalization;
        const normalizationTypes = await this.browser.getNormalizationOptions();
        if (normalizationTypes) {
            this.normalizationSelector.innerHTML = '';
            normalizationTypes.forEach(normalization => {
                const option = document.createElement('option');
                option.value = normalization;
                option.textContent = labels[normalization] || normalization;
                if (norm === normalization) {
                    option.selected = true;
                }
                this.normalizationSelector.appendChild(option);
            });
        }
    }
}

export {substitutionReason};
export default NormalizationWidget;
