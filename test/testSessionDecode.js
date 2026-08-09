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
 * The two I/O sites — the session-URL fetch and the legacy bit.ly expansion —
 * arrive as injected functions. The suite passes loaders that *throw* wherever a
 * fixture should not need one, so a format that quietly starts doing I/O fails
 * loudly rather than reaching for the wire.
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
import {describe, expect, test} from 'vitest'
import {BGZip} from 'igv-utils'
import {WIRE_FORMATS, decodeSession} from '../js/sessionCodec.js'
import State from '../js/hicState.js'

/**
 * A loader that fails the test rather than the fetch. Passed wherever a fixture
 * has no business doing I/O, which is every fixture but the two that name one.
 */
const noIO = {
    loadString: async url => {
        throw new Error(`unexpected load of ${url}`)
    },
    expandUrl: async url => {
        throw new Error(`unexpected expansion of ${url}`)
    },
}

/** The share link juicebox-web writes is `?session=blob:<compressed JSON>`. */
function compress(object) {
    return BGZip.compressString(JSON.stringify(object))
}

const oneBrowserSession = {
    browsers: [{url: 'https://example.org/one.hic', name: 'one'}],
}

describe('decodeSession — the query-parameter form', () => {

    test('decodes hicUrl, name and state without touching a loader', async () => {
        const config = await decodeSession(
            'https://host/?hicUrl=https://example.org/one.hic&name=one&state=1,1,1,0,0,1,1,NONE',
            noIO)

        expect(config.url).toBe('https://example.org/one.hic')
        expect(config.name).toBe('one')
        expect(config.state).toBeInstanceOf(State)
    })

    test('expands a URL shortcut', async () => {
        const config = await decodeSession('?hicUrl=*s3/hic/file.hic', noIO)
        expect(config.url).toBe('https://hicfiles.s3.amazonaws.com/hic/file.hic')
    })

    test('a URL naming nothing of ours decodes to no config at all', async () => {
        expect(await decodeSession('https://host/index.html', noIO)).toBeUndefined()
    })

    test('the loaders are optional — a self-contained form needs neither', async () => {
        const config = await decodeSession('?hicUrl=https://example.org/one.hic')
        expect(config.url).toBe('https://example.org/one.hic')
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
        })).rejects.toThrow('Failed to load session from URL/file: 404')
    })

    test('a fetched document that is not a session is reported as a parse failure', async () => {
        await expect(decodeSession('?session=https://example.org/index.html', {
            ...noIO,
            loadString: async () => '<html lang="en"></html>',
        })).rejects.toThrow(/Failed to parse session from URL\/file/)
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

    test('juiceboxURL= expands through the injected expander, never through fetch', async () => {
        const expanded = []
        const config = await decodeSession('?juiceboxURL=http://bit.ly/2C1VSHy', {
            ...noIO,
            expandUrl: async url => {
                expanded.push(url)
                return 'https://host/?hicUrl=https://example.org/one.hic'
            },
        })

        expect(expanded).toEqual(['http://bit.ly/2C1VSHy'])
        expect(config.url).toBe('https://example.org/one.hic')
    })
})

/**
 * The normalization the decode path still carries. ADR-0006 decision 8 hands
 * both of these to the normalize stage in candidate 9; until then they are
 * decode's, and pinning them here is what will make that move visible.
 */
describe('decodeSession — the normalization it still carries', () => {

    test('a selectedGene beside a session rides the session config', async () => {
        const config = await decodeSession(
            `?session=blob:${compress(oneBrowserSession)}&selectedGene=MYC`, noIO)

        expect(config.selectedGene).toBe('MYC')
    })

    test('tracks come back collapsed, with the default annotation colour dropped', async () => {
        const session = {
            browsers: [{
                url: 'https://example.org/one.hic',
                tracks: [{url: 'https://example.org/genes.bed', color: 'rgb(22, 129, 198)'}],
            }],
        }
        const config = await decodeSession(`?session=blob:${compress(session)}`, noIO)
        const [track] = config.browsers[0].tracks

        expect(track.color).toBeUndefined()
        expect(track.displayMode).toBe('COLLAPSED')
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

    test('the four wire formats are the four the ADR names', () => {
        expect(WIRE_FORMATS.map(a => a.format))
            .toEqual(['session', 'juiceboxURL', 'juicebox', 'query'])
    })
})
