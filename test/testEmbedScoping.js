import {describe, it, expect, beforeEach, afterEach} from 'vitest'
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
const {withDOM} = await import('./utils/browserFixture.js')

globalThis.window = mockedWindow
globalThis.document = mockedDocument

/**
 * The two page-scoped singletons that were plainly per-embed -- the selected
 * gene and the alert dialog -- now live on the registry. #481, the scope
 * section of ADR-0004.
 *
 * What each test here asserts is *which embed* a piece of state belongs to, so
 * every one of them stands up two containers. A single-embed assertion would
 * pass against the page-scoped code these replace.
 *
 * Real elements and a real `AlertDialog`: the claim is that an alert lands in
 * the container its own registry owns, and only the DOM can answer that.
 */

function withContainers() {

    const context = {}
    let fixture

    beforeEach(() => {
        fixture = withDOM()
        context.window = fixture.window
        context.container = fixture.container
        context.another = () => {
            const element = fixture.window.document.createElement('div')
            fixture.window.document.body.appendChild(element)
            return element
        }
    })

    afterEach(() => {
        fixture.restore()
    })

    return context
}

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
