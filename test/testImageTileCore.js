import {describe, it, expect} from 'vitest'
import {
    tileKey,
    colorScaleKey,
    tileGrid,
    bZoomIndex,
    resolveDisplayMode,
    computePercentile,
    autoThreshold,
    indexControlRecords,
    paintRecords
} from '../js/imageTileCore.js'
import DiffColorScale, {defaultDiffColorScaleConfig} from '../js/diffColorScale.js'

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

    it('carries the sentinel rung through unchanged', () => {
        // Both maps synthesise it from their own `wholeGenomeResolution`, and
        // genomes must match, so there is nothing to look up on either side --
        // and nothing for the "absent from the primary map" throw to catch.
        // ADR-0010.
        const a = datasetWith([1000000, 500000])
        const b = datasetWith([500000, 100000])
        expect(bZoomIndex(a, b, -1)).toBe(-1)
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

/**
 * A pixel buffer shaped like ImageData. In production this comes from
 * getImageData on a tile canvas; here it is a plain object, which is the whole
 * point of paintRecords taking a buffer rather than a context.
 */
const pixelBuffer = (width, height = width) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4)
})

const pixelAt = (buf, x, y) => {
    const i = (x + y * buf.width) * 4
    return [buf.data[i], buf.data[i + 1], buf.data[i + 2], buf.data[i + 3]]
}

const BLANK = [0, 0, 0, 0]

const record = (bin1, bin2, counts) => ({
    bin1,
    bin2,
    counts,
    getKey: () => `${bin1}_${bin2}`
})

// Encodes the count into the red channel so tests can tell which record
// painted which pixel.
const countScale = {getColor: (v) => ({red: v, green: 0, blue: 0, alpha: 255})}
const constantScale = (red) => ({getColor: () => ({red, green: 0, blue: 0, alpha: 255})})

const basePlan = (overrides = {}) => ({
    displayMode: 'A',
    tileDimension: 10,
    sameChr: false,
    averageCount: 1,
    ctrlAverageCount: 1,
    colorScale: countScale,
    ratioColorScale: constantScale(50),
    diffColorScale: constantScale(60),
    ...overrides
})

describe('indexControlRecords', () => {

    it('indexes by bin pair for the combining modes', () => {
        const recs = [record(1, 2, 10), record(3, 4, 20)]
        for (const mode of ['AOB', 'BOA', 'AMB']) {
            expect(Object.keys(indexControlRecords(recs, mode))).toEqual(['1_2', '3_4'])
        }
    })

    it('returns an empty index for single-map modes, which never consult it', () => {
        const recs = [record(1, 2, 10)]
        expect(indexControlRecords(recs, 'A')).toEqual({})
        expect(indexControlRecords(recs, 'B')).toEqual({})
    })

    it('does not touch the record list for single-map modes', () => {
        // cRecords is undefined whenever there is no control zoom data,
        // so the guard must short-circuit before iterating.
        expect(() => indexControlRecords(undefined, 'A')).not.toThrow()
    })
})

describe('paintRecords', () => {

    describe('single-map modes', () => {

        it('places a record at its bin position relative to the tile origin', () => {
            const buf = pixelBuffer(10)
            paintRecords(buf, [record(3, 4, 77)], {}, basePlan(), 0, 0)
            expect(pixelAt(buf, 3, 4)).toEqual([77, 0, 0, 255])
        })

        it('subtracts the tile origin so tile (1,1) starts over at pixel 0', () => {
            const buf = pixelBuffer(10)
            paintRecords(buf, [record(12, 13, 88)], {}, basePlan(), 1, 1)
            expect(pixelAt(buf, 2, 3)).toEqual([88, 0, 0, 255])
        })

        it('colors by raw count in mode A', () => {
            const buf = pixelBuffer(10)
            paintRecords(buf, [record(1, 1, 42)], {}, basePlan({displayMode: 'A'}), 0, 0)
            expect(pixelAt(buf, 1, 1)[0]).toBe(42)
        })

        it('colors by raw count in mode B as well', () => {
            const buf = pixelBuffer(10)
            paintRecords(buf, [record(1, 1, 42)], {}, basePlan({displayMode: 'B'}), 0, 0)
            expect(pixelAt(buf, 1, 1)[0]).toBe(42)
        })

        it('returns the number of records painted', () => {
            const buf = pixelBuffer(10)
            const painted = paintRecords(buf, [record(1, 1, 1), record(2, 2, 2)], {}, basePlan(), 0, 0)
            expect(painted).toBe(2)
        })

        it('leaves untouched pixels transparent', () => {
            const buf = pixelBuffer(10)
            paintRecords(buf, [record(3, 4, 77)], {}, basePlan(), 0, 0)
            expect(pixelAt(buf, 0, 0)).toEqual(BLANK)
        })
    })

    describe('diagonal reflection', () => {

        it('reflects across the diagonal on an on-diagonal intra-chromosomal tile', () => {
            const buf = pixelBuffer(10)
            paintRecords(buf, [record(2, 5, 33)], {}, basePlan({sameChr: true}), 0, 0)
            expect(pixelAt(buf, 2, 5)).toEqual([33, 0, 0, 255])
            expect(pixelAt(buf, 5, 2)).toEqual([33, 0, 0, 255])
        })

        it('does not reflect on an off-diagonal tile', () => {
            const buf = pixelBuffer(10)
            paintRecords(buf, [record(2, 15, 33)], {}, basePlan({sameChr: true}), 1, 0)
            expect(pixelAt(buf, 2, 5)).toEqual([33, 0, 0, 255])
            expect(pixelAt(buf, 5, 2)).toEqual(BLANK)
        })

        it('does not reflect for inter-chromosomal data, where the diagonal is meaningless', () => {
            const buf = pixelBuffer(10)
            paintRecords(buf, [record(2, 5, 33)], {}, basePlan({sameChr: false}), 0, 0)
            expect(pixelAt(buf, 2, 5)).toEqual([33, 0, 0, 255])
            expect(pixelAt(buf, 5, 2)).toEqual(BLANK)
        })
    })

    describe('transpose above the diagonal', () => {

        it('does not transpose below the diagonal', () => {
            const buf = pixelBuffer(10)
            paintRecords(buf, [record(3, 12, 55)], {}, basePlan({sameChr: true}), 1, 0)
            expect(pixelAt(buf, 3, 2)).toEqual([55, 0, 0, 255])
        })

        it('transposes tiles above the diagonal, mirroring their below-diagonal twin', () => {
            // Intra-chromosomal data is stored lower-diagonal, so an above-diagonal
            // query returns the mirrored block: bins arrive in row/column order
            // rather than column/row. The tile origins swap to match, then x and y
            // swap back. Net effect is that tile (0,1) mirrors tile (1,0).
            const below = pixelBuffer(10)
            const above = pixelBuffer(10)

            paintRecords(below, [record(3, 12, 55)], {}, basePlan({sameChr: true}), 1, 0)
            paintRecords(above, [record(3, 12, 55)], {}, basePlan({sameChr: true}), 0, 1)

            expect(pixelAt(below, 3, 2)).toEqual([55, 0, 0, 255])
            expect(pixelAt(above, 2, 3)).toEqual([55, 0, 0, 255])
            expect(pixelAt(above, 3, 2)).toEqual(BLANK)
        })

        it('does not transpose inter-chromosomal tiles above the diagonal', () => {
            // transpose is gated on sameChr; chr1 != chr2 has no symmetry to exploit.
            const buf = pixelBuffer(10)
            paintRecords(buf, [record(12, 3, 55)], {}, basePlan({sameChr: false}), 0, 1)
            expect(pixelAt(buf, 2, 3)).toEqual([55, 0, 0, 255])
        })
    })

    describe('AOB / BOA ratio mode', () => {

        const plan = basePlan({
            displayMode: 'AOB',
            averageCount: 2,
            ctrlAverageCount: 4,
            ratioColorScale: countScale     // surface the score in the red channel
        })

        it('scores the ratio of normalized counts', () => {
            const buf = pixelBuffer(10)
            const controls = indexControlRecords([record(1, 1, 8)], 'AOB')
            paintRecords(buf, [record(1, 1, 10)], controls, plan, 0, 0)
            // (10 / 2) / (8 / 4) = 2.5
            expect(pixelAt(buf, 1, 1)[0]).toBe(2.5 | 0)
        })

        it('skips records with no matching control record', () => {
            const buf = pixelBuffer(10)
            const painted = paintRecords(buf, [record(1, 1, 10)], {}, plan, 0, 0)
            expect(painted).toBe(0)
            expect(pixelAt(buf, 1, 1)).toEqual(BLANK)
        })

        it('paints only the records that do match', () => {
            const buf = pixelBuffer(10)
            const controls = indexControlRecords([record(1, 1, 8)], 'AOB')
            const painted = paintRecords(buf, [record(1, 1, 10), record(2, 2, 10)], controls, plan, 0, 0)
            expect(painted).toBe(1)
            expect(pixelAt(buf, 2, 2)).toEqual(BLANK)
        })

        it('BOA uses the same scoring as AOB', () => {
            const bufA = pixelBuffer(10)
            const bufB = pixelBuffer(10)
            const controls = indexControlRecords([record(1, 1, 8)], 'AOB')
            paintRecords(bufA, [record(1, 1, 10)], controls, plan, 0, 0)
            paintRecords(bufB, [record(1, 1, 10)], controls, {...plan, displayMode: 'BOA'}, 0, 0)
            expect(pixelAt(bufA, 1, 1)).toEqual(pixelAt(bufB, 1, 1))
        })
    })

    describe('AMB difference mode', () => {

        const plan = basePlan({
            displayMode: 'AMB',
            averageCount: 2,
            ctrlAverageCount: 4,
            diffColorScale: countScale
        })

        it('scores the difference of normalized counts, scaled by the mean average', () => {
            const buf = pixelBuffer(10)
            const controls = indexControlRecords([record(1, 1, 8)], 'AMB')
            paintRecords(buf, [record(1, 1, 10)], controls, plan, 0, 0)
            // ((2 + 4) / 2) * ((10 / 2) - (8 / 4)) = 3 * 3 = 9
            expect(pixelAt(buf, 1, 1)[0]).toBe(9)
        })

        it('skips records with no matching control record', () => {
            const buf = pixelBuffer(10)
            expect(paintRecords(buf, [record(1, 1, 10)], {}, plan, 0, 0)).toBe(0)
        })

        // The failure this mode was fixed for: a difference goes negative
        // wherever B exceeds A, and a scale that logs the score turns those
        // pixels into NaN alpha -- fully transparent, silently dropping half
        // the map. See issue #426.
        it('paints both directions of the difference opaquely with the real scale', () => {
            const diffPlan = basePlan({
                displayMode: 'AMB',
                diffColorScale: new DiffColorScale(defaultDiffColorScaleConfig.threshold)
            })

            const buf = pixelBuffer(10)
            const controls = indexControlRecords([record(1, 1, 2), record(2, 2, 60)], 'AMB')
            paintRecords(buf, [record(1, 1, 60), record(2, 2, 2)], controls, diffPlan, 0, 0)

            const [, , aExceedsBlue, aExceedsAlpha] = pixelAt(buf, 1, 1)
            const [, , bExceedsBlue, bExceedsAlpha] = pixelAt(buf, 2, 2)

            expect(aExceedsAlpha).toBeGreaterThan(0)
            expect(bExceedsAlpha).toBeGreaterThan(0)
            expect(aExceedsAlpha).toBe(bExceedsAlpha)     // equal magnitudes, opposite signs
            expect(aExceedsBlue).toBe(0)                  // A > B takes the positive color
            expect(bExceedsBlue).toBe(255)                // B > A takes the negative color
        })

        it('produces a different score from AOB for the same inputs', () => {
            const bufRatio = pixelBuffer(10)
            const bufDiff = pixelBuffer(10)
            const controls = indexControlRecords([record(1, 1, 8)], 'AMB')
            paintRecords(bufRatio, [record(1, 1, 10)], controls,
                {...plan, displayMode: 'AOB', ratioColorScale: countScale}, 0, 0)
            paintRecords(bufDiff, [record(1, 1, 10)], controls, plan, 0, 0)
            expect(pixelAt(bufRatio, 1, 1)).not.toEqual(pixelAt(bufDiff, 1, 1))
        })
    })
})
