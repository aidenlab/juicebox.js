import {describe, test, expect, vi, beforeEach} from 'vitest'

/**
 * What `onMapLoaded` actually publishes as its `datasetType`, driven through
 * both load paths -- see #471.
 *
 * `test/testDatasetTypeVocabulary.js` pins the values a `Dataset` *carries*.
 * That is not the same contract, and the difference is exactly the bug #471
 * missed: the issue asserted the file loader was "the only caller", and the
 * live loader was passing a hardcoded `'livecontactmap'` -- a fourth value, in
 * a third vocabulary, on the one path where the dataset itself already said
 * `'live'`. A constructor test cannot see a literal at a call site.
 *
 * So these assertions sit at the seam the host reads from: what arrives at the
 * coordinator, not what the dataset holds. Both paths must publish
 * `dataset.datasetType` verbatim, which is what the JSDoc now promises.
 */

const loadDataset = vi.fn()

vi.mock('../js/hicDataset.js', () => ({
    default: {loadDataset: (...args) => loadDataset(...args)},
    // loadLiveContactMap constructs one of these directly. It stands in for the
    // real class only as far as the fields the loader reads.
    HiCDataset: class {
        constructor(config) {
            this.isLive = Boolean(config.liveContactMap)
            this.datasetType = this.isLive ? 'live' : 'hic'
            this.genomeId = 'hg19'
            this.chromosomes = []
        }
        async init() {}
    }
}))

// The real Genome wants a chromosome list this stub browser has no reason to
// carry; nothing here asserts on it.
vi.mock('../js/genome.js', () => ({
    default: class {
        constructor(id) {
            this.id = id
        }
    }
}))

const {default: DataLoader} = await import('../js/dataLoader.js')

const mapLoaded = vi.fn()

function stubBrowser() {
    return {
        clearDataset: () => undefined,
        stopSpinner: () => undefined,
        contactMatrixView: {startSpinner: () => undefined},
        contactMapLabel: {textContent: '', title: ''},
        userInteractionShield: {style: {}},
        controlDataset: undefined,
        genome: undefined,
        dataset: undefined,
        setActiveDataset: () => undefined,
        setState: async () => undefined,
        parseGotoInput: async () => undefined,
        // The peer-sync sweep runs after onMapLoaded on the file path.
        registry: {presentAlert: () => undefined, sync: () => undefined, browsers: []},
        coordinator: {
            onGenomeChange: () => undefined,
            onNormalizationSubstituted: () => undefined,
            onNormalizationReadFailure: () => undefined,
            onNormVectorIndexLoad: () => undefined,
            onMapLoaded: (...args) => mapLoaded(...args)
        }
    }
}

/** The third positional argument, which is the field hosts destructure. */
function publishedDatasetType() {
    expect(mapLoaded).toHaveBeenCalledTimes(1)
    return mapLoaded.mock.calls[0][2]
}

describe('the datasetType onMapLoaded publishes', () => {

    beforeEach(() => {
        mapLoaded.mockReset()
        loadDataset.mockReset()
    })

    test('reads hic when a .hic file loads', async () => {
        loadDataset.mockResolvedValue({datasetType: 'hic', isLive: false, genomeId: 'hg19', chromosomes: []})

        await new DataLoader(stubBrowser()).loadHicFile({url: 'https://example.org/test.hic'}, true)

        expect(publishedDatasetType()).toBe('hic')
    })

    test('reads live when a live contact map loads', async () => {
        // This said 'livecontactmap' before #471, and no test could tell.
        const liveContactMap = {chromosomes: [{name: 'chrAll'}, {name: 'chr1'}], genomicStart: 0, genomicEnd: 1000}

        await new DataLoader(stubBrowser()).loadLiveContactMap({liveContactMap}, true)

        expect(publishedDatasetType()).toBe('live')
    })

    test('never publishes a value outside the documented vocabulary', async () => {
        // The negative half, and the one a host reading the old JSDoc would
        // have branched on. 'livecontactmap' is here because it was real.
        const documented = ['live', 'hic', 'unknown']
        const liveContactMap = {chromosomes: [{name: 'chrAll'}, {name: 'chr1'}], genomicStart: 0, genomicEnd: 1000}

        await new DataLoader(stubBrowser()).loadLiveContactMap({liveContactMap}, true)

        expect(documented).toContain(publishedDatasetType())
        expect(publishedDatasetType()).not.toBe('livecontactmap')
        expect(publishedDatasetType()).not.toBe('main')
        expect(publishedDatasetType()).not.toBe('control')
    })
})
