import {describe, it, expect} from 'vitest'
import {trackSkipReason, fanOutTracks, fanOutMap, controlSkipReason, fanOutControlMap} from '../js/targetGroup.js'

/**
 * The target-set rules -- see #615 and `docs/adr/0015`.
 *
 * `js/targetGroup.js` is the rule alone: which targets a load reaches, and what
 * comes back when it has. It reads no module state and touches no DOM, so the
 * browsers here are fabricated objects carrying only what the rules read -- a
 * `dataset` and a `genome` with an id -- exactly as `test/testSyncGroup.js`
 * fabricates browsers for the pairing rule.
 */

function fakeBrowser(name, {genomeId, dataset = {}} = {}) {
    const browser = {name}
    if (genomeId !== undefined) {
        browser.dataset = dataset
        browser.genome = {id: genomeId}
    }
    return browser
}

describe('trackSkipReason', () => {

    const hg38 = fakeBrowser('originating', {genomeId: 'hg38'})

    it('does not skip a target on the originating browser\'s genome', () => {
        expect(trackSkipReason(hg38, fakeBrowser('peer', {genomeId: 'hg38'}))).toBeUndefined()
    })

    it('does not skip the originating browser itself', () => {
        expect(trackSkipReason(hg38, hg38)).toBeUndefined()
    })

    it('skips a target with no dataset', () => {
        expect(trackSkipReason(hg38, fakeBrowser('empty'))).toBe('no-dataset')
    })

    it('skips a target on a different genome', () => {
        expect(trackSkipReason(hg38, fakeBrowser('mouse', {genomeId: 'mm10'}))).toBe('genome-mismatch')
    })

    // The empty-browser check comes first, and has to: a browser with no
    // dataset has no genome either, so testing the genome first would report
    // every empty panel as a mismatch and hide the ordinary case behind the
    // alarming one.
    it('reports an empty target as empty rather than as a mismatch', () => {
        expect(trackSkipReason(hg38, fakeBrowser('empty'))).toBe('no-dataset')
    })
})

describe('fanOutTracks', () => {

    const configs = [{url: 'https://example.com/a.bigWig', name: 'a'}]

    function recordingLoad(record, failing = new Set()) {
        return async (browser, ownConfigs) => {
            record.push({browser, configs: ownConfigs})
            if (failing.has(browser)) {
                throw new Error(`boom in ${browser.name}`)
            }
        }
    }

    it('loads into every eligible target and reports them', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        const b = fakeBrowser('b', {genomeId: 'hg38'})
        const record = []

        const summary = await fanOutTracks(a, [a, b], configs, recordingLoad(record))

        expect(summary.loaded).toEqual([a, b])
        expect(summary.failed).toEqual([])
        expect(summary.skipped).toEqual([])
        expect(record.map(({browser}) => browser)).toEqual([a, b])
    })

    it('reports the two skip paths without attempting a load', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        const empty = fakeBrowser('empty')
        const mouse = fakeBrowser('mouse', {genomeId: 'mm10'})
        const record = []

        const summary = await fanOutTracks(a, [a, empty, mouse], configs, recordingLoad(record))

        expect(summary.loaded).toEqual([a])
        expect(summary.skipped).toEqual([
            {browser: empty, reason: 'no-dataset'},
            {browser: mouse, reason: 'genome-mismatch'}
        ])
        expect(record.map(({browser}) => browser)).toEqual([a])
    })

    it('reports a failing target without stopping the others', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        const b = fakeBrowser('b', {genomeId: 'hg38'})
        const c = fakeBrowser('c', {genomeId: 'hg38'})
        const record = []

        const summary = await fanOutTracks(a, [a, b, c], configs, recordingLoad(record, new Set([b])))

        expect(summary.loaded).toEqual([a, c])
        expect(summary.failed.map(({browser}) => browser)).toEqual([b])
        expect(summary.failed[0].error.message).toBe('boom in b')
    })

    it('hands each target its own copy of each config', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        const b = fakeBrowser('b', {genomeId: 'hg38'})
        const record = []

        await fanOutTracks(a, [a, b], configs, recordingLoad(record))

        const [first, second] = record
        expect(first.configs[0]).toEqual(configs[0])
        expect(first.configs[0]).not.toBe(configs[0])
        expect(second.configs[0]).not.toBe(first.configs[0])
    })

    it('leaves the caller\'s configs unmutated when a loader writes to what it is handed', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        const mutating = async (browser, ownConfigs) => {
            ownConfigs[0].autoscale = true
        }

        await fanOutTracks(a, [a], configs, mutating)

        expect(configs[0].autoscale).toBeUndefined()
    })

    it('returns an empty summary for an empty target set', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        expect(await fanOutTracks(a, [], configs, recordingLoad([])))
            .toEqual({loaded: [], failed: [], skipped: []})
    })
})

describe('fanOutMap', () => {

    const config = {url: 'https://example.com/mouse.hic', name: 'mouse'}

    /**
     * A loader that installs the map's genome, as `loadHicFileOrThrow` does:
     * the incoming map declares its own genome, and the browser takes it.
     * Records when each load starts and ends, so the order is observable.
     */
    function mapLoad(record, {genomeId = 'mm10', failing = new Set()} = {}) {
        return async (browser, ownConfig) => {
            record.push({event: 'start', browser, config: ownConfig})
            await new Promise(resolve => setTimeout(resolve, 0))
            if (failing.has(browser)) {
                record.push({event: 'end', browser})
                throw new Error(`boom in ${browser.name}`)
            }
            browser.dataset = {}
            browser.genome = {id: genomeId}
            record.push({event: 'end', browser})
        }
    }

    const started = record => record.filter(({event}) => 'start' === event).map(({browser}) => browser)

    it('loads into every target, including an empty one, and skips nothing', async () => {
        const a = fakeBrowser('a', {genomeId: 'mm10'})
        const empty = fakeBrowser('empty')
        const record = []

        const summary = await fanOutMap([a, empty], config, mapLoad(record))

        expect(summary.loaded).toEqual([a, empty])
        expect(summary.failed).toEqual([])
        expect(summary.skipped).toEqual([])
        expect(started(record)).toEqual([a, empty])
    })

    it('loads into a target on another genome and reports the change', async () => {
        const human = fakeBrowser('human', {genomeId: 'hg38'})
        const mouse = fakeBrowser('mouse', {genomeId: 'mm10'})

        const summary = await fanOutMap([human, mouse], config, mapLoad([]))

        expect(summary.loaded).toEqual([human, mouse])
        expect(summary.genomeChanged).toEqual([{browser: human, from: 'hg38', to: 'mm10'}])
    })

    // `clearDataset()` runs at the top of every map load and does not touch the
    // genome or the tracks, so a panel whose last load failed has no dataset
    // but still has tracks on its old genome. That is the case this key exists for.
    it('reports a target that lost its dataset but kept its genome', async () => {
        const failedEarlier = fakeBrowser('failed-earlier')
        failedEarlier.genome = {id: 'hg38'}

        const summary = await fanOutMap([failedEarlier], config, mapLoad([]))

        expect(summary.genomeChanged).toEqual([{browser: failedEarlier, from: 'hg38', to: 'mm10'}])
    })

    // An empty panel had no genome, so it has no tracks drawn against one --
    // the fact `genomeChanged` exists to report cannot be true of it.
    it('does not report an empty target as a genome change', async () => {
        const empty = fakeBrowser('empty')

        const summary = await fanOutMap([empty], config, mapLoad([]))

        expect(summary.genomeChanged).toEqual([])
    })

    // The serial decision (#680): `loadHicFile` ends by syncing the registry
    // and adopting a peer's state, so concurrent loads would leave each panel
    // wherever the network order put it. This fails if the fan-out is ever
    // "optimised" back to `Promise.allSettled`.
    it('loads the targets one after another, never overlapping', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        const b = fakeBrowser('b', {genomeId: 'hg38'})
        const c = fakeBrowser('c')
        const record = []

        await fanOutMap([a, b, c], config, mapLoad(record))

        expect(record.map(({event, browser}) => `${event} ${browser.name}`)).toEqual([
            'start a', 'end a',
            'start b', 'end b',
            'start c', 'end c'
        ])
    })

    it('reports a failing target without stopping the ones after it', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        const b = fakeBrowser('b', {genomeId: 'hg38'})
        const c = fakeBrowser('c', {genomeId: 'hg38'})
        const record = []

        const summary = await fanOutMap([a, b, c], config, mapLoad(record, {failing: new Set([b])}))

        expect(summary.loaded).toEqual([a, c])
        expect(summary.failed.map(({browser}) => browser)).toEqual([b])
        expect(summary.failed[0].error.message).toBe('boom in b')
        expect(summary.genomeChanged.map(({browser}) => browser)).toEqual([a, c])
        expect(started(record)).toEqual([a, b, c])
    })

    it('hands each target its own copy of the config', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        const b = fakeBrowser('b', {genomeId: 'hg38'})
        const record = []

        await fanOutMap([a, b], config, mapLoad(record))

        const [first, second] = record.filter(({event}) => 'start' === event)
        expect(first.config).toEqual(config)
        expect(first.config).not.toBe(config)
        expect(second.config).not.toBe(first.config)
    })

    it('leaves the caller\'s config unmutated when a loader writes to what it is handed', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        const mutating = async (browser, ownConfig) => {
            ownConfig.name = 'renamed'
            ownConfig.nvi = '123,456'
        }

        await fanOutMap([a], config, mutating)

        expect(config).toEqual({url: 'https://example.com/mouse.hic', name: 'mouse'})
    })

    it('returns an empty summary for an empty target set', async () => {
        expect(await fanOutMap([], config, mapLoad([])))
            .toEqual({loaded: [], failed: [], skipped: [], genomeChanged: []})
    })
})

describe('controlSkipReason', () => {

    it('does not skip a target with a primary map', () => {
        expect(controlSkipReason(fakeBrowser('a', {genomeId: 'hg38'}))).toBeUndefined()
    })

    // `clearDataset()` leaves the genome behind, so a genome alone is not a
    // primary: a panel whose last map load failed has nothing to be the "B" of.
    it('skips a target with no primary map, even one that kept its genome', () => {
        const failedEarlier = fakeBrowser('failed-earlier')
        failedEarlier.genome = {id: 'hg38'}

        expect(controlSkipReason(fakeBrowser('empty'))).toBe('no-primary')
        expect(controlSkipReason(failedEarlier)).toBe('no-primary')
    })
})

describe('fanOutControlMap', () => {

    const config = {url: 'https://example.com/control.hic', name: 'control'}

    /**
     * A loader that stands in for `loadHicControlFileOrThrow`: the browsers in
     * `incompatible` refuse the map the way the real one does -- after the
     * read, with the declared code -- and the rest take it as their control.
     */
    function controlLoad(record, {incompatible = new Set(), failing = new Set()} = {}) {
        return async (browser, ownConfig) => {
            record.push({event: 'start', browser, config: ownConfig})
            await new Promise(resolve => setTimeout(resolve, 0))
            record.push({event: 'end', browser})
            if (incompatible.has(browser)) {
                const error = new Error('"B" map genome (mm10) does not match "A" map genome (hg38)')
                error.code = 'control-incompatible'
                throw error
            }
            if (failing.has(browser)) {
                throw new Error(`boom in ${browser.name}`)
            }
            browser.controlDataset = {name: ownConfig.name}
        }
    }

    const started = record => record.filter(({event}) => 'start' === event).map(({browser}) => browser)

    it('loads the control map into every target with a primary', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        const b = fakeBrowser('b', {genomeId: 'hg38'})
        const record = []

        const summary = await fanOutControlMap([a, b], config, controlLoad(record))

        expect(summary).toEqual({loaded: [a, b], failed: [], skipped: [], genomeChanged: []})
        expect(started(record)).toEqual([a, b])
    })

    it('skips a target with no primary map without reading anything for it', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        const empty = fakeBrowser('empty')
        const record = []

        const summary = await fanOutControlMap([a, empty], config, controlLoad(record))

        expect(summary.loaded).toEqual([a])
        expect(summary.skipped).toEqual([{browser: empty, reason: 'no-primary'}])
        expect(started(record)).toEqual([a])
    })

    // Known only after the read, and a declined placement rather than an
    // error -- ADR-0015 decision 5.
    it('skips a target whose primary cannot pair with the control map', async () => {
        const human = fakeBrowser('human', {genomeId: 'hg38'})
        const mouse = fakeBrowser('mouse', {genomeId: 'mm10'})

        const summary = await fanOutControlMap([human, mouse], config, controlLoad([], {incompatible: new Set([human])}))

        expect(summary.loaded).toEqual([mouse])
        expect(summary.failed).toEqual([])
        expect(summary.skipped).toEqual([{browser: human, reason: 'control-incompatible'}])
    })

    // The code is the contract (#679), not the wording: a failure that merely
    // reads like a mismatch is still a failure.
    it('reads incompatibility off the declared code, not the message', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        const lookalike = async () => {
            throw new Error('"B" map genome (mm10) does not match "A" map genome (hg38)')
        }

        const summary = await fanOutControlMap([a], config, lookalike)

        expect(summary.skipped).toEqual([])
        expect(summary.failed.map(({browser}) => browser)).toEqual([a])
    })

    it('reports a failing target without stopping the ones after it', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        const b = fakeBrowser('b', {genomeId: 'hg38'})
        const c = fakeBrowser('c', {genomeId: 'hg38'})
        const record = []

        const summary = await fanOutControlMap([a, b, c], config, controlLoad(record, {failing: new Set([b])}))

        expect(summary.loaded).toEqual([a, c])
        expect(summary.failed.map(({browser}) => browser)).toEqual([b])
        expect(summary.failed[0].error.message).toBe('boom in b')
        expect(started(record)).toEqual([a, b, c])
    })

    it('loads the targets one after another, never overlapping', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        const b = fakeBrowser('b', {genomeId: 'hg38'})
        const record = []

        await fanOutControlMap([a, b], config, controlLoad(record))

        expect(record.map(({event, browser}) => `${event} ${browser.name}`)).toEqual([
            'start a', 'end a',
            'start b', 'end b'
        ])
    })

    it('hands each target its own copy of the config', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        const b = fakeBrowser('b', {genomeId: 'hg38'})
        const record = []

        await fanOutControlMap([a, b], config, controlLoad(record))

        const [first, second] = record.filter(({event}) => 'start' === event)
        expect(first.config).toEqual(config)
        expect(first.config).not.toBe(config)
        expect(second.config).not.toBe(first.config)
    })

    // A/B/ratio is a view preference, and ADR-0014 keeps those out of what
    // crosses between browsers.
    it('leaves each target\'s display mode alone', async () => {
        const a = fakeBrowser('a', {genomeId: 'hg38'})
        a.displayMode = 'AOB'

        await fanOutControlMap([a], config, controlLoad([]))

        expect(a.displayMode).toBe('AOB')
    })

    it('returns an empty summary for an empty target set', async () => {
        expect(await fanOutControlMap([], config, controlLoad([])))
            .toEqual({loaded: [], failed: [], skipped: [], genomeChanged: []})
    })
})
