/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2016-2017 The Regents of the University of California
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import ColorScale from './colorScale.js'
import {
    tileKey,
    colorScaleKey,
    tileGrid,
    resolveDisplayMode,
    autoThreshold,
    indexControlRecords,
    paintRecords
} from './imageTileCore.js'

const DEFAULT_TILE_DIMENSION = 685

/**
 * Supplies image tiles for a contact map view. See CONTEXT.md for "image tile".
 *
 * One call to tilesFor absorbs display-mode dataset selection, zoom-index
 * translation between the primary and control maps, matrix and zoom-data
 * resolution, tile grid math, automatic color-scale computation, the tile
 * cache, in-flight de-duplication and rasterization.
 *
 *   const source = new ImageTileSource({colorScale, ratioColorScale, observer})
 *
 *   for await (const tile of source.tilesFor({
 *       dataset, controlDataset, state, displayMode, viewDimensions
 *   })) {
 *       view.paint(tile)
 *   }
 *
 *   source.invalidate({thresholds: true})
 *
 * The source never mutates canonical state. Where the requested normalization
 * is unavailable it renders the pass with a fallback and reports the
 * discrepancy through the observer; deciding what to do about it belongs to
 * whoever owns state mutation.
 *
 * Tiles are yielded one at a time as they resolve, so a caller painting inside
 * the loop fills the viewport progressively rather than waiting on the slowest
 * fetch.
 */
class ImageTileSource {

    /**
     * @param colorScale scale for the single-map display modes
     * @param ratioColorScale scale for AOB / BOA
     * @param diffColorScale scale for AMB. Currently undefined -- AMB has been
     *        unimplemented since 2018, see issue #426. Passed through so the
     *        behavior is unchanged rather than silently repaired here.
     * @param createTile factory for a raster surface. Defaults to a canvas;
     *        tests inject a stub, since the test environment has no canvas.
     * @param observer receives colorScaleChanged, normalizationUnavailable and
     *        loadingChanged. All optional.
     * @param tileDimension tile edge length in bins
     * @param cacheLimit retained tile count
     */
    constructor({
                    colorScale,
                    ratioColorScale,
                    diffColorScale,
                    createTile,
                    observer = {},
                    tileDimension = DEFAULT_TILE_DIMENSION,
                    cacheLimit = 8      // 8 is the minimum number required to support A/B cycling
                } = {}) {

        this.colorScale = colorScale
        this.ratioColorScale = ratioColorScale
        this.diffColorScale = diffColorScale

        this.createTile = createTile || defaultCreateTile
        this.observer = observer
        this.tileDimension = tileDimension

        this.cache = {}
        this.cacheKeys = []
        this.cacheLimit = cacheLimit
        this.thresholdCache = {}
        this.drawsInProgress = new Set()
    }

    // -- color scale ------------------------------------------------------

    getColorScale(displayMode) {
        switch (displayMode) {
            case 'AOB':
            case 'BOA':
                return this.ratioColorScale
            case 'AMB':
                return this.diffColorScale
            default:
                return this.colorScale
        }
    }

    setColorScale(colorScale, displayMode, state) {
        switch (displayMode) {
            case 'AOB':
            case 'BOA':
                this.ratioColorScale = colorScale
                break
            case 'AMB':
                this.diffColorScale = colorScale
                break
            default:
                this.colorScale = colorScale
        }
        this.thresholdCache[colorScaleKey(state, displayMode)] = colorScale.threshold
    }

    setThreshold(threshold, displayMode, state) {
        this.getColorScale(displayMode).setThreshold(threshold)
        this.thresholdCache[colorScaleKey(state, displayMode)] = threshold
        this.invalidate()
    }

    /**
     * Discard cached tiles. Threshold caching is separate and survives by
     * default: a pan or a color change invalidates rasters but not the computed
     * threshold. Pass {thresholds: true} on map load, where both are stale.
     */
    invalidate({thresholds = false} = {}) {
        this.cache = {}
        this.cacheKeys = []
        if (thresholds) {
            this.thresholdCache = {}
        }
    }

    // -- tiles ------------------------------------------------------------

    /**
     * Yields the image tiles covering the view, in row-major order.
     *
     * Each tile is {row, column, blockBinCount, binSize} plus either an `image`
     * or `inProgress: true`. An in-progress tile is one whose raster is already
     * being drawn by an overlapping pass; the caller decides what to show in
     * its place.
     *
     * `binSize` is carried on every tile because the caller needs it to express
     * the view's genomic extent, and it has no other route to the zoom data.
     */
    async* tilesFor({dataset, controlDataset, state, displayMode, viewDimensions}) {

        const {ds, dsControl, zoom, controlZoom} =
            resolveDisplayMode(dataset, controlDataset, state.zoom, displayMode)

        const matrix = await ds.getMatrix(state.chr1, state.chr2)
        const zd = matrix.getZoomDataByIndex(zoom, "BP")

        let zdControl = null
        if (dsControl) {
            const matrixControl = await dsControl.getMatrix(state.chr1, state.chr2)
            zdControl = matrixControl.getZoomDataByIndex(controlZoom, "BP")
        }

        const {row1, row2, col1, col2} = tileGrid(state, viewDimensions, this.tileDimension)

        const normalization = this.#effectiveNormalization(ds, zd, state.normalization)

        await this.#ensureColorScale(ds, zd, {row1, row2, col1, col2}, normalization, state, displayMode)

        for (let row = row1; row <= row2; row++) {
            for (let column = col1; column <= col2; column++) {
                yield await this.#tileAt(
                    {ds, dsControl, zd, zdControl, normalization, displayMode},
                    row,
                    column
                )
            }
        }
    }

    /**
     * The normalization this pass can actually render with.
     *
     * A vector absent at the current resolution falls back to NONE. The source
     * reports the fallback and renders with it; it does not write state.
     */
    #effectiveNormalization(ds, zd, requested) {

        if (requested === "NONE") return requested

        if (ds.hasNormalizationVector(requested, zd.chr1.name, zd.zoom.unit, zd.zoom.binSize)) {
            return requested
        }

        this.observer.normalizationUnavailable?.(requested, "NONE")
        return "NONE"
    }

    /**
     * Compute and apply the automatic color scale threshold, if needed.
     *
     * Ratio modes are left alone -- their scale is user-driven, not derived
     * from the data. Otherwise the threshold is memoized per chromosome pair,
     * zoom and normalization, so panning within a resolution does not refetch.
     */
    async #ensureColorScale(ds, zd, grid, normalization, state, displayMode) {

        if ('AOB' === displayMode || 'BOA' === displayMode) {
            return
        }

        const key = colorScaleKey(state, displayMode)

        if (this.thresholdCache[key]) {
            const cached = this.thresholdCache[key]
            const changed = this.colorScale.threshold !== cached
            this.colorScale.setThreshold(cached)
            if (changed) {
                this.observer.colorScaleChanged?.(this.colorScale)
            }
            return
        }

        this.observer.loadingChanged?.(true)
        try {
            const widthInBP = this.tileDimension * zd.zoom.binSize
            const x0bp = grid.col1 * widthInBP
            const y0bp = grid.row1 * widthInBP
            const region1 = {
                chr: zd.chr1.name,
                start: x0bp,
                end: x0bp + (grid.col2 - grid.col1 + 1) * widthInBP
            }
            const region2 = {
                chr: zd.chr2.name,
                start: y0bp,
                end: y0bp + (grid.row2 - grid.row1 + 1) * widthInBP
            }

            const records = await ds.getContactRecords(
                normalization, region1, region2, zd.zoom.unit, zd.zoom.binSize, true)

            const threshold = autoThreshold(records, {
                isLive: ds.isLive,
                isWholeGenome: 0 === zd.chr1.index
            })

            if (undefined !== threshold) {
                this.colorScale = new ColorScale(this.colorScale)
                this.colorScale.setThreshold(threshold)
                this.observer.colorScaleChanged?.(this.colorScale)
                this.thresholdCache[key] = threshold
            }
        } finally {
            this.observer.loadingChanged?.(false)
        }
    }

    async #tileAt({ds, dsControl, zd, zdControl, normalization, displayMode}, row, column) {

        const key = tileKey(zd, row, column, normalization, displayMode)
        const binSize = zd.zoom.binSize

        if (this.cache.hasOwnProperty(key)) {
            return this.cache[key]
        }

        if (this.drawsInProgress.has(key)) {
            // TODO return an image at a coarser resolution if available
            return {row, column, blockBinCount: this.tileDimension, binSize, inProgress: true}
        }

        this.drawsInProgress.add(key)
        this.observer.loadingChanged?.(true)

        try {
            const widthInBP = this.tileDimension * binSize
            const x0bp = column * widthInBP
            const y0bp = row * widthInBP
            const region1 = {chr: zd.chr1.name, start: x0bp, end: x0bp + widthInBP}
            const region2 = {chr: zd.chr2.name, start: y0bp, end: y0bp + widthInBP}

            const records = await ds.getContactRecords(
                normalization, region1, region2, zd.zoom.unit, binSize)

            let controlRecordList
            if (zdControl) {
                controlRecordList = await dsControl.getContactRecords(
                    normalization, region1, region2, zdControl.zoom.unit, zdControl.zoom.binSize)
            }

            const image = this.createTile(this.tileDimension)

            if (records.length > 0) {
                const ctx = image.getContext('2d')
                const buf = ctx.getImageData(0, 0, image.width, image.height)

                paintRecords(buf, records, indexControlRecords(controlRecordList, displayMode), {
                    displayMode,
                    tileDimension: this.tileDimension,
                    sameChr: zd.chr1.index === zd.chr2.index,
                    averageCount: zd.averageCount,
                    ctrlAverageCount: zdControl ? zdControl.averageCount : 1,
                    colorScale: this.colorScale,
                    ratioColorScale: this.ratioColorScale,
                    diffColorScale: this.diffColorScale
                }, row, column)

                ctx.putImageData(buf, 0, 0)
            }

            const tile = {row, column, blockBinCount: this.tileDimension, binSize, image}

            if (this.cacheLimit > 0) {
                if (this.cacheKeys.length > this.cacheLimit) {
                    delete this.cache[this.cacheKeys[0]]
                    this.cacheKeys.shift()
                }
                this.cache[key] = tile
            }

            return tile

        } finally {
            this.drawsInProgress.delete(key)
            this.observer.loadingChanged?.(false)
        }
    }
}

function defaultCreateTile(dimension) {
    const canvas = document.createElement('canvas')
    canvas.width = dimension
    canvas.height = dimension
    return canvas
}

export {DEFAULT_TILE_DIMENSION}

export default ImageTileSource
