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
 * No network and no DOM: the loader passed to `decodeSession` throws, and
 * nothing here constructs a browser. What a *registry* does with an empty
 * browser is `test/testRegistrySession.js`'s (#500); what the codec does with
 * the session that comes out of one is here.
 *
 * @see js/sessionCodec.js
 * @see docs/adr/0006-session-wire-format-and-one-decoder.md
 */
import {describe, expect, test} from 'vitest'
import {BGZip} from 'igv-utils'
import * as codec from '../js/sessionCodec.js'
import {
    SessionEncodeError,
    SessionFormat,
    decodeSession,
    decodeSessionString,
    encodeSession,
    encodeSessionString,
} from '../js/sessionCodec.js'
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
        if (chance(0.4)) {
            t.min = -rnd() * 10
            t.max = rnd() * 100
        }
        // Never `DEFAULT_ANNOTATION_COLOR`: that one is dropped on decode, and
        // is pinned in "the accepted asymmetries" below rather than here.
        if (chance(0.5)) t.color = `rgb(${int(255)},${int(255)},${int(255)})`
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
            .toBe(JSON.stringify(session))
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

    test('a session string is the payload without the parameter name', () => {
        expect(encodeSession(session)).toBe(`session=${encodeSessionString(session)}`)
    })

    /**
     * All three spellings the sniff tells apart, because the property below is
     * over a *format* and a spelling with no encoder would be the one corner
     * nothing exercises. Only `blob:` is ever written — see `encodeSession`.
     */
    test.each([
        [SessionFormat.BLOB, 'blob:'],
        [SessionFormat.DATA_URI, 'data:'],
    ])('%s is written with its prefix', (format, prefix) => {
        const encoded = encodeSessionString(session, format)

        expect(encoded.startsWith(prefix)).toBe(true)
        expect(decodeSessionString(encoded)).toEqual(session)
    })

    test('the JSON spelling is the document itself, uncompressed', () => {
        expect(encodeSessionString(session, SessionFormat.JSON)).toBe(JSON.stringify(session))
    })

    test('a spelling the sniff cannot read back is refused rather than written', () => {
        expect(() => encodeSessionString(session, 'base85')).toThrow(SessionEncodeError)
        expect(() => encodeSessionString(session, 'base85')).toThrow('Unknown session format')
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

        expect(encodeSessionString({browsers: [{url: 'a.hic', state}]}, SessionFormat.JSON))
            .toBe(JSON.stringify({browsers: [{url: 'a.hic', state: state.toJSON()}]}))
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

describe('decode(encode(session)) is the identity', () => {

    /**
     * The property. Every seed is a session drawn from the space
     * `registry.toJSON()` writes, and the assertion is strict equality — not
     * equality after any normalising step, which ADR-0006 rejected as defining
     * the test to pass.
     *
     * Tracks are held out of *this* loop by one line and get their own loop
     * below, because the decoder's normalize pass touches them and that
     * deviation is asserted rather than absorbed.
     */
    test('over 200 generated sessions', async () => {
        const generate = generator(20260810)

        for (let seed = 0; seed < 200; seed++) {
            const session = generate({tracks: false})

            expect(await roundTrip(session), `session ${seed}: ${JSON.stringify(session)}`)
                .toEqual(session)
        }
    })

    /**
     * The other half of the identity, and the half axis ordering was a
     * prerequisite for: a session's `state` is handed to `State.fromJSON` on
     * restore, and the view that comes out has to be the view that was saved.
     * The generator asks for pairs in both orders, so this covers both sides of
     * the diagonal.
     */
    test('the view survives being rebuilt as a State', async () => {
        const generate = generator(4242)

        for (let seed = 0; seed < 200; seed++) {
            const session = generate({tracks: false})
            const decoded = await roundTrip(session)

            for (const [i, browser] of (decoded?.browsers || []).entries()) {
                expect(State.fromJSON(browser.state).toJSON(), `session ${seed}, browser ${i}`)
                    .toEqual(session.browsers[i].state)
            }
        }
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
 * Two deviations, each asserted as behaviour rather than allowed to fail. Both
 * are named in ADR-0006; neither is a licence to normalise the property above.
 */
describe('the accepted asymmetries', () => {

    /**
     * ADR-0006 decision 6. A browser with no dataset serializes to `null` and
     * the registry drops it, so an embed saved with an empty panel open
     * restores one panel short. The registry half is `testRegistrySession.js`'s;
     * what is asserted here is that the *codec* faithfully round-trips the
     * shorter list — the count is already gone before the encoder sees it, and
     * nothing downstream puts it back.
     */
    test('browser count does not survive when a browser was empty', async () => {
        const written = {browsers: [{url: 'https://example.org/a.hic', state: State.default().toJSON()}]}

        // What two panels, one of them empty, serialize to.
        const decoded = await roundTrip(written)

        expect(decoded.browsers).toHaveLength(1)
        expect(decoded).toEqual(written)
    })

    /**
     * The decoder's normalize pass — `fixDefaults` — runs on every format,
     * including this one, and it forces every track to `COLLAPSED`, drops the
     * default annotation colour, and drops a `NaN` data range. A saved session's
     * tracks carry no `displayMode` at all, so the round trip adds a field.
     *
     * This is normalization sitting inside the decoder, which ADR-0006 decision
     * 8 names as candidate 9's to move behind a `normalizeSession` stage. **When
     * it moves, this block goes and the property above gets stricter** — the
     * three `delete`s below are the whole cost of the deviation, and they are
     * written out rather than hidden in a helper so that cost stays visible.
     * Filed as #525.
     */
    describe('the decoder normalises tracks on the way in', () => {

        test('every track comes back COLLAPSED, whatever was saved', async () => {
            const session = {
                browsers: [{
                    url: 'https://example.org/a.hic',
                    tracks: [{url: 'https://example.org/a.bed', name: 'a'}],
                }],
            }

            expect((await roundTrip(session)).browsers[0].tracks[0].displayMode).toBe('COLLAPSED')
        })

        test('the default annotation colour is dropped', async () => {
            const session = {
                browsers: [{
                    url: 'https://example.org/a.hic',
                    tracks: [{url: 'https://example.org/a.bed', color: codec.DEFAULT_ANNOTATION_COLOR}],
                }],
            }

            expect(Object.hasOwn((await roundTrip(session)).browsers[0].tracks[0], 'color')).toBe(false)
        })

        /**
         * The property, over track-bearing sessions, with the normalize pass's
         * one addition asserted and then removed. Everything else about a track
         * — url, type, format, name, data range, colour — is identity.
         */
        test('and changes nothing else about a track', async () => {
            const generate = generator(777)

            for (let seed = 0; seed < 200; seed++) {
                const session = generate()
                const decoded = await roundTrip(session)

                for (const browser of decoded?.browsers || []) {
                    for (const track of browser.tracks || []) {
                        expect(track.displayMode, `session ${seed}`).toBe('COLLAPSED')
                        delete track.displayMode
                    }
                }

                expect(decoded, `session ${seed}: ${JSON.stringify(session)}`).toEqual(session)
            }
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
