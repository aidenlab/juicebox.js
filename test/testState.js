import { describe, test, expect } from 'vitest'
import State from '../js/hicState.js'

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
        findMatchingZoomIndex: overrides.findMatchingZoomIndex ?? ((bpPerPixelTarget, res) => {
            for (let i = res.length - 1; i >= 0; i--) {
                if (res[i].binSize <= bpPerPixelTarget) return i
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

    test('sets state.locus directly from input bp values (not derived via configureLocus)', async () => {
        const browser = createMockBrowser({ findMatchingZoomIndex: () => 4 })
        const state = createState()

        await state.updateWithLoci('chr1', 1_000, 9_000, 'chr2', 2_000, 18_000, browser, 800, 800)

        // The literal input values are stored, NOT recomputed via bin/pixelSize math.
        // This is the "two sources of truth" the refactor will eventually unify.
        expect(state.locus).toEqual({
            x: { chr: 'chr1', start: 1_000, end: 9_000 },
            y: { chr: 'chr2', start: 2_000, end: 18_000 },
        })
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

    test('rebuilds state.locus via configureLocus from new x/y', async () => {
        const browser = createMockBrowser()
        const dataset = createMockDataset()
        const state = createState({ chr1: 1, chr2: 2, zoom: 3, x: 100, y: 100, pixelSize: 2 })

        state.panShift(20, 20, browser, dataset, DEFAULT_VIEW_DIMENSIONS)

        // x=110 after pan; bpPerBin=250000; startBP1 = 110*250000 = 27_500_000
        // endBP1 = min(250M, round(800/2 * 250000) + 27.5M) = min(250M, 100M + 27.5M) = 127_500_000
        expect(state.locus.x).toEqual({ chr: 'chr1', start: 27_500_000, end: 127_500_000 })
        expect(state.locus.y.chr).toBe('chr2')
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
