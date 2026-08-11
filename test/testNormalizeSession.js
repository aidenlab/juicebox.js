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
import {normalizeSession, normalizeTrackConfigs} from '../js/normalizeSession.js'
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

    /**
     * #536 closes the disagreement #531 pinned: `HICBrowser` read `miniMode` as
     * a figure mode and this stage did not, so `browser.figureMode` was true
     * while the three flags defaulted on. `miniMode` is resolved into
     * `figureMode` here now, and the browser reads the one field.
     */
    test('miniMode is the legacy spelling of figureMode, and resolves into it', () => {

        const config = normalizeSession({miniMode: true})

        expect(config.figureMode).toBe(true)
        for (const flag of WIDGET_FLAGS) {
            expect(config[flag], flag).toBe(false)
        }
    })

    test('an explicit figureMode wins over miniMode, which is the order the browser read them in', () => {

        const config = normalizeSession({figureMode: 'yes', miniMode: true})

        expect(config.figureMode).toBe('yes')
    })

    test('a config naming neither gains no figureMode member', () => {
        expect(Object.hasOwn(normalizeSession({url: 'a.hic'}), 'figureMode')).toBe(false)
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
 * The two defaults #536 moved up out of the browser: the background colour,
 * which `createWidgets` defaulted with a `||` as it built the contact matrix
 * view, and `synchable`, which the constructor defaulted with a `!== false`.
 * Both are fields of the resolved config now, so the readers below the seam read
 * them rather than deciding them.
 */
describe('the defaults moved up out of the browser', () => {

    test('a config naming no backgroundColor gets white, which is what createWidgets used to supply', () => {
        expect(normalizeSession({url: 'a.hic'}).backgroundColor).toEqual({r: 255, g: 255, b: 255})
    })

    test('the default is a copy, so two configs cannot share one mutable colour', () => {

        const first = normalizeSession({url: 'a.hic'})
        const second = normalizeSession({url: 'b.hic'})

        expect(first.backgroundColor).not.toBe(second.backgroundColor)
    })

    test('synchable defaults on', () => {
        expect(normalizeSession({url: 'a.hic'}).synchable).toBe(true)
    })

    test('a browser that opted out on its own stays out', () => {
        expect(normalizeSession({url: 'a.hic', synchable: false}).synchable).toBe(false)
    })

    test('only a literal false is the opt-out, matching what the browser read', () => {
        expect(normalizeSession({url: 'a.hic', synchable: 0}).synchable).toBe(true)
    })
})

/**
 * `cycle` is the control-map display cycle, and it implies a display mode: the
 * browser's `init` wrote `config.displayMode = "A"` onto the host's own object
 * before reading it back one line later. That is a resolution of one field into
 * another, so #536 moved it here — `init` reads `displayMode` now.
 */
describe('the display-mode cycle', () => {

    test('cycle resolves to display mode A', () => {
        expect(normalizeSession({url: 'a.hic', cycle: true}).displayMode).toBe('A')
    })

    test('cycle overrides a display mode the host asked for, as the browser did', () => {
        expect(normalizeSession({url: 'a.hic', cycle: true, displayMode: 'B'}).displayMode).toBe('A')
    })

    test('a config with no cycle keeps its display mode, and gains none when it names none', () => {

        expect(normalizeSession({url: 'a.hic', displayMode: 'B'}).displayMode).toBe('B')
        expect(Object.hasOwn(normalizeSession({url: 'a.hic'}), 'displayMode')).toBe(false)
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
 * The URL-shortcut expansion, moved here by #534.
 *
 * There were two copies: one three call sites deep inside `decodeQuery`, one in
 * `BrowserRegistry.restoreSession`, because a session handed straight to the
 * restore never met the decoder. Both are gone; this stage is the survivor, and
 * every entry path reaches it. The assertions below are the union of what the
 * two copies covered — `url`, `controlUrl` and track URLs, in both session
 * shapes — because that union is what must not shrink.
 */
describe('the URL shortcuts', () => {

    test('the map URL expands', () => {
        expect(normalizeSession({url: '*s3/hic/file.hic'}).url)
            .toBe('https://hicfiles.s3.amazonaws.com/hic/file.hic')
    })

    test('the control URL expands, which is the place the registry copy covered and the decoder reached separately', () => {
        expect(normalizeSession({url: 'a.hic', controlUrl: '*s3e/ctl.hic'}).controlUrl)
            .toBe('https://hicfiles.s3.amazonaws.com/external/ctl.hic')
    })

    test('a track URL expands', () => {
        expect(normalizeSession({url: 'a.hic', tracks: [{url: '*enc/ENCFF000.bed'}]}).tracks[0].url)
            .toBe('https://www.encodeproject.org/files/ENCFF000.bed')
    })

    test('the http spellings expand to http', () => {

        const config = normalizeSession({url: '*s3_/one.hic', controlUrl: '*s3e_/two.hic'})

        expect(config.url).toBe('http://hicfiles.s3.amazonaws.com/one.hic')
        expect(config.controlUrl).toBe('http://hicfiles.s3.amazonaws.com/external/two.hic')
    })

    test('every browser of a session expands, not just the first', () => {

        const session = {browsers: [
            {url: '*s3/a.hic'},
            {url: '*s3/b.hic', tracks: [{url: '*enc/b.bed'}]},
        ]}

        normalizeSession(session)

        expect(session.browsers[0].url).toBe('https://hicfiles.s3.amazonaws.com/a.hic')
        expect(session.browsers[1].url).toBe('https://hicfiles.s3.amazonaws.com/b.hic')
        expect(session.browsers[1].tracks[0].url).toBe('https://www.encodeproject.org/files/b.bed')
    })

    test('a shortcut anywhere but the front is left alone — the expansion is a prefix rule', () => {
        expect(normalizeSession({url: 'https://host/path/*s3/x.hic'}).url)
            .toBe('https://host/path/*s3/x.hic')
    })

    test('a URL naming no shortcut is untouched', () => {
        expect(normalizeSession({url: 'https://example.org/one.hic'}).url).toBe('https://example.org/one.hic')
    })

    test('a non-string URL is left as it is — a File config carries one, and this stage rejects nothing', () => {

        const file = {name: 'local.hic'}

        expect(normalizeSession({url: file}).url).toBe(file)
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

    test('a session that says nothing leaves the browser synchable, which is the default', () => {

        const session = {browsers: [{url: 'a.hic'}]}

        normalizeSession(session)

        expect(session.browsers[0].synchable).toBe(true)
    })

    test('syncDatasets true leaves a browser that opted out on its own alone', () => {

        const session = {syncDatasets: true, browsers: [{url: 'a.hic', synchable: false}]}

        normalizeSession(session)

        expect(session.browsers[0].synchable).toBe(false)
    })

    test('only a literal false is the opt-out', () => {

        const session = {syncDatasets: 0, browsers: [{url: 'a.hic'}]}

        normalizeSession(session)

        expect(session.browsers[0].synchable).toBe(true)
    })
})

/**
 * `normalizeTrackConfigs` — the same track rules, reached by the one door a
 * track can arrive at outside a session: `browser.loadTracks(configs)`, which a
 * host calls at runtime with configs no session ever carried. #536.
 *
 * It exists so that `DataLoader.loadTracks` can stop defaulting: the loader used
 * to apply a second, annotation-conditioned copy of the colour and display-mode
 * rules precisely because a runtime track met no normalize stage. Now it does,
 * at the published door, and the loader is left with what the *load* discovers.
 */
describe('the runtime track door', () => {

    test('a runtime track gets the document defaults a session-borne one gets', () => {

        const [track] = normalizeTrackConfigs([
            {url: 'a.bed', color: 'rgb(22, 129, 198)', min: NaN, displayMode: 'EXPANDED'},
        ])

        expect(Object.hasOwn(track, 'color')).toBe(false)
        expect(Object.hasOwn(track, 'min')).toBe(false)
        expect(track.displayMode).toBe('COLLAPSED')
    })

    test('a runtime track URL expands its shortcut, as a session-borne one does', () => {
        expect(normalizeTrackConfigs([{url: '*enc/ENCFF000.bed'}])[0].url)
            .toBe('https://www.encodeproject.org/files/ENCFF000.bed')
    })

    test('it hands back what it was given, and rejects nothing', () => {

        const tracks = [{url: 'a.bed'}]

        expect(normalizeTrackConfigs(tracks)).toBe(tracks)
        expect(() => normalizeTrackConfigs(undefined)).not.toThrow()
        expect(() => normalizeTrackConfigs('a.bed')).not.toThrow()
    })

    test('the session path and the runtime path agree about the same track', () => {

        const viaSession = normalizeSession({url: 'a.hic', tracks: [{url: '*enc/x.bed', min: NaN}]}).tracks[0]
        const viaRuntime = normalizeTrackConfigs([{url: '*enc/x.bed', min: NaN}])[0]

        expect(viaRuntime).toEqual(viaSession)
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
 * Running the stage twice must be the identity.
 *
 * #535 moved the call to the entry, so nothing in this repo normalizes the same
 * document twice any more — `test/testNormalizeOnceAtTheEntry.js` counts the
 * calls and holds that line. The property is kept for the caller this file
 * cannot see: a host may hand the same object to `init` twice, or to
 * `createBrowser` after a restore, and the stage rewrites the host's own object,
 * so drift on a second pass would be a rewrite of something the host still
 * holds.
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
 * The same property over what #533 moved in — the gene hoist, the `syncDatasets`
 * resolution and the track defaults, all of which write rather than merely
 * default, and so are where a second pass would be most likely to show.
 *
 * This was the load-bearing case until #535: the restore normalized so that the
 * gene it reads had been hoisted, and `createBrowserList` normalized the same
 * document again on its way to the browsers. The second call is gone; the
 * property is kept for the same reason as the one above.
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
