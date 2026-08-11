/**
 * The readers below the entry seam read fields. #536.
 *
 * `test/testNormalizeSession.js` says what the stage resolves a config to and
 * `test/testConfigGolden.js` pins what comes out of each door. Neither can say
 * that a reader *stopped deciding*: a browser built from a resolved config looks
 * the same whether it read `config.synchable` or re-derived it, which is exactly
 * how the inline defaults survived four tickets.
 *
 * So these drive the readers with a config the stage has **not** seen, where a
 * surviving default is the only thing that could supply a value. An undefined
 * field here is the assertion: it means the reader asked the config rather than
 * answering for itself.
 *
 * That is also why nothing here goes through `createBrowser` — that door
 * normalizes, and a normalized config would satisfy these tests no matter what
 * the reader does.
 *
 * @see js/normalizeSession.js — where the defaults these used to hold now live
 */
import {describe, expect, test} from 'vitest'
import HICBrowser from '../js/hicBrowser.js'
import {withContainers} from './utils/browserFixture.js'

/**
 * Spelled out rather than imported from `js/normalizeSession.js`, which exports
 * it: the same rule `test/data/configEntryPathCorpus.js` states — a test that
 * derives its input from the code under test moves when that code moves, and
 * what is being asserted here is that a *particular* colour is dropped.
 */
const DEFAULT_ANNOTATION_COLOR_LITERAL = 'rgb(22, 129, 198)'

describe('the browser constructor decides nothing about a config', () => {

    const dom = withContainers()

    test('synchable is the field, not a rule about the field', () => {

        // `config.synchable !== false` until #536, so this was `true`.
        expect(new HICBrowser(dom.another(), {}).synchable).toBeUndefined()
    })

    test('figureMode is the field, and miniMode is not consulted', () => {

        // `config.figureMode || config.miniMode` until #536, so this was `true`.
        expect(new HICBrowser(dom.another(), {miniMode: true}).figureMode).toBeUndefined()
    })

    test('what the config does say is what the browser holds', () => {

        const browser = new HICBrowser(dom.another(), {synchable: false, figureMode: true})

        expect(browser.synchable).toBe(false)
        expect(browser.figureMode).toBe(true)
    })
})

/**
 * The track loader's half. The loader itself is the network, so what is driven
 * is the door above it: `browser.loadTracks` is where a runtime track meets the
 * normalize stage now, which is what let the loader's own copy of those rules go.
 */
describe('the track loader decides nothing a document could have said', () => {

    const dom = withContainers()

    test('the published door resolves the tracks it is handed', async () => {

        const browser = new HICBrowser(dom.another(), {})
        const configs = [{url: '*enc/x.bed', color: DEFAULT_ANNOTATION_COLOR_LITERAL, min: NaN}]

        // The loader itself is the network; what is under test is the door.
        browser.dataLoader = {loadTracks: async () => undefined}
        await browser.loadTracks(configs)

        expect(configs[0].url).toBe('https://www.encodeproject.org/files/x.bed')
        expect(Object.hasOwn(configs[0], 'color')).toBe(false)
        expect(Object.hasOwn(configs[0], 'min')).toBe(false)
        expect(configs[0].displayMode).toBe('COLLAPSED')
    })
})
