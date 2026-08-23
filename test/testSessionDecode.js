/**
 * `decodeSession` — the whole decode path, driven from string literals. #505,
 * ADR-0006 decisions 9 and 10.
 *
 * Before this ticket the decode path was a single `async` function that did its
 * own fetching, so **none of the format logic was reachable from a test**. That
 * defect, more than the duplication, is what candidate 5 exists to fix. This
 * file is the evidence that it is fixed: every wire format the decoder accepts
 * is exercised here without network, without a DOM and without a file, by
 * handing `decodeSession` a fake loader and a string.
 *
 * The one I/O site — the session-URL fetch — arrives as an injected function.
 * The suite passes a loader that *throws* wherever a fixture should not need
 * one, so a format that quietly starts doing I/O fails loudly rather than
 * reaching for the wire. (There were two until #506 removed the bit.ly
 * expansion.)
 *
 * Division of labour with the neighbouring suites:
 *
 * - `testDecoderGolden.js` owns "did the decoder's output change?" — snapshots,
 *   no hand-written expectations. It still drives `extractConfig`, the real
 *   entry point, with the real loader stubbed at `igvxhr`.
 * - `testSessionCodec.js` owns the pure decisions inside the codec (sniffing,
 *   the state ladder).
 * - This file owns "is the decode path drivable, and does each format adapter
 *   pick up its own format?".
 *
 * @see js/sessionCodec.js
 * @see docs/adr/0006-session-wire-format-and-one-decoder.md
 */
import {afterEach, describe, expect, test, vi} from 'vitest'
import {BGZip} from 'igv-utils'
import {
    SESSION_SOURCES,
    SESSION_VERSION,
    SessionDecodeError,
    WIRE_FORMATS,
    decodeSession,
    encodeSession,
} from '../js/sessionCodec.js'
import State from '../js/hicState.js'
import {File} from './utils/File.js'

/**
 * A loader that fails the test rather than the fetch. Passed wherever a fixture
 * has no business doing I/O, which is every fixture but the two that name one.
 */
const noIO = {
    loadString: async url => {
        throw new Error(`unexpected load of ${url}`)
    },
}

/** The share link juicebox-web writes is `?session=blob:<compressed JSON>`. */
function compress(object) {
    return BGZip.compressString(JSON.stringify(object))
}

const oneBrowserSession = {
    browsers: [{url: 'https://example.org/one.hic', name: 'one'}],
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('decodeSession — the query-parameter form', () => {

    test('decodes hicUrl, name and state without touching a loader', async () => {
        const config = await decodeSession(
            'https://host/?hicUrl=https://example.org/one.hic&name=one&state=1,1,1,0,0,1,1,NONE',
            noIO)

        expect(config.url).toBe('https://example.org/one.hic')
        expect(config.name).toBe('one')
        expect(config.state).toBeInstanceOf(State)
    })

    /**
     * A shortcut leaves the decoder as it arrived. It used to be expanded here —
     * the decoder held one of the two copies #534 collapsed — and the expansion
     * is `js/normalizeSession.js`'s now, one stage downstream and on every entry
     * path. `test/testNormalizeSession.js` owns the rule itself; this pins the
     * seam, so a shortcut quietly reappearing on the decoder's side fails here.
     */
    test('a URL shortcut is left for the normalize stage to expand', async () => {
        const config = await decodeSession('?hicUrl=*s3/hic/file.hic', noIO)
        expect(config.url).toBe('*s3/hic/file.hic')
    })

    test('a URL naming nothing of ours decodes to no config at all', async () => {
        expect(await decodeSession('https://host/index.html', noIO)).toBeUndefined()
    })

    test('the loaders are optional — a self-contained form needs neither', async () => {
        const config = await decodeSession('?hicUrl=https://example.org/one.hic')
        expect(config.url).toBe('https://example.org/one.hic')
    })
})

/**
 * The third field of a four-field track string, and the one that is routinely
 * written empty — every harvested four-field track in `test/test_urls.md` has
 * `…|name||rgb(22, 129, 198)`. An empty field means *no data range*, so it must
 * leave the decoder as no `min`/`max` at all rather than as `NaN` bounds a later
 * stage has to sweep up. #515.
 *
 * `js/normalizeSession.js` still deletes `NaN` bounds, because a *partly* empty
 * range (`0-`) can still produce one.
 *
 * **Why here and not in `testSessionCodec.js`**, which owns the pure decisions
 * inside the codec: `destringifyTracksV0` is not one of them from a test's side.
 * It is a closure inside `decodeQuery`, exported nowhere, so the only way to
 * drive it is through `decodeSession` — which is this file's subject, and which
 * the query form reaches without a loader at all. Hand-written expectations
 * rather than a snapshot, because the claim is about the *rule*: the golden file
 * records that the output moved, and this records what it is now meant to be.
 */
describe('decodeSession — the v0 track string data range', () => {

    const tracksParam = trackString =>
        `?hicUrl=https://example.org/a.hic&tracks=${encodeURIComponent(trackString)}`

    test('an empty range decodes to a config with no min and no max', async () => {
        const config = await decodeSession(
            tracksParam('https://example.org/a.bed|A||rgb(255,0,0)'), noIO)
        const [track] = config.tracks

        expect(track.url).toBe('https://example.org/a.bed')
        expect(Object.hasOwn(track, 'min')).toBe(false)
        expect(Object.hasOwn(track, 'max')).toBe(false)
    })

    test('a blank range is an absent one too', async () => {
        const config = await decodeSession(
            tracksParam('https://example.org/a.bed|A|  |rgb(255,0,0)'), noIO)
        const [track] = config.tracks

        expect(Object.hasOwn(track, 'min')).toBe(false)
        expect(Object.hasOwn(track, 'max')).toBe(false)
    })

    test('0-50 decodes as it always has', async () => {
        const config = await decodeSession(
            tracksParam('https://example.org/a.bed|A|0-50|rgb(255,0,0)'), noIO)
        const [track] = config.tracks

        expect(track.min).toBe(0)
        expect(track.max).toBe(50)
    })

    test('the negative form -5-5 decodes as it always has', async () => {
        const config = await decodeSession(
            tracksParam('https://example.org/a.bed|A|-5-5|rgb(255,0,0)'), noIO)
        const [track] = config.tracks

        expect(track.min).toBe(-5)
        expect(track.max).toBe(5)
    })

    /**
     * A harvested link, verbatim from `test/testURL.js` — two four-field tracks,
     * both with an empty range. The shape the rule exists for.
     */
    test('a harvested link leaves both of its tracks unbounded', async () => {
        const url = "http://www.aidenlab.org/juicebox/?state=3,3,6,5537.98746,5537.749239047619,1,KR&colorScale=18.89619862813927&hicUrl=https://s3.amazonaws.com/hicfiles/external/wapl_hic/WT.hic&name=Haarhuis%20et%20al.%20|%20Cell%202017%20Hap1%20control&tracks=http://hicfiles.s3.amazonaws.com/external/GM12878_CTCF_orientation.bed|GM12878_CTCF_orientation.bed||rgb(22,%20129,%20198)|||https://s3.amazonaws.com/igv.broadinstitute.org/annotations/hg19/genes/gencode.v18.collapsed.bed.gz|gencode.v18.collapsed.bed.gz||rgb(22,%20129,%20198)"

        const config = await decodeSession(url, noIO)

        expect(config.tracks.length).toBe(2)
        for (const track of config.tracks) {
            expect(Object.hasOwn(track, 'min')).toBe(false)
            expect(Object.hasOwn(track, 'max')).toBe(false)
        }
    })
})

describe('decodeSession — the session parameter', () => {

    test('a compressed share link decodes from the parameter alone', async () => {
        const config = await decodeSession(`?session=blob:${compress(oneBrowserSession)}`, noIO)
        expect(config.browsers[0].url).toBe('https://example.org/one.hic')
    })

    test('a corrupt share link rejects with what the decompressor threw', async () => {
        await expect(decodeSession('?session=blob:not-compressed-at-all', noIO)).rejects.toThrow()
    })
})

/**
 * The case that motivated the injected loader (ADR-0006 decision 10): a session
 * parameter naming a URL whose *contents* then need sniffing. The caller cannot
 * hoist this fetch out, because knowing that a second read is needed at all
 * means knowing the format — which is the wrong side of the seam.
 */
describe('decodeSession — a session URL, driven from a fake loader', () => {

    test('fetches the named document and decodes the JSON it returns', async () => {
        const loaded = []
        const config = await decodeSession('?session=https://example.org/session.json', {
            ...noIO,
            loadString: async url => {
                loaded.push(url)
                return JSON.stringify(oneBrowserSession)
            },
        })

        expect(loaded).toEqual(['https://example.org/session.json'])
        expect(config.browsers[0].name).toBe('one')
    })

    test('sniffs the fetched document too — a URL may serve the compressed form', async () => {
        const config = await decodeSession('?session=https://example.org/session.txt', {
            ...noIO,
            loadString: async () => `blob:${compress(oneBrowserSession)}`,
        })

        expect(config.browsers[0].url).toBe('https://example.org/one.hic')
    })

    test('a failed fetch is reported as a load failure, not a parse failure', async () => {
        await expect(decodeSession('?session=https://example.org/gone.json', {
            ...noIO,
            loadString: async () => {
                throw new Error('404')
            },
        })).rejects.toThrow('Session document could not be fetched (404)')
    })

    test('a fetched document that is not a session is reported as a parse failure', async () => {
        await expect(decodeSession('?session=https://example.org/index.html', {
            ...noIO,
            loadString: async () => '<html lang="en"></html>',
        })).rejects.toThrow(/Session is not valid JSON/)
    })
})

describe('decodeSession — the legacy braced forms', () => {

    test('juicebox= carries one braced query string per browser', async () => {
        // The inner `=` and `&` arrive percent-encoded — the outer query parser
        // would otherwise split the braced string at its first `=`.
        const input = '?juicebox={hicUrl%3Dhttps%3A%2F%2Fexample.org%2Fone.hic},{hicUrl%3Dhttps%3A%2F%2Fexample.org%2Ftwo.hic}'
        const config = await decodeSession(input, noIO)

        expect(config.browsers.map(b => b.url))
            .toEqual(['https://example.org/one.hic', 'https://example.org/two.hic'])
    })

    test('juiceboxData= is the braced form, compressed', async () => {
        const braced = '{hicUrl%3Dhttps%3A%2F%2Fexample.org%2Fone.hic}'
        const config = await decodeSession(`?juiceboxData=${BGZip.compressString(braced)}`, noIO)

        expect(config.browsers[0].url).toBe('https://example.org/one.hic')
    })

})

/**
 * `juiceboxURL=` — the one deliberate deviation from ADR-0006's frozen
 * compatibility contract, dropped by decision 1 in #506.
 *
 * The adapter stays in {@link WIRE_FORMATS} rather than being deleted outright,
 * and these tests are why: a URL naming a retired format has to *say so*. Delete
 * the entry and the parameter falls through to the `query` adapter, which finds
 * no `hicUrl`, returns no config, and leaves the host silently showing whatever
 * it was configured with — the confusing failure the ticket rules out.
 */
describe('decodeSession — the retired bit.ly form', () => {

    test('juiceboxURL= is refused, and never reaches the network', async () => {
        vi.stubGlobal('fetch', async () => {
            throw new Error('the bit.ly expansion is gone; nothing here may fetch')
        })

        await expect(decodeSession('?juiceboxURL=http://bit.ly/2C1VSHy', noIO))
            .rejects.toThrow(SessionDecodeError)
    })

    test('the refusal names the format, the ticket and where to read about it', async () => {
        const error = await decodeSession('?juiceboxURL=http://bit.ly/2C1VSHy', noIO)
            .catch(e => e)

        expect(error.message).toMatch(/juiceboxURL/)
        expect(error.message).toMatch(/#506/)
        expect(error.message).toMatch(/docs\/url\.md/)
    })

    test('it is refused before the rest of the URL is decoded, not after', async () => {
        // The expansion used to *replace* the query, so anything beside it was
        // read from the expanded href rather than from the URL as pasted.
        // Decoding the remainder would answer a link that was never written.
        await expect(decodeSession(
            '?juiceboxURL=http://bit.ly/2C1VSHy&hicUrl=https://example.org/one.hic', noIO))
            .rejects.toThrow(SessionDecodeError)
    })
})

/**
 * The read half of the version stamp — `js/sessionCodec.js` `SESSION_VERSION`
 * carries what it is for. #508, ADR-0006 decision 7.
 *
 * Since the field buys nothing today, what is asserted here is mostly what it
 * does *not* do: it is never required, its absence is not a degraded path, and a
 * session that carries it decodes to the same document as one that does not.
 * The write half, and the strict identity that depends on the field being taken
 * back off, are `test/testSessionRoundTrip.js`'s.
 */
describe('decodeSession — the version stamp', () => {

    test('a session with no version field decodes as v1, unremarked', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})

        const config = await decodeSession(`?session=blob:${compress(oneBrowserSession)}`, noIO)

        expect(config).toEqual(oneBrowserSession)
        expect(warn).not.toHaveBeenCalled()
        expect(error).not.toHaveBeenCalled()
    })

    test('the version juicebox writes decodes to the same document, field consumed', async () => {
        const stamped = {...oneBrowserSession, version: SESSION_VERSION}

        expect(await decodeSession(`?session=blob:${compress(stamped)}`, noIO))
            .toEqual(oneBrowserSession)
    })

    test('what juicebox itself writes decodes, which is the round trip in one line', async () => {
        expect(await decodeSession(encodeSession(oneBrowserSession), noIO))
            .toEqual(oneBrowserSession)
    })

    test('an unknown version is refused, and the message names it', async () => {
        const future = {...oneBrowserSession, version: 2}

        await expect(decodeSession(`?session=blob:${compress(future)}`, noIO))
            .rejects.toThrow(SessionDecodeError)
        await expect(decodeSession(`?session=blob:${compress(future)}`, noIO))
            .rejects.toThrow(/version 2/)
    })

    /**
     * Refused *before* anything is read out of it, which is the difference
     * between a session that fails and one that half-decodes into a view the
     * user did not save.
     */
    test('and nothing of it is decoded', async () => {
        const future = {browsers: [{url: 'https://example.org/one.hic'}], version: 2, selectedGene: 'MYC'}

        await expect(decodeSession(`?session=blob:${compress(future)}`, noIO))
            .rejects.toThrow(SessionDecodeError)
    })

    /**
     * A version is a version whichever arm carried the document. The URL arm is
     * the one that wraps what it catches (#521), so it is the arm where a
     * message can be lost on the way out.
     */
    test('a fetched session is version-checked too, and the version survives the report', async () => {
        await expect(decodeSession('?session=https://example.org/session.json', {
            ...noIO,
            loadString: async () => JSON.stringify({...oneBrowserSession, version: 7}),
        })).rejects.toThrow(/version 7/)
    })

    /**
     * The version is a number, and a string spelling of it is a different
     * format — one nothing here wrote. Refusing it is the same call as refusing
     * version 2: this reader does not know what wrote the document, so it does
     * not guess. The message quotes the value, so the two cases are told apart
     * in a bug report.
     */
    test('a version that is not the number 1 is unknown, however it is spelled', async () => {
        await expect(decodeSession(`?session=blob:${compress({...oneBrowserSession, version: '1'})}`, noIO))
            .rejects.toThrow(/version "1"/)
    })

    /**
     * The legacy forms carry no version and are not made to. `?juicebox=` is a
     * braced query string per browser; a `version` token in one would decode to
     * nothing, exactly as any other unrecognised parameter does.
     */
    test('the braced legacy form is untouched by any of this', async () => {
        const input = '?juicebox={hicUrl%3Dhttps%3A%2F%2Fexample.org%2Fone.hic%26version%3D2}'
        const config = await decodeSession(input, noIO)

        expect(config.browsers[0].url).toBe('https://example.org/one.hic')
        expect(config.browsers[0].version).toBeUndefined()
    })
})

/**
 * The one normalization the decode path still carries, and the one it no longer
 * does. ADR-0006 decision 8 drew the line; #533 is where the crossing happened.
 *
 * What stays is what needs to know a *format*: reading the `selectedGene=` query
 * parameter. What went is what only needed to read a *document*: the track
 * defaults, and the hoist of a gene named inside a browser. Both are
 * `js/normalizeSession.js`'s now, and `test/testNormalizeSession.js` owns the
 * assertions about them.
 */
describe('decodeSession — the normalization it still carries', () => {

    test('a selectedGene beside a session rides the session config', async () => {
        const config = await decodeSession(
            `?session=blob:${compress(oneBrowserSession)}&selectedGene=MYC`, noIO)

        expect(config.selectedGene).toBe('MYC')
    })

    test('a track comes back exactly as the session spelled it', async () => {
        const session = {
            browsers: [{
                url: 'https://example.org/one.hic',
                tracks: [{url: 'https://example.org/genes.bed', color: 'rgb(22, 129, 198)'}],
            }],
        }
        const config = await decodeSession(`?session=blob:${compress(session)}`, noIO)
        const [track] = config.browsers[0].tracks

        // The default annotation colour is kept and no display mode is invented:
        // both are defaults, and defaulting is the next stage's. #533.
        expect(track.color).toBe('rgb(22, 129, 198)')
        expect(Object.hasOwn(track, 'displayMode')).toBe(false)
    })

    test('a gene named inside a browser is left where the session put it', async () => {
        const session = {browsers: [{url: 'https://example.org/one.hic', selectedGene: 'MYC'}]}

        const config = await decodeSession(`?session=blob:${compress(session)}`, noIO)

        expect(Object.hasOwn(config, 'selectedGene')).toBe(false)
        expect(config.browsers[0].selectedGene).toBe('MYC')
    })
})

/**
 * The acceptance criterion "adding a hypothetical fifth format touches one
 * module", asserted rather than asserted-in-a-comment: the formats are a list of
 * uniformly-shaped adapters in `sessionCodec.js`, so a fifth is an entry in it.
 */
describe('the format registry', () => {

    test('every adapter has the same shape', () => {
        for (const adapter of WIRE_FORMATS) {
            expect(typeof adapter.format, JSON.stringify(adapter.format)).toBe('string')
            expect(typeof adapter.appliesTo, adapter.format).toBe('function')
            expect(typeof adapter.decode, adapter.format).toBe('function')
        }
    })

    test('the registry names four formats, one of them retired', () => {
        // `juiceboxURL` is still named here after #506, and still in the same
        // position in the fold: the array is where a format's *disposition* is
        // recorded, and "retired, refuse it loudly" is a disposition.
        expect(WIRE_FORMATS.map(a => a.format))
            .toEqual(['session', 'juiceboxURL', 'juicebox', 'query'])
    })
})

/**
 * One outward failure shape, whatever fetched the session. #521.
 *
 * The three arms of the `session` adapter differ only in where the text came
 * from, and until this ticket they differed in how they said so: the parameter
 * arm rethrew a bare string from `BGZip` (`name` and `message` both `undefined`),
 * the File arm wrote one sentence, and the URL arm wrote that sentence wrapped
 * inside a second one. The same malformed input therefore reported differently
 * depending on which path reached it, which is what made a bug report ambiguous
 * about where the link actually failed.
 *
 * What is asserted here is the shape, not the prose: a `SessionDecodeError`,
 * always, carrying **two facts in one message** — what would not decode, and
 * where the session came from — plus the source as a field a caller can branch
 * on and the original failure still reachable through `cause`.
 *
 * The File arm is driven through the adapter rather than through
 * `decodeSession`, because `extractQuery` can only ever produce string values
 * and so the arm is unreachable from the entry point (#519). Its *shape* is
 * still this suite's business: the arm is the one #521 has to bring into line
 * and the one no golden snapshot can see.
 */
describe('decodeSession — one outward failure shape', () => {

    const sessionAdapter = WIRE_FORMATS.find(adapter => adapter.format === 'session')

    /** Reject and return the rejection, so the shape can be read off it. */
    async function rejection(promise) {
        let resolved
        try {
            resolved = await promise
        } catch (e) {
            return e
        }
        throw new Error(`expected a rejection, and the session decoded to ${JSON.stringify(resolved)}`)
    }

    const arms = {
        parameter: () => decodeSession('?session=blob:not-compressed-at-all', noIO),
        file: () => sessionAdapter.decode({
            query: {session: new File(Buffer.from('<html lang="en"></html>'), 'session.json')},
            loaders: {},
        }),
        url: () => decodeSession('?session=https://example.org/index.html', {
            ...noIO,
            loadString: async () => '<html lang="en"></html>',
        }),
    }

    for (const [source, arm] of Object.entries(arms)) {

        test(`the ${source} arm rejects with a SessionDecodeError naming its source`, async () => {
            const e = await rejection(arm())

            expect(e).toBeInstanceOf(Error)
            expect(e).toBeInstanceOf(SessionDecodeError)
            expect(e.name).toBe('SessionDecodeError')
            expect(e.source).toBe(source)
            expect(e.message).toContain(SESSION_SOURCES[source])
        })

        test(`the ${source} arm keeps the failure underneath as cause`, async () => {
            const e = await rejection(arm())

            expect(e.cause).toBeDefined()
        })
    }

    /**
     * The bare string is the one the acceptance criterion names outright: `BGZip`
     * rejects a corrupt payload with a string, and until now the parameter arm
     * rethrew it untouched, so `extractConfig` rejected with a value that was not
     * an `Error` at all.
     */
    test('a corrupt share link no longer rejects with a bare string', async () => {
        const e = await rejection(decodeSession('?session=blob:not-compressed-at-all', noIO))

        expect(typeof e).not.toBe('string')
        expect(e.message).toMatch(/[a-z]/)
        expect(e.message).not.toContain('undefined')
    })

    /** Two facts, one message — and the decoder's own reason is the *what*. */
    test('the message says what would not decode as well as where it came from', async () => {
        const e = await rejection(arms.url())

        expect(e.message).toContain('Session is not valid JSON')
        expect(e.message).toContain(SESSION_SOURCES.url)
    })

    /**
     * The URL arm used to nest its parse failure inside a load failure, so a
     * document that fetched fine and then would not parse was reported as if the
     * fetch had failed. The two are different repairs for a user and stay told
     * apart — but each is now said once.
     */
    test('a fetch that failed and a document that would not parse are told apart, and neither is double-wrapped', async () => {
        const unreachable = await rejection(decodeSession('?session=https://example.org/gone.json', {
            ...noIO,
            loadString: async () => {
                throw new Error('404')
            },
        }))
        const unparseable = await rejection(arms.url())

        expect(unreachable.message).toContain('404')
        expect(unreachable.message).not.toContain('Session is not valid JSON')
        expect(unparseable.message).not.toMatch(/could not be fetched/)

        for (const e of [unreachable, unparseable]) {
            expect(e.source).toBe('url')
            expect(e.message.match(/Could not decode/g)).toHaveLength(1)
        }
    })

    /**
     * The criterion is written against `extractConfig`, which is more than the
     * `session` parameter: `?juiceboxData=` decompresses too, and rejected with
     * the same kind of bare string. It carries no source — the parameter names
     * itself, and `SESSION_SOURCES` is the `session=` vocabulary — but it is an
     * `Error`, which is the half of the criterion that was failing.
     */
    test('a corrupt juiceboxData= link rejects with an Error too', async () => {
        const e = await rejection(decodeSession('?juiceboxData=not-compressed-at-all', noIO))

        expect(e).toBeInstanceOf(SessionDecodeError)
        expect(e.message).toContain('juiceboxData=')
        expect(e.cause).toBeDefined()
    })

    /**
     * A session value that is neither a File nor a string cannot arrive through
     * `extractConfig`, whose parser only ever produces strings. It used to raise
     * a bare `TypeError` out of the prefix sniff all the same; a caller driving
     * the adapter gets the one shape instead, and the ladder's own reason.
     */
    test('a session value that is not a string is refused in the same shape', async () => {
        const e = await rejection(sessionAdapter.decode({query: {session: 42}, loaders: {}}))

        expect(e).toBeInstanceOf(SessionDecodeError)
        expect(e.source).toBe('parameter')
        expect(e.message).toContain('Session must be a string, got number')
    })

    /**
     * The version refusal is raised after the arms, on the document rather than
     * on where it was read from -- and it still has to come out in the one shape,
     * carrying the source of the document it refused.
     */
    test('a version refusal is reported in the same shape, with the source of the document', async () => {
        const e = await rejection(decodeSession('?session=https://example.org/session.json', {
            ...noIO,
            loadString: async () => JSON.stringify({browsers: [{url: 'https://example.org/one.hic'}], version: 7}),
        }))

        expect(e).toBeInstanceOf(SessionDecodeError)
        expect(e.source).toBe('url')
        expect(e.message).toContain('version 7')
        expect(e.message).toContain(SESSION_SOURCES.url)
    })
})
