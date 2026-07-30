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

/**
 * Pure functions behind the image tile source.
 *
 * An "image tile" is a square raster of the contact matrix at a given zoom, row
 * and column. It is distinct from a "track tile" (js/tile.js), which is a
 * buffered span of 1D track features for one axis.
 *
 * Everything in this module is free of DOM, browser and dataset dependencies so
 * it can be exercised directly from tests. See CONTEXT.md.
 */

/**
 * Cache key for a single image tile.
 *
 * Identifies tile content exactly: the chromosome pair, resolution, unit, grid
 * position, normalization and display mode. Notably it does NOT include x, y or
 * pixelSize -- those affect where a tile is painted, not what it contains.
 *
 * @param zd zoom data
 * @param {number} row tile row
 * @param {number} column tile column
 * @param {string} normalization normalization vector id
 * @param {string} displayMode one of 'A', 'B', 'AOB', 'BOA', 'AMB'
 * @returns {string}
 */
function tileKey(zd, row, column, normalization, displayMode) {
    return `${zd.chr1.name}_${zd.chr2.name}_${zd.zoom.binSize}_${zd.zoom.unit}_${row}_${column}_${normalization}_${displayMode}`
}

/**
 * Cache key for a computed color scale threshold.
 *
 * Coarser than tileKey -- a threshold is shared by every tile in the view, so
 * the key omits grid position, unit and binSize, keying on zoom index instead.
 *
 * @param state canonical state, or undefined during startup
 * @param {string} displayMode
 * @returns {string}
 */
function colorScaleKey(state, displayMode) {
    // Safety check: ensure state exists before accessing its properties
    if (!state) {
        return "unknown_" + displayMode
    }
    return "" + state.chr1 + "_" + state.chr2 + "_" + state.zoom + "_" + state.normalization + "_" + displayMode
}

/**
 * The inclusive range of image tiles covering the current view.
 *
 * Bin extent is derived from an integer pixel size -- the fractional pixelSize
 * carried in canonical state is floored (and floored at 1) before dividing, so
 * the covered range never collapses to zero at sub-pixel resolutions.
 *
 * The range is inclusive on both ends: a view whose right edge falls exactly on
 * a tile boundary still includes that boundary tile.
 *
 * @param state canonical state -- reads x, y, pixelSize
 * @param {{width: number, height: number}} viewDimensions
 * @param {number} tileDimension tile edge length in bins
 * @returns {{row1: number, row2: number, col1: number, col2: number}}
 */
function tileGrid(state, viewDimensions, tileDimension) {

    const pixelSizeInt = Math.max(1, Math.floor(state.pixelSize))
    const widthInBins = viewDimensions.width / pixelSizeInt
    const heightInBins = viewDimensions.height / pixelSizeInt

    return {
        col1: Math.floor(state.x / tileDimension),
        col2: Math.floor((state.x + widthInBins) / tileDimension),
        row1: Math.floor(state.y / tileDimension),
        row2: Math.floor((state.y + heightInBins) / tileDimension)
    }
}

/**
 * Translate a zoom index on the primary map to the equivalent index on the
 * control map.
 *
 * The two maps are matched by resolution, not by index -- a control map may
 * carry a different set of bin sizes, so index N on A is not index N on B.
 *
 * @throws if the zoom index is not present on the primary map, or the resulting
 *         bin size is not present on the control map
 */
function bZoomIndex(dataset, controlDataset, zoom) {

    const binSize = dataset.getBinSizeForZoomIndex(zoom)
    if (!binSize) throw new Error(`Invalid zoom (resolution) index: ${zoom}`)

    const bZoom = controlDataset.getZoomIndexForBinSize(binSize)
    if (bZoom < 0) throw new Error(`Invalid binSize for "B" map: ${binSize}`)

    return bZoom
}

/**
 * Which dataset is rendered, which is the control, and at what zoom index each.
 *
 * Display modes:
 *   A    -- primary only
 *   B    -- control only, rendered as if it were primary
 *   AOB  -- A over B, ratio
 *   AMB  -- A minus B, difference
 *   BOA  -- B over A, ratio with the roles swapped
 *
 * Only the modes that read the control map translate the zoom index; A leaves
 * everything at the incoming values.
 *
 * @returns {{ds: *, dsControl: *, zoom: number, controlZoom: number|undefined}}
 */
function resolveDisplayMode(dataset, controlDataset, zoom, displayMode) {

    let ds = dataset
    let dsControl = null
    let controlZoom

    switch (displayMode) {
        case 'B':
            zoom = bZoomIndex(dataset, controlDataset, zoom)
            ds = controlDataset
            break
        case 'AOB':
        case 'AMB':
            controlZoom = bZoomIndex(dataset, controlDataset, zoom)
            dsControl = controlDataset
            break
        case 'BOA':
            controlZoom = zoom
            zoom = bZoomIndex(dataset, controlDataset, zoom)
            ds = controlDataset
            dsControl = dataset
            break
    }

    return {ds, dsControl, zoom, controlZoom}
}

/**
 * The p-th percentile of contact counts.
 *
 * Returns undefined when there are no records -- the index lands past the end
 * of the sorted array. Callers must treat that as "no threshold available"
 * rather than zero.
 */
function computePercentile(records, p) {
    const counts = records.map(r => r.counts)
    counts.sort(function (a, b) {
        return a - b
    })
    const idx = Math.floor((p / 100) * records.length)
    return counts[idx]
}

/**
 * Threshold for the automatically-computed color scale.
 *
 * Two families of map need different treatment:
 *
 * - .hic maps carry raw contact counts with a long tail, so the 95th percentile
 *   is used, scaled x4 at whole-genome view where averaging across chromosomes
 *   depresses the percentile.
 * - Live maps emit ensemble contact frequencies bounded in (0, 1]. The .hic
 *   heuristics overshoot that ceiling and leave the +/- threshold buttons with
 *   no usable range, so a lower percentile is used and the result is clamped.
 *
 * @param records contact records
 * @param {{isLive: boolean, isWholeGenome: boolean}} options
 * @returns {number|undefined} undefined when no threshold can be computed
 */
function autoThreshold(records, {isLive, isWholeGenome}) {

    const s = computePercentile(records, isLive ? 75 : 95)

    if (isNaN(s)) return undefined      // no records, or all blocks empty

    if (isLive) return Math.min(s, 1)   // clamp to the frequency ceiling

    return isWholeGenome ? s * 4 : s
}

function setPixel(buf, x, y, r, g, b, a) {
    const index = (x + y * buf.width) * 4
    buf.data[index + 0] = r
    buf.data[index + 1] = g
    buf.data[index + 2] = b
    buf.data[index + 3] = a
}

/**
 * Index control-map records by bin pair, for the modes that combine two maps.
 *
 * Returns an empty index for the single-map modes, which never consult it.
 */
function indexControlRecords(controlRecordList, displayMode) {

    const index = {}
    if ('AOB' === displayMode || 'BOA' === displayMode || 'AMB' === displayMode) {
        for (const record of controlRecordList) {
            index[record.getKey()] = record
        }
    }
    return index
}

/**
 * Rasterize contact records into a pixel buffer.
 *
 * The buffer is any object shaped like ImageData -- {width, height, data} where
 * data is a Uint8ClampedArray of RGBA quads. In production it comes from
 * getImageData on a tile canvas; in tests it is a plain object.
 *
 * Intra-chromosomal data is stored in lower-diagonal coordinates by convention.
 * Two consequences are handled here:
 *
 * - Tiles above the diagonal (row < column) are read from their mirrored
 *   position and transposed on the way in.
 * - Tiles ON the diagonal are painted twice, reflected, so the upper triangle
 *   is filled from the same records.
 *
 * Records with no matching control record are skipped entirely in the combining
 * modes -- they leave the buffer untouched rather than painting a zero score.
 *
 * @param buf {{width: number, height: number, data: Uint8ClampedArray}}
 * @param records primary map contact records
 * @param controlRecords control records indexed by bin pair, from indexControlRecords
 * @param plan {{displayMode, tileDimension, sameChr, averageCount, ctrlAverageCount,
 *               colorScale, ratioColorScale, diffColorScale}}
 * @param {number} row tile row
 * @param {number} column tile column
 * @returns {number} how many records were painted, excluding those skipped
 */
function paintRecords(buf, records, controlRecords, plan, row, column) {

    const {
        displayMode, tileDimension, sameChr,
        averageCount, ctrlAverageCount,
        colorScale, ratioColorScale, diffColorScale
    } = plan

    const transpose = sameChr && row < column
    const onDiagonal = sameChr && row === column
    const averageAcrossMapAndControl = (averageCount + ctrlAverageCount) / 2

    const x0 = (transpose ? row : column) * tileDimension
    const y0 = (transpose ? column : row) * tileDimension

    let painted = 0

    for (const rec of records) {

        let x = Math.floor(rec.bin1 - x0)
        let y = Math.floor(rec.bin2 - y0)

        if (transpose) {
            const t = y
            y = x
            x = t
        }

        let rgba

        switch (displayMode) {

            case 'AOB':
            case 'BOA': {
                const controlRec = controlRecords[rec.getKey()]
                if (!controlRec) continue    // Skip
                const score = (rec.counts / averageCount) / (controlRec.counts / ctrlAverageCount)
                rgba = ratioColorScale.getColor(score)
                break
            }

            case 'AMB': {
                const controlRec = controlRecords[rec.getKey()]
                if (!controlRec) continue    // Skip
                const score = averageAcrossMapAndControl * ((rec.counts / averageCount) - (controlRec.counts / ctrlAverageCount))
                rgba = diffColorScale.getColor(score)
                break
            }

            default:    // Either 'A' or 'B'
                rgba = colorScale.getColor(rec.counts)
        }

        setPixel(buf, x, y, rgba.red, rgba.green, rgba.blue, rgba.alpha)
        if (onDiagonal) {
            setPixel(buf, y, x, rgba.red, rgba.green, rgba.blue, rgba.alpha)
        }

        painted++
    }

    return painted
}

export {
    tileKey,
    colorScaleKey,
    tileGrid,
    bZoomIndex,
    resolveDisplayMode,
    computePercentile,
    autoThreshold,
    indexControlRecords,
    paintRecords
}
