/**
 * The golden-file characterization test for the resolved config. #531.
 *
 * **Nothing in the config-handling code moves until this file is green.** It is
 * candidate 9's gate, and it is the same instrument #503 was for candidate 5:
 * drive representative inputs through every entry path, snapshot what comes out,
 * and let the refactor pass by coming back byte-identical.
 *
 * ## What is snapshotted, and why it is two things
 *
 * Each fixture is driven through the four entry paths a config can arrive by,
 * and each path contributes two records:
 *
 * - **`atConstruction`** — the config as it reaches `HICBrowser`, captured at
 *   `HICBrowser.prototype.init` (the constructor assigns `this.config` and does
 *   not rewrite it, so the two are the same object one line apart). This is
 *   everything the normalizers upstream of the browser did.
 * - **`readBack`** — `browser.config` off the live instance afterwards, plus the
 *   two members the browser derives from a config rather than storing
 *   (`figureMode`, `synchable`). juicebox-web reads `browser.config` back
 *   (ADR-0003), so the resolved config is an *observable surface*: a change to
 *   it is consumer-visible whether or not any juicebox code notices. The pair
 *   also catches `init()` writing to the host's own object -- `config.displayMode
 *   = "A"` at hicBrowser.js:217 is one such write.
 *
 * `sameObjectAsInput` is snapshotted beside them because none of this is copied:
 * every normalizer mutates in place, so the host's own object is the browser's
 * config. A refactor that starts returning a normalized *copy* is a behaviour
 * change for a host that holds a reference, and this is the line that catches it.
 *
 * ## Why one snapshot holds all four paths
 *
 * Because the divergences are the point. No file in this repo states what a
 * config contains; four modules each interpret a subset, and the entry paths
 * have silently diverged. Putting the paths side by side in one snapshot turns
 * "the paths disagree" from a claim in a review card into a difference between
 * two columns of a committed file. Where a fixture exists to expose one, its
 * `divergence` note in `test/data/configEntryPathCorpus.js` says which -- and
 * names the ticket expected to close it.
 *
 * ## Updating a snapshot — the convention
 *
 * Unchanged from #503, and it applies here for the same reason: a bare
 * `vitest -u` is exactly what makes a deliberate movement and an accidental one
 * indistinguishable.
 *
 * 1. Read the diff fixture by fixture. A column you did not expect to move is a
 *    bug report, not a snapshot to accept.
 * 2. Update only what moved -- `vitest -u -t '<fixture id>'`, never a bare `-u`.
 * 3. Add a row to the log below naming the ticket that authorised it.
 *
 * ### Authorised snapshot movements
 *
 * | Date | Fixtures | Authorised by |
 * |------|----------|---------------|
 * | 2026-08-10 | all — baseline taken | #531. No production code changed; this is the gate, taken before candidate 9 moves anything. |
 *
 * @see test/data/configEntryPathCorpus.js — the inputs and their divergence notes
 * @see test/testDecoderGolden.js — the same instrument, one seam upstream
 */
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {igvxhr} from 'igv-utils'
import HICBrowser from '../js/hicBrowser.js'
import DataLoader from '../js/dataLoader.js'
import {init} from '../js/init.js'
import {restoreSession} from '../js/session.js'
import {createBrowser, createBrowserList} from '../js/createBrowser.js'
import {registryForContainer} from '../js/browserRegistry.js'
import {withContainers} from './utils/browserFixture.js'
import {withStubbedLoads} from './utils/stubbedLoads.js'
import {configFixtures, divergenceProbes, sessionFixtures} from './data/configEntryPathCorpus.js'
import {selfContained, viaLoader} from './data/wireFormatCorpus.js'

/**
 * The two loads `withStubbedLoads` does not cover, stubbed for the same reason
 * it covers the others: they are the network, and a config fixture naming a
 * control map or a normalization vector would otherwise go to the wire.
 *
 * Local to this file rather than added to the shared helper: no other suite
 * drives a config with a control map, so putting these in `withStubbedLoads`
 * would change what every existing suite stubs in order to serve one. (The
 * `browserFixture` change in the same commit goes the other way because it is
 * purely additive -- an extra return value and an extra method, nothing that
 * alters what an existing caller sees.) What the stub reproduces is only what
 * the config path downstream of it reads: `controlUrl` on the browser, and a
 * dataset present enough for `isWholeGenome` and the resolution selector.
 */
function withStubbedControlLoads() {

    beforeEach(() => {
        vi.spyOn(DataLoader.prototype, 'loadHicControlFile').mockImplementation(async function (config) {
            this.browser.controlUrl = config.url
            this.browser.controlDataset = {
                url: config.url,
                name: config.name,
                genomeId: 'hg19',
                isWholeGenome: () => false,
                bpResolutions: [2500000, 1000000],
                isCompatible: () => true,
            }
        })
        vi.spyOn(DataLoader.prototype, 'loadNormalizationFile').mockImplementation(async () => undefined)
    })
}

/**
 * A config rendered as plain, order-stable data.
 *
 * Three things this does that a raw `toMatchSnapshot()` of the object would not:
 *
 * 1. **Keys are sorted.** Insertion order is an artefact of which normalizer
 *    wrote which field, and it differs between paths for reasons that are not
 *    behaviour. Sorting makes the columns comparable by eye.
 * 2. **Class instances keep their class.** `colorScale` arrives as a string on
 *    one path and a `ColorScale` on another; `state` as a plain object from
 *    `JSON.parse` and as a `State` from the query decoder. Those are different
 *    values and the snapshot has to say so.
 * 3. **Nothing calls `toJSON()`.** A wire projection would hide exactly the
 *    fields a normalize stage is most likely to drop.
 *
 * `testDecoderGolden.js` reaches (2) and (3) with a snapshot serializer instead.
 * The two are deliberately not shared: a serializer is installed on `expect` and
 * so applies to everything a file snapshots, which is right there and wrong here
 * -- this file snapshots a nested record where only the config subtrees want the
 * treatment, and it wants sorted keys, which a serializer cannot add without
 * changing how every other suite's objects print.
 */
function snapshotable(value) {

    if (value === null || typeof value !== 'object') {
        return typeof value === 'function' ? '[Function]' : value
    }

    if (Array.isArray(value)) {
        return value.map(snapshotable)
    }

    const entries = Object.keys(value).sort().map(key => [key, snapshotable(value[key])])
    const plain = Object.fromEntries(entries)

    const className = value.constructor?.name
    return className === undefined || className === 'Object'
        ? plain
        : {__class: className, ...plain}
}

/**
 * What one browser looks like once a path has built it.
 *
 * `figureMode` and `synchable` are here because they are read off a config and
 * stored, not stored as config: `browser.figureMode` is true for `miniMode`
 * while `config.showLocusGoto` is defaulted as though it were not, and that
 * disagreement is invisible in the config alone.
 */
function describeBrowser(browser, input) {
    return {
        config: snapshotable(browser.config),
        figureMode: browser.figureMode,
        synchable: browser.synchable,
        // Every normalizer mutates in place, so today this is `true` everywhere.
        // It is snapshotted rather than asserted because "the host's object *is*
        // the browser's config" is a property of the current design, not a
        // requirement -- a normalize stage that copies would move this line, and
        // that is a consumer-visible change worth arriving deliberately.
        sameObjectAsInput: input === undefined ? undefined : browser.config === input,
    }
}

/**
 * The four doors a config can come in by.
 *
 * All four take a single browser config: `createBrowserList` reads
 * `session.browsers || [session]`, so a bare config is a one-browser session,
 * and `restoreSession` and `init` end in one of the two creation paths. That
 * shared shape is what makes the four comparable.
 *
 * `init` navigates first: it consults `window.location.href` unless the host
 * opts out, and a URL carrying no juicebox parameters is what a host app that
 * embeds juicebox on an ordinary page presents. Setting
 * `queryParametersSupported: false` instead would have put an extra field in
 * every snapshot on one column only.
 */
const ENTRY_PATHS = [
    {
        name: 'hic.init(container, config)',
        sessionShaped: true,
        run: async (container, config, dom) => {
            dom.navigate('http://localhost/host.html')
            await init(container, config)
        },
    },
    {
        name: 'hic.restoreSession(container, session)',
        sessionShaped: true,
        run: async (container, config) => {
            await restoreSession(container, config)
        },
    },
    {
        name: 'createBrowser(container, config)',
        // The one path that takes a browser config and *only* a browser config:
        // it builds one browser, so `browsers` and `syncDatasets` mean nothing
        // to it. That is why it is excluded from the session suite -- and, since
        // the exclusion is a claim about the path rather than about its name, it
        // is a flag rather than a substring match on the caption.
        sessionShaped: false,
        run: async (container, config) => {
            await createBrowser(container, config)
        },
    },
    {
        name: 'createBrowserList(container, session)',
        sessionShaped: true,
        run: async (container, config) => {
            await createBrowserList(container, config)
        },
    },
]

const HOST_CONFIG_PATH = ENTRY_PATHS[0]

const SESSION_PATHS = ENTRY_PATHS.filter(path => path.sessionShaped)

/**
 * The three things every suite below needs: containers, the loads a test cannot
 * do, and the capture of what reached `HICBrowser`.
 *
 * One function rather than four repetitions of the same four lines, and it
 * returns the two holders the tests read -- neither of which exists until
 * `beforeEach` has run.
 */
function goldenSuite() {

    const dom = withContainers()
    withStubbedLoads()
    withStubbedControlLoads()

    return {dom, capture: captureConstructionConfigs()}
}

/**
 * Drive one input through one path in a container of its own, and return both
 * records as data -- including a rejection, which is as much a part of what a
 * path does with a config as an acceptance is.
 *
 * The input is cloned per path because every normalizer mutates in place: two
 * paths sharing a fixture object would have the first path's rewrites in the
 * second path's input, and the divergence the snapshot is for would vanish.
 */
async function drive(path, dom, input, capture) {

    const container = dom.another()
    const clone = structuredClone(input)
    const inputBrowsers = clone.browsers || [clone]

    capture.take()

    try {
        await path.run(container, clone, dom)
    } catch (e) {
        return {outcome: 'throws', error: {name: e?.name, message: e?.message}}
    }

    const browsers = registryForContainer(container).browsers

    return {
        outcome: 'builds',
        atConstruction: capture.take(),
        readBack: browsers.map((browser, i) => describeBrowser(browser, inputBrowsers[i])),
    }
}

/**
 * The query path's counterpart to `drive`: navigate to `href`, initialize with
 * the empty config a host that leaves the URL in charge passes, and return the
 * same two records.
 *
 * `init(container, {})` rather than a call to `extractConfig`: what is being
 * characterized is the whole path from the address bar to `browser.config`, and
 * the decode half of it already has a golden file of its own.
 */
async function driveQuery(dom, href, capture) {

    const container = dom.another()
    capture.take()

    dom.navigate(href)
    await init(container, {})

    return {
        atConstruction: capture.take(),
        readBack: registryForContainer(container).browsers.map(browser => describeBrowser(browser)),
    }
}

/**
 * Capture the config *as it reaches the browser*, before `init()` has had a
 * chance to write to it.
 *
 * A spy rather than a constructor hook: the constructor assigns `this.config`
 * and the very next thing any path does is `await browser.init(config)`, with
 * the same object and nothing in between. Rendered immediately, because the
 * object it holds is the one everything downstream then mutates.
 *
 * `take()` returns what has accumulated *and* clears it, so a driver never
 * reaches into the captor's array to reset it: one path's browsers cannot leak
 * into the next path's column, and there is one place that rule is written.
 */
function captureConstructionConfigs() {

    let captured = []

    beforeEach(() => {
        captured = []
        const original = HICBrowser.prototype.init
        vi.spyOn(HICBrowser.prototype, 'init').mockImplementation(async function (config) {
            captured.push(snapshotable(config))
            return original.call(this, config)
        })
    })

    return {
        take() {
            const taken = captured
            captured = []
            return taken
        },
    }
}

/**
 * "Every entry path is covered" has to hold by construction, not by having been
 * true the day it was written -- the same guard `testDecoderGolden.js` puts over
 * its three partitions, and for the same reason: the one failure mode a golden
 * file cannot survive is a case that stops being snapshotted in silence.
 *
 * The session suite runs a subset of the paths, so the subset is checked rather
 * than assumed: exactly one path is not session-shaped, and it is the one that
 * builds a single browser. A path added without a `sessionShaped` flag fails
 * here instead of quietly running in one suite only.
 */
test('every entry path is driven, and the session subset is the one path short', () => {

    expect(ENTRY_PATHS.map(path => path.name)).toEqual([
        'hic.init(container, config)',
        'hic.restoreSession(container, session)',
        'createBrowser(container, config)',
        'createBrowserList(container, session)',
    ])

    expect(ENTRY_PATHS.every(path => typeof path.sessionShaped === 'boolean'),
        'a path with no sessionShaped flag would be dropped from the session suite in silence').toBe(true)

    expect(ENTRY_PATHS.filter(path => !path.sessionShaped).map(path => path.name))
        .toEqual(['createBrowser(container, config)'])

    expect(SESSION_PATHS).toHaveLength(ENTRY_PATHS.length - 1)
    expect(HOST_CONFIG_PATH.name).toBe('hic.init(container, config)')
})

/**
 * A fixture id names a snapshot, so two fixtures sharing one would leave a
 * single entry standing for both -- silently, and differently depending on
 * which ran last.
 */
test('every fixture id is unique within its corpus', () => {
    for (const corpus of [configFixtures, sessionFixtures, divergenceProbes]) {
        expect(new Set(corpus.map(f => f.id)).size).toBe(corpus.length)
    }
})

describe('resolved config golden file — one browser config, through every entry path', () => {

    const {dom, capture} = goldenSuite()

    for (const fixture of configFixtures) {
        test(fixture.id, async () => {

            const byPath = {}
            for (const path of ENTRY_PATHS) {
                byPath[path.name] = await drive(path, dom, fixture.config, capture)
            }

            expect(byPath).toMatchSnapshot()
        })
    }
})

describe('resolved config golden file — session documents, through the session-shaped paths', () => {

    const {dom, capture} = goldenSuite()

    for (const fixture of sessionFixtures) {
        test(fixture.id, async () => {

            const byPath = {}
            for (const path of SESSION_PATHS) {
                byPath[path.name] = await drive(path, dom, fixture.session, capture)
            }

            expect(byPath).toMatchSnapshot()
        })
    }
})

/**
 * The Spacewalk sequence: `init(container, {})` first, then `restoreSession`
 * into the *same* embed.
 *
 * The suites above give each path a container of its own, which is the right
 * isolation for comparing columns and the wrong shape for the one host that
 * matters most here. Spacewalk initializes with an empty config and drives
 * everything through `restoreSession` afterwards, so its restore always lands on
 * a registry that already holds a browser -- `deleteAll()` then rebuild, not a
 * cold start. That re-entrancy is a different code path and gets its own
 * snapshot.
 *
 * Both halves are recorded, because the interesting question is whether the
 * second one is affected by the first having happened.
 */
describe('resolved config golden file — the Spacewalk sequence, restoring into a live embed', () => {

    const {dom, capture} = goldenSuite()

    for (const fixture of sessionFixtures) {
        test(fixture.id, async () => {

            const container = dom.another()

            dom.navigate('http://localhost/host.html')
            capture.take()
            await init(container, {})

            const afterInit = {
                atConstruction: capture.take(),
                readBack: registryForContainer(container).browsers.map(browser => describeBrowser(browser)),
            }

            const session = structuredClone(fixture.session)
            await restoreSession(container, session)

            const afterRestore = {
                atConstruction: capture.take(),
                readBack: registryForContainer(container).browsers
                    .map((browser, i) => describeBrowser(browser, (session.browsers || [session])[i])),
            }

            expect({afterInit, afterRestore}).toMatchSnapshot()
        })
    }
})

/**
 * The query/URL path, over the wire-format corpus rather than over fixtures
 * invented here.
 *
 * #503 pins what `decodeSession` *returns*; what this pins is what happens to
 * that value on its way to a browser -- the registry's shortcut expansion, the
 * per-browser defaults, and the fields `HICBrowser` reads. The two golden files
 * meet at `init.js:50`, and the corpus is deliberately the same one so that a
 * fixture added there is covered on both sides of the seam.
 *
 * Only the fixtures that decode to a config are here: a `no-config` URL leaves
 * the host's config in place, which is the `hic.init` column above, and a
 * rejection never reaches a browser. Those are #503's to pin, and it does.
 *
 * The corpus's bare-query fixtures are given a base URL, since a page has one.
 * `extractQuery` reads from the first `?`, so the base is not part of what is
 * being characterized -- but it *is* part of what JSDOM parses, which is the
 * other reason to navigate rather than to hand `extractConfig` a raw string:
 * a URL a user pastes has been through a URL parser before juicebox sees it.
 */
describe('resolved config golden file — the query path, over the wire-format corpus', () => {

    const {dom, capture} = goldenSuite()

    const decoding = [...selfContained, ...viaLoader].filter(f => f.outcome === 'decodes')

    beforeEach(() => {
        // A tripwire, as in #503: nothing on this path should reach the network.
        // The session-URL fixtures re-stub it with their own recorded response.
        vi.spyOn(igvxhr, 'loadString').mockImplementation(async () => {
            throw new Error('unexpected network access from the config golden-file suite')
        })
    })

    for (const fixture of decoding) {
        test(fixture.id, async () => {

            if (fixture.loaderResponse !== undefined) {
                vi.spyOn(igvxhr, 'loadString').mockImplementation(async () => fixture.loaderResponse)
            }

            const href = fixture.input.startsWith('?')
                ? `http://localhost/juicebox/${fixture.input}`
                : fixture.input

            expect(await driveQuery(dom, href, capture)).toMatchSnapshot()
        })
    }
})

/**
 * The divergences the four columns cannot show: query path against config path,
 * on inputs that mean the same thing.
 *
 * A URL and a config are different types, so they cannot be two columns of the
 * table above. Pairing them is the substitute -- and it is a real one, because
 * the inputs are equivalent by construction, so anything that differs between
 * the two answers was put there by a normalizer that only one path meets.
 *
 * @see test/data/configEntryPathCorpus.js — each probe's `divergence` note
 */
describe('resolved config golden file — the same input as a URL and as a config', () => {

    const {dom, capture} = goldenSuite()

    for (const probe of divergenceProbes) {
        test(probe.id, async () => {

            const viaQuery = await driveQuery(dom, probe.url, capture)
            const viaHostConfig = await drive(HOST_CONFIG_PATH, dom, probe.config, capture)

            expect({viaQuery, viaHostConfig}).toMatchSnapshot()
        })
    }
})
