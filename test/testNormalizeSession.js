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

const CHROME_FLAGS = ['showLocusGoto', 'showHicContactMapLabel', 'showChromosomeSelector']

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
})

describe('the chrome-visibility defaults', () => {

    test('the three flags default on', () => {

        const config = normalizeSession({})

        for (const flag of CHROME_FLAGS) {
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

        for (const flag of CHROME_FLAGS) {
            expect(config[flag], flag).toBe(false)
        }
    })

    test('miniMode is not figureMode here — the browser reads it, normalize does not', () => {

        // `HICBrowser` treats `miniMode` as a figure mode; this stage keys on
        // `figureMode` alone, so the flags default on. The disagreement is real
        // and pinned in the golden file; it is not this ticket's to close.
        const config = normalizeSession({miniMode: true})

        for (const flag of CHROME_FLAGS) {
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
