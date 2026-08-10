/**
 * The golden-file characterization test for the session decoder. #503.
 *
 * Every fixture in `test/data/wireFormatCorpus.js` is run through the decoder as
 * it exists today and the result is snapshotted verbatim into
 * `test/__snapshots__/testDecoderGolden.js.snap`. ADR-0006, "How we know the
 * decoder did not change": the refactor that collapses eight encodings and seven
 * decoders behind `decodeSession` passes when — and only when — these snapshots
 * come back byte-identical.
 *
 * **Nothing in the decoder moves until this file is green.** That is the whole
 * job of the ticket. Hand-written per-fixture assertions were considered and
 * rejected: they re-encode one reader's understanding of the code, and would
 * bless a misreading as spec. A snapshot is indifferent to whether anyone
 * understood it — which matters here, because this decoder has already drifted
 * from its own documentation in three places.
 *
 * Two consequences to keep in view:
 *
 * 1. **The snapshots capture bugs as well as behaviour, deliberately.** The
 *    brace-repair mangling at `urlUtils.js:417`, the `NaN` origins of a
 *    truncated state string, the bare `TypeError` a corrupt share link throws —
 *    all of it is pinned. Pinning a bug is not blessing it; it is refusing to
 *    let a refactor change it by accident.
 * 2. **Rejections are contract.** An input the decoder refuses, and *how* it
 *    refuses, is snapshotted alongside the ones it accepts. `capture()` below
 *    returns a throw as data for exactly this reason.
 *
 * ## Updating a snapshot — the convention
 *
 * A snapshot never gets re-baselined silently. `vitest -u` across the suite is
 * how a deliberate change and an accidental one become indistinguishable, and
 * this file exists to keep them distinguishable.
 *
 * When a change to the decoder legitimately moves output:
 *
 * 1. Read the snapshot diff first, fixture by fixture. Every moved fixture must
 *    be one you can explain. A fixture you did not expect to move is a bug
 *    report, not a snapshot to accept.
 * 2. Update only the affected snapshots — `vitest -u -t '<fixture id>'`, not a
 *    bare `-u` over the file.
 * 3. Add a line to the log below saying which decision authorised it. The log,
 *    not the git history, is where the next person looks: a `.snap` diff is
 *    unreadable without it.
 *
 * ### Authorised snapshot movements
 *
 * | Date | Fixtures | Authorised by |
 * |------|----------|---------------|
 * | 2026-08-09 | all — baseline taken | #503, after #499 (axis ordering) and #500 (empty browsers), both of which move decoded output and so had to land first |
 * | 2026-08-09 | `harvested-juiceboxURL-bitly` — `decodes` became `throws` | **#506**, ADR-0006 decision 1: the named exception to the frozen contract. The bit.ly expansion and its embedded credential are gone, so the fixture that decoded a two-browser session through a live third-party endpoint now records the refusal that replaced it. **This is the first deliberate deviation from the baseline** — the whole point of the log is that it is written down rather than absorbed by a bare `-u`. No other fixture moved, which is the other half of the claim. |
 *
 * @see docs/adr/0006-session-wire-format-and-one-decoder.md
 * @see test/data/wireFormatCorpus.js — the inputs
 * @see test/testWireFormatCorpus.js — guards the corpus, not the decoder
 */
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {igvxhr} from 'igv-utils'
import {extractConfig} from '../js/urlUtils.js'
import State from '../js/hicState.js'
import {
    selfContained,
    stateStringCorpus,
    viaFile,
    viaLoader,
    wireFormatCorpus,
} from './data/wireFormatCorpus.js'

/**
 * Describe a rejection well enough that its snapshot means something.
 *
 * Not everything the decoder throws is an `Error`: the `blob:`/`data:` arm has
 * no try/catch of its own, so a corrupt share link rejects with whatever the
 * decompressor threw, `name` and `message` both undefined. `{name, message}`
 * alone would snapshot that as two blanks and pin nothing at all, so the raw
 * value is stringified alongside for those.
 */
function describeThrow(e) {
    const described = {name: e?.name, message: e?.message}
    if (described.name === undefined && described.message === undefined) {
        described.thrown = `${typeof e}: ${String(e)}`
    }
    return described
}

/**
 * Run one input through the decoder and return the result *as data* — a decoded
 * config, the absence of one, or the rejection — so that all three snapshot the
 * same way. `outcome` mirrors the corpus's own vocabulary so the snapshot and
 * the fixture can be compared without reading either closely.
 */
async function capture(input) {
    try {
        const config = await extractConfig(input)
        return config === undefined
            ? {outcome: 'no-config'}
            : {outcome: 'decodes', config}
    } catch (e) {
        return {outcome: 'throws', error: describeThrow(e)}
    }
}

/**
 * Snapshot class instances as their own properties under their class name.
 *
 * Without this the default serializer calls `toJSON()` where one exists, which
 * would show `State` as its seven-field wire projection and hide both the class
 * identity and any field the projection drops. Both matter here: a `state` that
 * arrives as a `State` from `decodeQuery` and one that arrives as a plain object
 * from `JSON.parse` are different values, and the collapse could silently turn
 * one into the other.
 */
expect.addSnapshotSerializer({
    test: v => v !== null && typeof v === 'object' && typeof v.toJSON === 'function',
    serialize: (v, config, indentation, depth, refs, printer) =>
        `${v.constructor.name} ${printer({...v}, config, indentation, depth, refs)}`,
})

/**
 * "Every fixture in the corpus has a committed snapshot" has to hold by
 * construction, not by having been true the day it was written. The three suites
 * below run the three partitions the corpus exports; a fixture belonging to none
 * of them would otherwise be skipped in silence, which is the one failure mode a
 * golden file cannot survive.
 */
test('every fixture falls into exactly one of the three suites', () => {
    const partitioned = [...selfContained, ...viaLoader, ...viaFile]
    expect(partitioned.length, 'a fixture in two partitions is snapshotted twice')
        .toBe(wireFormatCorpus.length)
    expect(new Set(partitioned.map(f => f.id)).size, 'a fixture in none is never snapshotted')
        .toBe(wireFormatCorpus.length)
})

/**
 * "Runs without network, DOM or file I/O" is enforced here rather than asserted
 * in a comment: `igvxhr.loadString` and `fetch` are both replaced with a throw,
 * so a fixture that reaches either fails loudly instead of quietly going to the
 * wire. One suite — the session URLs — re-stubs `loadString` with a canned
 * answer. Nothing re-stubs `fetch` any more: the bit.ly expansion was the only
 * caller and #506 removed it, so the stub is now purely a tripwire.
 *
 * `console.error` is silenced because the decoder logs every rejection before
 * rethrowing it — behaviour worth keeping, noise worth not printing forty times
 * a run. The message itself comes off the thrown error, so nothing is lost.
 */
beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {
    })
    vi.spyOn(igvxhr, 'loadString').mockImplementation(async () => {
        throw new Error('unexpected network access from the golden-file suite')
    })
    vi.stubGlobal('fetch', async () => {
        throw new Error('unexpected network access from the golden-file suite')
    })
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('decoder golden file — inputs the decoder takes as a string', () => {

    for (const fixture of selfContained) {
        test(fixture.id, async () => {
            const captured = await capture(fixture.input)
            expect(captured.outcome, fixture.id).toBe(fixture.outcome)
            expect(captured).toMatchSnapshot()
        })
    }
})

describe('decoder golden file — session URLs, driven from their loader response', () => {

    for (const fixture of viaLoader) {
        test(fixture.id, async () => {
            vi.spyOn(igvxhr, 'loadString').mockImplementation(async () => {
                if (fixture.loaderResponse === null) throw new Error('simulated fetch failure')
                return fixture.loaderResponse
            })

            const captured = await capture(fixture.input)
            expect(captured.outcome, fixture.id).toBe(fixture.outcome)
            expect(captured).toMatchSnapshot()
        })
    }
})

/**
 * The `isFile` arm of `extractConfig` (`urlUtils.js:90-104`).
 *
 * What is snapshotted here is **the arm's unreachability**, which is the real
 * behaviour and not a stand-in for it. `extractConfig` parses its argument with
 * `extractQuery`, which calls `indexOf` on it and can only ever produce string
 * values; the sole caller (`init.js:50`) hands it `window.location.href`. There
 * is no input — File or otherwise — that reaches line 92. Handing the decoder
 * the query object the arm was written for does not enter the arm, it throws out
 * of the parser one line earlier, and that throw is what the snapshot records.
 *
 * The three `sessionFile` fixtures still get a snapshot each, so that "every
 * fixture in the corpus has one" stays literally true and so that this arm
 * becoming reachable — which the ADR-0006 collapse could easily do by accident —
 * shows up as a snapshot movement rather than as silence.
 *
 * **These three are the one place the suite does not assert `fixture.outcome`,
 * and the divergence is deliberate.** The corpus records what the *arm* would do
 * with `fileText` — two `decodes` and one `throws`, measured by reading the code
 * because nothing can run it. What is measured here is what the *decoder* does,
 * which is to reject at the parser without ever looking at the file. Asserting
 * the parser's message rather than the coarse outcome is what keeps the two
 * claims apart: the day that assertion fails, the arm has become reachable and
 * the corpus's declared outcome is the thing to check against instead.
 */
describe('decoder golden file — the File arm is not reachable', () => {

    for (const fixture of viaFile) {
        test(fixture.id, async () => {
            // The mock File (test/utils/File.js) takes a Buffer, not the array
            // of parts the DOM constructor wants. Deliberate — `.text()` reads
            // `buffer.toString()`.
            const file = new File(Buffer.from(fixture.fileText), 'session.json')

            const captured = await capture({session: file})

            expect(captured.error.message, 'the File arm became reachable — see the note above')
                .toBe('uri.indexOf is not a function')
            expect(captured).toMatchSnapshot()
        })
    }
})

/**
 * `State.parse` on its own. The state string is a wire format in its own right —
 * the one piece of the query form that also appears inside session JSON, and the
 * one with two live versions — so it is pinned directly as well as through the
 * decoder.
 *
 * The instance, not `toJSON()`: the serializer above prints its own properties,
 * which is a superset of the wire projection and so pins the fields `toJSON`
 * drops as well as the ones it keeps.
 */
describe('decoder golden file — state strings', () => {

    for (const fixture of stateStringCorpus) {
        test(fixture.id, () => {
            expect(State.parse(fixture.input)).toMatchSnapshot()
        })
    }
})
