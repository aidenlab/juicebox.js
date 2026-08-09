/**
 * `js/sessionCodec.js` — the pure half of the session decoder. #504, ADR-0006
 * decision 9.
 *
 * The whole reason this module exists is that it can be driven from string
 * literals: no network, no DOM, no async, no browser. Nothing in this file
 * stubs anything, and if that ever stops being true the extraction has leaked.
 *
 * The golden file (`test/testDecoderGolden.js`) still owns the question "does
 * the decoder as a whole behave as it did?". This file owns "does each decision
 * inside it behave as described?" — including the branches the golden corpus
 * cannot reach, such as the unknown-`state`-type rung that no URL can express.
 *
 * @see js/sessionCodec.js
 * @see docs/adr/0006-session-wire-format-and-one-decoder.md
 */
import {describe, expect, test} from 'vitest'
import {BGZip} from 'igv-utils'
import {
    SessionDecodeError,
    SessionFormat,
    decodeSessionString,
    decodeState,
    isCompressedSession,
    sniffSessionFormat,
} from '../js/sessionCodec.js'
import State from '../js/hicState.js'

/**
 * The share link juicebox-web writes is `?session=blob:<compressed JSON>`, so a
 * compressed fixture is built the way one is written rather than pasted as an
 * opaque literal — a pasted blob would pin this suite to one compressor build.
 */
function compress(object) {
    return BGZip.compressString(JSON.stringify(object))
}

describe('sniffSessionFormat', () => {

    test('a share link is a compressed blob, and the prefix is not part of the payload', () => {
        expect(sniffSessionFormat('blob:H4sIAAAA')).toEqual({
            format: SessionFormat.BLOB,
            payload: 'H4sIAAAA',
        })
    })

    test('a data URI is told apart from a blob, and carries the same payload shape', () => {
        expect(sniffSessionFormat('data:H4sIAAAA')).toEqual({
            format: SessionFormat.DATA_URI,
            payload: 'H4sIAAAA',
        })
    })

    test('anything else is JSON, payload and all', () => {
        expect(sniffSessionFormat('{"browsers":[]}')).toEqual({
            format: SessionFormat.JSON,
            payload: '{"browsers":[]}',
        })
    })

    test('the prefix must be at the front — a blob named inside a document is not one', () => {
        const {format} = sniffSessionFormat('{"url":"blob:something"}')
        expect(format).toBe(SessionFormat.JSON)
    })

    test('the empty string sniffs as JSON rather than throwing; decoding is what refuses it', () => {
        expect(sniffSessionFormat('').format).toBe(SessionFormat.JSON)
    })

    test('a non-string is the one thing the sniff itself refuses', () => {
        expect(() => sniffSessionFormat(undefined)).toThrow(SessionDecodeError)
        expect(() => sniffSessionFormat({session: 'x'}))
            .toThrow('Session must be a string, got object')
    })
})

/**
 * `extractConfig` asks this question before it knows which of its three arms to
 * enter, so it has to be answerable without decoding. It must stay the same
 * question `sniffSessionFormat` answers — a fourth copy of the prefix literals
 * in `urlUtils.js` is what the extraction was for.
 */
describe('isCompressedSession', () => {

    test.each([
        ['blob:H4sIAAAA', true],
        ['data:H4sIAAAA', true],
        ['{"browsers":[]}', false],
        ['https://example.org/session.json', false],
        ['', false],
    ])('%s -> %s', (text, expected) => {
        expect(isCompressedSession(text)).toBe(expected)
    })

    test('agrees with the sniff on every input', () => {
        for (const text of ['blob:x', 'data:x', '{}', 'session.json', '']) {
            const compressed = sniffSessionFormat(text).format !== SessionFormat.JSON
            expect(isCompressedSession(text), text).toBe(compressed)
        }
    })
})

describe('decodeSessionString', () => {

    test('plain JSON decodes to the object it spells', () => {
        expect(decodeSessionString('{"browsers":[{"url":"a.hic"}]}'))
            .toEqual({browsers: [{url: 'a.hic'}]})
    })

    test('a compressed blob decodes to the same object', () => {
        const session = {browsers: [{url: 'a.hic', name: 'A'}]}
        expect(decodeSessionString(`blob:${compress(session)}`)).toEqual(session)
    })

    test('a data URI decodes by the same path as a blob', () => {
        const session = {browsers: [{url: 'a.hic'}]}
        expect(decodeSessionString(`data:${compress(session)}`)).toEqual(session)
    })

    /**
     * The single error contract, stated three ways. Each of these produced a
     * different message at each of the three former call sites; here the same
     * condition raises the same error whatever reached it, with the underlying
     * failure kept as `cause` so the caller can still say what went wrong.
     */
    describe('one error contract', () => {

        test('a document that is not JSON', () => {
            expect(() => decodeSessionString('<!doctype html>')).toThrow(SessionDecodeError)
            expect(() => decodeSessionString('<!doctype html>')).toThrow('Session is not valid JSON')
        })

        test('the parse failure survives as `cause`', () => {
            try {
                decodeSessionString('<!doctype html>')
                expect.unreachable('malformed JSON must not decode')
            } catch (e) {
                expect(e.cause).toBeInstanceOf(SyntaxError)
            }
        })

        test('a corrupt compressed payload names the form it failed to read', () => {
            expect(() => decodeSessionString('blob:not-a-compressed-payload'))
                .toThrow('Session is not a readable blob')
            expect(() => decodeSessionString('data:not-a-compressed-payload'))
                .toThrow('Session is not a readable data-uri')
        })

        /**
         * `BGZip` rejects a corrupt payload with a bare string, not an `Error`.
         * Pinned because the wrapper is what makes that survivable for callers,
         * and because the golden file records the raw string reaching a user.
         */
        test('a decompression failure survives as `cause` even when it is not an Error', () => {
            try {
                decodeSessionString('blob:not-a-compressed-payload')
                expect.unreachable('a corrupt payload must not decode')
            } catch (e) {
                expect(e).toBeInstanceOf(SessionDecodeError)
                expect(e.cause).toBeDefined()
            }
        })

        test('compressed JSON that decompresses to something unparseable is a JSON failure', () => {
            expect(() => decodeSessionString(`blob:${BGZip.compressString('not json')}`))
                .toThrow('Session is not valid JSON')
        })
    })
})

describe('decodeState', () => {

    /**
     * The v0 seven-token form, from the published Haarhuis et al. link — the
     * same literal the golden corpus carries as load-bearing.
     */
    test('a state token decodes through State.parse', () => {
        const state = decodeState('3,3,6,5537.98746,5537.749239047619,1,KR')
        expect(state).toBeInstanceOf(State)
        expect(state.chr1).toBe(3)
        expect(state.zoom).toBe(6)
        expect(state.normalization).toBe('KR')
    })

    test('a state object decodes through State.fromJSON', () => {
        const state = decodeState({chr1: 1, chr2: 2, zoom: 3, x: 10, y: 20, pixelSize: 2, normalization: 'VC'})
        expect(state).toBeInstanceOf(State)
        expect(state.chr2).toBe(2)
        expect(state.pixelSize).toBe(2)
        expect(state.normalization).toBe('VC')
    })

    test('no state at all is the default view', () => {
        expect(decodeState(undefined)).toEqual(State.default())
    })

    /**
     * Both call sites guarded the ladder with `if (config.state)`. Delegating
     * that guard is what keeps an empty string out of `State.parse`, where it
     * would decode to a view of `NaN` rather than to the default.
     */
    test('an empty state is the default view, not a view of NaN', () => {
        expect(decodeState('')).toEqual(State.default())
        expect(decodeState(null)).toEqual(State.default())
    })

    /**
     * The rung the live-map copy had lost. `State.parse` on a number throws;
     * before this extraction, a live contact map handed a numeric `state` died
     * there while a `.hic` file handed the same value opened the default view.
     */
    describe('the unknown-type rung', () => {

        test('an unknown type falls back to the default view rather than throwing', () => {
            expect(decodeState(42)).toEqual(State.default())
        })

        test('the caller is told, and is handed the offending value', () => {
            const seen = []
            decodeState(42, undefined, value => seen.push(value))
            expect(seen).toEqual([42])
        })

        test('the reporter is not called for the types the ladder handles', () => {
            const seen = []
            decodeState('1,2,4,10,20,3', undefined, v => seen.push(v))
            decodeState({chr1: 0, chr2: 0}, undefined, v => seen.push(v))
            decodeState(undefined, undefined, v => seen.push(v))
            expect(seen).toEqual([])
        })
    })
})
