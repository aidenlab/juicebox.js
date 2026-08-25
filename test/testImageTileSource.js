import {describe, it, expect} from 'vitest'
import ImageTileSource from '../js/imageTileSource.js'

/**
 * ImageTileSource is exercised end to end with plain-object fakes. Nothing here
 * needs a browser, a canvas, a network or a HICBrowser -- which is the point of
 * the lift. See issue #428.
 */

const TILE = 10

// -- fakes ----------------------------------------------------------------

const record = (bin1, bin2, counts) => ({
    bin1, bin2, counts,
    getKey: () => `${bin1}_${bin2}`
})

/**
 * Stands in for a canvas. Records every getImageData/putImageData round trip so
 * tests can read the pixels the source produced.
 */
const stubTile = (dimension) => {
    const buf = {
        width: dimension,
        height: dimension,
        data: new Uint8ClampedArray(dimension * dimension * 4)
    }
    return {
        width: dimension,
        height: dimension,
        buf,
        getContext: () => ({
            getImageData: () => buf,
            putImageData: () => { /* buffer is already the live one */ }
        })
    }
}

const zoomData = ({binSize = 1000, unit = 'BP', chr1Index = 1, chr2Index = 1, averageCount = 1} = {}) => ({
    chr1: {name: 'chr1', index: chr1Index},
    chr2: {name: chr1Index === chr2Index ? 'chr1' : 'chr2', index: chr2Index},
    zoom: {binSize, unit},
    averageCount
})

/**
 * Stands in for HiCDataset. `records` is consulted for every getContactRecords
 * call; `calls` records the arguments so tests can assert on fetch behavior.
 */
const dataset = ({
                     records = [],
                     resolutions = [1000],
                     normalizations = ['NONE', 'KR'],
                     isLive = false,
                     zd = zoomData()
                 } = {}) => {
    const calls = []
    return {
        isLive,
        calls,
        bpResolutions: resolutions,
        getBinSizeForZoomIndex: (i) => resolutions[i],
        getZoomIndexForBinSize: (b) => resolutions.indexOf(b),
        // Async, as `Dataset.hasNormalizationVector` is (js/hicDataset.js:322).
        // It was a plain function here until #372, and a plain function is
        // exactly what hid the production bug: an un-awaited call returns a
        // Promise, and every Promise is truthy, so the check could never say
        // "no" against the real dataset while passing here.
        hasNormalizationVector: async (norm) => normalizations.includes(norm),
        getMatrix: async () => ({getZoomDataByIndex: () => zd}),
        // A declared rung is an identity here; the sentinel path has its own
        // suite. See ADR-0010.
        matrixViewForZoom: (chr1, chr2, zoom) => ({chr1, chr2, zoomIndex: zoom}),
        getContactRecords: async (norm, r1, r2, unit, binSize, forScale) => {
            calls.push({norm, r1, r2, unit, binSize, forScale: !!forScale})
            return records
        }
    }
}

/**
 * Stands in for ColorScale. Carries r/g/b because the automatic scale path
 * replaces the scale with `new ColorScale(previous)`, which copies those
 * fields -- a fake without them yields undefined colour components.
 */
const scale = (red = 1) => ({
    threshold: 100,
    r: red, g: 0, b: 0,
    setThreshold(t) { this.threshold = t },
    getColor: () => ({red, green: 0, blue: 0, alpha: 255})
})

// The source issues two kinds of fetch: one scale-only probe per threshold
// computation, and one per uncached tile. Most assertions care about the tiles.
const tileFetches = (ds) => ds.calls.filter(c => !c.forScale).length
const scaleFetches = (ds) => ds.calls.filter(c => c.forScale).length

const state = (over = {}) => ({
    chr1: 1, chr2: 1, x: 0, y: 0, zoom: 0, pixelSize: 1, normalization: 'NONE',
    ...over
})

const request = (over = {}) => ({
    dataset: dataset(),
    controlDataset: null,
    state: state(),
    displayMode: 'A',
    viewDimensions: {width: TILE, height: TILE},
    ...over
})

const makeSource = (over = {}) => new ImageTileSource({
    colorScale: scale(),
    ratioColorScale: scale(2),
    createTile: stubTile,
    tileDimension: TILE,
    ...over
})

const collect = async (iterable) => {
    const out = []
    for await (const item of iterable) out.push(item)
    return out
}

const recordingObserver = () => {
    const seen = {scales: [], fallbacks: [], loading: []}
    return {
        seen,
        colorScaleChanged: (s) => seen.scales.push(s),
        normalizationSubstituted: (req, eff) => seen.fallbacks.push([req, eff]),
        loadingChanged: (b) => seen.loading.push(b)
    }
}

// -- tests ----------------------------------------------------------------

describe('ImageTileSource.tilesFor', () => {

    it('yields one tile per grid cell, row-major', async () => {
        const tiles = await collect(makeSource().tilesFor(request()))
        expect(tiles.map(t => [t.row, t.column])).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]])
    })

    it('yields progressively rather than resolving everything first', async () => {
        // If the generator gathered all tiles before yielding, the dataset would
        // show 4 fetches before the first tile arrived.
        const ds = dataset({records: [record(0, 0, 5)]})
        const it = makeSource().tilesFor(request({dataset: ds}))

        await it.next()
        const afterFirst = tileFetches(ds)
        await collect(it)

        expect(afterFirst).toBe(1)
        expect(tileFetches(ds)).toBe(4)
    })

    it('carries binSize on every tile so the caller can express genomic extent', async () => {
        const ds = dataset({zd: zoomData({binSize: 25000})})
        const tiles = await collect(makeSource().tilesFor(request({dataset: ds})))
        expect(tiles.every(t => t.binSize === 25000)).toBe(true)
    })

    it('rasterizes records into the tile it was handed', async () => {
        const ds = dataset({records: [record(3, 4, 50)]})
        const tiles = await collect(makeSource({colorScale: scale(99)}).tilesFor(request({dataset: ds})))

        const origin = tiles.find(t => t.row === 0 && t.column === 0)
        const i = (3 + 4 * TILE) * 4
        expect([origin.image.buf.data[i], origin.image.buf.data[i + 3]]).toEqual([99, 255])
    })

    it('reads the whole-genome matrix at the sentinel rung', async () => {
        // ADR-0010 decision 3. The rung is synthesised, but the data behind it
        // is the `All` matrix -- queried in the `All` matrix's own coordinates,
        // exactly as the whole-genome view queries it today. The source asks the
        // dataset which matrix carries the view rather than assuming the state's
        // chromosomes do.
        const asked = []
        const wholeGenomeZd = zoomData({binSize: 4800, chr1Index: 0, chr2Index: 0})
        const ds = {
            ...dataset(),
            matrixViewForZoom: (chr1, chr2, zoom) =>
                -1 === zoom ? {chr1: 0, chr2: 0, zoomIndex: 0} : {chr1, chr2, zoomIndex: zoom},
            getMatrix: async (chr1, chr2) => {
                asked.push([chr1, chr2])
                return {getZoomDataByIndex: () => wholeGenomeZd}
            }
        }

        const tiles = await collect(makeSource().tilesFor(request({
            dataset: ds,
            state: {chr1: 1, chr2: 1, zoom: -1, x: 0, y: 0, pixelSize: 1, normalization: 'NONE'}
        })))

        expect(asked).toEqual([[0, 0]])
        expect(tiles.every(t => t.binSize === 4800)).toBe(true)
    })

    it('does not request a raster context when there are no records', async () => {
        // Guards the records.length > 0 branch: an empty tile stays blank
        // rather than round-tripping through getImageData.
        const tiles = await collect(makeSource().tilesFor(request()))
        expect(tiles.every(t => t.image.buf.data.every(byte => byte === 0))).toBe(true)
    })
})

describe('ImageTileSource caching', () => {

    it('serves a repeated pass from cache without refetching', async () => {
        const ds = dataset({records: [record(0, 0, 5)]})
        const source = makeSource()

        await collect(source.tilesFor(request({dataset: ds})))
        const afterFirstPass = ds.calls.length
        await collect(source.tilesFor(request({dataset: ds})))

        expect(ds.calls.length).toBe(afterFirstPass)
    })

    it('reuses tiles when only pixelSize changes -- scaling happens at paint time', async () => {
        const ds = dataset({records: [record(0, 0, 5)]})
        const source = makeSource()

        await collect(source.tilesFor(request({dataset: ds})))
        const afterFirst = tileFetches(ds)
        await collect(source.tilesFor(request({dataset: ds, state: state({pixelSize: 1})})))

        expect(tileFetches(ds)).toBe(afterFirst)
    })

    it('returns the identical tile object on a cache hit', async () => {
        const source = makeSource()
        const first = await collect(source.tilesFor(request()))
        const second = await collect(source.tilesFor(request()))
        expect(second[0]).toBe(first[0])
    })

    it('refetches after invalidate', async () => {
        const ds = dataset({records: [record(0, 0, 5)]})
        const source = makeSource()

        await collect(source.tilesFor(request({dataset: ds})))
        source.invalidate()
        await collect(source.tilesFor(request({dataset: ds})))

        expect(tileFetches(ds)).toBe(8)
        expect(scaleFetches(ds)).toBe(1)    // thresholds survive invalidate()
    })

    it('keys tiles by normalization, so switching normalization misses the cache', async () => {
        const ds = dataset({records: [record(0, 0, 5)]})
        const source = makeSource()

        await collect(source.tilesFor(request({dataset: ds})))
        await collect(source.tilesFor(request({dataset: ds, state: state({normalization: 'KR'})})))

        expect(tileFetches(ds)).toBe(8)
    })

    it('evicts the oldest tile once the retained count is exceeded', async () => {
        const ds = dataset({records: [record(0, 0, 5)]})
        // One tile per pass, retaining two.
        const source = makeSource({cacheLimit: 2})
        const oneTile = {width: 1, height: 1}

        for (const x of [0, TILE, TILE * 2]) {
            await collect(source.tilesFor(request({
                dataset: ds, state: state({x}), viewDimensions: oneTile
            })))
        }

        expect(source.cacheKeys.length).toBe(2)
        expect(Object.keys(source.cache).length).toBe(2)
    })

    it('keeps cache and cacheKeys in step', async () => {
        // The original eviction shifted cacheKeys but never pushed to it, so the
        // two structures diverged and the cache grew without bound.
        const ds = dataset({records: [record(0, 0, 5)]})
        const source = makeSource({cacheLimit: 2})
        const oneTile = {width: 1, height: 1}

        for (const x of [0, TILE, TILE * 2, TILE * 3]) {
            await collect(source.tilesFor(request({
                dataset: ds, state: state({x}), viewDimensions: oneTile
            })))
        }

        expect(source.cacheKeys.length).toBe(Object.keys(source.cache).length)
        expect(source.cacheKeys.every(k => k in source.cache)).toBe(true)
    })

    it('never evicts a tile the current view still needs', async () => {
        // Regression guard. A 1000x1000 viewport can span 9 tiles and a
        // 1920x1080 one 12, against a default limit of 8 -- honouring the limit
        // literally would evict tiles mid-pass and refetch them every repaint.
        const ds = dataset({records: [record(0, 0, 5)]})
        const source = makeSource({cacheLimit: 2})
        const fourTiles = {width: TILE, height: TILE}   // 2x2 grid

        await collect(source.tilesFor(request({dataset: ds, viewDimensions: fourTiles})))
        const afterFirst = tileFetches(ds)
        await collect(source.tilesFor(request({dataset: ds, viewDimensions: fourTiles})))

        expect(afterFirst).toBe(4)
        expect(tileFetches(ds)).toBe(4)      // second pass entirely cached
    })

    it('caches nothing when the limit is zero', async () => {
        const ds = dataset({records: [record(0, 0, 5)]})
        const source = makeSource({cacheLimit: 0})

        await collect(source.tilesFor(request({dataset: ds})))
        await collect(source.tilesFor(request({dataset: ds})))

        expect(source.cacheKeys.length).toBe(0)
        expect(tileFetches(ds)).toBe(8)      // every pass refetches
    })

    it('retains two screenfuls, so A/B cycling stays cached', async () => {
        const primary = dataset({records: [record(0, 0, 5)]})
        const control = dataset({records: [record(0, 0, 9)]})
        const source = makeSource({cacheLimit: 2})
        const fourTiles = {width: TILE, height: TILE}

        const pass = (displayMode) => collect(source.tilesFor(request({
            dataset: primary, controlDataset: control, displayMode, viewDimensions: fourTiles
        })))

        await pass('A')
        await pass('B')
        const afterCycle = primary.calls.length + control.calls.length
        await pass('A')                      // back to A -- should be cached

        expect(primary.calls.length + control.calls.length).toBe(afterCycle)
    })

    it('does not key tiles by pan position -- panning within a tile reuses it', async () => {
        const ds = dataset({records: [record(0, 0, 5)]})
        const source = makeSource()

        await collect(source.tilesFor(request({dataset: ds})))
        const afterFirst = ds.calls.length
        // x moves but stays inside tile column 0
        await collect(source.tilesFor(request({dataset: ds, state: state({x: 2})})))

        expect(ds.calls.length).toBe(afterFirst)
    })
})

describe('ImageTileSource normalization fallback', () => {

    it('renders with the requested normalization when it is available', async () => {
        const observer = recordingObserver()
        const ds = dataset({normalizations: ['NONE', 'KR']})
        await collect(makeSource({observer}).tilesFor(
            request({dataset: ds, state: state({normalization: 'KR'})})))

        expect(observer.seen.fallbacks).toEqual([])
        expect(ds.calls.every(c => c.norm === 'KR')).toBe(true)
    })

    it('falls back to NONE and reports when the vector is unavailable', async () => {
        const observer = recordingObserver()
        const ds = dataset({normalizations: ['NONE']})
        await collect(makeSource({observer}).tilesFor(
            request({dataset: ds, state: state({normalization: 'KR'})})))

        expect(observer.seen.fallbacks).toEqual([['KR', 'NONE']])
        expect(ds.calls.every(c => c.norm === 'NONE')).toBe(true)
    })

    it('never mutates canonical state', async () => {
        const s = state({normalization: 'KR'})
        await collect(makeSource().tilesFor(
            request({dataset: dataset({normalizations: ['NONE']}), state: s})))

        expect(s.normalization).toBe('KR')
    })

    it('does not consult the dataset when normalization is already NONE', async () => {
        let asked = false
        const ds = dataset()
        ds.hasNormalizationVector = async () => { asked = true; return true }
        await collect(makeSource().tilesFor(request({dataset: ds})))
        expect(asked).toBe(false)
    })
})

describe('ImageTileSource automatic color scale', () => {

    const manyRecords = Array.from({length: 100}, (_, i) => record(0, 0, i + 1))

    it('computes a threshold from a dedicated scale-only fetch', async () => {
        const observer = recordingObserver()
        const ds = dataset({records: manyRecords})
        await collect(makeSource({observer}).tilesFor(request({dataset: ds})))

        expect(ds.calls.filter(c => c.forScale).length).toBe(1)
        expect(observer.seen.scales.length).toBe(1)
        expect(observer.seen.scales[0].threshold).toBe(96)   // 95th percentile
    })

    it('memoizes the threshold across passes at the same zoom', async () => {
        const ds = dataset({records: manyRecords})
        const source = makeSource()

        await collect(source.tilesFor(request({dataset: ds})))
        source.invalidate()                       // drop rasters, keep thresholds
        await collect(source.tilesFor(request({dataset: ds})))

        expect(ds.calls.filter(c => c.forScale).length).toBe(1)
    })

    it('recomputes after invalidate({thresholds: true})', async () => {
        const ds = dataset({records: manyRecords})
        const source = makeSource()

        await collect(source.tilesFor(request({dataset: ds})))
        source.invalidate({thresholds: true})
        await collect(source.tilesFor(request({dataset: ds})))

        expect(ds.calls.filter(c => c.forScale).length).toBe(2)
    })

    it('leaves ratio modes alone -- their scale is user-driven', async () => {
        const observer = recordingObserver()
        const control = dataset({records: manyRecords})
        const ds = dataset({records: manyRecords})

        await collect(makeSource({observer}).tilesFor(
            request({dataset: ds, controlDataset: control, displayMode: 'AOB'})))

        expect(ds.calls.filter(c => c.forScale).length).toBe(0)
        expect(observer.seen.scales).toEqual([])
    })

    it('leaves the difference mode alone -- a count threshold does not describe a difference', async () => {
        const observer = recordingObserver()
        const control = dataset({records: manyRecords})
        const ds = dataset({records: manyRecords})

        await collect(makeSource({observer, diffColorScale: scale(2)}).tilesFor(
            request({dataset: ds, controlDataset: control, displayMode: 'AMB'})))

        expect(ds.calls.filter(c => c.forScale).length).toBe(0)
        expect(observer.seen.scales).toEqual([])
    })

    it('applies the live-map heuristic when the dataset is live', async () => {
        const observer = recordingObserver()
        const frequencies = Array.from({length: 100}, (_, i) => record(0, 0, (i + 1) / 1000))
        await collect(makeSource({observer}).tilesFor(
            request({dataset: dataset({records: frequencies, isLive: true})})))

        // 75th percentile of the frequencies, not the 95th
        expect(observer.seen.scales[0].threshold).toBeCloseTo(0.076)
    })

    it('emits no color scale change when no threshold can be computed', async () => {
        const observer = recordingObserver()
        await collect(makeSource({observer}).tilesFor(request()))
        expect(observer.seen.scales).toEqual([])
    })
})

describe('ImageTileSource loading signal', () => {

    it('is balanced across a pass', async () => {
        const observer = recordingObserver()
        await collect(makeSource({observer}).tilesFor(
            request({dataset: dataset({records: [record(0, 0, 5)]})})))

        const opens = observer.seen.loading.filter(Boolean).length
        const closes = observer.seen.loading.filter(b => !b).length
        expect(opens).toBe(closes)
    })

    it('stays quiet on a fully cached pass', async () => {
        // Needs records: with none, autoThreshold yields undefined, nothing is
        // memoized, and every pass re-probes for a scale.
        const ds = dataset({records: [record(0, 0, 5)]})
        const source = makeSource()
        await collect(source.tilesFor(request({dataset: ds})))

        const observer = recordingObserver()
        source.observer = observer
        await collect(source.tilesFor(request({dataset: ds})))

        expect(observer.seen.loading).toEqual([])
    })

    it('re-probes for a scale on every pass when the region is empty', async () => {
        // Documents a pre-existing quirk carried over from checkColorScale: an
        // uncomputable threshold is never memoized, so an empty region pays for
        // a scale-only fetch on every repaint.
        const ds = dataset({records: []})
        const source = makeSource()

        await collect(source.tilesFor(request({dataset: ds})))
        await collect(source.tilesFor(request({dataset: ds})))

        expect(scaleFetches(ds)).toBe(2)
    })
})

describe('ImageTileSource display modes', () => {

    it('renders the control map in mode B', async () => {
        const primary = dataset({records: [record(0, 0, 5)]})
        const control = dataset({records: [record(0, 0, 9)]})

        await collect(makeSource().tilesFor(
            request({dataset: primary, controlDataset: control, displayMode: 'B'})))

        expect(primary.calls.length).toBe(0)
        expect(control.calls.length).toBeGreaterThan(0)
    })

    it('fetches from both maps in AOB', async () => {
        const primary = dataset({records: [record(0, 0, 5)]})
        const control = dataset({records: [record(0, 0, 9)]})

        await collect(makeSource().tilesFor(
            request({dataset: primary, controlDataset: control, displayMode: 'AOB'})))

        expect(primary.calls.length).toBeGreaterThan(0)
        expect(control.calls.length).toBeGreaterThan(0)
    })

    it('fetches from both maps in AMB', async () => {
        const primary = dataset({records: [record(0, 0, 5)]})
        const control = dataset({records: [record(0, 0, 9)]})

        await collect(makeSource({diffColorScale: scale(2)}).tilesFor(
            request({dataset: primary, controlDataset: control, displayMode: 'AMB'})))

        expect(primary.calls.length).toBeGreaterThan(0)
        expect(control.calls.length).toBeGreaterThan(0)
    })

    it('selects a scale per display mode', () => {
        const diffColorScale = scale(2)
        const source = makeSource({diffColorScale})
        expect(source.getColorScale('AMB')).toBe(diffColorScale)
        expect(source.getColorScale('AOB')).not.toBe(diffColorScale)
        expect(source.getColorScale('A')).not.toBe(diffColorScale)
    })

    it('keys tiles by display mode', async () => {
        const primary = dataset({records: [record(0, 0, 5)]})
        const control = dataset({records: [record(0, 0, 9)]})
        const source = makeSource()

        await collect(source.tilesFor(request({dataset: primary, controlDataset: control, displayMode: 'A'})))
        const afterA = primary.calls.length
        await collect(source.tilesFor(request({dataset: primary, controlDataset: control, displayMode: 'AOB'})))

        expect(primary.calls.length).toBeGreaterThan(afterA)
    })
})
