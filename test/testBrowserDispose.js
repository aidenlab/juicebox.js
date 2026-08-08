import {describe, it, expect} from 'vitest'
import HICBrowser, {DisposedBrowserError} from '../js/hicBrowser.js'
import {registryForContainer} from '../js/browserRegistry.js'
import EventBus from '../js/eventBus.js'
import {withContainers} from './utils/browserFixture.js'
import {withStubbedLoads} from './utils/stubbedLoads.js'
import {BROWSER_SURFACE} from '../js/publicApi.js'

/**
 * Browser teardown -- #493, decisions 4 through 7 of ADR-0005.
 *
 * The claim is symmetry: what the constructor installs, `dispose()` removes.
 * The constructor installs in two places -- inside `rootElement`, which every
 * delete path already removed, and in the *host's container*, which none of
 * them did. So every assertion here counts what is left in the container, not
 * what is left in the root: an orphan is by definition a node no delete path
 * looks at.
 *
 * `InputDialog` is the only such node today. It is named in exactly one test,
 * and everything else counts children -- because the mechanism under test is
 * "the constructor records what it installs outside `rootElement`", not "the
 * dialog specifically gets removed."
 */

/**
 * What one live browser contributes to its container: the root element, and the
 * dialog it installs beside it. Restoring N browsers should leave exactly this
 * much behind, however many times it has been restored.
 */
const NODES_PER_LIVE_BROWSER = 2

describe('HICBrowser.dispose', () => {

    const dom = withContainers()

    it('leaves the container empty after repeated build/delete cycles', () => {
        const registry = registryForContainer(dom.container)

        for (let cycle = 0; cycle < 3; cycle++) {
            const browser = new HICBrowser(dom.container, {})
            registry.add(browser)
            browser.dispose()
        }

        expect(dom.container.children.length).toBe(0)
    })

    it('removes the dialog it appended to the host container', () => {
        // The one place the current leak is named. Every other assertion here
        // counts nodes, so that adding a second externally installed widget is
        // covered without anyone remembering to extend this file.
        const browser = new HICBrowser(dom.container, {})
        const dialog = browser.inputDialog.container

        expect(dialog.isConnected).toBe(true)
        browser.dispose()
        expect(dialog.isConnected).toBe(false)
    })

    it('removes its root element', () => {
        const browser = new HICBrowser(dom.container, {})
        const rootElement = browser.rootElement

        browser.dispose()

        expect(rootElement.isConnected).toBe(false)
    })

    it('clears the per-browser bus', () => {
        // The retention path that matters: Spacewalk subscribes
        // DidHideCrosshairs on this bus and has no way to know the browser is
        // gone. Clearing it is what releases the host's handler.
        const browser = new HICBrowser(dom.container, {})
        const handler = () => undefined
        browser.eventBus.subscribe('DidHideCrosshairs', handler)

        browser.dispose()

        expect(Object.values(browser.eventBus.subscribers).flat()).toEqual([])
    })

    it('never touches globalBus', () => {
        // globalBus outlives every browser on the page and its registrations
        // belong to the host. Decision 5.
        const browser = new HICBrowser(dom.container, {})
        const handler = () => undefined
        EventBus.globalBus.subscribe('GenomeChange', handler)

        try {
            browser.dispose()
            expect(EventBus.globalBus.subscribers['GenomeChange']).toContain(handler)
        } finally {
            EventBus.globalBus.unsubscribe('GenomeChange', handler)
        }
    })

    it('unsyncs itself from its peers', () => {
        const registry = registryForContainer(dom.container)
        const a = new HICBrowser(dom.container, {})
        const b = new HICBrowser(dom.container, {})
        registry.add(a)
        registry.add(b)
        a.synchedBrowsers.add(b)
        b.synchedBrowsers.add(a)

        a.dispose()

        expect([...b.synchedBrowsers]).toEqual([])
    })

    it('releases its registry slot and falls selection through', () => {
        const registry = registryForContainer(dom.container)
        const a = new HICBrowser(dom.container, {})
        const b = new HICBrowser(dom.container, {})
        registry.add(a)
        registry.add(b)

        b.dispose()

        expect(registry.browsers).toEqual([a])
        expect(registry.currentBrowser).toBe(a)
    })

    it('is idempotent', () => {
        const registry = registryForContainer(dom.container)
        const browser = new HICBrowser(dom.container, {})
        registry.add(browser)

        browser.dispose()

        expect(() => browser.dispose()).not.toThrow()
        expect(registry.browsers).toEqual([])
    })
})

describe('a disposed browser', () => {

    const dom = withContainers()

    /**
     * Decision 6: a disposed browser is fatal, not inert. `registry.delete()`
     * leaves a zombie the host may still hold -- juicebox-web holds `browser`
     * across several call sites -- and a thrown error surfaces in development
     * where a silent no-op surfaces as a blank panel in production.
     */

    const SYNCHRONOUS = ['reset', 'setCustomCrosshairsHandler']
    const ASYNCHRONOUS = ['loadHicFile', 'loadTracks', 'loadHicControlFile', 'loadLiveContactMap', 'parseGotoInput']

    function disposedBrowser() {
        const browser = new HICBrowser(dom.container, {})
        registryForContainer(dom.container).add(browser)
        browser.dispose()
        return browser
    }

    it.each(SYNCHRONOUS)('throws a named error from %s()', name => {
        expect(() => disposedBrowser()[name]()).toThrow(DisposedBrowserError)
    })

    it.each(ASYNCHRONOUS)('rejects with a named error from %s()', async name => {
        await expect(disposedBrowser()[name]({})).rejects.toThrow(DisposedBrowserError)
    })

    it('names the browser and the method it was called on', () => {
        const browser = disposedBrowser()
        expect(() => browser.reset()).toThrow(new RegExp(`${browser.id}.*reset`))
    })

    it('guards every published method', () => {
        // The list above is a hand-written subset of the declared surface and
        // will go stale the day a method is added. This is what notices.
        const browser = disposedBrowser()
        const guarded = new Set([...SYNCHRONOUS, ...ASYNCHRONOUS])
        const published = BROWSER_SURFACE.filter(name => 'dispose' !== name && 'function' === typeof browser[name])
        expect(published.sort()).toEqual([...guarded].sort())
    })

    it('still answers dispose()', () => {
        // Idempotence has to outrank the guard, or a host that tears down twice
        // gets an exception for doing the right thing.
        expect(() => disposedBrowser().dispose()).not.toThrow()
    })
})

describe('the registry delete paths', () => {

    const dom = withContainers()

    it('leave no orphans behind delete()', () => {
        const registry = registryForContainer(dom.container)
        const browser = new HICBrowser(dom.container, {})
        registry.add(browser)

        registry.delete(browser)

        expect(dom.container.children.length).toBe(0)
    })

    it('leave the container empty across repeated delete() cycles', () => {
        // The cycle claim again, against the path a host actually reaches:
        // the exported `deleteBrowser` calls `registry.delete`.
        const registry = registryForContainer(dom.container)

        for (let cycle = 0; cycle < 3; cycle++) {
            const browser = new HICBrowser(dom.container, {})
            registry.add(browser)
            registry.delete(browser)
        }

        expect(registry.browsers).toEqual([])
        expect(dom.container.children.length).toBe(0)
    })

    it('leave no orphans behind deleteAll()', () => {
        const registry = registryForContainer(dom.container)
        registry.add(new HICBrowser(dom.container, {}))
        registry.add(new HICBrowser(dom.container, {}))

        registry.deleteAll()

        expect(registry.browsers).toEqual([])
        expect(dom.container.children.length).toBe(0)
    })
})

describe('restoreSession', () => {

    const dom = withContainers()
    withStubbedLoads()

    /**
     * The path both hosts actually reach teardown through: a restore opens with
     * `deleteAll()`. Before #493 this orphaned one dialog per browser per
     * restore, permanently, and nothing in the repo counted them.
     */

    it('leaves nothing orphaned across repeated restores', async () => {
        const registry = registryForContainer(dom.container)
        const session = () => ({browsers: [{url: 'https://example.com/a.hic'}, {url: 'https://example.com/b.hic'}]})

        for (let restore = 0; restore < 3; restore++) {
            await registry.restoreSession(session())
        }

        // The container holds the third restore's two browsers and nothing
        // from the first two. Before #493 it held six dialogs.
        expect(registry.browsers.length).toBe(2)
        expect(dom.container.children.length).toBe(2 * NODES_PER_LIVE_BROWSER)

        // And the survivors come down too, which is what says the count above
        // is two live browsers rather than one live browser and two orphans.
        registry.deleteAll()
        expect(dom.container.children.length).toBe(0)
    })

    it('leaves the container empty when the session names no browsers', async () => {
        const registry = registryForContainer(dom.container)

        await registry.restoreSession({browsers: [{url: 'https://example.com/a.hic'}]})
        await registry.restoreSession({browsers: []})

        expect(dom.container.children.length).toBe(0)
    })
})
