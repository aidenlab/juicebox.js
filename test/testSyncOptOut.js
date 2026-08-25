/**
 * A browser that opted out of syncing stays out.
 *
 * `synchable: false` is a host's way of pinning one panel while the others move
 * together. Until #562 the flag was read in three places, one of which --
 * `HICBrowser.syncState`'s own guard -- was the only thing stopping the
 * "sync with a compatible browser" step at the end of `loadHicFile`, since that
 * step's filter never looked at the flag. The split moved the reading to
 * `isSynchable`, so this pins the behaviour rather than the reader: load a map
 * into an opted-out browser next to a compatible peer, and it must open at its
 * own state.
 *
 * `canBeSynched` was the third reader until #566 deleted it along with the
 * `config.synchState` rung it was the only production caller of. That changes
 * nothing here: the guard on `HICBrowser.syncState` is what this suite drives.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

const loadDataset = vi.fn()

vi.mock('../js/hicDataset.js', () => ({
    default: { loadDataset: (...args) => loadDataset(...args) },
    HiCDataset: class {}
}))

const { default: DataLoader } = await import('../js/dataLoader.js')
const { default: HICBrowser } = await import('../js/hicBrowser.js')

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

/**
 * The stub takes `HICBrowser`'s real `syncState` -- the guard under test is in
 * it, so a hand-written stand-in would test nothing. Everything that method
 * touches beyond the guard is stubbed: `state.sync` records the call, `update`
 * and the coordinator do nothing.
 */
function stubBrowser({ synchable, peer, synched }) {
    const browser = {
        synchable,
        genome: { getChromosome: name => CHROMOSOMES.find(c => c.name === name) },
        state: {
            sync: async targetState => {
                synched.push(targetState)
                return { zoomChanged: false, chrChanged: false }
            }
        },
        update: async () => undefined,
        dataset: undefined,
        clearDataset: () => undefined,
        stopSpinner: () => undefined,
        contactMatrixView: { startSpinner: () => undefined },
        contactMapLabel: { textContent: '', title: '' },
        userInteractionShield: { style: {} },
        controlDataset: undefined,
        coordinator: {
            onLocusChange: () => undefined,
            onNormalizationSubstituted: () => undefined,
            onGenomeChange: () => undefined,
            onNormVectorIndexLoad: () => undefined,
            onMapLoaded: () => undefined
        },
        registry: { presentAlert: () => undefined, sync: () => undefined, browsers: [peer] },
        setActiveDataset: dataset => { browser.dataset = dataset },
        setState: async () => undefined,
        parseGotoInput: async () => undefined,
        syncState: targetState => HICBrowser.prototype.syncState.call(browser, targetState)
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

/**
 * `synchedBrowsers` is a snapshot: `registry.sync()` rebuilds it with
 * `pairSynchable`, and it stands until the next rebuild. A host that flips
 * `synchable` in between leaves a browser in a set it no longer belongs to, and
 * the only thing that catches it is `syncState`'s own guard -- which is why
 * #562 kept that guard rather than leaving the question to the callers.
 */
describe('the sync a browser pushes to the browsers it is linked with', () => {

    test('a browser that opted out after the group was built does not take the state', async () => {
        const synched = []
        const recipient = stubBrowser({ synchable: undefined, peer: undefined, synched })
        recipient.dataset = stubDataset()

        const source = {
            synchedBrowsers: new Set([recipient]),
            getSyncState: () => ({
                chr1Name: 'chr1', chr2Name: 'chr1', binSize: 1000, binX: 3, binY: 4, pixelSize: 2
            })
        }

        // The host flips the flag; nothing rebuilds the group.
        recipient.synchable = false

        HICBrowser.prototype.syncToOtherBrowsers.call(source)
        await Promise.resolve()

        expect(synched).toEqual([])
    })
})
