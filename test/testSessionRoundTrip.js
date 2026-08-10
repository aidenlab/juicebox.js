/**
 * `decode(encode(x)) === x`, as a property, over generated sessions. #507,
 * ADR-0006 decision 4.
 *
 * This is the test the whole candidate exists to make possible, and two earlier
 * tickets were prerequisites *because of it*:
 *
 * - **#500** — `browser.toJSON()` used to return the string `"{}"` for a browser
 *   with no map, so there was no well-typed encoder output to invert. The
 *   empty-browser case is **covered here** rather than skipped; skipping it is
 *   precisely how that bug survived as long as it did.
 * - **Axis ordering** (ADR-0006 decision 3) — a saved view now has exactly one
 *   spelling. Without it the property fails on day one for any view whose
 *   y-axis chromosome index is below its x-axis's, and "equal after
 *   normalisation" was explicitly rejected as a way to make it pass, because
 *   that defines the test to pass by weakening it. The generator asks for views
 *   on **both** sides of the diagonal and asserts that both survive; the one
 *   spelling that does not survive is pinned separately, below.
 *
 * The generator emits the shape `registry.toJSON()` writes — field for field,
 * with `js/hicBrowser.js` `toJSON` as the reference — because the property is
 * about the format juicebox actually emits and nothing else. A generator free to
 * invent fields would be testing a format no session is ever in.
 *
 * No network and no DOM: the loader passed to `decodeSession` throws, and the
 * one place a `BrowserRegistry` appears — the count asymmetry — constructs it
 * without a container and registers stand-ins, so nothing renders and nothing is
 * selected. What a registry does with a real empty `HICBrowser` is
 * `test/testRegistrySession.js`'s (#500).
 *
 * @see js/sessionCodec.js
 * @see docs/adr/0006-session-wire-format-and-one-decoder.md
 */
import {describe, expect, test} from 'vitest'
import {BGZip} from 'igv-utils'
// The namespace import is for one assertion only -- "the codec exports exactly
// one encoder", which is a claim about the module's *surface* and so cannot be
// written with named imports.
import * as codec from '../js/sessionCodec.js'
// The default annotation colour comes from the *normalize* stage since #533,
// which is where the pass that reads it went; the codec no longer knows it.
import {DEFAULT_ANNOTATION_COLOR} from '../js/normalizeSession.js'
import {
    SESSION_VERSION,
    SessionEncodeError,
    decodeSession,
    encodeSession,
    encodeSessionString,
} from '../js/sessionCodec.js'
import BrowserRegistry from '../js/browserRegistry.js'
import State from '../js/hicState.js'

/**
 * A loader that fails the test rather than the fetch. The session-JSON form
 * carries its whole payload in the parameter, so a round trip that reaches for
 * the wire has stopped being a round trip.
 */
const noIO = {
    loadString: async url => {
        throw new Error(`unexpected load of ${url}`)
    },
}

// ---------------------------------------------------------------------------
// The generator
//
// Deterministic and dependency-free. A seeded PRNG rather than a property-test
// library because the whole value here is a space of *sessions*, which no
// library knows how to build for us, and a failing run has to be reproducible
// from the seed printed in the assertion.
// ---------------------------------------------------------------------------

/** mulberry32 — small, seeded, and good enough to walk a space of sessions. */
function mulberry32(seed) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * The chromosome indices a state can name. Index 0 is the whole genome, so it
 * is in the pool deliberately: `(0, 0)` is the view every session opens on.
 */
const CHROMOSOMES = [0, 1, 2, 5, 17, 23]

const NORMALIZATIONS = ['NONE', 'VC', 'VC_SQRT', 'KR', 'SCALE']

const DISPLAY_MODES = ['A', 'B', 'AOB', 'BOA']

function generator(seed) {

    const rnd = mulberry32(seed)
    const pick = choices => choices[Math.floor(rnd() * choices.length)]
    const chance = p => rnd() < p
    const int = n => Math.floor(rnd() * n)

    /**
     * A state as a *saved* session carries it: whatever order the pair is asked
     * for, it goes through `State`, which owns the axis-ordering invariant, and
     * out through `State.toJSON()`. Both sides of the diagonal are asked for —
     * which is the point — and both produce the one canonical spelling.
     */
    function state() {
        const a = pick(CHROMOSOMES)
        const b = pick(CHROMOSOMES)
        // Deliberately unordered half the time. `new State` transposes chr/x/y
        // together, exactly as `setView` does for a live view.
        const [chr1, chr2] = chance(0.5) ? [a, b] : [b, a]
        return new State(
            chr1,
            chr2,
            int(10),
            rnd() * 10000,
            rnd() * 10000,
            1 + rnd() * 20,
            pick(NORMALIZATIONS),
        ).toJSON()
    }

    /** A track as `HICBrowser.toJSON` writes one: no `displayMode`, ever. */
    function track() {
        const t = {url: `https://example.org/track-${int(1000)}.bed`}
        if (chance(0.5)) t.type = pick(['annotation', 'wig', 'interaction'])
        if (chance(0.5)) t.format = pick(['bed', 'bigwig', 'bedpe'])
        if (chance(0.7)) t.name = `track ${int(100)}`
        // Always numbers: `HICBrowser.toJSON` writes a range only from a
        // `track.dataRange`, so the `NaN` bounds the normalize stage sweeps
        // cannot arise from a written session. They arise from an empty field in
        // a v0 `tracks=` string, which is #515's, not this property's.
        if (chance(0.4)) {
            t.min = -rnd() * 10
            t.max = rnd() * 100
        }
        // `DEFAULT_ANNOTATION_COLOR` is in the pool deliberately: the *normalize*
        // stage drops it, and it was the decoder that dropped it until #533. A
        // generator that steered around the colour would be routing around the
        // very thing that made this property inexact — and it is the input that
        // proves the codec no longer touches it.
        if (chance(0.2)) {
            t.color = DEFAULT_ANNOTATION_COLOR
        } else if (chance(0.5)) {
            t.color = `rgb(${int(255)},${int(255)},${int(255)})`
        }
        return t
    }

    function browser({tracks}) {
        const config = {
            backgroundColor: `rgb(${int(255)},${int(255)},${int(255)})`,
            url: `https://example.org/map-${int(1000)}.hic`,
            state: state(),
            colorScale: `${pick(['', '-', '+'])}${int(100)},${int(255)},${int(255)},${int(255)}`,
        }
        if (chance(0.7)) config.name = `map ${int(100)}`
        if (chance(0.3)) config.nvi = `${int(1e9)},${int(1e5)}`
        if (chance(0.3)) {
            config.controlUrl = `https://example.org/control-${int(1000)}.hic`
            if (chance(0.7)) config.controlName = `control ${int(100)}`
            if (chance(0.7)) config.displayMode = pick(DISPLAY_MODES)
            if (chance(0.5)) config.controlNvi = `${int(1e9)},${int(1e5)}`
            if (chance(0.5)) config.cycle = true
        }
        if (tracks && chance(0.5)) {
            config.tracks = Array.from({length: 1 + int(3)}, track)
        }
        return config
    }

    /**
     * `selectedGene` is written at both levels or at neither — the registry
     * writes the top-level copy and every browser writes its own from the same
     * field — so the generator does not vary them independently. A session
     * carrying the gene on a browser but not at the top level is a shape
     * juicebox never writes, and the decoder reconciles it (#481); that is
     * `testSessionDecode.js`'s.
     */
    return function session({tracks = true, browsers: howMany} = {}) {
        const count = undefined === howMany ? int(4) : howMany
        const config = {
            browsers: Array.from({length: count}, () => browser({tracks})),
        }
        if (count > 0 && chance(0.3)) {
            const selectedGene = pick(['ACE', 'EGFR', 'MYC'])
            config.selectedGene = selectedGene
            for (const b of config.browsers) {
                b.selectedGene = selectedGene
            }
        }
        if (chance(0.2)) config.caption = `figure ${int(100)}`
        return config
    }
}

// ---------------------------------------------------------------------------
// The encoder
// ---------------------------------------------------------------------------

describe('encodeSession', () => {

    const session = {browsers: [{url: 'https://example.org/a.hic', name: 'a'}]}

    test('writes the share-link form juicebox-web appends to its base URL', () => {
        const encoded = encodeSession(session)

        expect(encoded.startsWith('session=blob:')).toBe(true)
        expect(BGZip.uncompressString(encoded.substring('session=blob:'.length)))
            .toBe(JSON.stringify({...session, version: SESSION_VERSION}))
    })

    /**
     * The write half of the version stamp (#508, ADR-0006 decision 7);
     * `testSessionDecode.js` owns the read half, and `SESSION_VERSION`'s own doc
     * comment owns why the field exists at all.
     *
     * It does not appear in the property below because the decoder takes it back
     * off, which is what keeps that property a strict identity rather than
     * "equal apart from one field" — the same weakening ADR-0006 rejected for
     * axis ordering.
     */
    describe('the version stamp', () => {

        const written = encoded => JSON.parse(BGZip.uncompressString(encoded.substring('session=blob:'.length)))

        test('every session juicebox writes carries the version', () => {
            expect(written(encodeSession(session))).toEqual({...session, version: SESSION_VERSION})
        })

        test('over one the caller handed it — what juicebox writes is what juicebox writes', () => {
            expect(written(encodeSession({...session, version: 0})).version).toBe(SESSION_VERSION)
        })

        test('and the caller\'s own document is not touched', () => {
            const document = {browsers: []}
            encodeSession(document)

            expect(Object.hasOwn(document, 'version')).toBe(false)
        })

        /**
         * The stamp sits at the parameter layer, beside the adapter that reads
         * it, so that the two string-level functions stay exact inverses of each
         * other with no opinion about what is in the document. A host reaching
         * for `encodeSessionString` gets a compressor, not a writer of the
         * format.
         */
        test('the string encoder stamps nothing — the two layers do not overlap', () => {
            const string = encodeSessionString(session)

            expect(JSON.parse(BGZip.uncompressString(string.substring('blob:'.length)))).toEqual(session)
        })
    })

    /**
     * The encoded parameter goes into a URL, and `extractQuery` splits a query
     * string on `&` and takes the value up to the *second* `=`. A base64
     * alphabet with padding or a `+` would therefore be silently truncated on
     * the way back in. `BGZip` writes the URL-safe alphabet unpadded, and this
     * is the assertion that says the round trip depends on it.
     */
    test('the payload carries nothing a query string would eat', () => {
        const generate = generator(11)
        for (let i = 0; i < 50; i++) {
            const encoded = encodeSession(generate())
            expect(encoded.split('=')).toHaveLength(2)
            expect(encoded).not.toContain('&')
            expect(encoded).not.toContain('#')
        }
    })

    /**
     * The parameter is the string with a name in front — and, since #508, the
     * version stamp: the string encoder compresses a document, and the parameter
     * encoder is the one that writes the format.
     */
    test('a session string is the payload without the parameter name', () => {
        expect(encodeSession(session))
            .toBe(`session=${encodeSessionString({...session, version: SESSION_VERSION})}`)
    })

    /**
     * The sniff reads three spellings; the encoder writes one. `data:` is an
     * inbound spelling juicebox has never produced, and a bare-JSON *parameter*
     * would carry braces and quotes straight into a query string — so neither
     * gets an encoder, and there is no `format` argument for a caller to reach
     * one with. Reading all three back is `testSessionCodec.js`'s.
     */
    test('takes no format argument, so there is one spelling to own', () => {
        expect(encodeSessionString.length).toBe(1)
        expect(encodeSession.length).toBe(1)
        expect(encodeSessionString(session, 'data-uri').startsWith('blob:')).toBe(true)
    })

    test('a document JSON cannot express is refused, with the failure kept', () => {
        const circular = {browsers: []}
        circular.self = circular

        expect(() => encodeSessionString(circular)).toThrow(SessionEncodeError)
        try {
            encodeSessionString(circular)
            expect.unreachable('a circular session must not encode')
        } catch (e) {
            expect(e.cause).toBeInstanceOf(TypeError)
        }
    })

    /**
     * A `State` instance reaches the encoder from any host that hands one
     * straight to `restoreSession`'s inverse; `JSON.stringify` runs its
     * `toJSON`, so it encodes to the same seven fields a saved session carries.
     */
    test('a State instance encodes as the object State.toJSON writes', () => {
        const state = new State(2, 5, 3, 10, 20, 4, 'KR')

        expect(encodeSessionString({browsers: [{url: 'a.hic', state}]}))
            .toBe(encodeSessionString({browsers: [{url: 'a.hic', state: state.toJSON()}]}))
    })
})

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

/**
 * One iteration of the property. Returns the decoded session so a caller can
 * make further claims about it.
 */
async function roundTrip(session) {
    return await decodeSession(encodeSession(session), noIO)
}

/** How many sessions each property walks. */
const SESSIONS = 200

/**
 * Walk the generated space, round-tripping each session. `assert` is handed the
 * session as written, the session as it came back, and a label carrying the seed
 * and the offending document — a property whose failure you cannot reproduce is
 * not much of a property.
 */
async function forEachGeneratedSession(seed, options, assert) {
    const generate = generator(seed)
    for (let i = 0; i < SESSIONS; i++) {
        const session = generate(options)
        await assert(session, await roundTrip(session), `seed ${seed}, session ${i}: ${JSON.stringify(session)}`)
    }
}

describe('decode(encode(session)) is the identity', () => {

    /**
     * The property. Every session is drawn from the space `registry.toJSON()`
     * writes, and the assertion is strict equality — not equality after any
     * normalising step, which ADR-0006 rejected as defining the test to pass.
     *
     * Tracks used to be held out of this loop by one line, because the decoder's
     * `fixDefaults` made two changes to every track it read. #533 moved that
     * pass to `js/normalizeSession.js`, one stage downstream, so the property is
     * now strict over tracks too and the two loops below differ only in their
     * seed and in whether the generator emits tracks at all.
     */
    test('over 200 generated sessions, tracks aside', async () => {
        await forEachGeneratedSession(20260810, {tracks: false}, (session, decoded, label) => {
            expect(decoded, label).toEqual(session)
        })
    })

    /**
     * The same property over track-bearing sessions, and it is the *same*
     * assertion now: no per-track exception, nothing deleted before comparing.
     * That strictness is the observable result of #533 — a track goes into the
     * wire format and comes back spelled as it was written, colour and all.
     */
    test('over 200 generated sessions with tracks, exactly as written', async () => {
        await forEachGeneratedSession(777, {tracks: true}, (session, decoded, label) => {
            expect(decoded, label).toEqual(session)
        })
    })

    /**
     * The other half of the identity, and the half axis ordering was a
     * prerequisite for: a session's `state` is handed to `State.fromJSON` on
     * restore, and the view that comes out has to be the view that was saved.
     * The generator asks for pairs in both orders, so this covers both sides of
     * the diagonal.
     *
     * The codec itself passes a `state` through verbatim — it is one more object
     * in the document — so this leg, not the `toEqual` above, is where the
     * invariant is load-bearing. Without it the pair asked for as `(chr5, chr2)`
     * comes back spelled the other way; "the spelling axis ordering retired",
     * below, is that failure, pinned.
     */
    test('the view survives being rebuilt as a State', async () => {
        await forEachGeneratedSession(4242, {tracks: false}, (session, decoded, label) => {
            for (const [i, browser] of decoded.browsers.entries()) {
                expect(State.fromJSON(browser.state).toJSON(), `${label} (browser ${i})`)
                    .toEqual(session.browsers[i].state)
            }
        })
    })

    /**
     * The empty-browser case, covered rather than skipped. An embed whose only
     * panel has no map serializes to `{browsers: []}` — a well-typed session
     * with nothing in it, which is what #500 bought — and that survives the
     * round trip like any other. Until #500 it was the string `"{}"`, which the
     * encoder had no way to invert.
     */
    test('a session with no browsers at all', async () => {
        expect(await roundTrip({browsers: []})).toEqual({browsers: []})
    })

    test('an empty browser list still carries the rest of the session', async () => {
        const session = {browsers: [], selectedGene: 'ACE', caption: 'figure 1'}

        expect(await roundTrip(session)).toEqual(session)
    })
})

/**
 * A property over generated data is only as good as the space it walks, and a
 * generator that quietly stopped producing off-diagonal views would leave the
 * suite green and prove nothing. These assertions are about the *generator*.
 */
describe('the generated space', () => {

    const states = () => {
        const generate = generator(20260810)
        return Array.from({length: 200}, () => generate({tracks: false}))
            .flatMap(session => session.browsers.map(browser => browser.state))
    }

    test('holds views on the diagonal and off it', () => {
        const all = states()

        expect(all.filter(s => s.chr1 === s.chr2).length).toBeGreaterThan(10)
        expect(all.filter(s => s.chr1 !== s.chr2).length).toBeGreaterThan(10)
    })

    test('holds the whole-genome view, which is index 0 on both axes', () => {
        expect(states().some(s => 0 === s.chr1 && 0 === s.chr2)).toBe(true)
    })

    /**
     * Every generated state is canonical, because every one went through
     * `State` — including the half of them asked for in the reversed order. This
     * is the invariant ADR-0006 decision 3 bought, seen from the generator's
     * side: asking for `(chr5, chr2)` and asking for `(chr2, chr5)` produce the
     * same saved spelling, so there is exactly one spelling to round-trip.
     */
    test('every generated view is axis-ordered, whichever order it was asked for', () => {
        for (const state of states()) {
            expect(state.chr1, JSON.stringify(state)).toBeLessThanOrEqual(state.chr2)
        }
    })

    test('a session with browsers, and a session with none, are both generated', () => {
        const generate = generator(20260810)
        const counts = Array.from({length: 200}, () => generate({tracks: false}).browsers.length)

        expect(counts.some(n => 0 === n)).toBe(true)
        expect(counts.some(n => n > 1)).toBe(true)
    })

    /**
     * The deviation the track property's `else` arm exists for. A generator that
     * never emitted the default colour would leave that arm unexercised and the
     * drop unpinned.
     */
    test('holds tracks carrying the default annotation colour, and tracks carrying another', () => {
        const generate = generator(777)
        const tracks = Array.from({length: SESSIONS}, () => generate({tracks: true}))
            .flatMap(session => session.browsers)
            .flatMap(browser => browser.tracks || [])

        expect(tracks.filter(t => DEFAULT_ANNOTATION_COLOR === t.color).length).toBeGreaterThan(0)
        expect(tracks.filter(t => t.color && DEFAULT_ANNOTATION_COLOR !== t.color).length).toBeGreaterThan(0)
    })

    test('tracks are generated when they are asked for, and not when they are not', () => {
        const withTracks = generator(99)
        const without = generator(99)
        const hasTracks = session => session.browsers.some(b => undefined !== b.tracks)

        expect(Array.from({length: 50}, () => withTracks()).some(hasTracks)).toBe(true)
        expect(Array.from({length: 50}, () => without({tracks: false})).some(hasTracks)).toBe(false)
    })
})

/**
 * The spelling that does **not** survive, pinned here so the property above is
 * read as a claim about canonical sessions rather than about every object with a
 * `state` in it.
 *
 * A session carrying `chr1 > chr2` names the same triangle as its transpose — a
 * `.hic` file stores one triangle of a symmetric matrix — so `State` transposes
 * `chr1`/`chr2` together with `x`/`y` and the view that comes back out is spelled
 * the other way. The *view* is the identity; the *spelling* is not, which is
 * exactly why axis ordering had to become an invariant before this property
 * could be written. ADR-0006 decision 3.
 *
 * Non-breaking for the archive: a session in the wild carrying the unordered
 * spelling decodes exactly as it always has, to the transposed view.
 */
describe('the spelling axis ordering retired', () => {

    const unordered = {chr1: 5, chr2: 2, zoom: 3, x: 100, y: 200, pixelSize: 4, normalization: 'KR'}

    test('the session document itself survives verbatim — the codec transposes nothing', async () => {
        const session = {browsers: [{url: 'https://example.org/a.hic', state: unordered}]}

        expect((await roundTrip(session)).browsers[0].state).toEqual(unordered)
    })

    test('rebuilding it as a State transposes the axes, so the spelling does not round-trip', () => {
        expect(State.fromJSON(unordered).toJSON()).toEqual({
            chr1: 2, chr2: 5, zoom: 3, x: 200, y: 100, pixelSize: 4, normalization: 'KR',
        })
    })

    test('and juicebox cannot write it: the canonical spelling is a fixed point', () => {
        const canonical = State.fromJSON(unordered).toJSON()

        expect(State.fromJSON(canonical).toJSON()).toEqual(canonical)
    })
})

// ---------------------------------------------------------------------------
// Where it is not the identity
// ---------------------------------------------------------------------------

/**
 * One deviation, asserted as behaviour rather than allowed to fail, and it is
 * named in ADR-0006; it is not a licence to normalise the property above.
 *
 * There were two until #533 moved the decoder's track defaults to the normalize
 * stage. The block that recorded the second is still here, saying the opposite
 * of what it used to.
 */
describe('the accepted asymmetries', () => {

    /**
     * ADR-0006 decision 6. A browser with no dataset serializes to `null` and
     * the registry drops it, so an embed saved with an empty panel open restores
     * one panel short.
     *
     * The asymmetry is asserted end to end — two panels in, one browser out,
     * round-tripped — because a test that hands the encoder a one-browser
     * session and finds one browser has asserted nothing. That means a real
     * `BrowserRegistry`, which needs no document as long as nothing selects a
     * browser: `register` pushes, and `toJSON` reads only `toJSON`. The two
     * stand-ins are what a loaded panel and an empty one serialize to, per #500,
     * and `testRegistrySession.js` is where *that* is pinned against the real
     * `HICBrowser`.
     */
    test('browser count does not survive when a browser was empty', async () => {
        const loaded = {url: 'https://example.org/a.hic', state: State.default().toJSON()}
        const registry = new BrowserRegistry()
        registry.register({toJSON: () => loaded})
        registry.register({toJSON: () => null})     // a panel with no map

        const written = registry.toJSON()
        const decoded = await roundTrip(written)

        expect(registry.browsers).toHaveLength(2)
        expect(written.browsers).toEqual([loaded])
        expect(decoded).toEqual(written)
    })

    /**
     * And the count is gone for good — nothing in the decoded session records
     * that a panel was dropped, which is what makes this an accepted asymmetry
     * rather than a recoverable one. Restore rebuilds what the session names.
     */
    test('and nothing in the session says a panel was dropped', async () => {
        const registry = new BrowserRegistry()
        registry.register({toJSON: () => null})
        registry.register({toJSON: () => null})

        expect(await roundTrip(registry.toJSON())).toEqual({browsers: []})
    })

    /**
     * The asymmetry that used to be here, in literal form, and now says the
     * opposite.
     *
     * `fixDefaults` ran at the end of every decode and made two changes to every
     * track it read: it forced `displayMode` to `COLLAPSED`, a field the written
     * form never has, and it dropped the default annotation colour. That is
     * normalization sitting inside the decoder — ADR-0006 decision 8, filed as
     * #525 — and it meant a session restored from a URL and the same session
     * handed to `restoreSession` disagreed.
     *
     * #533 moved the pass to `js/normalizeSession.js`, which every entry path
     * reaches. The codec is a codec again, and these four tests are kept
     * inverted rather than deleted: the claim "the wire format does not default"
     * is worth a reader finding in one screen, and it is exactly the claim that
     * was false before.
     *
     * That the defaults are still *applied*, one stage on, is
     * `test/testNormalizeSession.js`'s to say.
     */
    describe('the codec normalises nothing on the way in', () => {

        const withTrack = track => ({browsers: [{url: 'https://example.org/a.hic', tracks: [track]}]})

        test('no display mode is invented for a track that saved none', async () => {
            const session = withTrack({url: 'https://example.org/a.bed', name: 'a'})

            const [track] = (await roundTrip(session)).browsers[0].tracks
            expect(Object.hasOwn(track, 'displayMode')).toBe(false)
        })

        test('and one that saved a display mode keeps the one it saved', async () => {
            const session = withTrack({url: 'https://example.org/a.bed', displayMode: 'EXPANDED'})

            expect((await roundTrip(session)).browsers[0].tracks[0].displayMode).toBe('EXPANDED')
        })

        test('the default annotation colour survives the round trip', async () => {
            const session = withTrack({url: 'https://example.org/a.bed', color: DEFAULT_ANNOTATION_COLOR})

            expect((await roundTrip(session)).browsers[0].tracks[0].color).toBe(DEFAULT_ANNOTATION_COLOR)
        })

        test('as does any other colour', async () => {
            const session = withTrack({url: 'https://example.org/a.bed', color: 'rgb(1,2,3)'})

            expect((await roundTrip(session)).browsers[0].tracks[0].color).toBe('rgb(1,2,3)')
        })
    })
})

// ---------------------------------------------------------------------------
// One encoder, not four
// ---------------------------------------------------------------------------

/**
 * ADR-0006 decision 4. The other three accepted formats stay decode-only:
 * writing encoders for them would resurrect live encoders for formats nothing
 * has written in years, and we would then own them forever.
 *
 * Asserted rather than trusted to the review, because the failure mode is
 * someone adding `encodeJuicebox` for a plausible-sounding reason and no test
 * minding.
 */
describe('the legacy formats stay decode-only', () => {

    test('the codec exports exactly one encoder, and it is the session form', () => {
        const encoders = Object.keys(codec).filter(name => name.startsWith('encode'))

        expect(encoders.sort()).toEqual(['encodeSession', 'encodeSessionString'])
    })

    test('no wire-format adapter carries an encode half', () => {
        for (const adapter of codec.WIRE_FORMATS) {
            expect(adapter.encode, adapter.format).toBeUndefined()
        }
    })
})
