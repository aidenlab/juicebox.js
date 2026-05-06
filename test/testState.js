import { describe, test, expect } from 'vitest'
import State from '../js/hicState.js'
import InteractionHandler from '../js/interactionHandler.js'

/**
 * Mock helpers for State characterization tests.
 *
 * State's collaborator surface, derived from current usage in hicState.js:
 *   browser:
 *     - minPixelSize(chr1, chr2, zoom): Promise<number>
 *     - getResolutions(): Array<{binSize, index}>
 *     - resolutionLocked: boolean
 *     - findMatchingZoomIndex(bpPerPixelTarget, bpResolutions): number
 *     - genome.getChromosome(name): {index, name, size}
 *     - contactMatrixView.getViewDimensions(): {width, height}
 *   dataset:
 *     - bpResolutions: Array<number>           (used as raw binSizes in setWithZoom/clampXY/configureLocus)
 *     - chromosomes: Array<{name, size, index}>
 *
 * Note the dual shape of resolutions: browser.getResolutions() returns objects
 * with a .binSize property; dataset.bpResolutions is a flat array of numbers.
 * Both are real and used by different methods.
 */

const DEFAULT_CHROMOSOMES = [
    { index: 0, name: 'all',  size: 3000000000 },
    { index: 1, name: 'chr1', size: 250000000 },
    { index: 2, name: 'chr2', size: 240000000 },
    { index: 3, name: 'chr3', size: 200000000 },
]

const DEFAULT_BIN_SIZES = [2500000, 1000000, 500000, 250000, 100000, 50000, 25000, 10000, 5000]

export function createMockBrowser(overrides = {}) {
    const chromosomes = overrides.chromosomes ?? DEFAULT_CHROMOSOMES
    const binSizes    = overrides.binSizes    ?? DEFAULT_BIN_SIZES
    const resolutions = binSizes.map((binSize, index) => ({ binSize, index }))

    return {
        resolutionLocked: overrides.resolutionLocked ?? false,
        minPixelSize: overrides.minPixelSize ?? (async () => 1),
        getResolutions: overrides.getResolutions ?? (() => resolutions),
        // Mirrors the real interactionHandler.findMatchingZoomIndex, which accepts
        // both shapes: an array of {binSize, index} objects (browser.getResolutions())
        // and a flat array of numbers (dataset.bpResolutions). State.sync passes the
        // latter, the others pass the former.
        findMatchingZoomIndex: overrides.findMatchingZoomIndex ?? ((targetResolution, res) => {
            const isObject = res.length > 0 && res[0].index !== undefined
            for (let z = res.length - 1; z > 0; z--) {
                const binSize = isObject ? res[z].binSize : res[z]
                const index = isObject ? res[z].index : z
                if (binSize >= targetResolution) return index
            }
            return 0
        }),
        genome: overrides.genome ?? {
            getChromosome: (name) => chromosomes.find(c => c.name === name)
        },
        contactMatrixView: overrides.contactMatrixView ?? {
            getViewDimensions: () => overrides.viewDimensions ?? { width: 800, height: 800 }
        },
    }
}

export function createMockDataset(overrides = {}) {
    return {
        chromosomes: overrides.chromosomes ?? DEFAULT_CHROMOSOMES,
        bpResolutions: overrides.bpResolutions ?? DEFAULT_BIN_SIZES,
    }
}

export const DEFAULT_VIEW_DIMENSIONS = { width: 800, height: 800 }

/** Construct a State with sensible default scalar fields, override anything via opts. */
export function createState(opts = {}) {
    return new State(
        opts.chr1 ?? 1,
        opts.chr2 ?? 1,
        opts.locus,
        opts.zoom ?? 3,
        opts.x ?? 100,
        opts.y ?? 100,
        opts.pixelSize ?? 2,
        opts.normalization ?? 'NONE',
    )
}

describe('State characterization tests — scaffolding', () => {
    test('mocks load and State constructs', () => {
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        const state = createState()

        expect(state).toBeInstanceOf(State)
        expect(browser.resolutionLocked).toBe(false)
        expect(dataset.bpResolutions.length).toBe(DEFAULT_BIN_SIZES.length)
    })
})

describe('State.getLocus — pure projection', () => {
    test('returns BP locus derived from canonical state', () => {
        const dataset = createMockDataset()
        const state = createState({ chr1: 1, chr2: 2, zoom: 3, x: 100, y: 50, pixelSize: 2 })

        const locus = state.getLocus(dataset, DEFAULT_VIEW_DIMENSIONS)

        // bpPerBin = bpResolutions[3] = 250000
        // startBP1 = 100 * 250000 = 25_000_000
        // endBP1 = min(chr1.size=250M, round(800/2 * 250000) + 25M) = min(250M, 100M + 25M) = 125M
        expect(locus.x).toEqual({ chr: 'chr1', start: 25_000_000, end: 125_000_000 })
        // startBP2 = 50 * 250000 = 12_500_000
        // endBP2 = min(chr2.size=240M, 100M + 12.5M) = 112_500_000
        expect(locus.y).toEqual({ chr: 'chr2', start: 12_500_000, end: 112_500_000 })
    })

    test('clamps end at chromosome size', () => {
        const dataset = createMockDataset()
        // x large enough that visible-end exceeds chr1.size
        const state = createState({ chr1: 1, chr2: 2, zoom: 0, x: 1000, y: 0, pixelSize: 1 })

        const locus = state.getLocus(dataset, DEFAULT_VIEW_DIMENSIONS)

        // bpPerBin at zoom=0 = 2_500_000; startBP1 = 1000 * 2.5M = 2.5B; clamped to chr1.size 250M
        expect(locus.x.end).toBe(dataset.chromosomes[1].size)
    })

    test('does not mutate this — pure function', () => {
        const dataset = createMockDataset()
        const sentinel = { x: { chr: 'sentinel' }, y: { chr: 'sentinel' } }
        const state = createState({ chr1: 1, chr2: 2, locus: sentinel })

        const result = state.getLocus(dataset, DEFAULT_VIEW_DIMENSIONS)

        // state.locus must be untouched.
        expect(state.locus).toBe(sentinel)
        // Returned object is fresh, not state.locus.
        expect(result).not.toBe(sentinel)
    })

    test('matches configureLocus output exactly (locks in equivalence during migration)', () => {
        const dataset = createMockDataset()
        const a = createState({ chr1: 1, chr2: 2, zoom: 4, x: 250, y: 175, pixelSize: 3 })
        const b = createState({ chr1: 1, chr2: 2, zoom: 4, x: 250, y: 175, pixelSize: 3 })

        const fromGet = a.getLocus(dataset, DEFAULT_VIEW_DIMENSIONS)
        b.configureLocus(dataset, DEFAULT_VIEW_DIMENSIONS)

        expect(fromGet).toEqual(b.locus)
    })
})

describe('State.updateWithLoci', () => {
    test('sets chr indices, zoom, x/y, pixelSize from BP loci', async () => {
        const browser = createMockBrowser({
            findMatchingZoomIndex: () => 4, // pin zoom selection
        })
        const state = createState({ chr1: 1, chr2: 1, zoom: 3, x: 0, y: 0, pixelSize: 2 })

        // chr1 region: 0–8,000,000bp on chr1 (index 1); chr2 region: same on chr2 (index 2)
        const result = await state.updateWithLoci('chr1', 0, 8_000_000, 'chr2', 0, 8_000_000, browser, 800, 800)

        expect(state.chr1).toBe(1)
        expect(state.chr2).toBe(2)
        expect(state.zoom).toBe(4)
        // binSize at zoom=4 is 100000; x = bpX / binSize = 0
        expect(state.x).toBe(0)
        expect(state.y).toBe(0)
        // bpPerPixelTarget = 8_000_000 / 800 = 10_000; pixelSize = binSize / bpPerPixelTarget = 100000 / 10000 = 10
        expect(state.pixelSize).toBe(10)
        expect(result).toEqual({ chrChanged: true, resolutionChanged: true })
    })

    test('post-updateWithLoci getLocus reflects requested chromosomes and start positions', async () => {
        const browser = createMockBrowser({ findMatchingZoomIndex: () => 4 })
        const dataset = createMockDataset()
        const state = createState()

        await state.updateWithLoci('chr1', 1_000, 9_000, 'chr2', 2_000, 18_000, browser, 800, 800)

        const locus = state.getLocus(dataset, DEFAULT_VIEW_DIMENSIONS)
        expect(locus.x.chr).toBe('chr1')
        expect(locus.y.chr).toBe('chr2')
        // Start round-trips exactly: state.x = bpX/binSize, then getLocus.start = round(state.x * binSize) = bpX.
        expect(locus.x.start).toBe(1_000)
        expect(locus.y.start).toBe(2_000)
        // End is NOT generally equal to the requested bpXMax — it reflects the actual visible range
        // (binSize * width / pixelSize), which is the honest answer.
    })

    test('resolutionLocked=true: zoom is preserved', async () => {
        const browser = createMockBrowser({
            resolutionLocked: true,
            findMatchingZoomIndex: () => 99, // would-be zoom; should be ignored
        })
        const state = createState({ zoom: 5 })

        const result = await state.updateWithLoci('chr1', 0, 8_000_000, 'chr2', 0, 8_000_000, browser, 800, 800)

        expect(state.zoom).toBe(5)
        expect(result.resolutionChanged).toBe(false)
    })

    test('chrChanged=false when chromosomes do not change', async () => {
        const browser = createMockBrowser({ findMatchingZoomIndex: () => 4 })
        const state = createState({ chr1: 1, chr2: 2, zoom: 4 })

        const result = await state.updateWithLoci('chr1', 0, 1_000_000, 'chr2', 0, 1_000_000, browser, 800, 800)

        expect(result.chrChanged).toBe(false)
    })

    test('pixelSize is clamped to >= 1 by _adjustPixelSize', async () => {
        // bpPerPixelTarget large => binSize / bpPerPixelTarget would be < 1
        // Clamp to 1 should engage. minPixelSize default returns 1, so result is 1.
        const browser = createMockBrowser({ findMatchingZoomIndex: () => 4 })
        const state = createState()

        // bpPerPixelTarget = 80_000_000 / 800 = 100_000; pixelSize = 100000/100000 = 1
        await state.updateWithLoci('chr1', 0, 80_000_000, 'chr2', 0, 80_000_000, browser, 800, 800)

        expect(state.pixelSize).toBe(1)
    })
})

describe('State.panShift', () => {
    test('advances x and y by dx/pixelSize, dy/pixelSize', async () => {
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        const state = createState({ chr1: 1, chr2: 2, zoom: 3, x: 100, y: 50, pixelSize: 2 })

        state.panShift(20, -10, browser, dataset, DEFAULT_VIEW_DIMENSIONS)

        // x: 100 + 20/2 = 110; y: 50 + (-10)/2 = 45 (still inside clamp range)
        expect(state.x).toBe(110)
        expect(state.y).toBe(45)
    })

    test('clamps x to 0 when dx goes negative past origin', async () => {
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        const state = createState({ x: 5, y: 5, pixelSize: 1 })

        state.panShift(-1000, 0, browser, dataset, DEFAULT_VIEW_DIMENSIONS)

        expect(state.x).toBe(0)
    })

    test('clamps x/y to maxX/maxY when dx/dy push past chromosome end', async () => {
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        // zoom=3 -> binSize=250000; chr1 size=250M -> chr1.size/binSize = 1000
        // width=800, pixelSize=2 -> width/pixelSize = 400
        // maxX = 1000 - 400 = 600
        const state = createState({ chr1: 1, chr2: 2, zoom: 3, x: 100, y: 100, pixelSize: 2 })

        state.panShift(100_000, 100_000, browser, dataset, DEFAULT_VIEW_DIMENSIONS)

        expect(state.x).toBe(600)
        // chr2 size=240M, chr2.size/binSize = 960; maxY = 960 - 400 = 560
        expect(state.y).toBe(560)
    })

    test('post-pan getLocus reflects new x/y in BP coordinates', async () => {
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        const state = createState({ chr1: 1, chr2: 2, zoom: 3, x: 100, y: 100, pixelSize: 2 })

        state.panShift(20, 20, browser, dataset, DEFAULT_VIEW_DIMENSIONS)

        // x=110 after pan; bpPerBin=250000; startBP1 = 110*250000 = 27_500_000
        // endBP1 = min(250M, round(800/2 * 250000) + 27.5M) = min(250M, 100M + 27.5M) = 127_500_000
        const locus = state.getLocus(dataset, DEFAULT_VIEW_DIMENSIONS)
        expect(locus.x).toEqual({ chr: 'chr1', start: 27_500_000, end: 127_500_000 })
        expect(locus.y.chr).toBe('chr2')
    })

    test('does not change chr1, chr2, zoom, pixelSize, or normalization', async () => {
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        const state = createState({
            chr1: 1, chr2: 2, zoom: 3, x: 100, y: 100, pixelSize: 2, normalization: 'KR'
        })

        state.panShift(50, 50, browser, dataset, DEFAULT_VIEW_DIMENSIONS)

        expect(state.chr1).toBe(1)
        expect(state.chr2).toBe(2)
        expect(state.zoom).toBe(3)
        expect(state.pixelSize).toBe(2)
        expect(state.normalization).toBe('KR')
    })
})

describe('State.panWithZoom', () => {
    test('preserves the genomic position under the anchor pixel (anchor invariant)', async () => {
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        const bpResolutions = browser.getResolutions() // [{binSize, index}, ...]

        // Pre: zoom=3 (binSize=250000), pixelSize=4, x=200, y=200, anchor at view center.
        const state = createState({ chr1: 1, chr2: 2, zoom: 3, x: 200, y: 200, pixelSize: 4 })

        const anchorPx = 400, anchorPy = 400
        const oldBinSize = bpResolutions[state.zoom].binSize
        const gxBefore = (state.x + anchorPx / state.pixelSize) * oldBinSize
        const gyBefore = (state.y + anchorPy / state.pixelSize) * oldBinSize

        // Zoom to zoom=4 (binSize=100000) at pixelSize=8.
        const newZoom = 4
        const newBinSize = bpResolutions[newZoom].binSize
        await state.panWithZoom(newZoom, 8, anchorPx, anchorPy, newBinSize, browser, dataset, DEFAULT_VIEW_DIMENSIONS, bpResolutions)

        const gxAfter = (state.x + anchorPx / state.pixelSize) * newBinSize
        const gyAfter = (state.y + anchorPy / state.pixelSize) * newBinSize

        expect(gxAfter).toBeCloseTo(gxBefore, 6)
        expect(gyAfter).toBeCloseTo(gyBefore, 6)
    })

    test('sets zoom and pixelSize to the requested values (after pixelSize adjustment)', async () => {
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        const bpResolutions = browser.getResolutions()
        const state = createState({ chr1: 1, chr2: 2, zoom: 3, x: 200, y: 200, pixelSize: 4 })

        await state.panWithZoom(4, 8, 400, 400, bpResolutions[4].binSize, browser, dataset, DEFAULT_VIEW_DIMENSIONS, bpResolutions)

        expect(state.zoom).toBe(4)
        expect(state.pixelSize).toBe(8) // 8 > min (1), 8 < MAX_PIXEL_SIZE (128)
    })

    test('post-zoom getLocus reflects new zoom and x/y (locus is always live via getLocus)', async () => {
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        const bpResolutions = browser.getResolutions()
        const state = createState({ chr1: 1, chr2: 2, zoom: 3, x: 200, y: 200, pixelSize: 4 })

        await state.panWithZoom(4, 8, 400, 400, bpResolutions[4].binSize, browser, dataset, DEFAULT_VIEW_DIMENSIONS, bpResolutions)

        // Under the field-based design panWithZoom left state.locus stale until
        // interactionHandler called configureLocus separately. With getLocus the
        // BP locus is always live — derived from canonical state on demand.
        const locus = state.getLocus(dataset, DEFAULT_VIEW_DIMENSIONS)
        expect(locus.x.chr).toBe('chr1')
        expect(locus.y.chr).toBe('chr2')
        // bpPerBin at zoom 4 is 100000; locus reflects post-zoom state.
        expect(locus.x.start).toBe(Math.round(state.x * 100000))
    })

    test('clampXY runs — x cannot go negative even with anchor near origin', async () => {
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        const bpResolutions = browser.getResolutions()
        // Start near origin so the anchor preservation math would push x negative.
        const state = createState({ chr1: 1, chr2: 2, zoom: 3, x: 0, y: 0, pixelSize: 4 })

        await state.panWithZoom(4, 8, 400, 400, bpResolutions[4].binSize, browser, dataset, DEFAULT_VIEW_DIMENSIONS, bpResolutions)

        expect(state.x).toBeGreaterThanOrEqual(0)
        expect(state.y).toBeGreaterThanOrEqual(0)
    })

    test('pixelSize is floored by browser.minPixelSize', async () => {
        const browser = createMockBrowser({
            minPixelSize: async () => 5, // floor higher than requested
        })
        const dataset = createMockDataset()
        const bpResolutions = browser.getResolutions()
        const state = createState({ chr1: 1, chr2: 2, zoom: 3, x: 200, y: 200, pixelSize: 4 })

        await state.panWithZoom(4, 2, 400, 400, bpResolutions[4].binSize, browser, dataset, DEFAULT_VIEW_DIMENSIONS, bpResolutions)

        expect(state.pixelSize).toBe(5)
    })
})

describe('State.setWithZoom', () => {
    test('returns resolutionChanged=true when zoom differs, false when same', async () => {
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        const state = createState({ chr1: 1, chr2: 2, zoom: 3, x: 200, y: 200, pixelSize: 4 })

        const changed = await state.setWithZoom(4, DEFAULT_VIEW_DIMENSIONS, browser, dataset)
        expect(changed).toBe(true)

        const sameState = createState({ chr1: 1, chr2: 2, zoom: 4, x: 100, y: 100, pixelSize: 1 })
        const unchanged = await sameState.setWithZoom(4, DEFAULT_VIEW_DIMENSIONS, browser, dataset)
        expect(unchanged).toBe(false)
    })

    test('DEFAULT_PIXEL_SIZE floor: pixelSize is at least 1 even when minPixelSize is below 1', async () => {
        // This is the resolution-selector-only floor that produces the "jump"
        // when alternating with wheel zoom (which has no such floor).
        // The refactor explicitly preserves this behavior.
        const browser = createMockBrowser({
            minPixelSize: async () => 0.5,
        })
        const dataset = createMockDataset()
        const state = createState({ chr1: 1, chr2: 2, zoom: 3, x: 200, y: 200, pixelSize: 4 })

        await state.setWithZoom(4, DEFAULT_VIEW_DIMENSIONS, browser, dataset)

        expect(state.pixelSize).toBe(1)
    })

    test('minPixelSize wins when above DEFAULT_PIXEL_SIZE', async () => {
        const browser = createMockBrowser({
            minPixelSize: async () => 7,
        })
        const dataset = createMockDataset()
        const state = createState({ chr1: 1, chr2: 2, zoom: 3, x: 200, y: 200, pixelSize: 4 })

        await state.setWithZoom(4, DEFAULT_VIEW_DIMENSIONS, browser, dataset)

        expect(state.pixelSize).toBe(7)
    })

    test('pixelSize is independent of incoming state.pixelSize (the "jump")', async () => {
        // Demonstrates the divergence vs panWithZoom: setWithZoom RESETS pixelSize to
        // max(DEFAULT_PIXEL_SIZE, minPixelSize) regardless of current pixelSize, which
        // is what produces the visible jump when switching from wheel to dropdown zoom.
        const browser = createMockBrowser({ minPixelSize: async () => 1 })
        const dataset = createMockDataset()

        const a = createState({ chr1: 1, chr2: 2, zoom: 3, x: 200, y: 200, pixelSize: 0.7 })
        const b = createState({ chr1: 1, chr2: 2, zoom: 3, x: 200, y: 200, pixelSize: 50 })

        await a.setWithZoom(4, DEFAULT_VIEW_DIMENSIONS, browser, dataset)
        await b.setWithZoom(4, DEFAULT_VIEW_DIMENSIONS, browser, dataset)

        expect(a.pixelSize).toBe(1)
        expect(b.pixelSize).toBe(1) // jump down — current behavior
    })

    test('preserves the genomic position at the view center across the zoom', async () => {
        const browser = createMockBrowser({ minPixelSize: async () => 1 })
        const dataset = createMockDataset()
        const state = createState({ chr1: 1, chr2: 2, zoom: 3, x: 200, y: 200, pixelSize: 4 })

        const oldBinSize = dataset.bpResolutions[state.zoom]
        const xCenterBpBefore = (state.x + DEFAULT_VIEW_DIMENSIONS.width / (2 * state.pixelSize)) * oldBinSize
        const yCenterBpBefore = (state.y + DEFAULT_VIEW_DIMENSIONS.height / (2 * state.pixelSize)) * oldBinSize

        await state.setWithZoom(4, DEFAULT_VIEW_DIMENSIONS, browser, dataset)

        const newBinSize = dataset.bpResolutions[state.zoom]
        const xCenterBpAfter = (state.x + DEFAULT_VIEW_DIMENSIONS.width / (2 * state.pixelSize)) * newBinSize
        const yCenterBpAfter = (state.y + DEFAULT_VIEW_DIMENSIONS.height / (2 * state.pixelSize)) * newBinSize

        expect(xCenterBpAfter).toBeCloseTo(xCenterBpBefore, 6)
        expect(yCenterBpAfter).toBeCloseTo(yCenterBpBefore, 6)
    })

    test('post-zoom getLocus reflects new zoom level', async () => {
        const browser = createMockBrowser({ minPixelSize: async () => 1 })
        const dataset = createMockDataset()
        const state = createState({ chr1: 1, chr2: 2, zoom: 3, x: 200, y: 200, pixelSize: 4 })

        await state.setWithZoom(4, DEFAULT_VIEW_DIMENSIONS, browser, dataset)

        const locus = state.getLocus(dataset, DEFAULT_VIEW_DIMENSIONS)
        expect(locus.x.chr).toBe('chr1')
        expect(locus.y.chr).toBe('chr2')
    })
})

describe('State.sync', () => {
    test('converts binX/binY between source and target binSizes', async () => {
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        const state = createState({ chr1: 1, chr2: 2, zoom: 3, x: 0, y: 0, pixelSize: 4 })

        // Source: binSize=100000, pixelSize=2 -> bpPerPixelTarget = 50000.
        // Mock findMatchingZoomIndex on flat-number array picks zoom=5 (binSize=50000).
        // Target binSize=50000, so binX scales by 100000/50000 = 2x.
        const targetState = {
            chr1Name: 'chr1', chr2Name: 'chr2',
            binSize: 100000, pixelSize: 2,
            binX: 1000, binY: 500,
        }

        const result = await state.sync(targetState, browser, browser.genome, dataset)

        expect(state.zoom).toBe(5)
        expect(state.x).toBe(2000) // 1000 * (100000/50000)
        expect(state.y).toBe(1000) // 500 * 2
        expect(state.pixelSize).toBe(1) // 50000 / 50000 = 1
        expect(result).toEqual({ zoomChanged: true, chrChanged: false })
    })

    test('looks up chr1/chr2 indices from genome by name', async () => {
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        const state = createState({ chr1: 1, chr2: 1 })

        const targetState = {
            chr1Name: 'chr2', chr2Name: 'chr3',
            binSize: 100000, pixelSize: 2,
            binX: 0, binY: 0,
        }

        const result = await state.sync(targetState, browser, browser.genome, dataset)

        expect(state.chr1).toBe(2)
        expect(state.chr2).toBe(3)
        expect(result.chrChanged).toBe(true)
    })

    test('runs clampXY (regression guard for the missing-clampXY fix)', async () => {
        // Code comment in hicState.js notes: "Finalize with both clampXY and configureLocus
        // (fixes missing clampXY)". Lock that in.
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        const state = createState({ chr1: 1, chr2: 2 })

        // Provide binX way past the chromosome — clampXY must clip it to maxX.
        const targetState = {
            chr1Name: 'chr1', chr2Name: 'chr2',
            binSize: 100000, pixelSize: 2,
            binX: 999_999_999, binY: 999_999_999,
        }

        await state.sync(targetState, browser, browser.genome, dataset)

        // chr1 size=250M, zoom=5 -> binSize=50000 -> chr.size/binSize=5000
        // width=800, pixelSize=1 -> width/pixelSize=800; maxX = 4200
        expect(state.x).toBe(4200)
        // chr2 size=240M -> 4800-800 = 4000
        expect(state.y).toBe(4000)
    })

    test('post-sync getLocus reflects new chromosomes and bin position', async () => {
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        const state = createState({ chr1: 1, chr2: 1 })

        const targetState = {
            chr1Name: 'chr1', chr2Name: 'chr2',
            binSize: 100000, pixelSize: 2,
            binX: 100, binY: 100,
        }

        await state.sync(targetState, browser, browser.genome, dataset)

        const locus = state.getLocus(dataset, DEFAULT_VIEW_DIMENSIONS)
        expect(locus.x.chr).toBe('chr1')
        expect(locus.y.chr).toBe('chr2')
    })

    test('reports zoomChanged=false / chrChanged=false when neither changes', async () => {
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        const state = createState({ chr1: 1, chr2: 2, zoom: 5, x: 100, y: 100, pixelSize: 1 })

        const targetState = {
            chr1Name: 'chr1', chr2Name: 'chr2',
            binSize: 100000, pixelSize: 2,
            binX: 100, binY: 100,
        }

        const result = await state.sync(targetState, browser, browser.genome, dataset)

        expect(result).toEqual({ zoomChanged: false, chrChanged: false })
    })
})

/**
 * Mock browser shaped for InteractionHandler.zoomAndCenter.
 * Adds: state, dataset (with isWholeGenome), update(), notifyLocusChange(),
 * contactMatrixView with the methods _applyStateChange touches.
 */
function createInteractionBrowser(overrides = {}) {
    const dataset = overrides.dataset ?? {
        ...createMockDataset(),
        isWholeGenome: () => false,
    }
    const base = createMockBrowser({
        ...overrides,
        contactMatrixView: {
            getViewDimensions: () => DEFAULT_VIEW_DIMENSIONS,
            clearImageCaches: () => {},
            zoomIn: async () => {},
        },
    })
    return {
        ...base,
        dataset,
        state: overrides.state ?? createState({ chr1: 1, chr2: 2, zoom: 3, x: 200, y: 200, pixelSize: 4 }),
        minZoom: overrides.minZoom ?? (async () => 2),
        update: async () => {},
        notifyLocusChange: () => {},
    }
}

describe('InteractionHandler.zoomAndCenter — inline-mutation path', () => {
    test('resolutionLocked + zoom in: pixelSize doubles, x/y shift by shiftRatio', async () => {
        const browser = createInteractionBrowser({ resolutionLocked: true })
        const handler = new InteractionHandler(browser)

        // direction=1 (in), center at view center (no recenter shift)
        await handler.zoomAndCenter(1, 400, 400)

        // newPixelSize = min(MAX, 4*2) = 8; shiftRatio = (8-4)/8 = 0.5
        // x += 0.5 * (800/8) = 50 -> 250; y -> 250
        expect(browser.state.pixelSize).toBe(8)
        expect(browser.state.x).toBe(250)
        expect(browser.state.y).toBe(250)
    })

    test('resolutionLocked + zoom out: pixelSize halves', async () => {
        const browser = createInteractionBrowser({ resolutionLocked: true })
        const handler = new InteractionHandler(browser)

        await handler.zoomAndCenter(-1, 400, 400)

        // newPixelSize = max(min(MAX, 4*0.5), minPS=1) = 2; shiftRatio = (2-4)/2 = -1
        // x += -1 * (800/2) = -400 -> -200, then clampXY -> 0
        expect(browser.state.pixelSize).toBe(2)
        expect(browser.state.x).toBe(0)
        expect(browser.state.y).toBe(0)
    })

    test('off-center anchor: state.x/y are recentered before the zoom math', async () => {
        const browser = createInteractionBrowser({ resolutionLocked: true })
        const handler = new InteractionHandler(browser)

        // centerPX=600 -> dx = 600-400 = 200 -> state.x += 200/4 = 50 -> 250
        // centerPY=300 -> dy = 300-400 = -100 -> state.y += -100/4 = -25 -> 175
        // Then zoom-in math on the recentered values:
        // newPixelSize=8; shiftRatio=0.5; x += 0.5*(800/8)=50 -> 300; y += 50 -> 225
        await handler.zoomAndCenter(1, 600, 300)

        expect(browser.state.pixelSize).toBe(8)
        expect(browser.state.x).toBe(300)
        expect(browser.state.y).toBe(225)
    })

    test('boundary: at highest zoom index + zoom in -> still inline path', async () => {
        // Highest zoom index in DEFAULT_BIN_SIZES is 8; resolutions[length-1].index === 8
        const browser = createInteractionBrowser({
            state: createState({ chr1: 1, chr2: 2, zoom: 8, x: 100, y: 100, pixelSize: 4 }),
        })
        const handler = new InteractionHandler(browser)

        await handler.zoomAndCenter(1, 400, 400)

        // direct zoom-in math should have applied (pixelSize doubled).
        expect(browser.state.pixelSize).toBe(8)
        expect(browser.state.zoom).toBe(8) // unchanged
    })

    test('minPixelSize clamps newPixelSize on zoom out', async () => {
        const browser = createInteractionBrowser({
            resolutionLocked: true,
            minPixelSize: async () => 3, // floor higher than 4*0.5=2
        })
        const handler = new InteractionHandler(browser)

        await handler.zoomAndCenter(-1, 400, 400)

        expect(browser.state.pixelSize).toBe(3)
    })

    test('post-zoom getLocus reflects new x/y', async () => {
        const browser = createInteractionBrowser({
            resolutionLocked: true,
            state: createState({ chr1: 1, chr2: 2, zoom: 3, x: 200, y: 200, pixelSize: 4 }),
        })
        const handler = new InteractionHandler(browser)

        await handler.zoomAndCenter(1, 400, 400)

        const locus = browser.state.getLocus(browser.dataset, DEFAULT_VIEW_DIMENSIONS)
        expect(locus.x.chr).toBe('chr1')
        expect(locus.y.chr).toBe('chr2')
    })
})

describe('InteractionHandler.setChromosomes — inline-mutation path', () => {
    test('sorts chr1 <= chr2 even when input order is reversed', async () => {
        const browser = createInteractionBrowser({
            state: createState({ chr1: 99, chr2: 99 }),
        })
        const handler = new InteractionHandler(browser)

        // Pass chr3 first, chr1 second — should end up chr1=1, chr2=3.
        await handler.setChromosomes(
            { chr: 'chr3', start: 0, end: 100, wholeChr: true },
            { chr: 'chr1', start: 0, end: 100, wholeChr: true },
        )

        expect(browser.state.chr1).toBe(1)
        expect(browser.state.chr2).toBe(3)
    })

    test('resets x and y to 0', async () => {
        const browser = createInteractionBrowser({
            state: createState({ chr1: 1, chr2: 2, x: 999, y: 888 }),
        })
        const handler = new InteractionHandler(browser)

        await handler.setChromosomes(
            { chr: 'chr1', start: 0, end: 100, wholeChr: true },
            { chr: 'chr2', start: 0, end: 100, wholeChr: true },
        )

        expect(browser.state.x).toBe(0)
        expect(browser.state.y).toBe(0)
    })

    test('post-setChromosomes getLocus reflects the chosen chromosomes', async () => {
        const browser = createInteractionBrowser({
            state: createState({ chr1: 0, chr2: 0 }),
        })
        const handler = new InteractionHandler(browser)

        await handler.setChromosomes(
            { chr: 'chr1', start: 1_000, end: 9_000, wholeChr: false },
            { chr: 'chr2', start: 2_000, end: 18_000, wholeChr: false },
        )

        // After Part A, setChromosomes only sets canonical fields (chr1, chr2, x=0, y=0,
        // zoom, pixelSize). Locus is derived on read.
        const locus = browser.state.getLocus(browser.dataset, DEFAULT_VIEW_DIMENSIONS)
        expect(locus.x.chr).toBe('chr1')
        expect(locus.y.chr).toBe('chr2')
        // x/y were reset to 0, so start at chromosome origin.
        expect(locus.x.start).toBe(0)
        expect(locus.y.start).toBe(0)
    })

    test('wholeChr branch: zoom = minZoom, pixelSize = clamp(minPS, [DEFAULT_PIXEL_SIZE, 100])', async () => {
        const browser = createInteractionBrowser({
            minZoom: async () => 1,
            minPixelSize: async () => 0.3, // below DEFAULT_PIXEL_SIZE
            state: createState({ chr1: 1, chr2: 2, zoom: 5, pixelSize: 4 }),
        })
        const handler = new InteractionHandler(browser)

        await handler.setChromosomes(
            { chr: 'chr1', start: 0, end: 100, wholeChr: true },
            { chr: 'chr2', start: 0, end: 100, wholeChr: true },
        )

        expect(browser.state.zoom).toBe(1)
        expect(browser.state.pixelSize).toBe(1) // floored at DEFAULT_PIXEL_SIZE
    })

    test('wholeChr branch: pixelSize is capped at 100 even if minPS is higher', async () => {
        const browser = createInteractionBrowser({
            minZoom: async () => 1,
            minPixelSize: async () => 200, // above 100 cap
        })
        const handler = new InteractionHandler(browser)

        await handler.setChromosomes(
            { chr: 'chr1', start: 0, end: 100, wholeChr: true },
            { chr: 'chr2', start: 0, end: 100, wholeChr: true },
        )

        expect(browser.state.pixelSize).toBe(100)
    })

    test('non-wholeChr branch: zoom = 0, pixelSize = max(current, minPS)', async () => {
        const browser = createInteractionBrowser({
            minPixelSize: async () => 3,
            state: createState({ chr1: 1, chr2: 2, zoom: 5, pixelSize: 7 }),
        })
        const handler = new InteractionHandler(browser)

        await handler.setChromosomes(
            { chr: 'chr1', start: 1000, end: 9000, wholeChr: false },
            { chr: 'chr2', start: 1000, end: 9000, wholeChr: false },
        )

        expect(browser.state.zoom).toBe(0)
        expect(browser.state.pixelSize).toBe(7) // current 7 > minPS 3, kept
    })

    test('non-wholeChr branch: pixelSize floored by minPS when minPS > current', async () => {
        const browser = createInteractionBrowser({
            minPixelSize: async () => 9,
            state: createState({ chr1: 1, chr2: 2, pixelSize: 4 }),
        })
        const handler = new InteractionHandler(browser)

        await handler.setChromosomes(
            { chr: 'chr1', start: 1000, end: 9000, wholeChr: false },
            { chr: 'chr2', start: 1000, end: 9000, wholeChr: false },
        )

        expect(browser.state.pixelSize).toBe(9)
    })
})
