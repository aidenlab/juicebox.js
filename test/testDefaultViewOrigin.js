/**
 * A map opened with neither a locus nor a state falls back to the default view.
 * That is the ordinary path for opening a map, and #510 had it opening one bin
 * below the origin on the y axis — a shifted argument list that the
 * constructor's coercions turned into a valid state rather than a crash.
 *
 * testState.js pins `State.default()`'s fields directly. This pins the door:
 * the state `loadHicFile` actually hands the browser when the config names
 * neither.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

import State from '../js/hicState.js'
import { DEFAULT_PIXEL_SIZE } from '../js/hicBrowser.js'

const loadDataset = vi.fn()

vi.mock('../js/hicDataset.js', () => ({
    default: { loadDataset: (...args) => loadDataset(...args) },
    HiCDataset: class {}
}))

const { default: DataLoader } = await import('../js/dataLoader.js')

function stubDataset() {
    return {
        genomeId: 'hg19',
        chromosomes: [
            { name: 'All', size: 1000, index: 0 },
            { name: 'chr1', size: 1000, index: 1 }
        ],
        datasetType: 'hic',
        isCompatible: () => false
    }
}

function stubBrowser(recorded) {
    const browser = {
        genome: undefined,
        dataset: undefined,
        clearDataset: () => undefined,
        stopSpinner: () => undefined,
        contactMatrixView: { startSpinner: () => undefined },
        contactMapLabel: { textContent: '', title: '' },
        userInteractionShield: { style: {} },
        controlDataset: undefined,
        coordinator: {
            onNormalizationExternalChange: () => undefined,
            onGenomeChange: () => undefined,
            onNormVectorIndexLoad: () => undefined,
            onMapLoaded: () => undefined
        },
        registry: { presentAlert: () => undefined, sync: () => undefined, browsers: [] },
        setActiveDataset: (dataset) => {
            browser.dataset = dataset
        },
        // The default view is observed where it now arrives: at the chokepoint.
        // It used to be read off `setActiveDataset`'s second parameter, which
        // #559 deleted -- the ladder installs the dataset and then hands the
        // state to `setState`, so this is the same state one call later.
        setState: async (state) => {
            recorded.push(state)
        },
        parseGotoInput: async () => undefined,
        canBeSynched: () => false,
        syncState: async () => undefined
    }
    return browser
}

describe('the default view a map opens at when the config names neither locus nor state', () => {

    beforeEach(() => {
        loadDataset.mockReset()
        loadDataset.mockResolvedValue(stubDataset())
    })

    test('its y origin is zero, and every other field is the default', async () => {
        const recorded = []
        const dataLoader = new DataLoader(stubBrowser(recorded))

        await dataLoader.loadHicFile({ url: 'https://example.org/a.hic' }, true)

        expect(recorded).toHaveLength(1)

        const [state] = recorded
        expect(state.y).toBe(0)          // #510: this was 1
        expect(state.x).toBe(0)
        expect(state.chr1).toBe(0)
        expect(state.chr2).toBe(0)
        expect(state.zoom).toBe(0)
        expect(state.pixelSize).toBe(DEFAULT_PIXEL_SIZE)
        expect(state.normalization).toBe('NONE')
        expect(state.toJSON()).toEqual(State.default().toJSON())
    })
})
