import {describe, it, expect} from 'vitest'
import {tileKey, colorScaleKey, tileGrid} from '../js/imageTileCore.js'

/**
 * Characterization tests for the pure core of the image tile source.
 *
 * These lock in behavior as it exists today, before the pipeline is lifted out
 * of ContactMatrixView. See issue #428.
 */

const zoomData = ({chr1 = 'chr1', chr2 = 'chr1', binSize = 5000, unit = 'BP'} = {}) => ({
    chr1: {name: chr1},
    chr2: {name: chr2},
    zoom: {binSize, unit}
})

describe('tileKey', () => {

    it('joins chromosome pair, resolution, unit, grid position, normalization and display mode', () => {
        const key = tileKey(zoomData(), 3, 7, 'KR', 'A')
        expect(key).toBe('chr1_chr1_5000_BP_3_7_KR_A')
    })

    it('distinguishes tiles differing only by grid position', () => {
        const zd = zoomData()
        expect(tileKey(zd, 0, 1, 'NONE', 'A')).not.toBe(tileKey(zd, 1, 0, 'NONE', 'A'))
    })

    it('distinguishes tiles differing only by normalization', () => {
        const zd = zoomData()
        expect(tileKey(zd, 0, 0, 'NONE', 'A')).not.toBe(tileKey(zd, 0, 0, 'KR', 'A'))
    })

    it('distinguishes tiles differing only by display mode', () => {
        const zd = zoomData()
        expect(tileKey(zd, 0, 0, 'NONE', 'A')).not.toBe(tileKey(zd, 0, 0, 'B', 'NONE'))
    })

    it('distinguishes tiles differing only by resolution', () => {
        expect(tileKey(zoomData({binSize: 5000}), 0, 0, 'NONE', 'A'))
            .not.toBe(tileKey(zoomData({binSize: 10000}), 0, 0, 'NONE', 'A'))
    })

    it('distinguishes inter-chromosomal tiles by axis order', () => {
        expect(tileKey(zoomData({chr1: 'chr1', chr2: 'chr2'}), 0, 0, 'NONE', 'A'))
            .not.toBe(tileKey(zoomData({chr1: 'chr2', chr2: 'chr1'}), 0, 0, 'NONE', 'A'))
    })

    it('ignores pan position and pixel size -- they affect placement, not content', () => {
        // tileKey takes no x/y/pixelSize by design; this documents the omission.
        const zd = zoomData()
        expect(tileKey(zd, 2, 2, 'NONE', 'A')).toBe(tileKey(zd, 2, 2, 'NONE', 'A'))
    })
})

describe('colorScaleKey', () => {

    const state = {chr1: 1, chr2: 1, zoom: 4, normalization: 'KR'}

    it('joins chromosome pair, zoom index, normalization and display mode', () => {
        expect(colorScaleKey(state, 'A')).toBe('1_1_4_KR_A')
    })

    it('is coarser than tileKey -- shared across every tile in the view', () => {
        expect(colorScaleKey(state, 'A')).not.toContain('BP')
        expect(colorScaleKey(state, 'A')).not.toContain('5000')
    })

    it('distinguishes states differing only by zoom index', () => {
        expect(colorScaleKey({...state, zoom: 4}, 'A')).not.toBe(colorScaleKey({...state, zoom: 5}, 'A'))
    })

    it('distinguishes states differing only by display mode', () => {
        expect(colorScaleKey(state, 'A')).not.toBe(colorScaleKey(state, 'AOB'))
    })

    it('falls back to a display-mode-scoped key when state is absent during startup', () => {
        expect(colorScaleKey(undefined, 'A')).toBe('unknown_A')
        expect(colorScaleKey(null, 'AOB')).toBe('unknown_AOB')
    })

    it('does not collide the startup fallback across display modes', () => {
        expect(colorScaleKey(undefined, 'A')).not.toBe(colorScaleKey(undefined, 'B'))
    })
})

describe('tileGrid', () => {

    const TILE = 685
    const view = {width: 685, height: 685}

    it('returns the single origin tile for a view at the origin', () => {
        expect(tileGrid({x: 0, y: 0, pixelSize: 1}, view, TILE))
            .toEqual({row1: 0, row2: 1, col1: 0, col2: 1})
    })

    it('is inclusive on both ends -- a view ending exactly on a boundary includes that tile', () => {
        // 685 bins wide starting at bin 0 reaches bin 685, which is tile 1.
        const {col1, col2} = tileGrid({x: 0, y: 0, pixelSize: 1}, view, TILE)
        expect(col1).toBe(0)
        expect(col2).toBe(1)
    })

    it('covers a single tile when the view sits strictly inside one', () => {
        expect(tileGrid({x: 10, y: 10, pixelSize: 2}, {width: 400, height: 400}, TILE))
            .toEqual({row1: 0, row2: 0, col1: 0, col2: 0})
    })

    it('advances the range as the view pans across a tile boundary', () => {
        const before = tileGrid({x: 600, y: 0, pixelSize: 4}, {width: 200, height: 200}, TILE)
        const after = tileGrid({x: 700, y: 0, pixelSize: 4}, {width: 200, height: 200}, TILE)
        expect(before.col1).toBe(0)
        expect(after.col1).toBe(1)
    })

    it('floors fractional pixelSize when deriving bin extent', () => {
        // pixelSize 1.9 floors to 1, so the view spans 685 bins, not 360.
        expect(tileGrid({x: 0, y: 0, pixelSize: 1.9}, view, TILE).col2).toBe(1)
    })

    it('floors pixelSize at 1 so sub-pixel resolutions do not divide by zero', () => {
        const grid = tileGrid({x: 0, y: 0, pixelSize: 0.25}, view, TILE)
        expect(Number.isFinite(grid.col2)).toBe(true)
        expect(grid.col2).toBe(1)
    })

    it('derives rows from y and columns from x independently', () => {
        expect(tileGrid({x: 0, y: 2000, pixelSize: 4}, {width: 100, height: 100}, TILE))
            .toEqual({row1: 2, row2: 2, col1: 0, col2: 0})
    })

    it('spans multiple tiles for a large viewport at pixelSize 1', () => {
        const grid = tileGrid({x: 0, y: 0, pixelSize: 1}, {width: 2000, height: 1400}, TILE)
        expect(grid.col2 - grid.col1).toBe(2)
        expect(grid.row2 - grid.row1).toBe(2)
    })
})
