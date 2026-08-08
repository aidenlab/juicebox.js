import {describe, it, expect} from 'vitest'
import {JSDOM} from 'jsdom'

/**
 * igv-ui builds its DOMPurify at import time, from whatever `window` is then,
 * and `test/setup.js` installs a hand-rolled mock. Priming a real window before
 * the dynamic imports below is what lets one of these tests raise a real alert
 * through a real dialog -- the same dance, and for the same reason, as
 * `test/testEmbedScoping.js`.
 */
const priming = new JSDOM('<!doctype html><html><body></body></html>')
const mockedWindow = globalThis.window
const mockedDocument = globalThis.document
globalThis.window = priming.window
globalThis.document = priming.window.document

const {default: BrowserRegistry, registryForContainer} = await import('../js/browserRegistry.js')
const {initRegistry} = await import('../js/init.js')
const {default: juicebox} = await import('../js/index.js')
const {default: HICBrowser} = await import('../js/hicBrowser.js')
const {withContainers} = await import('./utils/browserFixture.js')
const {withStubbedLoads} = await import('./utils/stubbedLoads.js')
const {REGISTRY_SURFACE} = await import('../js/publicApi.js')

globalThis.window = mockedWindow
globalThis.document = mockedDocument

/**
 * Registry teardown -- #496, decisions 7 and 8 of ADR-0005.
 *
 * `browser.dispose()` gives a host a way to take one panel down. This is the
 * other half: a host that is done with the whole embed -- Spacewalk removing
 * its Juicebox panel -- takes the container back. Two claims, and the second is
 * the one that is easy to leave out:
 *
 * 1. Every browser goes, and the container is *empty* -- not "empty of roots".
 *    The registry installs a node in the container itself, its own alert
 *    dialog, and a teardown that counts only browsers leaves it behind.
 * 2. The registry evicts itself from the container map, so `hic.init()` on the
 *    same element afterwards builds into a clean registry rather than a dead
 *    one. `registryForContainer` creates lazily, which is what makes eviction
 *    sufficient.
 *
 * Every test stands up two containers where the claim is about scope: a
 * single-embed assertion would pass against a teardown that took the page down.
 */

const config = url => ({url, queryParametersSupported: false})

const session = (...urls) => ({browsers: urls.map(url => ({url})), queryParametersSupported: false})

describe('BrowserRegistry.dispose', () => {

    const dom = withContainers()
    withStubbedLoads()

    it('disposes every browser it owns', async () => {
        const registry = await initRegistry(dom.container, session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const browsers = [...registry.browsers]

        registry.dispose()

        expect(registry.browsers).toEqual([])
        expect(registry.currentBrowser).toBeUndefined()
        expect(browsers.some(browser => browser.rootElement.isConnected)).toBe(false)
        // Disposed, not merely delisted: a published call on one now throws.
        expect(() => browsers[0].reset()).toThrow()
    })

    it('leaves its container empty', async () => {
        const registry = await initRegistry(dom.container, session('https://example.com/a.hic', 'https://example.com/b.hic'))

        registry.dispose()

        expect(dom.container.children.length).toBe(0)
    })

    it('takes its own alert dialog down with it', async () => {
        // The registry's contribution to the container, and the reason the
        // assertion above counts children rather than browsers: nothing in the
        // browser teardown path looks at this node.
        const registry = await initRegistry(dom.container, config('https://example.com/a.hic'))
        registry.presentAlert('boom')
        const dialog = registry.alertDialog.container

        expect(dialog.isConnected).toBe(true)

        registry.dispose()

        expect(dialog.isConnected).toBe(false)
        expect(dom.container.children.length).toBe(0)
    })

    it('leaves an empty container empty', () => {
        const registry = registryForContainer(dom.container)

        expect(() => registry.dispose()).not.toThrow()
        expect(dom.container.children.length).toBe(0)
    })

    it('is idempotent', async () => {
        const registry = await initRegistry(dom.container, config('https://example.com/a.hic'))

        registry.dispose()

        expect(() => registry.dispose()).not.toThrow()
        expect(registry.browsers).toEqual([])
    })

    it('leaves a second embed on the page untouched', async () => {
        const mine = await initRegistry(dom.container, session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const theirs = await initRegistry(dom.another(), config('https://example.com/c.hic'))
        const survivor = theirs.browsers[0]

        mine.dispose()

        expect(theirs.browsers).toEqual([survivor])
        expect(theirs.currentBrowser).toBe(survivor)
        expect(survivor.rootElement.isConnected).toBe(true)
        expect(theirs.container.children.length).toBeGreaterThan(0)
        // And the surviving embed still has *its* registry: eviction is keyed
        // by container, so disposing one must not clear the map.
        expect(registryForContainer(theirs.container)).toBe(theirs)
    })
})

describe('a container whose registry has been disposed', () => {

    const dom = withContainers()
    withStubbedLoads()

    it('resolves to a different registry instance', async () => {
        const disposed = await initRegistry(dom.container, config('https://example.com/a.hic'))

        disposed.dispose()

        const fresh = registryForContainer(dom.container)
        expect(fresh).toBeInstanceOf(BrowserRegistry)
        expect(fresh).not.toBe(disposed)
        expect(fresh.container).toBe(dom.container)
        expect(fresh.browsers).toEqual([])
    })

    it('yields a working embed when init() is called on it again', async () => {
        // The sequence decision 8 makes supported rather than accidental: a
        // host disposes its embed, and later initializes the same element.
        // Reached through the published namespace, because that is the door the
        // criterion names -- a host writes `hic.init(container, config)`.
        const disposed = await initRegistry(dom.container, config('https://example.com/a.hic'))
        disposed.dispose()

        const browser = await juicebox.init(dom.container, config('https://example.com/b.hic'))

        expect(browser).toBeInstanceOf(HICBrowser)
        expect(browser.dataset.url).toBe('https://example.com/b.hic')
        expect(browser.rootElement.isConnected).toBe(true)
        expect(browser.registry).not.toBe(disposed)
        expect(browser.registry).toBe(registryForContainer(dom.container))
        expect(browser.registry.browsers).toEqual([browser])
        expect(browser.registry.currentBrowser).toBe(browser)
    })

    it('keeps the re-initialized embed when a stale handle is disposed again', async () => {
        // The sequence decision 8 opens up: dispose, init the same container,
        // and a host still holding the *first* registry tears it down twice.
        // Eviction keyed by container alone would take the live embed's map
        // entry with it, and the next init() would build a third registry over
        // the second one's browsers -- silently, since nothing else reads it.
        const stale = await initRegistry(dom.container, config('https://example.com/a.hic'))
        stale.dispose()

        const live = await initRegistry(dom.container, config('https://example.com/b.hic'))
        stale.dispose()

        expect(registryForContainer(dom.container)).toBe(live)
        expect(live.browsers).toHaveLength(1)
        expect(live.browsers[0].rootElement.isConnected).toBe(true)
    })
})

describe('the declared registry surface', () => {

    it('names dispose', () => {
        // Declared deliberately rather than discovered later: per ADR-0003's
        // "absence is not permission" a reachable member is contract the moment
        // it ships. Decision 7 of ADR-0005.
        expect(REGISTRY_SURFACE).toContain('dispose')
    })
})
