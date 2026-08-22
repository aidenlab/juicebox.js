/**
 * The golden-file characterization test for the **resolved state after
 * restore**. #557, candidate 6's gate, scoped by ADR-0009.
 *
 * **Nothing in the restore path moves until this file is green.** It is the
 * third instrument of the same kind: #503 snapshots the decoded session, #531
 * the resolved config, and the stage between them -- the state a `.hic` load
 * actually hands the browser -- is exactly what candidate 6 moves. The corpus
 * from #502 is the input for all three, so a fixture added there is covered on
 * every seam.
 *
 * ## The five doors
 *
 * `dataLoader.loadHicFile` walks a four-rung ladder -- a config-level `locus`, a
 * `state` token, a `synchState`, and the `State.default()` fallback -- and
 * `dataLoader.loadLiveContactMap` is a fifth door walking its own copy of the
 * middle of it. Only two rungs reach `browser.setState`.
 *
 * All five are here, not the two candidate 6 touches. #504 is the reason: the
 * live-map path had drifted from the file path and lost a rung of the same
 * ladder -- a numeric `state` crashed on one path and opened the default view on
 * the other -- and nothing caught it. A golden scoped to the doors you are
 * touching cannot see the door you are not.
 *
 * ## Two stated viewports, and why they are stated
 *
 * The honest in-harness measurement of the viewport is `{width: 0, height: 0}`:
 * the test environment is `node`, JSDOM is opt-in per suite, and JSDOM does no
 * layout in any case (ADR-0009 fact 5). So the fixture states a viewport; there
 * is no alternative, and a test that read a live measurement would be recording
 * zero and calling it a clamp.
 *
 * It states *two* because candidate 6's whole claim is that clamping happens on
 * restore, and at a single viewport a golden cannot tell a clamp from a
 * coincidence. `clampXY` bounds the origin at
 * `chromosome.size / binSize - viewport / pixelSize` and `minPixelSize` divides
 * the viewport by the bin count, so both are viewport-dependent -- and the two
 * sizes here differ on both axes and in aspect, so a value that moves between
 * the columns is a value the viewport reached. The sizes are written into the
 * snapshot as a `viewport` field rather than implied by the column name.
 *
 * ## What is snapshotted
 *
 * Per fixture, per browser config in it, per door, per viewport:
 *
 * - **`presented`** -- the config the door was handed. Doors take different
 *   spellings of the same view, so this says which one, in full.
 * - **`rungs`** -- which of `parseGotoInput`, `setState` and `syncState` the
 *   load actually called. The ladder's branch is an observation here, not an
 *   inference from the input: a rung that stops running is the failure this file
 *   exists to catch, and it would otherwise show up only as a state that moved.
 * - **`state`** -- the resolved `State` off the live browser, field by field,
 *   plus `getLocus` projected at the same stated viewport.
 *   `setActiveDataset(state)` counts only the calls that carry a state -- the
 *   second parameter ADR-0009 decision 1 deletes, and so the number that should
 *   reach zero. It is not a rung; it is the back door beside the ladder.
 *
 * A fixture that differs from another only in its tracks or its colour scale
 * produces an identical record here, and that is correct: restore reads the
 * state and the URL and nothing else. The corpus is driven whole anyway, because
 * "which config fields restore reads" is a fact about today that a later ticket
 * could change without anyone noticing.
 *
 * ## No behaviour moves in this ticket
 *
 * This file adds a test surface and nothing else. Where a snapshot looks wrong
 * it is recorded as-is, with a note here saying so -- the point is to pin what
 * happens *today*, so that the next ticket's diff has something to be read
 * against. Three are known, and all three were found by reading the baseline:
 *
 * 1. **No door clamps.** The `state` door does not, because
 *    `StateManager.setState` applies a `minPixelSize` floor directly and never
 *    calls `_adjustPixelSize` or `clampXY`. The `locus` door does not either, on
 *    the branch a real link takes: `State.updateWithLoci` passes
 *    `{clampXY: false}`, so only the whole-chromosome branch through
 *    `setChromosomesView` clamps at all. That is ADR-0009's premise recorded as
 *    data rather than argued: the invariant has no enforcer on restore, and the
 *    live door's record below is what it costs.
 * 2. **The live-map door's `state` rung is overwritten one line later, and lands
 *    outside the chromosome.** `loadLiveContactMap` decodes `config.state`,
 *    calls `setState`, and then unconditionally calls `parseGotoInput` on the
 *    live extent -- so the state a live session carries never survives its own
 *    load. And because `parseLocusString` converts to 0-based by subtracting one,
 *    an extent starting at 0 becomes `-1` bp, which nothing clamps, so every live
 *    record in this file has a **negative** origin. Recorded, not fixed; filed
 *    as #567.
 *
 *    The live door is the worst case, not the only one: the same subtraction
 *    reaches the file path's `locus` door whenever the projected locus starts at
 *    bp 0, and roughly a sixth of the `config.locus` records here carry a small
 *    negative `x` for that reason. A negative origin outside the live column is
 *    therefore **baseline**, not a regression -- it is finding 1 showing through,
 *    since no door clamps.
 * 3. **The `config.synchState` rung is unreachable.** Its guard is
 *    `config.synchState && browser.canBeSynched(...)`, and `canBeSynched`
 *    returns false without an `activeDataset` -- which `loadHicFile` has just
 *    cleared, four lines earlier, by calling `clearDataset()`. So a config
 *    carrying a `synchState` silently takes the fallback rung instead. The door
 *    is driven *primed* -- against a browser that has already loaded the map --
 *    precisely so the snapshot shows that priming does not help: the record says
 *    `primedWith`, and still reports the fallback. Sync between browsers works;
 *    it goes through `registry.sync()` and `browser.syncState()` and never
 *    through this rung. Recorded, not fixed; filed as #566, which also names the
 *    two candidate 6 tickets that assume the rung is live.
 *
 * ## Updating a snapshot — the convention
 *
 * Unchanged from #503 and #531, and it applies here for the same reason: a bare
 * `vitest -u` is exactly what makes a deliberate movement and an accidental one
 * indistinguishable.
 *
 * 1. Read the diff fixture by fixture. A column you did not expect to move is a
 *    bug report, not a snapshot to accept.
 * 2. Update only what moved -- `vitest -u -t '<fixture id>'`, never a bare `-u`.
 * 3. Add a row to the log below naming the ticket that authorised it.
 *
 * ### What moves a snapshot legitimately
 *
 * - A **door changing which rung it takes** -- ADR-0009 decision 1 routes every
 *   door through the chokepoint, so `rungs` moves for the doors that skipped it.
 * - A **clamp arriving** -- an `x` or `y` outside `[0, chromosome/binSize]`
 *   coming back inside it. Every live-door record is negative today and some
 *   `config.locus` records are too, so those are the ones to read first. Expect a clamp to move one viewport column and
 *   not the other; that asymmetry is the evidence it is a clamp and not a
 *   coincidence, and it is the whole reason there are two columns.
 * - A **`pixelSize` cap arriving** -- a value above `MAX_PIXEL_SIZE` coming down
 *   to it, once restore runs `_adjustPixelSize`.
 * - A **normalization coerced against the dataset** (ADR-0009 decision 5).
 * - **`setActiveDataset(state)` falling to zero**, as decision 1 removes the
 *   parameter. It should reach zero on every door in the file.
 *
 * And what does **not**: a `locus` projection moving without its `state` moving
 * -- `getLocus` is a pure function of the fields above it, so that combination
 * is a change to the projection and not to restore. Nor a value moving in both
 * viewport columns by the same amount, which is the signature of a change to the
 * default view rather than to the clamp. Nor `rungs` losing a `setActiveDataset`
 * call while the state beside it stays put, which would mean the dataset stopped
 * being installed.
 *
 * ### Authorised snapshot movements
 *
 * | Date | Fixtures | Authorised by |
 * |------|----------|---------------|
 * | 2026-08-22 | all — baseline taken | #557. No production code changed; this is the gate, taken before candidate 6 moves anything. #510 landed first, so the fallback door records a y-origin of 0 rather than baking that defect in. |
 *
 * @see docs/adr/0009-restore-is-a-translator.md — the decisions this gate guards
 * @see test/data/wireFormatCorpus.js — the inputs
 * @see test/testDecoderGolden.js, test/testConfigGolden.js — the same instrument, one seam either side
 */
import {beforeEach, afterEach, describe, expect, test, vi} from 'vitest'
import {igvxhr} from 'igv-utils'
import {extractConfig} from '../js/urlUtils.js'
import {decodeState} from '../js/sessionCodec.js'
import {normalizeSession} from '../js/normalizeSession.js'
import ContactMatrixView from '../js/contactMatrixView.js'
import StateManager from '../js/stateManager.js'
import {selfContained, viaLoader, wireFormatCorpus} from './data/wireFormatCorpus.js'
import {withContainers} from './utils/browserFixture.js'
import {restoreDataset} from './utils/restoreDataset.js'

/**
 * The two things behind the restore path that a test cannot supply: the `.hic`
 * read and, on the live door, the streaming source. Both answer with the same
 * `restoreDataset`, so the two doors land on identical chromosome tables and
 * resolution ladders and any difference between their columns is the ladder's,
 * not the dataset's.
 *
 * `vi.mock` rather than `vi.spyOn` because the live door reaches its dataset
 * through `new HiCDataset(...)`, and a constructor cannot be spied.
 */
vi.mock('../js/hicDataset.js', async () => {
    const {restoreDataset} = await import('./utils/restoreDataset.js')
    return {
        default: {loadDataset: async config => restoreDataset(config)},
        HiCDataset: class {
            constructor(config) {
                Object.assign(this, restoreDataset(config))
            }
            async init() {}
        },
    }
})

const {default: HICBrowser} = await import('../js/hicBrowser.js')

/**
 * The stated viewports.
 *
 * `800 x 800` is the size `test/testState.js` already states, for the same
 * reason and against the same `--hic-viewport-width/height` the browser writes
 * onto `rootElement` in a real page. `1600 x 400` differs on both axes and
 * inverts the aspect, so a clamp that binds on x and not on y is visible as a
 * difference between the columns rather than as a single number nobody can
 * calibrate.
 */
const VIEWPORTS = [
    {id: '800x800', width: 800, height: 800},
    {id: '1600x400', width: 1600, height: 400},
]

/**
 * The viewport the `locus` door's input is derived at -- see `LOCUS_DOOR`.
 * Fixed rather than per-column so that the *same* locus string is presented at
 * both viewports and the difference between the columns is restore's doing
 * rather than the input's.
 */
const REFERENCE_VIEWPORT = VIEWPORTS[0]

/**
 * The extent a live contact map declares. Stated, like the viewports, because a
 * live map has no file to be measured against -- and stated small enough to sit
 * well inside chr1, so that the live door's unconditional `parseGotoInput` lands
 * on a real region rather than on a whole chromosome.
 */
const LIVE_EXTENT = {genomicStart: 0, genomicEnd: 10000000}

function formatLocus(locus) {
    return `${locus.x.chr}:${locus.x.start}-${locus.x.end} ${locus.y.chr}:${locus.y.start}-${locus.y.end}`
}

/**
 * The config a door was handed, rendered *before* the load runs.
 *
 * Before, because `loadHicFile` writes to the object it is given -- `config.name`
 * from `extractName`, `config.nvi` from the lookup table in `js/nvi.js` -- and a
 * record taken afterwards would be showing the load's output in the input
 * column.
 *
 * Two shapes get special treatment. A `state` keeps its class, because the query
 * decoder hands over a `State` and session JSON a plain object, and those take
 * different halves of `decodeState`; erasing the difference would erase the one
 * thing the two spellings disagree about. A `liveContactMap` is elided down to
 * its extent, because the rest of it is the `restoreDataset` chromosome table --
 * twenty-five entries of hg19 that would be repeated in every live-door record
 * in the file and say nothing.
 */
function renderPresented(config) {

    const rendered = {url: config.url}

    if ('locus' in config) {
        rendered.locus = config.locus
    }

    if ('state' in config) {
        rendered.state = renderPresentedState(config.state)
    }

    if ('synchState' in config) {
        rendered.synchState = config.synchState
    }

    if ('liveContactMap' in config) {
        const {chromosomes, ...extent} = config.liveContactMap
        rendered.liveContactMap = {chromosomes: `${chromosomes.length} — the restoreDataset table`, ...extent}
    }

    return rendered
}

function renderPresentedState(state) {

    if (state === undefined || state === null || typeof state !== 'object') {
        return state
    }

    const fields = Object.fromEntries(Object.keys(state).sort().map(key => [key, state[key]]))
    const className = state.constructor?.name

    return className === undefined || className === 'Object' ? fields : {__class: className, ...fields}
}

/**
 * A `State` as plain, order-stable data, plus the BP projection of it at the
 * viewport it was resolved against.
 *
 * The projection is included because the six canonical fields are bins and a bin
 * is unreadable without its resolution: `x: 5537.98` says nothing about whether
 * a clamp bit, and `chr3:13844968-...` says it immediately. It is a pure
 * function of the fields above it, so it never moves on its own -- a `locus`
 * that moves without its `state` moving is a change to `getLocus`, which is not
 * this candidate's.
 */
function renderState(state, dataset, viewport) {
    if (state === undefined) {
        return undefined
    }
    return {
        __class: state.constructor?.name,
        chr1: state.chr1,
        chr2: state.chr2,
        zoom: state.zoom,
        x: state.x,
        y: state.y,
        pixelSize: state.pixelSize,
        normalization: state.normalization,
        locus: formatLocus(state.getLocus(dataset, viewport)),
    }
}

/**
 * `StateManager.getSyncState`, computed off a state that has not been restored
 * yet.
 *
 * This is the one door whose input does not exist in any wire format: a
 * `synchState` is what a *sibling browser* publishes, so it can only be
 * synthesized. Synthesizing it with the same expression `getSyncState` uses is
 * what makes it the fixture's own view rather than an invented one -- the door
 * is then asked the honest question, "restore this view the way a sibling would
 * hand it to you", and its answer is comparable with the other four columns.
 */
function syncStateFrom(state, dataset) {
    return {
        chr1Name: dataset.chromosomes[state.chr1]?.name,
        chr2Name: dataset.chromosomes[state.chr2]?.name,
        binSize: dataset.bpResolutions[state.zoom],
        binX: state.x,
        binY: state.y,
        pixelSize: state.pixelSize,
    }
}

/**
 * The five doors, each with the spelling of the view it accepts.
 *
 * `present` receives the state the fixture's config decodes to -- `decodeState`
 * is the ladder's own `state` rung, so the intent is the view the fixture
 * *means*, whether it spelled it as a `state=` token, as session JSON, or not at
 * all (in which case the intent is the default view and every door is still
 * asked). Returning the fixture's own material rather than a literal is what
 * keeps the columns comparable: five spellings, one view.
 */
const RESTORE_DOORS = [
    {
        id: 'config.locus — the goto rung',
        // A locus is BP and a state is bins, so the translation between them is
        // a projection and needs a viewport. It is taken at REFERENCE_VIEWPORT
        // rather than at the column's own, so both columns are handed the same
        // string. That makes the square column a round trip and the wide one
        // not, which is itself worth seeing: the wide column shows what a link
        // built on one screen does on another.
        present: (intent, dataset) => ({
            locus: formatLocus(intent.getLocus(dataset, REFERENCE_VIEWPORT)),
        }),
    },
    {
        id: 'config.state — the restore rung',
        // The wire spelling as it arrived, not the decoded State: a fixture
        // whose `state` is a token string and one whose `state` is session JSON
        // take different halves of `decodeState`, and handing the door a
        // pre-decoded object would erase that.
        present: (intent, dataset, browserConfig) => ({state: browserConfig.state}),
    },
    {
        id: 'config.synchState — the sibling rung',
        // **Primed, because the rung is unreachable cold.** The ladder's guard is
        // `config.synchState && browser.canBeSynched(...)`, and `canBeSynched`
        // returns false when `activeDataset` is undefined -- which it is, because
        // the ladder does not set the dataset until *inside* one of its branches.
        // So a first load carrying a `synchState` silently takes the fallback rung
        // instead; only a re-load into a browser that already holds a map can
        // reach it.
        //
        // That is a finding, and #557 changes no behaviour, so it is recorded
        // both ways: the priming load is named in the snapshot, and the `rungs`
        // field of every *unprimed* door shows what a cold load does. Driving
        // this door cold as well would have produced a fifth column identical to
        // the fallback's and said less than this note does.
        prime: true,
        present: (intent, dataset) => ({synchState: syncStateFrom(intent, dataset)}),
    },
    {
        id: 'State.default() — the fallback rung',
        // Nothing presented. The column is the same for every fixture by
        // construction, and it is snapshotted per fixture anyway: "the fallback
        // does not depend on the config" is a claim #510 found to be false in a
        // different way, and a column that is identical everywhere is the cheapest
        // possible statement of it.
        present: () => ({}),
    },
    {
        id: 'loadLiveContactMap — the live door',
        live: true,
        present: (intent, dataset, browserConfig) => ({
            state: browserConfig.state,
            liveContactMap: {chromosomes: dataset.chromosomes, ...LIVE_EXTENT},
        }),
    },
]

/**
 * Which rungs ran, observed rather than inferred.
 *
 * Counted on the prototype, so a call from anywhere reaches it -- including the
 * `syncState` the file door makes on its own behalf after the ladder, and the
 * `parseGotoInput` the live door makes unconditionally after its `setState`.
 * That second one is the whole reason this is a count and not a name.
 */
function rungCounter() {

    const counts = {}

    const count = (target, method, label = method) => {
        const original = target[method]
        vi.spyOn(target, method).mockImplementation(function (...args) {
            counts[label] = (counts[label] || 0) + 1
            return original.apply(this, args)
        })
    }

    beforeEach(() => {
        for (const method of ['parseGotoInput', 'setState', 'syncState']) {
            count(HICBrowser.prototype, method)
        }
        // Not a rung: the back door beside the ladder. `setActiveDataset`'s
        // second parameter is what lets a caller install a state without the
        // chokepoint seeing it, and ADR-0009 decision 1 deletes it. Counting the
        // calls that carry one says, per door, how many states this load
        // installed that way -- which is the number that should reach zero.
        const original = StateManager.prototype.setActiveDataset
        vi.spyOn(StateManager.prototype, 'setActiveDataset').mockImplementation(function (dataset, state) {
            counts['setActiveDataset'] = (counts['setActiveDataset'] || 0) + 1
            if (state) {
                counts['setActiveDataset(state)'] = (counts['setActiveDataset(state)'] || 0) + 1
            }
            return original.call(this, dataset, state)
        })
    })

    return {
        take() {
            const taken = {...counts}
            for (const key of Object.keys(counts)) delete counts[key]
            return taken
        },
    }
}

/**
 * A JSDOM, the two stubs every restore needs, and the rung counter.
 *
 * `withContainers()` is composed rather than re-implemented, the same way
 * `testConfigGolden.js`'s `goldenSuite()` composes it: this file needs the
 * `another()` container factory for the reason that helper exists -- one embed
 * per drive -- and nothing else about the DOM. It does not navigate, because no
 * door here reads `window.location`.
 *
 * `update` is stubbed on both the browser and the view for the reason
 * `stubbedLoads` gives: every route out of a repaint ends at the network or a
 * pixel, and rendering has its own tests. `getViewDimensions` is stubbed per
 * drive rather than here, because its value is the column.
 */
function restoreSuite() {

    const dom = withContainers()

    beforeEach(() => {
        vi.spyOn(ContactMatrixView.prototype, 'update').mockImplementation(async () => undefined)
        vi.spyOn(HICBrowser.prototype, 'update').mockImplementation(async () => undefined)
        // A tripwire, as in #503 and #531: nothing on this path should reach the
        // network. The corpus's own decode happens before the browser is built.
        vi.spyOn(igvxhr, 'loadString').mockImplementation(async () => {
            throw new Error('unexpected network access from the restore golden-file suite')
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    return {dom, rungs: rungCounter()}
}

/**
 * Drive one door, in a browser of its own, at one stated viewport.
 *
 * A container per drive rather than per fixture: `loadHicFile` ends by syncing
 * against every compatible browser in the same registry, so two doors sharing an
 * embed would have the first one's state reach the second's -- which is a real
 * behaviour with a suite of its own, and noise here.
 */
async function drive(door, dom, rungs, browserConfig, intent, viewport) {

    const dataset = restoreDataset(browserConfig)
    const presented = {url: browserConfig.url, ...door.present(intent, dataset, browserConfig)}
    const record = {viewport: {width: viewport.width, height: viewport.height}, presented: renderPresented(presented)}

    const browser = new HICBrowser(dom.another(), browserConfig)
    vi.spyOn(browser.contactMatrixView, 'getViewDimensions').mockReturnValue({
        width: viewport.width,
        height: viewport.height,
    })

    if (door.prime) {
        record.primedWith = 'loadHicFile({url}) — a bare load, so that a dataset is active'
        await browser.loadHicFile({url: browserConfig.url}, true)
    }

    // After the priming load, so the counts below belong to the door and not to
    // the load that made the door reachable.
    rungs.take()

    record.outcome = 'restores'
    try {
        if (door.live) {
            await browser.loadLiveContactMap(presented, true)
        } else {
            await browser.loadHicFile(presented, true)
        }
    } catch (e) {
        record.outcome = 'throws'
        record.error = {name: e?.name, message: e?.message}
    }

    record.rungs = rungs.take()
    record.state = renderState(browser.state, dataset, viewport)

    return record
}

/**
 * The corpus, decoded and normalized once, off its own string literals.
 *
 * The decode is #503's subject and the normalize is #531's; neither is being
 * characterized here. They run because restore's input is what they produce, and
 * driving them from the same literals is what makes a fixture added to #502
 * appear on all three seams without being written down three times.
 */
async function browserConfigsFor(fixture) {

    if (fixture.loaderResponse !== undefined) {
        vi.spyOn(igvxhr, 'loadString').mockImplementation(async () => fixture.loaderResponse)
    }

    const decoded = await extractConfig(fixture.input)
    const session = normalizeSession(decoded)
    return session.browsers || [session]
}

const DECODING_FIXTURES = [...selfContained, ...viaLoader].filter(f => f.outcome === 'decodes')

/**
 * "Every door is covered" has to hold by construction rather than by having been
 * true the day it was written -- the same guard #503 puts over its partitions and
 * #531 over its entry paths. The one failure mode a golden file cannot survive is
 * a case that stops being snapshotted in silence, and for this file that case is
 * the door nobody is touching: #504's live path is in the table precisely because
 * it drifted while nothing watched it.
 */
test('all five restore doors are driven, and exactly one of them is the live path', () => {

    expect(RESTORE_DOORS.map(door => door.id)).toEqual([
        'config.locus — the goto rung',
        'config.state — the restore rung',
        'config.synchState — the sibling rung',
        'State.default() — the fallback rung',
        'loadLiveContactMap — the live door',
    ])

    expect(RESTORE_DOORS.filter(door => door.live).map(door => door.id))
        .toEqual(['loadLiveContactMap — the live door'])

    expect(RESTORE_DOORS.every(door => typeof door.present === 'function')).toBe(true)
})

/**
 * The viewports are the other thing that cannot be allowed to shrink in silence:
 * a golden that quietly dropped to one column would still be green, and would
 * have stopped measuring the only property candidate 6 is asserting.
 */
test('two viewports are stated, and they differ on both axes', () => {

    expect(VIEWPORTS).toHaveLength(2)

    const [square, wide] = VIEWPORTS
    expect(square.width).not.toBe(wide.width)
    expect(square.height).not.toBe(wide.height)
    expect(square.width / square.height).not.toBe(wide.width / wide.height)

    // Stated, never measured. `contactMatrixView.getViewDimensions()` reads
    // `offsetWidth`/`offsetHeight`, which JSDOM answers with 0 -- ADR-0009 fact 5.
    for (const viewport of VIEWPORTS) {
        expect(Number.isFinite(viewport.width) && viewport.width > 0).toBe(true)
        expect(Number.isFinite(viewport.height) && viewport.height > 0).toBe(true)
    }
})

/**
 * The corpus's other half has to be accounted for, not merely absent.
 *
 * `testDecoderGolden.js` guards this with a partition check, and the same
 * failure mode applies here one seam down: a fixture that silently stops being
 * driven leaves a green suite measuring less than it says. This file drives
 * strictly fewer fixtures than that one, so it states which and why rather than
 * letting the `filter` above be the only record.
 *
 * Two exclusions, both structural:
 *
 * - **`throws` and `no-config`** never produce a config, so there is no state
 *   for a restore door to resolve. #503 is where those outcomes are pinned.
 * - **The three `sessionFile` fixtures**, whose `outcome` says `decodes` but
 *   whose arm is not reachable: `extractConfig` rejects with
 *   `uri.indexOf is not a function` before any of them produces a config, which
 *   is exactly what `testDecoderGolden.js`'s "the File arm is not reachable"
 *   suite pins. Their declared outcome was measured by hand rather than
 *   re-measured on every run -- the corpus header says to distrust those three
 *   first -- so this suite trusts the driven measurement over the declaration
 *   and leaves them out.
 */
test('every corpus fixture is either driven or excluded for a stated reason', () => {

    const driven = new Set(DECODING_FIXTURES.map(fixture => fixture.id))
    const excluded = wireFormatCorpus.filter(fixture => !driven.has(fixture.id))

    expect(driven.size + excluded.length).toBe(wireFormatCorpus.length)
    expect(driven.size).toBeGreaterThan(0)

    for (const fixture of excluded) {
        const reason = fixture.format === 'sessionFile' ? 'the File arm is not reachable' : fixture.outcome
        expect(['the File arm is not reachable', 'throws', 'no-config'], fixture.id).toContain(reason)
    }

    // Named, so that a fixture leaving the File arm -- because the arm was fixed
    // -- fails here and gets driven rather than staying excluded by format.
    expect(wireFormatCorpus.filter(f => f.format === 'sessionFile').map(f => f.id)).toEqual([
        'synth-session-file-plain-json',
        'synth-session-file-blob-prefixed',
        'reject-session-file-invalid-json',
    ])
})

describe('resolved state golden file — every restore door, at two stated viewports', () => {

    const {dom, rungs} = restoreSuite()

    for (const fixture of DECODING_FIXTURES) {
        test(fixture.id, async () => {

            const browserConfigs = await browserConfigsFor(fixture)

            const byBrowser = []
            for (const browserConfig of browserConfigs) {

                const intent = decodeState(browserConfig.state)
                const byDoor = {}

                for (const door of RESTORE_DOORS) {
                    const byViewport = {}
                    for (const viewport of VIEWPORTS) {
                        byViewport[viewport.id] = await drive(
                            door, dom, rungs, browserConfig, intent, viewport,
                        )
                    }
                    byDoor[door.id] = byViewport
                }

                byBrowser.push(byDoor)
            }

            expect(byBrowser).toMatchSnapshot()
        })
    }
})
