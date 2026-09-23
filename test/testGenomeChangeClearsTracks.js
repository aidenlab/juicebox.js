/**
 * A genome change clears the panel's tracks. #682, ADR-0019.
 *
 * A *genome change* is a successful map load -- file or live -- into a panel
 * whose genome id differs from its previous map's. Everything that belongs to
 * the old genome goes: track pairs, pending tracks (whose late result is then
 * discarded) and 2D annotations. Each loaded track pair posts
 * `TrackXYPairRemoval`, and all of it happens before `onGenomeChange` and the
 * `GenomeChange` event, so a host reacting to the change sees an empty panel.
 * A same-genome reload and a failed load clear nothing.
 *
 * The seam is the one the restore suites use -- `Dataset.loadDataset` -- so the
 * map load under test runs for real; `genomeId` on the config names the genome
 * the stand-in dataset reports, and `fail` makes the read throw.
 */
import {describe, test, expect, vi, beforeEach} from 'vitest'

const createTrack = vi.fn()

vi.mock('igv', async (importOriginal) => {
    const igv = (await importOriginal()).default
    return {default: {...igv, createTrack: (...args) => createTrack(...args)}}
})

// As in testPendingTrackRow.js: the dialog is a track pair's furniture.
vi.mock('igv-ui', async (importOriginal) => ({...(await importOriginal()), DataRangeDialog: class {}}))

vi.mock('../js/hicDataset.js', async () => {
    const {restoreDataset, datasetModule} = await import('./utils/restoreDataset.js')
    return datasetModule(config => {
        if (config.fail) {
            throw new Error('Not Found')
        }
        // A live map's config carries the map, not the genome; read it off the map.
        return restoreDataset(config.liveContactMap ? {genomeId: config.liveContactMap.genomeId} : config)
    })
})

const {default: HICBrowser} = await import('../js/hicBrowser.js')
const {default: TrackPair} = await import('../js/trackPair.js')
const {default: Track2D} = await import('../js/track2D.js')
const {default: EventBus} = await import('../js/eventBus.js')
const {restoreFixture} = await import('./utils/restoreFixture.js')
const {restoreDataset} = await import('./utils/restoreDataset.js')

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

const trackConfig = name => ({name, url: `https://example.org/${name}.bigWig`, format: 'bigwig'})

function track(name) {
    return {name, config: {name, url: `https://example.org/${name}.bigWig`}, getFeatures: async () => [], draw: () => undefined}
}

/** A createTrack whose every call waits until the test settles it by track name. */
function deferredCreateTrack() {
    const pending = new Map()
    createTrack.mockImplementation(({name}) => new Promise((resolve, reject) => {
        pending.set(name, {resolve: () => resolve(track(name)), reject})
    }))
    return pending
}

const map = genomeId => ({url: `https://example.org/${genomeId}.hic`, genomeId})

const live = genomeId => {
    const {chromosomes} = restoreDataset()
    return {liveContactMap: {genomeId, chromosomes, genomicStart: 0, genomicEnd: 10000000}}
}

/** Record the global events a host would hear, in order, for the length of `body`. */
async function heard(body) {
    const events = []
    const listeners = ['TrackXYPairRemoval', 'GenomeChange'].map(type => {
        const listener = event => events.push({type, data: event.data})
        EventBus.globalBus.subscribe(type, listener)
        return [type, listener]
    })
    try {
        await body()
    } finally {
        for (const [type, listener] of listeners) {
            EventBus.globalBus.unsubscribe(type, listener)
        }
    }
    return events
}

describe('a genome change clears the panel\'s tracks (#682)', () => {

    const {embed} = restoreFixture(HICBrowser, {suite: 'genome change'})

    beforeEach(() => {
        vi.spyOn(TrackPair.prototype, 'updateViews').mockImplementation(async () => undefined)
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        createTrack.mockReset()
    })

    /**
     * An hg38 panel with two loaded tracks, one pending track and one 2D
     * annotation. Returns the browser, the pending loads and the tracks load.
     */
    async function populated(load = browser => browser.loadHicFile(map('hg38'), true)) {
        const browser = embed()
        await load(browser)

        const pending = deferredCreateTrack()
        const tracks = browser.loadTracks(['a', 'b', 'c'].map(trackConfig))
        await flush()
        pending.get('a').resolve()
        pending.get('b').resolve()
        await flush()

        browser.tracks2D = [{config: {name: 'loops'}}]

        expect(browser.trackPairs.map(pair => pair.isPendingTrack === true)).toEqual([true, false, false])

        return {browser, pending, tracks}
    }

    test('loading another genome\'s map leaves no tracks, no annotations, and the pending track never lands', async () => {
        const {browser, pending, tracks} = await populated()

        await browser.loadHicFile(map('mm10'), true)

        expect(browser.trackPairs).toEqual([])
        expect(browser.tracks2D).toEqual([])
        expect(browser.layoutController.xTracks.querySelectorAll('.x-track-canvas-container')).toHaveLength(0)
        expect(browser.layoutController.yTracks.querySelectorAll('.y-track-canvas-container')).toHaveLength(0)

        pending.get('c').resolve()
        await tracks

        expect(browser.trackPairs).toEqual([])
    })

    test('each loaded track pair posts TrackXYPairRemoval, before GenomeChange', async () => {
        const {browser, pending, tracks} = await populated()
        const loaded = browser.trackPairs.filter(pair => !pair.isPendingTrack)

        const events = await heard(() => browser.loadHicFile(map('mm10'), true))

        expect(events).toEqual([
            ...loaded.map(pair => ({type: 'TrackXYPairRemoval', data: pair})),
            {type: 'GenomeChange', data: 'mm10'}
        ])

        pending.get('c').resolve()
        await tracks
    })

    test('a host told of the change by the coordinator sees an empty panel', async () => {
        const {browser, pending, tracks} = await populated()
        const seen = []
        vi.spyOn(browser.coordinator, 'onGenomeChange').mockImplementation(() => {
            seen.push({trackPairs: browser.trackPairs.length, tracks2D: browser.tracks2D.length})
        })

        await browser.loadHicFile(map('mm10'), true)

        expect(seen).toEqual([{trackPairs: 0, tracks2D: 0}])

        pending.get('c').resolve()
        await tracks
    })

    test('reloading a map of the same genome keeps every track', async () => {
        const {browser, pending, tracks} = await populated()
        const before = [...browser.trackPairs]
        const annotations = browser.tracks2D

        const events = await heard(() => browser.loadHicFile(map('hg38'), true))

        expect(events).toEqual([])
        expect(browser.trackPairs).toEqual(before)
        expect(browser.tracks2D).toBe(annotations)

        pending.get('c').resolve()
        await tracks
        expect(browser.trackPairs.map(pair => pair.track.name)).toEqual(['c', 'b', 'a'])
    })

    test('a failed load keeps the tracks', async () => {
        const {browser, pending, tracks} = await populated()
        const before = [...browser.trackPairs]
        const annotations = browser.tracks2D

        const events = await heard(() =>
            expect(browser.loadHicFile({...map('mm10'), fail: true}, true)).rejects.toThrow('Not Found'))

        expect(events).toEqual([])
        expect(browser.genome.id).toBe('hg38')
        expect(browser.trackPairs).toEqual(before)
        expect(browser.tracks2D).toBe(annotations)

        pending.get('c').resolve()
        await tracks
        expect(browser.trackPairs.map(pair => pair.track.name)).toEqual(['c', 'b', 'a'])
    })

    test('a 2D track still loading when the genome changes is discarded', async () => {
        const browser = embed()
        await browser.loadHicFile(map('hg38'), true)

        let arrive
        vi.spyOn(Track2D, 'loadTrack2D').mockImplementation(() => new Promise(resolve => {
            arrive = () => resolve({config: {name: 'loops'}})
        }))
        const tracks = browser.loadTracks([{name: 'loops', url: 'https://example.org/loops.bedpe'}])
        await flush()

        await browser.loadHicFile(map('mm10'), true)
        arrive()
        await tracks

        expect(browser.tracks2D).toEqual([])
    })

    test('the live-map path clears the same way', async () => {
        const {browser, pending, tracks} = await populated(browser => browser.loadLiveContactMap(live('hg38'), true))
        const loaded = browser.trackPairs.filter(pair => !pair.isPendingTrack)

        const events = await heard(() => browser.loadLiveContactMap(live('mm10'), true))

        expect(events).toEqual([
            ...loaded.map(pair => ({type: 'TrackXYPairRemoval', data: pair})),
            {type: 'GenomeChange', data: 'mm10'}
        ])
        expect(browser.trackPairs).toEqual([])
        expect(browser.tracks2D).toEqual([])

        pending.get('c').resolve()
        await tracks
        expect(browser.trackPairs).toEqual([])
    })

    test('the live-map path keeps the tracks across a same-genome reload', async () => {
        const {browser, pending, tracks} = await populated(browser => browser.loadLiveContactMap(live('hg38'), true))

        await browser.loadLiveContactMap(live('hg38'), true)

        pending.get('c').resolve()
        await tracks
        expect(browser.trackPairs.map(pair => pair.track.name)).toEqual(['c', 'b', 'a'])
        expect(browser.tracks2D).toHaveLength(1)
    })
})
