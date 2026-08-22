/**
 * A browser that opted out of syncing stays out.
 *
 * `synchable: false` is a host's way of pinning one panel while the others move
 * together. Until #562 the flag was read in three places, one of which --
 * `HICBrowser.syncState`'s own guard -- was the only thing stopping the
 * "sync with a compatible browser" step at the end of `loadHicFile`, since that
 * step's filter never looked at the flag. The split moved the reading to
 * `canBeSynched`, so this pins the behaviour rather than the reader: load a map
 * into an opted-out browser next to a compatible peer, and it must open at its
 * own state.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

const loadDataset = vi.fn()

vi.mock('../js/hicDataset.js', () => ({
    default: { loadDataset: (...args) => loadDataset(...args) },
    HiCDataset: class {}
}))

const { default: DataLoader } = await import('../js/dataLoader.js')

const CHROMOSOMES = [
    { name: 'All', size: 2000, index: 0 },
    { name: 'chr1', size: 1000, index: 1 }
]

function stubDataset() {
    return {
        genomeId: 'hg19',
        chromosomes: CHROMOSOMES,
        bpResolutions: [1000, 100],
        datasetType: 'hic',
        isCompatible: () => true,
        getChrIndexFromName: name => CHROMOSOMES.find(c => c.name === name)?.index
    }
}

/** The sibling already showing a map, whose state the loading browser would take. */
function stubPeer() {
    return {
        dataset: stubDataset(),
        getSyncState: () => ({
            chr1Name: 'chr1', chr2Name: 'chr1', binSize: 1000, binX: 3, binY: 4, pixelSize: 2
        })
    }
}

function stubBrowser({ synchable, peer, synched }) {
    const browser = {
        synchable,
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
        registry: { presentAlert: () => undefined, sync: () => undefined, browsers: [peer] },
        setActiveDataset: dataset => { browser.dataset = dataset },
        setState: async () => undefined,
        parseGotoInput: async () => undefined,
        syncState: async targetState => { synched.push(targetState) }
    }
    browser.registry.browsers.push(browser)
    return browser
}

describe('the sync step at the end of a map load', () => {

    beforeEach(() => {
        loadDataset.mockReset()
        loadDataset.mockResolvedValue(stubDataset())
    })

    test('a browser that opted out of syncing does not take a compatible peer\'s state', async () => {
        const synched = []
        const browser = stubBrowser({ synchable: false, peer: stubPeer(), synched })

        await new DataLoader(browser).loadHicFile({ url: 'https://example.org/a.hic' }, true)

        expect(synched).toEqual([])
    })

    test('a browser that did not opt out takes it', async () => {
        const synched = []
        const browser = stubBrowser({ synchable: undefined, peer: stubPeer(), synched })

        await new DataLoader(browser).loadHicFile({ url: 'https://example.org/a.hic' }, true)

        expect(synched).toHaveLength(1)
        expect(synched[0]).toMatchObject({ chr1Name: 'chr1', binX: 3, binY: 4 })
    })
})
