import {describe, it, expect} from 'vitest'
import {
    tileKey,
    colorScaleKey,
    tileGrid,
    bZoomIndex,
    resolveDisplayMode,
    computePercentile,
    autoThreshold
} from '../js/imageTileCore.js'

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

/**
 * Datasets stand in for HiCDataset. Only the two resolution-lookup methods are
 * exercised, and both are pure lookups over a bin-size array.
 */
const datasetWith = (resolutions) => ({
    bpResolutions: resolutions,
    getBinSizeForZoomIndex: (index) => resolutions[index],
    getZoomIndexForBinSize: (binSize) => resolutions.indexOf(binSize)
})

describe('bZoomIndex', () => {

    it('matches maps by resolution, not by index', () => {
        const a = datasetWith([1000000, 500000, 100000])
        const b = datasetWith([500000, 100000])
        // index 2 on A is 100kb, which is index 1 on B
        expect(bZoomIndex(a, b, 2)).toBe(1)
    })

    it('is the identity when both maps carry the same resolutions', () => {
        const res = [1000000, 500000, 100000]
        expect(bZoomIndex(datasetWith(res), datasetWith(res), 1)).toBe(1)
    })

    it('throws when the zoom index is absent from the primary map', () => {
        const a = datasetWith([1000000])
        const b = datasetWith([1000000])
        expect(() => bZoomIndex(a, b, 5)).toThrow(/Invalid zoom \(resolution\) index: 5/)
    })

    it('throws when the resolution is absent from the control map', () => {
        const a = datasetWith([1000000, 25000])
        const b = datasetWith([1000000])
        expect(() => bZoomIndex(a, b, 1)).toThrow(/Invalid binSize for "B" map: 25000/)
    })
})

describe('resolveDisplayMode', () => {

    const a = datasetWith([1000000, 500000, 100000])
    const b = datasetWith([500000, 100000])

    it('A renders the primary map alone and translates nothing', () => {
        expect(resolveDisplayMode(a, b, 2, 'A')).toEqual({ds: a, dsControl: null, zoom: 2, controlZoom: undefined})
    })

    it('A leaves the zoom index untouched even with no control map loaded', () => {
        expect(resolveDisplayMode(a, null, 2, 'A')).toEqual({ds: a, dsControl: null, zoom: 2, controlZoom: undefined})
    })

    it('B renders the control map as if it were primary, at the translated index', () => {
        expect(resolveDisplayMode(a, b, 2, 'B')).toEqual({ds: b, dsControl: null, zoom: 1, controlZoom: undefined})
    })

    it('AOB keeps A primary and translates only the control zoom', () => {
        expect(resolveDisplayMode(a, b, 2, 'AOB')).toEqual({ds: a, dsControl: b, zoom: 2, controlZoom: 1})
    })

    it('AMB resolves identically to AOB -- they differ only in how scores combine', () => {
        expect(resolveDisplayMode(a, b, 2, 'AMB')).toEqual(resolveDisplayMode(a, b, 2, 'AOB'))
    })

    it('BOA swaps the roles: B is primary at the translated index, A is control at the original', () => {
        expect(resolveDisplayMode(a, b, 2, 'BOA')).toEqual({ds: b, dsControl: a, zoom: 1, controlZoom: 2})
    })

    it('BOA control zoom is the incoming index, not the translated one', () => {
        // Guards the ordering: translating zoom before capturing controlZoom
        // would leave both at the B index.
        const {zoom, controlZoom} = resolveDisplayMode(a, b, 2, 'BOA')
        expect(controlZoom).toBe(2)
        expect(zoom).toBe(1)
    })

    it('an unrecognised display mode falls through to primary-only', () => {
        expect(resolveDisplayMode(a, b, 2, 'nonsense')).toEqual({ds: a, dsControl: null, zoom: 2, controlZoom: undefined})
    })
})

const recordsWithCounts = (counts) => counts.map(c => ({counts: c}))

describe('computePercentile', () => {

    it('returns the value at the p-th percentile of sorted counts', () => {
        const records = recordsWithCounts([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        expect(computePercentile(records, 50)).toBe(6)
    })

    it('sorts numerically, not lexicographically', () => {
        // A default Array.sort would order these as 10, 100, 9, 90.
        const records = recordsWithCounts([100, 9, 90, 10])
        expect(computePercentile(records, 0)).toBe(9)
    })

    it('is independent of input order', () => {
        const ascending = recordsWithCounts([1, 2, 3, 4])
        const shuffled = recordsWithCounts([3, 1, 4, 2])
        expect(computePercentile(shuffled, 50)).toBe(computePercentile(ascending, 50))
    })

    it('returns undefined for no records', () => {
        expect(computePercentile([], 95)).toBeUndefined()
    })

    it('returns undefined at the 100th percentile -- the index lands past the end', () => {
        expect(computePercentile(recordsWithCounts([1, 2, 3]), 100)).toBeUndefined()
    })
})

describe('autoThreshold', () => {

    // 100 records with counts 1..100. The 95th percentile lands on 96,
    // the 75th on 76.
    const hicRecords = recordsWithCounts(Array.from({length: 100}, (_, i) => i + 1))

    it('uses the 95th percentile for .hic maps', () => {
        expect(autoThreshold(hicRecords, {isLive: false, isWholeGenome: false})).toBe(96)
    })

    it('scales x4 at whole-genome view for .hic maps', () => {
        expect(autoThreshold(hicRecords, {isLive: false, isWholeGenome: true})).toBe(384)
    })

    it('uses the 75th percentile for live maps', () => {
        const frequencies = recordsWithCounts(Array.from({length: 100}, (_, i) => (i + 1) / 1000))
        expect(autoThreshold(frequencies, {isLive: true, isWholeGenome: false})).toBeCloseTo(0.076)
    })

    it('clamps live maps to the frequency ceiling of 1', () => {
        const frequencies = recordsWithCounts([0.5, 0.9, 1, 1, 1, 1])
        expect(autoThreshold(frequencies, {isLive: true, isWholeGenome: false})).toBe(1)
    })

    it('does not apply the whole-genome x4 to live maps -- it would overshoot the ceiling', () => {
        const frequencies = recordsWithCounts(Array.from({length: 100}, (_, i) => (i + 1) / 1000))
        expect(autoThreshold(frequencies, {isLive: true, isWholeGenome: true}))
            .toBe(autoThreshold(frequencies, {isLive: true, isWholeGenome: false}))
    })

    it('returns undefined when all blocks are empty', () => {
        expect(autoThreshold([], {isLive: false, isWholeGenome: false})).toBeUndefined()
        expect(autoThreshold([], {isLive: true, isWholeGenome: true})).toBeUndefined()
    })

    it('never returns a whole-genome scaled value from an empty set', () => {
        // Guards against the x4 being applied to undefined and yielding NaN.
        expect(autoThreshold([], {isLive: false, isWholeGenome: true})).toBeUndefined()
    })
})
