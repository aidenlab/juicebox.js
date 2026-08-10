/**
 * `js/normalizeSession.js` — the normalize stage, driven from object literals.
 * #532, candidate 9.
 *
 * The point of the extraction is that this file exists: normalization used to be
 * two unexported functions inside the browser-creation module, so the only way
 * to ask "what does a config resolve to?" was to build a browser and read it
 * back. Nothing here stubs anything, and if that ever stops being true the
 * extraction has leaked.
 *
 * `test/testConfigGolden.js` still owns "does the resolved config as a whole
 * come back byte-identical?". This file owns "does each decision inside the
 * stage behave as described?" — including the one property the golden file can
 * only show by accident: **normalize rejects nothing**.
 *
 * @see js/normalizeSession.js
 * @see docs/juicebox-punch-list.md — candidate 9
 */
import {describe, expect, test} from 'vitest'
import {normalizeSession} from '../js/normalizeSession.js'
import ColorScale from '../js/colorScale.js'
import RatioColorScale from '../js/ratioColorScale.js'

const WIDGET_FLAGS = ['showLocusGoto', 'showHicContactMapLabel', 'showChromosomeSelector']

describe('the two session shapes', () => {

    test('a single-browser config is a session with its one browser inlined', () => {

        const config = {url: 'a.hic'}

        expect(normalizeSession(config)).toBe(config)
        expect(config.showLocusGoto).toBe(true)
    })

    test('a session names its browsers, and every one of them is normalized', () => {

        const session = {browsers: [{url: 'a.hic'}, {url: 'b.hic', figureMode: true}]}

        normalizeSession(session)

        expect(session.browsers[0].showChromosomeSelector).toBe(true)
        expect(session.browsers[1].showChromosomeSelector).toBe(false)
    })

    test('the session document itself is left alone when it names browsers', () => {

        const session = {browsers: [{url: 'a.hic'}], syncDatasets: false}

        normalizeSession(session)

        expect(session.showLocusGoto).toBeUndefined()
        expect(session.syncDatasets).toBe(false)
    })

    test('an empty browser list normalizes nothing rather than treating the session as a browser', () => {

        const session = {browsers: []}

        normalizeSession(session)

        expect(session.showLocusGoto).toBeUndefined()
    })

    /**
     * `createBrowser` is the one entry path that takes a browser config and
     * *only* a browser config, so it wraps rather than handing its argument
     * over: a member spelled `browsers` on a single browser config is an
     * ordinary unread member, and reading it as a browser list would leave the
     * object that becomes `browser.config` undefaulted.
     */
    test('a caller that knows it holds one browser config says so by wrapping it', () => {

        const config = {url: 'a.hic', browsers: 'a member nothing reads'}

        normalizeSession({browsers: [config]})

        expect(config.showLocusGoto).toBe(true)
        expect(config.browsers).toBe('a member nothing reads')
    })
})

describe('the widget-visibility defaults', () => {

    test('the three flags default on', () => {

        const config = normalizeSession({})

        for (const flag of WIDGET_FLAGS) {
            expect(config[flag], flag).toBe(true)
        }
    })

    test('a host that asked for a flag off keeps it off', () => {

        const config = normalizeSession({showLocusGoto: false, showHicContactMapLabel: false})

        expect(config.showLocusGoto).toBe(false)
        expect(config.showHicContactMapLabel).toBe(false)
        expect(config.showChromosomeSelector).toBe(true)
    })

    test('figureMode forces all three off, overriding what the host asked for', () => {

        const config = normalizeSession({figureMode: true, showLocusGoto: true})

        for (const flag of WIDGET_FLAGS) {
            expect(config[flag], flag).toBe(false)
        }
    })

    test('miniMode is not figureMode here — the browser reads it, normalize does not', () => {

        // `HICBrowser` treats `miniMode` as a figure mode; this stage keys on
        // `figureMode` alone, so the flags default on. The disagreement is real
        // and pinned in the golden file; it is not this ticket's to close.
        const config = normalizeSession({miniMode: true})

        for (const flag of WIDGET_FLAGS) {
            expect(config[flag], flag).toBe(true)
        }
    })

    test('only a literal true is figure mode', () => {

        const config = normalizeSession({figureMode: 'yes'})

        expect(config.showLocusGoto).toBe(true)
    })
})

describe('the string coercions', () => {

    test('a colorScale string becomes a ColorScale', () => {

        const config = normalizeSession({colorScale: '2000,255,0,0'})

        expect(config.colorScale).toBeInstanceOf(ColorScale)
        expect(config.colorScale.threshold).toBe(2000)
    })

    test('a tagged colorScale string becomes the signed scale its tag names', () => {

        const config = normalizeSession({colorScale: 'R:5:2000,255,0,0:2000,0,0,255'})

        expect(config.colorScale).toBeInstanceOf(RatioColorScale)
    })

    test('a colorScale that is already an object is left as it is', () => {

        const colorScale = new ColorScale({threshold: 17, r: 1, g: 2, b: 3})
        const config = normalizeSession({colorScale})

        expect(config.colorScale).toBe(colorScale)
    })

    test('a backgroundColor string becomes an {r, g, b}', () => {

        const config = normalizeSession({backgroundColor: '10,20,30'})

        expect(config.backgroundColor).toEqual({r: 10, g: 20, b: 30})
    })

    test('a backgroundColor that is already an object is left as it is', () => {

        const backgroundColor = {r: 1, g: 2, b: 3}
        const config = normalizeSession({backgroundColor})

        expect(config.backgroundColor).toBe(backgroundColor)
    })
})

/**
 * The track defaults, moved here from the decoder by #533.
 *
 * They ran inside `decodeSession` and so reached the URL path only; a session
 * handed straight to `restoreSession` — the documented public API — was never
 * swept. The rules themselves are unchanged, which is why the assertions below
 * read the same as the ones `test/testSessionRoundTrip.js` used to make about
 * the decoder.
 */
describe('the track defaults', () => {

    const DEFAULT_ANNOTATION_COLOR_LITERAL = 'rgb(22, 129, 198)'

    const oneTrack = track => normalizeSession({url: 'a.hic', tracks: [track]}).tracks[0]

    test('the default annotation colour is dropped, so the track picks up whatever the renderer defaults to', () => {

        const track = oneTrack({url: 'a.bed', color: DEFAULT_ANNOTATION_COLOR_LITERAL})

        expect(Object.hasOwn(track, 'color')).toBe(false)
    })

    test('any other colour is kept', () => {
        expect(oneTrack({url: 'a.bed', color: 'rgb(1,2,3)'}).color).toBe('rgb(1,2,3)')
    })

    test('NaN data-range bounds are dropped', () => {

        const track = oneTrack({url: 'a.bed', min: NaN, max: NaN})

        expect(Object.hasOwn(track, 'min')).toBe(false)
        expect(Object.hasOwn(track, 'max')).toBe(false)
    })

    test('a real data range is kept, including a zero bound', () => {

        const track = oneTrack({url: 'a.bed', min: 0, max: 100})

        expect(track.min).toBe(0)
        expect(track.max).toBe(100)
    })

    test('display mode is collapsed, whatever the session asked for', () => {
        expect(oneTrack({url: 'a.bed'}).displayMode).toBe('COLLAPSED')
        expect(oneTrack({url: 'a.bed', displayMode: 'EXPANDED'}).displayMode).toBe('COLLAPSED')
    })

    test('a browser naming no tracks is left alone', () => {
        expect(Object.hasOwn(normalizeSession({url: 'a.hic'}), 'tracks')).toBe(false)
    })

    test('every browser of a session is swept, not just the first', () => {

        const session = {browsers: [
            {url: 'a.hic', tracks: [{url: 'a.bed'}]},
            {url: 'b.hic', tracks: [{url: 'b.bed'}]},
        ]}

        normalizeSession(session)

        expect(session.browsers.map(b => b.tracks[0].displayMode)).toEqual(['COLLAPSED', 'COLLAPSED'])
    })
})

/**
 * The `selectedGene` reconciliation, #481 — its session-shaped half, moved here
 * by #533.
 *
 * A gene named inside a browser config belongs to the *embed*: the registry
 * keeps one selected gene and serializes it at the top level. Hoisting it is a
 * reading of a session document, so it belongs to this stage. Reading the
 * `selectedGene=` **query parameter** is format knowledge and stays in the
 * decoder, which is why only the fold over `browsers` is tested here.
 */
describe('the selectedGene reconciliation', () => {

    test('a gene named inside a browser is hoisted to the session', () => {

        const session = {browsers: [{url: 'a.hic', selectedGene: 'MYC'}]}

        normalizeSession(session)

        expect(session.selectedGene).toBe('MYC')
    })

    test('the session\'s own gene wins over its browsers', () => {

        const session = {selectedGene: 'ACE', browsers: [{url: 'a.hic', selectedGene: 'MYC'}]}

        normalizeSession(session)

        expect(session.selectedGene).toBe('ACE')
    })

    test('the last browser to name one wins, which is the order the old successive writes produced', () => {

        const session = {browsers: [
            {url: 'a.hic', selectedGene: 'MYC'},
            {url: 'b.hic'},
            {url: 'c.hic', selectedGene: 'EGFR'},
        ]}

        normalizeSession(session)

        expect(session.selectedGene).toBe('EGFR')
    })

    test('a session naming no gene anywhere gains no member', () => {

        const session = {browsers: [{url: 'a.hic'}]}

        normalizeSession(session)

        expect(Object.hasOwn(session, 'selectedGene')).toBe(false)
    })

    test('the gene on an inlined single-browser config is already at session level', () => {

        const config = normalizeSession({url: 'a.hic', selectedGene: 'MYC'})

        expect(config.selectedGene).toBe('MYC')
    })
})

/**
 * `syncDatasets`, resolved once at session level — the third of the three
 * divergences #533 closes.
 *
 * `createBrowserList` translated it into a per-browser `synchable` and
 * `createBrowser` never looked at it, so the same document produced a synchable
 * browser through one creation door and an unsynchable one through the other.
 * The behaviour kept is the one that **honours the opt-out**: a session that
 * says `syncDatasets: false` means it wherever it is handed in.
 */
describe('the syncDatasets resolution', () => {

    test('a session that opts out marks every browser unsynchable', () => {

        const session = {syncDatasets: false, browsers: [{url: 'a.hic'}, {url: 'b.hic'}]}

        normalizeSession(session)

        expect(session.browsers.map(b => b.synchable)).toEqual([false, false])
    })

    test('a single-browser config opts out too, since it is a session with its browser inlined', () => {

        const config = normalizeSession({url: 'a.hic', syncDatasets: false})

        expect(config.synchable).toBe(false)
    })

    test('nothing is written when the session says nothing', () => {

        const session = {browsers: [{url: 'a.hic'}]}

        normalizeSession(session)

        expect(Object.hasOwn(session.browsers[0], 'synchable')).toBe(false)
    })

    test('syncDatasets true leaves a browser that opted out on its own alone', () => {

        const session = {syncDatasets: true, browsers: [{url: 'a.hic', synchable: false}]}

        normalizeSession(session)

        expect(session.browsers[0].synchable).toBe(false)
    })

    test('only a literal false is the opt-out', () => {

        const session = {syncDatasets: 0, browsers: [{url: 'a.hic'}]}

        normalizeSession(session)

        expect(Object.hasOwn(session.browsers[0], 'synchable')).toBe(false)
    })
})

/**
 * The acceptance criterion candidate 9 repeats on every ticket that could
 * violate it: the config object is the most-used public surface there is, so a
 * normalize stage that tightened validation would reject configs that work
 * today. These are the inputs a validating stage would be most tempted by.
 */
describe('normalize rejects nothing', () => {

    const hostile = [
        ['an empty config', {}],
        ['a config with no url', {name: 'nameless'}],
        ['unknown members', {url: 'a.hic', somethingNobodyReads: {deep: [1, 2]}}],
        ['a null colorScale', {colorScale: null}],
        ['a numeric url', {url: 42}],
        ['a browsers list holding an empty config', {browsers: [{}]}],
        ['browsers alongside inline browser members', {browsers: [{url: 'a.hic'}], url: 'b.hic'}],
        ['a tracks member that is not a list', {url: 'a.hic', tracks: 'a.bed'}],
        ['a track that is an empty object', {url: 'a.hic', tracks: [{}]}],
        ['a numeric selectedGene', {url: 'a.hic', selectedGene: 42}],
        ['syncDatasets false with no browsers at all', {syncDatasets: false}],
    ]

    for (const [caption, input] of hostile) {
        test(caption, () => {
            expect(() => normalizeSession(input)).not.toThrow()
        })
    }

    test('a malformed colorScale string coerces to whatever the parser makes of it, and does not throw', () => {
        expect(() => normalizeSession({colorScale: 'not-a-color-scale'})).not.toThrow()
    })
})

/**
 * Running the stage twice must be the identity — #535 will move the call to the
 * entry, and until then both a host's `init` and the restore it drives can reach
 * the same document.
 */
test('normalizing an already-normalized session changes nothing further', () => {

    const once = normalizeSession({url: 'a.hic', colorScale: '2000,255,0,0', backgroundColor: '10,20,30'})
    const snapshot = {...once, colorScale: once.colorScale, backgroundColor: once.backgroundColor}

    normalizeSession(once)

    expect(once).toEqual(snapshot)
    expect(once.colorScale).toBe(snapshot.colorScale)
    expect(once.backgroundColor).toBe(snapshot.backgroundColor)
})

/**
 * The same property over what #533 moved in, and it is load-bearing rather than
 * decorative: `BrowserRegistry.restoreSession` normalizes so that the gene it
 * reads has been hoisted, and then `createBrowserList` normalizes the same
 * document again on its way to the browsers.
 */
test('normalizing an already-normalized session document changes nothing further', () => {

    const session = {
        syncDatasets: false,
        browsers: [
            {url: 'a.hic', selectedGene: 'MYC', tracks: [{url: 'a.bed', color: 'rgb(22, 129, 198)', min: NaN}]},
            {url: 'b.hic'},
        ],
    }

    normalizeSession(session)
    const once = structuredClone(session)

    normalizeSession(session)

    expect(session).toEqual(once)
})
