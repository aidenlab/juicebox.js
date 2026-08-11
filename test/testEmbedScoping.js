import {describe, it, expect} from 'vitest'
import {JSDOM} from 'jsdom'

/**
 * igv-ui builds its DOMPurify at import time, from whatever `window` is then.
 * `test/setup.js` installs a hand-rolled document mock, which leaves purify
 * inert and `AlertDialog.present` throwing on a method that was never defined.
 * Priming a real window before the dynamic imports below is what lets the alert
 * tests exercise the real dialog rather than a stand-in for it. The window
 * outlives the primed import deliberately -- purify keeps using it.
 */
const priming = new JSDOM('<!doctype html><html><body></body></html>')
const mockedWindow = globalThis.window
const mockedDocument = globalThis.document
globalThis.window = priming.window
globalThis.document = priming.window.document

const {registryForContainer} = await import('../js/browserRegistry.js')
const {toJSON, restoreSession} = await import('../js/session.js')
const {default: HICBrowser} = await import('../js/hicBrowser.js')
const {withContainers} = await import('./utils/browserFixture.js')

globalThis.window = mockedWindow
globalThis.document = mockedDocument

/**
 * The page-scoped singletons that were plainly per-embed -- the selected gene,
 * the alert dialog, and the viewport sizing -- no longer are. The first two
 * moved onto the registry (#481, the scope section of ADR-0004); the third is
 * the `--hic-viewport-*` custom properties, which ADR-0004 deferred and #477
 * moved onto each browser's own root element.
 *
 * What each test here asserts is *which embed* a piece of state belongs to, so
 * every one of them stands up two containers. A single-embed assertion would
 * pass against the page-scoped code these replace.
 *
 * Real elements and a real `AlertDialog`: the claim is that an alert lands in
 * the container its own registry owns, and only the DOM can answer that.
 */

describe('selectedGene', () => {

    const dom = withContainers()

    it('is undefined on a fresh registry', () => {
        expect(registryForContainer(dom.container).selectedGene).toBeUndefined()
    })

    it('holds a different gene in each of two registries at once', () => {
        const one = registryForContainer(dom.container)
        const two = registryForContainer(dom.another())

        one.selectedGene = 'ace'
        two.selectedGene = 'egfr'

        expect(one.selectedGene).toBe('ace')
        expect(two.selectedGene).toBe('egfr')
    })

    it('is written by a gene search to the searching browser\'s own registry', async () => {
        const mine = new HICBrowser(dom.container, {})
        const theirs = new HICBrowser(dom.another(), {})

        for (const browser of [mine, theirs]) {
            browser.state = {}
            browser.genome = {featureDB: new Map([['ACE', {chr: 'chr17', start: 61554422, end: 61575741}]])}
            // The locus parse is a separate concern, and needs a dataset.
            browser.parseLocusString = locus => locus
        }

        await mine.lookupFeatureOrGene('ace')

        expect(mine.registry.selectedGene).toBe('ace')
        expect(theirs.registry.selectedGene).toBeUndefined()
    })

    it('is restored onto the registry owning the container it was restored into', async () => {
        const other = dom.another()

        await restoreSession(dom.container, {browsers: [], selectedGene: 'ace'})

        expect(registryForContainer(dom.container).selectedGene).toBe('ace')
        expect(registryForContainer(other).selectedGene).toBeUndefined()
    })

    /**
     * The legacy `juicebox={…},{…}` form spells the gene inside each browser
     * rather than at the top level, and the decoder used to hoist it before
     * anything else saw the document. #533 moved that hoist to the normalize
     * stage, which `BrowserRegistry.restoreSession` now runs *before* it reads
     * the gene -- so the ordering this asserts is what keeps such a link
     * restoring the gene it names.
     */
    it('is restored from a session that names it inside a browser rather than at the top', async () => {
        const other = dom.another()

        await restoreSession(dom.container, {browsers: [{selectedGene: 'ace'}]})

        expect(registryForContainer(dom.container).selectedGene).toBe('ace')
        expect(registryForContainer(other).selectedGene).toBeUndefined()
    })

    it('is serialized from the embed whose browser is current, not page-wide', () => {
        // `toJSON()` is a zero-argument export with no container to resolve
        // from, so it follows the page-wide selection -- the same
        // single-embed convenience `getAllBrowsers()` carries. What it must not
        // do is serialize one embed's browsers beside another embed's gene.
        const one = registryForContainer(dom.container)
        const two = registryForContainer(dom.another())
        one.selectedGene = 'ace'
        two.selectedGene = 'egfr'

        for (const [registry, name] of [[one, 'a'], [two, 'b']]) {
            registry.register(fakeBrowser(name, registry))
        }

        two.select(two.browsers[0])
        expect(toJSON().selectedGene).toBe('egfr')

        one.select(one.browsers[0])
        expect(toJSON().selectedGene).toBe('ace')
    })

    it('is left out of a session when the embed has no selected gene', () => {
        const registry = registryForContainer(dom.container)
        registry.add(fakeBrowser('a', registry))

        expect(Object.hasOwn(toJSON(), 'selectedGene')).toBe(false)
    })
})

describe('alerts', () => {

    const dom = withContainers()

    function alertTextIn(container) {
        const dialog = container.querySelector('.igv-ui-alert-dialog-container')
        return dialog && dialog.querySelector('.igv-ui-alert-dialog-body-copy').textContent
    }

    it('surface in the container of the registry that raised them', () => {
        const other = dom.another()

        registryForContainer(dom.container).presentAlert('mine')

        expect(alertTextIn(dom.container)).toBe('mine')
        expect(alertTextIn(other)).toBeNull()
    })

    it('reach each embed separately rather than the last one to initialize', () => {
        // The bug: igv-ui's Alert singleton was re-bound on every `init()`, so
        // whichever embed initialized last captured every embed's alerts.
        const other = dom.another()

        registryForContainer(dom.container).presentAlert('mine')
        registryForContainer(other).presentAlert('theirs')

        expect(alertTextIn(dom.container)).toBe('mine')
        expect(alertTextIn(other)).toBe('theirs')
    })

    it('builds one dialog per registry, however many alerts it raises', () => {
        const registry = registryForContainer(dom.container)

        registry.presentAlert('first')
        registry.presentAlert('second')

        expect(dom.container.querySelectorAll('.igv-ui-alert-dialog-container')).toHaveLength(1)
        expect(alertTextIn(dom.container)).toBe('second')
    })

    it('puts no dialog in the container until something is alerted', () => {
        registryForContainer(dom.container)

        expect(dom.container.querySelector('.igv-ui-alert-dialog-container')).toBeNull()
    })
})

/**
 * `--hic-viewport-width/height` are the input to `.hic-root`'s own width and
 * height, so whichever element carries them decides what "the viewport" means.
 * They were written to `document.documentElement`, which made that meaning
 * page-wide and the last browser to lay out the winner. #477.
 */
describe('viewport sizing', () => {

    const dom = withContainers()

    const sizeOf = element => ({
        width: element.style.getPropertyValue('--hic-viewport-width'),
        height: element.style.getPropertyValue('--hic-viewport-height')
    })

    it('is carried by the browser rather than by the page', () => {
        const browser = new HICBrowser(dom.container, {width: 320, height: 240})

        expect(sizeOf(browser.rootElement)).toEqual({width: '320px', height: '240px'})
        expect(sizeOf(globalThis.document.documentElement)).toEqual({width: '', height: ''})
    })

    it('differs between two embeds at once', () => {
        const mine = new HICBrowser(dom.container, {width: 320, height: 240})
        const theirs = new HICBrowser(dom.another(), {width: 800, height: 600})

        expect(sizeOf(mine.rootElement)).toEqual({width: '320px', height: '240px'})
        expect(sizeOf(theirs.rootElement)).toEqual({width: '800px', height: '600px'})
    })

    it('differs between two browsers sharing one container', () => {
        // Why per-browser and not per-container, which is what #477 first
        // proposed: a container holds many browsers -- juicebox-web's clone
        // button puts a second one in the same container it was given -- so
        // scoping to the container would have left last-writer-wins in place
        // inside a single embed.
        const first = new HICBrowser(dom.container, {width: 320, height: 240})
        const second = new HICBrowser(dom.container, {width: 800, height: 600})

        expect(sizeOf(first.rootElement)).toEqual({width: '320px', height: '240px'})
        expect(sizeOf(second.rootElement)).toEqual({width: '800px', height: '600px'})
    })

    it('is left to the stylesheet when a browser is given no dimensions', () => {
        // The visible behaviour change. Such a browser used to inherit whatever
        // the last sized browser wrote to the page; it now sets nothing, and
        // the `:root` declarations in css/juicebox.scss supply the default.
        //
        // Both assertions are the claim: an empty inline property on the root
        // is only a default if the page it inherits from is empty too, which is
        // exactly what was not true before.
        new HICBrowser(dom.container, {width: 320, height: 240})
        const unsized = new HICBrowser(dom.container, {})

        expect(sizeOf(unsized.rootElement)).toEqual({width: '', height: ''})
        expect(sizeOf(globalThis.document.documentElement)).toEqual({width: '', height: ''})
    })
})

/** Carries only what the registry and `session.toJSON` read. */
function fakeBrowser(name, registry) {
    return {
        name,
        registry,
        rootElement: {classList: {add: () => undefined, remove: () => undefined}},
        browserPanelDeleteButton: {style: {display: 'none'}},
        synchedBrowsers: new Set(),
        unsyncSelf: () => undefined,
        toJSON: () => ({name})
    }
}
