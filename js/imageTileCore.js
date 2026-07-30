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

export { tileKey, colorScaleKey }
