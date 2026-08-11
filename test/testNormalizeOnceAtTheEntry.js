/**
 * The normalize stage runs once per session, at the entry. #535.
 *
 * `test/testNormalizeSession.js` drives the stage itself and `testConfigGolden.js`
 * pins what it produces. Neither can say *how many times* it ran: the stage is
 * idempotent, so a second call is invisible in the result. That is exactly why
 * this file exists -- the claim #535 makes is about the shape of the pipeline,
 * not about a value, and the only way to see it is to count.
 *
 * ## What it counts, and why the stage is mocked to do it
 *
 * The module is replaced by a counting wrapper over the real thing, so every
 * importer -- `browserRegistry.js`, `createBrowser.js` -- is counted whichever
 * one of them happens to call. Spying on an export after the fact would not
 * work: the importers hold the binding they imported.
 *
 * The wrapper delegates to the actual implementation rather than stubbing it, so
 * these tests drive a real, resolved config all the way to a browser. A count
 * taken over a stub would be a count over a pipeline that no longer works.
 *
 * ## The doors
 *
 * Every published way a config or session gets in is here, plus the query path,
 * which is `init` with the URL in charge. `createBrowserList` is deliberately
 * absent: since #535 it is *below* the seam -- it builds browsers from a session
 * its caller has already resolved -- and the one thing this file would assert
 * about it is that it does **not** normalize, which is the `zero` case at the
 * end.
 *
 * @see js/normalizeSession.js
 * @see test/testConfigGolden.js -- what the resolved config is
 */
import {beforeEach, describe, expect, test, vi} from 'vitest'

const {calls} = vi.hoisted(() => ({calls: []}))

vi.mock('../js/normalizeSession.js', async importOriginal => {

    const actual = await importOriginal()

    return {
        ...actual,
        normalizeSession: session => {
            calls.push(session)
            return actual.normalizeSession(session)
        },
    }
})

import {createBrowser, createBrowserList} from '../js/createBrowser.js'
import {init} from '../js/init.js'
import {restoreSession} from '../js/session.js'
import {registryForContainer} from '../js/browserRegistry.js'
import {withContainers} from './utils/browserFixture.js'
import {withStubbedLoads} from './utils/stubbedLoads.js'
import {selfContained} from './data/wireFormatCorpus.js'

/**
 * A published link, taken from the wire-format corpus rather than written here,
 * so the query column is driven by a URL that is known to decode.
 */
const QUERY_URL = selfContained.find(fixture => fixture.id === 'harvested-query-wapl-wt').input

/**
 * A host-shaped config with something to normalize in every stage: a shortcut to
 * expand, a string to coerce, a track to default, and a session member to
 * resolve. If a door skipped the stage, this is the config that would show it.
 */
function hostConfig() {
    return {
        url: '*s3/aidenlab/hic/GM12878.hic',
        name: 'GM12878',
        colorScale: '2000,255,0,0',
        tracks: [{url: '*s3e/GM12878_CTCF.bed', name: 'CTCF', color: 'rgb(22, 129, 198)'}],
    }
}

function sessionDocument() {
    return {browsers: [hostConfig(), {url: 'https://example.org/b.hic', name: 'B'}]}
}

/**
 * Everything a resolved config carries that an unresolved one does not, asserted
 * beside the count so that "exactly once" cannot be satisfied by "not at all".
 */
function expectResolved(browser) {
    expect(browser.config.showLocusGoto).toBe(true)
    expect(browser.config.url).toBe('https://hicfiles.s3.amazonaws.com/aidenlab/hic/GM12878.hic')
    expect(typeof browser.config.colorScale).not.toBe('string')
    expect(browser.config.tracks[0].color).toBeUndefined()
}

describe('every entry path normalizes exactly once', () => {

    const dom = withContainers()
    withStubbedLoads()

    beforeEach(() => {
        calls.length = 0
    })

    test('hic.init(container, config)', async () => {

        dom.navigate('http://localhost/host.html')
        await init(dom.another(), hostConfig())

        expect(calls).toHaveLength(1)
    })

    test('hic.init(container, {}) with the URL in charge', async () => {

        dom.navigate(QUERY_URL)
        await init(dom.another(), {})

        expect(calls).toHaveLength(1)
    })

    test('hic.restoreSession(container, session)', async () => {

        await restoreSession(dom.another(), sessionDocument())

        expect(calls).toHaveLength(1)
    })

    test('registry.restoreSession(session) reached directly', async () => {

        await registryForContainer(dom.another()).restoreSession(sessionDocument())

        expect(calls).toHaveLength(1)
    })

    test('hic.createBrowser(container, config)', async () => {

        await createBrowser(dom.another(), hostConfig())

        expect(calls).toHaveLength(1)
    })

    /**
     * The Spacewalk sequence -- `init(container, {})` and then a restore into the
     * same embed -- is two entries, and so two normalizations of two different
     * documents. Counted here because "once per session" is the claim, not "once
     * per page".
     */
    test('a restore into a live embed is a second entry, not a second pass over the first', async () => {

        const container = dom.another()

        dom.navigate('http://localhost/host.html')
        await init(container, {})
        expect(calls).toHaveLength(1)

        const session = sessionDocument()
        await restoreSession(container, session)

        expect(calls).toHaveLength(2)
        expect(calls[1]).toBe(session)
    })

    test('the config a browser is built from is the resolved one', async () => {

        const browser = await createBrowser(dom.another(), hostConfig())

        expectResolved(browser)
    })

    test('and so is every browser of a restored session', async () => {

        const container = dom.another()
        await restoreSession(container, sessionDocument())

        expectResolved(registryForContainer(container).browsers[0])
    })
})

/**
 * The other half of "at the entry": the browser-building step below the seam
 * does not normalize, so nothing downstream re-interprets a config that has
 * already been resolved.
 *
 * `createBrowserList` is internal -- it is not in `js/index.js` and its one
 * production caller is `BrowserRegistry.restoreSession`, which is the door. It
 * is driven here rather than described, because "the stage moved up" and "the
 * stage was copied up" look identical from every other test in the repo.
 */
describe('browser creation does not normalize', () => {

    const dom = withContainers()
    withStubbedLoads()

    beforeEach(() => {
        calls.length = 0
    })

    test('createBrowserList takes a session its caller has already resolved', async () => {

        await createBrowserList(dom.another(), sessionDocument())

        expect(calls).toHaveLength(0)
    })
})
