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
