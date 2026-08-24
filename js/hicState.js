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

import {DEFAULT_PIXEL_SIZE, MAX_PIXEL_SIZE} from "./hicBrowser.js"
import {SENTINEL_ZOOM} from "./sentinelZoom.js"

/**
 * State holds the canonical six fields that fully specify the view:
 *   chr1, chr2, x (bins), y (bins), zoom (resolution index), pixelSize
 * plus normalization. These are the source of truth.
 *
 * BP coordinates ("locus") are NOT stored — they are a projection of canonical
 * state through view dimensions. Read via state.getLocus(dataset, viewDimensions),
 * which always reflects what is actually on screen.
 *
 * All mutations flow through one chokepoint: state.setView(...). The legacy
 * mutation methods (updateWithLoci, panShift, panWithZoom, setWithZoom, sync) and
 * the inline-mutation paths formerly in interactionHandler (zoomBy, recenterByPixel,
 * setChromosomesView) are translators that convert their domain-specific inputs
 * into canonical args and delegate to setView. setView owns clamping, pixelSize
 * adjustment, and change detection.
 *
 * Invariants:
 * - No code outside this file should mutate state fields directly. Everything is
 *   a translator-then-setView chain.
 * - locus reads always go through getLocus(); state.locus does not exist.
 * - chr1 <= chr2 (axis ordering). A .hic file stores one triangle of a symmetric
 *   matrix, so an unordered pair is a second spelling of a view that already has
 *   one. setView enforces it, transposing chr1/chr2 and x/y together; translators
 *   inherit it by delegating. The constructor transposes too, for states arriving
 *   from outside the chokepoint. See ADR-0006 decision 3.
 */
class State {

    constructor(chr1, chr2, zoom, x, y, pixelSize, normalization) {
        if (chr1 <= chr2) {
            this.chr1 = chr1;
            this['x'] = x;

            this.chr2 = chr2;
            this['y'] = y;
        } else {
            // Transpose
            this.chr1 = chr2;
            this['x'] = y;

            this.chr2 = chr1;
            this['y'] = x;
        }

        this.zoom = zoom;

        if (undefined === normalization) {
            normalization = 'NONE';
        }
        this.normalization = normalization;

        if (typeof pixelSize === 'string') {
            const parsed = parseFloat(pixelSize);
            pixelSize = isNaN(parsed) ? 1 : parsed;
        } else if (typeof pixelSize !== 'number' || Number.isNaN(pixelSize) || pixelSize <= 0) {
            pixelSize = 1;
        }
        this.pixelSize = pixelSize;
    }

    /**
     * Detect if resolution changed.
     * 
     * @param {number} newZoom - New zoom index
     * @returns {boolean} - True if resolution changed
     */
    _detectResolutionChange(newZoom) {
        return this.zoom !== newZoom;
    }

    /**
     * Detect if chromosome changed.
     * 
     * @param {number} newChr1 - New chromosome 1 index
     * @param {number} newChr2 - New chromosome 2 index
     * @returns {boolean} - True if chromosome changed
     */
    _detectChromosomeChange(newChr1, newChr2) {
        return this.chr1 !== newChr1 || this.chr2 !== newChr2;
    }

    /**
     * Adjust a target pixelSize through the standard floor-and-cap pipeline.
     * Floor: max(1, targetPixelSize), then floor by minPixelSize (looked up from
     * browser if not provided). Cap: MAX_PIXEL_SIZE. Optionally apply
     * DEFAULT_PIXEL_SIZE as the floor (resolution-selector path only).
     */
    async _adjustPixelSize(targetPixelSize, browser, zoom, options = {}) {
        const { minPixelSize, useDefaultMin = false } = options;

        let adjustedPixelSize = Math.max(1, targetPixelSize);

        let actualMinPixelSize = minPixelSize;
        if (actualMinPixelSize === undefined && browser) {
            actualMinPixelSize = await browser.minPixelSize(this.chr1, this.chr2, zoom);
        }

        if (actualMinPixelSize !== undefined) {
            adjustedPixelSize = useDefaultMin
                ? Math.max(DEFAULT_PIXEL_SIZE, actualMinPixelSize)
                : Math.max(adjustedPixelSize, actualMinPixelSize);
        } else if (useDefaultMin) {
            adjustedPixelSize = Math.max(DEFAULT_PIXEL_SIZE, adjustedPixelSize);
        }

        return Math.min(MAX_PIXEL_SIZE, adjustedPixelSize);
    }

    /**
     * The single canonical mutation entry point for State. All seven legacy mutation
     * paths (updateWithLoci, panShift, panWithZoom, setWithZoom, sync,
     * zoomAndCenter's inline path, setChromosomes's inline path) are migrated to
     * delegate here.
     *
     * Inputs are the canonical six. Translators are responsible for converting their
     * domain-specific inputs (BP loci, dx/dy deltas, anchor pixels, peer-sync targets)
     * into these.
     *
     * @param {number} chr1 - Chromosome 1 index. Ordering is NOT the caller's
     *                        responsibility: setView enforces the chr1 <= chr2
     *                        invariant itself, transposing the pair when handed an
     *                        unordered one.
     * @param {number} chr2 - Chromosome 2 index.
     * @param {number} x - Bin position on the chr1 axis.
     * @param {number} y - Bin position on the chr2 axis.
     * @param {number} zoom - Zoom level (index into bpResolutions).
     * @param {number} [pixelSize] - Target pixelSize. May be undefined when
     *                               options.useDefaultMin is true (DEFAULT_PIXEL_SIZE
     *                               floor is applied without a target — preserves the
     *                               resolution-selector-only behavior).
     * @param {Object} browser - For minPixelSize lookup.
     * @param {Object} dataset - For clampXY.
     * @param {Object} viewDimensions - {width, height} for clampXY.
     * @param {Object} [options]
     * @param {boolean} [options.useDefaultMin=false] - Use DEFAULT_PIXEL_SIZE as floor
     *                                                   (resolution-selector path only).
     * @param {number}  [options.minPixelSize] - Override browser.minPixelSize lookup
     *                                            (caller has already computed it).
     * @param {boolean} [options.clampXY=true] - Whether to clamp x/y to chromosome bounds.
     * @param {boolean} [options.adjustPixelSize=true] - Run pixelSize through
     *                                                    _adjustPixelSize. Pan paths set
     *                                                    this false: panning never alters
     *                                                    pixelSize, including by floor.
     * @returns {Promise<{chrChanged: boolean, resolutionChanged: boolean}>}
     */
    async setView(chr1, chr2, x, y, zoom, pixelSize, browser, dataset, viewDimensions, options = {}) {
        const { useDefaultMin = false, minPixelSize, clampXY = true, adjustPixelSize = true } = options;

        // Axis ordering (ADR-0006 decision 3). A .hic file stores one triangle of a
        // symmetric matrix, so an unordered pair names a view that already has a
        // canonical spelling. Transpose it here — the one place that receives both
        // chromosomes and both origins together, and so can swap all four atomically.
        // Every translator inherits the invariant by delegating here.
        if (chr1 > chr2) {
            [chr1, chr2] = [chr2, chr1];
            [x, y] = [y, x];
        }

        // `All` is not a chromosome a single-chromosome assembly can be at
        // (ADR-0010 decision 5). Every entry point that can name it -- the
        // pulldown, the locus box, a saved session, a pasted URL -- reaches the
        // state through here, so the redirect lives at the chokepoint rather
        // than at four call sites, and an eight-year-old link naming `chr 0`
        // opens instead of throwing (ADR-0009: coerce, never reject).
        //
        // It is silent. By the premise of #236 there is no user-visible
        // difference between the two views, so there is nothing to warn about.
        //
        // x, y and pixelSize carry over untouched: the whole-genome bin and the
        // sentinel bin are the same bin, offset zero (ADR-0010 fact 4).
        let redirected = false;
        if (dataset && dataset.isSingleChromosome() && dataset.isWholeGenome(chr1)) {
            chr1 = chr2 = dataset.soleChromosome().index;
            zoom = SENTINEL_ZOOM;
            redirected = true;
        }

        const chrChanged = this._detectChromosomeChange(chr1, chr2);
        const resolutionChanged = this._detectResolutionChange(zoom);

        // A redirected view is sized against the pair it lands on, not the pair
        // it arrived as. `_adjustPixelSize` consults `minPixelSize` with the
        // *outgoing* chromosomes by the convention noted below, and the outgoing
        // pair here is `All`, whose size is in kb -- divided by a sentinel bin
        // stated in bp it yields half a bin and a pixelSize pinned to the cap.
        // The scaffold and the sentinel bin are both bp (ADR-0010 fact 4).
        let sizedAgainst = minPixelSize;
        if (redirected && undefined === sizedAgainst && adjustPixelSize && browser) {
            sizedAgainst = await browser.minPixelSize(chr1, chr2, zoom);
        }

        // Adjust pixelSize BEFORE mutating chr1/chr2 — preserves the existing convention
        // that browser.minPixelSize is consulted with the pre-mutation chr1/chr2 (and the
        // post-mutation zoom).
        const adjustedPixelSize = adjustPixelSize
            ? await this._adjustPixelSize(pixelSize, browser, zoom, { useDefaultMin, minPixelSize: sizedAgainst })
            : pixelSize;

        this.chr1 = chr1;
        this.chr2 = chr2;
        this.zoom = zoom;
        this.x = x;
        this.y = y;
        this.pixelSize = adjustedPixelSize;

        if (clampXY) {
            this.clampXY(dataset, viewDimensions);
        }

        return { chrChanged, resolutionChanged };
    }

    clampXY(dataset, viewDimensions) {
        const { width, height } = viewDimensions
        const { chromosomes } = dataset;

        const binSize = dataset.binSizeForZoom(this.zoom);
        const maxX = Math.max(0, chromosomes[this.chr1].size / binSize -  width / this.pixelSize);
        const maxY = Math.max(0, chromosomes[this.chr2].size / binSize - height / this.pixelSize);

        this.x = Math.min(Math.max(0, this.x), maxX);
        this.y = Math.min(Math.max(0, this.y), maxY);
    }

    async panWithZoom(zoom, pixelSize, anchorPx, anchorPy, binSize, browser, dataset, viewDimensions) {
        // The translator owns anchor-preservation math because it depends on the adjusted
        // pixelSize: the new x/y must be computed against the post-adjust pixelSize so the
        // genomic position at (anchorPx, anchorPy) is invariant across the call.
        //
        // The outgoing bin size is read off the dataset rather than out of a
        // resolution array the caller passes in. Position and zoom index are not
        // the same number once a rung is filtered (an A/B map) or synthesised
        // (the sentinel), and this used to index one by the other.
        const adjustedPixelSize = await this._adjustPixelSize(pixelSize, browser, zoom)
        const currentBinSize = dataset.binSizeForZoom(this.zoom)
        const gx = (this.x + anchorPx / this.pixelSize) * currentBinSize
        const gy = (this.y + anchorPy / this.pixelSize) * currentBinSize
        const newX = gx / binSize - anchorPx / adjustedPixelSize
        const newY = gy / binSize - anchorPy / adjustedPixelSize

        return await this.setView(
            this.chr1, this.chr2, newX, newY, zoom, adjustedPixelSize,
            browser, dataset, viewDimensions,
            { adjustPixelSize: false, clampXY: true },
        )
    }

    async panShift(dx, dy, browser, dataset, viewDimensions) {
        await this.setView(
            this.chr1, this.chr2,
            this.x + dx / this.pixelSize, this.y + dy / this.pixelSize,
            this.zoom, this.pixelSize,
            browser, dataset, viewDimensions,
            { adjustPixelSize: false, clampXY: true },
        )
    }

    async setWithZoom(zoom, viewDimensions, browser, dataset) {
        // The resolution-selector path. Translator computes the view-center-preserving
        // x/y under the new (post-floor) pixelSize and delegates. useDefaultMin: true is
        // the only setting that preserves the DEFAULT_PIXEL_SIZE floor — the visible
        // "jump" vs wheel zoom that #411 codifies as resolution-selector-only.
        const { width, height } = viewDimensions
        const xCenter = this.x + (width / 2) / this.pixelSize
        const yCenter = this.y + (height / 2) / this.pixelSize

        const binSize = dataset.binSizeForZoom(this.zoom)
        const binSizeNew = dataset.binSizeForZoom(zoom)
        const scaleFactor = binSize / binSizeNew
        const xCenterNew = xCenter * scaleFactor
        const yCenterNew = yCenter * scaleFactor

        const minPixelSize = await browser.minPixelSize(this.chr1, this.chr2, zoom)
        const newPixelSize = await this._adjustPixelSize(undefined, browser, zoom, { minPixelSize, useDefaultMin: true })

        const newX = Math.max(0, xCenterNew - width / (2 * newPixelSize))
        const newY = Math.max(0, yCenterNew - height / (2 * newPixelSize))

        const { resolutionChanged } = await this.setView(
            this.chr1, this.chr2, newX, newY, zoom, newPixelSize,
            browser, dataset, viewDimensions,
            { adjustPixelSize: false, clampXY: true },
        )
        return resolutionChanged
    }

    /**
     * Pure projection of canonical state into a BP locus, given dataset and view geometry.
     * Returns {x: {chr, start, end}, y: {chr, start, end}}. Does not mutate this.
     *
     * This is the only place "where am I in BP coordinates" is computed — it always
     * reflects what is actually on screen, derived from chr1/chr2/x/y/zoom/pixelSize.
     */
    getLocus(dataset, viewDimensions) {
        const bpPerBin = dataset.binSizeForZoom(this.zoom);
        const startBP1 = Math.round(this.x * bpPerBin);
        const startBP2 = Math.round(this.y * bpPerBin);
        const chr1 = dataset.chromosomes[this.chr1];
        const chr2 = dataset.chromosomes[this.chr2];
        const pixelsPerBin = this.pixelSize;
        const endBP1 = Math.min(chr1.size, Math.round(((viewDimensions.width / pixelsPerBin) * bpPerBin)) + startBP1);
        const endBP2 = Math.min(chr2.size, Math.round(((viewDimensions.height / pixelsPerBin) * bpPerBin)) + startBP2);
        return {
            x: { chr: chr1.name, start: startBP1, end: endBP1 },
            y: { chr: chr2.name, start: startBP2, end: endBP2 },
        };
    }

    async updateWithLoci(chr1Name, bpX, bpXMax, chr2Name, bpY, bpYMax, browser, width, height) {
        const bpResolutions = browser.getResolutions()

        const { index: chr1Index } = browser.genome.getChromosome(chr1Name)
        const { index: chr2Index } = browser.genome.getChromosome(chr2Name)

        // The fit weighs one BP range against the view width and the other against its
        // height, so it must be computed against the axis assignment the state will
        // actually end up with — and setView orders the pair. Ordering here is for this
        // computation only; setView still receives the caller's pair and does the swap.
        const [fitRangeX, fitRangeY] = chr1Index <= chr2Index
            ? [bpXMax - bpX, bpYMax - bpY]
            : [bpYMax - bpY, bpXMax - bpX]

        const bpPerPixelTarget = Math.max(fitRangeX / width, fitRangeY / height)
        const zoomNew = (true === browser.resolutionLocked)
            ? this.zoom
            : browser.findMatchingZoomIndex(bpPerPixelTarget, bpResolutions)
        // Off the browser rather than off a dataset, uniquely here: this is the
        // one translator handed no dataset of its own.
        const binSizeNew = browser.binSizeForZoom(zoomNew)

        return await this.setView(
            chr1Index, chr2Index,
            bpX / binSizeNew, bpY / binSizeNew,
            zoomNew, binSizeNew / bpPerPixelTarget,
            browser, browser.dataset, { width, height },
            { clampXY: false },
        )
    }

    /**
     * Set the view to a pair of whole chromosomes (or whole genome). Handles both
     * branches of the chromosome-selector / setChromosomes path:
     *
     * - wholeChr=true: zoom = browser.minZoom(...); pixelSize clamped to
     *   [DEFAULT_PIXEL_SIZE, 100] around minPixelSize. Used when both axes are full
     *   chromosomes.
     * - wholeChr=false: zoom = 0; pixelSize = max(current pixelSize, minPixelSize).
     *   Used for whole-genome view.
     *
     * In both cases x and y are reset to 0.
     */
    async setChromosomesView(chr1Index, chr2Index, wholeChr, browser, dataset, viewDimensions) {
        // State-level ordering is setView's job now (ADR-0006 decision 3) — this
        // translator passes the caller's pair through untouched, and x/y are both 0
        // so it has no origins of its own to keep in step.
        //
        // The ordered pair survives for the two lookups below, which are genuinely
        // order-sensitive: minZoom maxes chr1 against the view width and chr2 against
        // its height, and those differ on a non-square viewport. Since setView will
        // order the pair anyway, fitting against the caller's order would size the view
        // for an axis pairing the state is not going to have.
        const lookupChr1 = Math.min(chr1Index, chr2Index)
        const lookupChr2 = Math.max(chr1Index, chr2Index)

        let newZoom, newPixelSize
        if (wholeChr) {
            newZoom = await browser.minZoom(lookupChr1, lookupChr2)
            const minPS = await browser.minPixelSize(lookupChr1, lookupChr2, newZoom)
            newPixelSize = Math.min(100, Math.max(DEFAULT_PIXEL_SIZE, minPS))
        } else {
            newZoom = 0
            const minPS = await browser.minPixelSize(lookupChr1, lookupChr2, newZoom)
            newPixelSize = Math.max(this.pixelSize, minPS)
        }

        return await this.setView(
            chr1Index, chr2Index, 0, 0, newZoom, newPixelSize,
            browser, dataset, viewDimensions,
            { adjustPixelSize: false, clampXY: true },
        )
    }

    /**
     * Translate a screen pixel (centerPX, centerPY) to the new view center, no zoom change.
     * The bin position is shifted so the chosen pixel becomes the center of the view.
     * Used by the setZoom branch of zoomAndCenter (and is generally safe as a "scroll to
     * click" primitive).
     */
    async recenterByPixel(centerPX, centerPY, browser, dataset, viewDimensions) {
        const { width, height } = viewDimensions
        const dx = centerPX === undefined ? 0 : centerPX - width / 2
        const dy = centerPY === undefined ? 0 : centerPY - height / 2
        return await this.setView(
            this.chr1, this.chr2,
            this.x + dx / this.pixelSize, this.y + dy / this.pixelSize,
            this.zoom, this.pixelSize,
            browser, dataset, viewDimensions,
            { adjustPixelSize: false, clampXY: true },
        )
    }

    /**
     * Zoom by a step (direction: +1 in, -1 out) anchored at a screen pixel.
     * Used by the resolution-locked / zoom-boundary branch of zoomAndCenter, where the
     * resolution index cannot change so the zoom is achieved by doubling/halving pixelSize
     * instead. Performs the recenter and the pixelSize change in one atomic mutation.
     */
    async zoomBy(direction, centerPX, centerPY, browser, dataset, viewDimensions) {
        const { width, height } = viewDimensions
        const dx = centerPX === undefined ? 0 : centerPX - width / 2
        const dy = centerPY === undefined ? 0 : centerPY - height / 2

        // Step 1: recenter under the OLD pixelSize (so dx/dy in pixels translates correctly).
        let newX = this.x + dx / this.pixelSize
        let newY = this.y + dy / this.pixelSize

        const minPS = await browser.minPixelSize(this.chr1, this.chr2, this.zoom)
        const newPixelSize = Math.max(
            Math.min(MAX_PIXEL_SIZE, this.pixelSize * (direction > 0 ? 2 : 0.5)),
            minPS,
        )

        // Step 2: pixelSize-change shift uses the NEW pixelSize for the second leg.
        const shiftRatio = (newPixelSize - this.pixelSize) / newPixelSize
        newX += shiftRatio * (width / newPixelSize)
        newY += shiftRatio * (height / newPixelSize)

        return await this.setView(
            this.chr1, this.chr2, newX, newY, this.zoom, newPixelSize,
            browser, dataset, viewDimensions,
            { adjustPixelSize: false, clampXY: true },
        )
    }

    /**
     * The view as a sibling browser can read it: chromosomes by name and a bin
     * size rather than a zoom index, because the sibling's dataset may order
     * its chromosomes differently and offer a different resolution array.
     *
     * A projection through a dataset, like `getLocus` -- so the dataset is a
     * parameter, not a remembered field (ADR-0009 decision 6, #562).
     *
     * @param {Object} dataset
     * @returns {Object} the sync state `State.sync` consumes on the other side
     */
    getSyncState(dataset) {
        return {
            chr1Name: dataset.chromosomes[this.chr1].name,
            chr2Name: dataset.chromosomes[this.chr2].name,
            binSize: dataset.binSizeForZoom(this.zoom),
            binX: this.x,
            binY: this.y,
            pixelSize: this.pixelSize
        }
    }

    async sync(targetState, browser, genome, dataset) {
        const chr1 = genome.getChromosome(targetState.chr1Name)
        const chr2 = genome.getChromosome(targetState.chr2Name)

        const bpPerPixelTarget = targetState.binSize / targetState.pixelSize
        // Matched against `browser.getResolutions()` rather than the raw
        // `bpResolutions` array so a peer sitting at the sentinel rung is a rung
        // this browser can follow it to. Same reason as everywhere else: array
        // position and zoom index are not the same number.
        const zoomNew = browser.findMatchingZoomIndex(bpPerPixelTarget, browser.getResolutions())
        const binSizeNew = dataset.binSizeForZoom(zoomNew)

        const xBinNew = targetState.binX * (targetState.binSize / binSizeNew)
        const yBinNew = targetState.binY * (targetState.binSize / binSizeNew)
        const targetPixelSize = binSizeNew / bpPerPixelTarget

        const { chrChanged, resolutionChanged } = await this.setView(
            chr1.index, chr2.index, xBinNew, yBinNew, zoomNew, targetPixelSize,
            browser, dataset, browser.contactMatrixView.getViewDimensions(),
        )
        // sync's contract uses "zoomChanged" rather than "resolutionChanged"; same concept.
        return { zoomChanged: resolutionChanged, chrChanged }
    }

    /**
     * Shallow clone is intentional and correct: State holds only scalar fields
     * (chr1, chr2, zoom, x, y, pixelSize, normalization) since locus was made
     * a pure projection. Object.assign produces an independent clone.
     */
    clone() {
        return Object.assign(new State(), this);
    }

    equals(state) {
        const s1 = JSON.stringify(this);
        const s2 = JSON.stringify(state);
        return s1 === s2;
    }

    async sizeBP(dataset, zoomIndex, pixels){
        const matrix = await dataset.getMatrix(this.chr1, this.chr2)
        const { zoom } = matrix.getZoomDataByIndex(zoomIndex, 'BP')

        // bp = pixel * (bp/bin) * (bin/pixel) = pixel * bp/pixel = bp
        return pixels * (zoom.binSize/this.pixelSize)
    }

    /**
     * Decode the `state` query parameter. Two versions, told apart by token
     * count: v0 is seven tokens or fewer, v1 is more than seven and carries two
     * filler tokens (the view width and height, retired in March 2025 and never
     * read) between y and pixelSize. Both branches are intentional — links in
     * the wild use both.
     *
     * There is no encoder: juicebox writes only the compressed session form.
     * `docs/url.md` is the specification, and the wire-format tests at the end
     * of `test/testState.js` are its executable half. Change one, change all
     * three. ADR-0006 decisions 2 and 5.
     */
    static parse(string) {
        const tokens = string.split(",")

        if (tokens.length <= 7) {
            // v0
            return new State(
                parseInt(tokens[0]),    // chr1
                parseInt(tokens[1]),    // chr2
                parseFloat(tokens[2]), // zoom
                parseFloat(tokens[3]), // x
                parseFloat(tokens[4]), // y
                parseFloat(tokens[5]), // pixelSize
                tokens.length > 6 ? tokens[6] : "NONE"   // normalization
            )
        } else {
            // v1 — tokens[5] and tokens[6] are the retired view width and height
            return new State(
                parseInt(tokens[0]),    // chr1
                parseInt(tokens[1]),    // chr2
                parseFloat(tokens[2]), // zoom
                parseFloat(tokens[3]), // x
                parseFloat(tokens[4]), // y
                parseFloat(tokens[7]), // pixelSize
                tokens.length > 8 ? tokens[8] : "NONE"   // normalization
            )
        }
    }

    /**
     * The sentinel rung never crosses the process boundary (ADR-0010 decision
     * 6). A view sitting on it is written out as the whole-genome view --
     * `chr1: 0, chr2: 0, zoom: 0` -- which for a single-chromosome assembly is
     * pixel-for-pixel the same picture, is a wire value every existing consumer
     * already renders, and is redirected straight back to the sentinel by
     * `setView` on the way in.
     */
    toJSON() {
        // Named for where the state *is*, not for what it is written as. The
        // sentinel is deliberately not a whole-genome view (decision 4); what
        // decision 6 says is that it is written out as one.
        const atSentinel = SENTINEL_ZOOM === this.zoom;
        return {
            chr1: atSentinel ? 0 : this.chr1,
            chr2: atSentinel ? 0 : this.chr2,
            zoom: atSentinel ? 0 : this.zoom,
            x: this.x,
            y: this.y,
            pixelSize: this.pixelSize,
            normalization: this.normalization || 'NONE',
        }
    }

    /**
     * Parse a JSON object into a State instance.
     * A `locus` field on the input is read-and-ignored for backward compatibility
     * with old session payloads — locus is derived on demand via getLocus().
     */
    static fromJSON(json) {
        return new State(
            json.chr1,
            json.chr2,
            json.zoom,
            json.x,
            json.y,
            json.pixelSize,
            json.normalization
        );
    }

    /**
     * The fall-back view: the whole genome at the origin, one pixel per bin,
     * unnormalized. It does not vary with the config, so it takes no argument.
     *
     * Every parameter is supplied explicitly because the previous form passed
     * six arguments and the constructor's coercions hid the shift entirely —
     * see #510 for the defect and ADR-0009's sequencing for why it landed
     * before candidate 6's gate.
     */
    static default() {
        return new State(
            0,                      // chr1: whole genome
            0,                      // chr2: whole genome
            0,                      // zoom: coarsest resolution index
            0,                      // x: bin origin
            0,                      // y: bin origin
            DEFAULT_PIXEL_SIZE,     // one pixel per bin, the browser-wide default
            'NONE'                  // normalization
        )
    }

}

export default State
