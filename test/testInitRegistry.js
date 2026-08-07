import {describe, it, expect, vi} from 'vitest'
import BrowserRegistry, {registryForContainer} from '../js/browserRegistry.js'
import {init, initRegistry} from '../js/init.js'
import juicebox from '../js/index.js'
import {withContainers} from './utils/browserFixture.js'
import {withStubbedLoads} from './utils/stubbedLoads.js'
import HICBrowser from '../js/hicBrowser.js'

/**
 * The registry's front door, and the proof that two embeds coexist -- #483,
 * decision 3 of ADR-0004, closing #384.
 *
 * `initRegistry` is the real initialization function; `init` is a wrapper whose
 * return type is contract for both known host apps and so is pinned here in
 * both its shapes -- a browser for a single-browser session, an array for a
 * multi-browser one.
 *
 * Everything below stands up two containers, because a single-embed assertion
 * would pass against the page-scoped code this replaces.
 */

const config = url => ({url, queryParametersSupported: false})

const session = (...urls) => ({browsers: urls.map(url => ({url})), queryParametersSupported: false})

describe('initRegistry', () => {

    const dom = withContainers()
    withStubbedLoads()

    it('returns the registry owning the container it initialized', async () => {
        const registry = await initRegistry(dom.container, config('https://example.com/a.hic'))

        expect(registry).toBeInstanceOf(BrowserRegistry)
        expect(registry).toBe(registryForContainer(dom.container))
        expect(registry.container).toBe(dom.container)
    })

    it('returns a registry holding the browsers the session named', async () => {
        const registry = await initRegistry(dom.container, session('https://example.com/a.hic', 'https://example.com/b.hic'))

        expect(registry.browsers.map(browser => browser.dataset.url))
            .toEqual(['https://example.com/a.hic', 'https://example.com/b.hic'])
        expect(registry.currentBrowser).toBe(registry.browsers[0])
    })

    it('returns a registry when reached through the published namespace', async () => {
        // The manifest declares `initRegistry` on the namespace, and
        // test/testPublicApi.js pins that entry to this function. What is left
        // to check is that a host calling it the way a host does gets the
        // object whose surface that manifest declares.
        const registry = await juicebox.initRegistry(dom.container, config('https://example.com/a.hic'))

        expect(registry).toBeInstanceOf(BrowserRegistry)
        expect(registry.browsers[0].dataset.url).toBe('https://example.com/a.hic')
    })

    it('returns a different registry for a different container', async () => {
        const mine = await initRegistry(dom.container, config('https://example.com/a.hic'))
        const theirs = await initRegistry(dom.another(), config('https://example.com/b.hic'))

        expect(theirs).not.toBe(mine)
        expect(mine.browsers[0].dataset.url).toBe('https://example.com/a.hic')
        expect(theirs.browsers[0].dataset.url).toBe('https://example.com/b.hic')
    })

    it('returns the same registry for a container initialized twice', async () => {
        const first = await initRegistry(dom.container, config('https://example.com/a.hic'))
        const second = await initRegistry(dom.container, config('https://example.com/b.hic'))

        expect(second).toBe(first)
        expect(second.browsers.map(browser => browser.dataset.url)).toEqual(['https://example.com/b.hic'])
    })
})

describe('init', () => {

    const dom = withContainers()
    withStubbedLoads()

    // The return type is contract for both known host apps -- ADR-0003 -- so it
    // is pinned in both shapes it has ever had.

    it('returns the single browser of a single-browser session', async () => {
        const returned = await init(dom.container, config('https://example.com/a.hic'))

        expect(Array.isArray(returned)).toBe(false)
        expect(returned).toBe(registryForContainer(dom.container).browsers[0])
    })

    it('returns the array of browsers of a multi-browser session', async () => {
        const returned = await init(dom.container, session('https://example.com/a.hic', 'https://example.com/b.hic'))

        expect(Array.isArray(returned)).toBe(true)
        expect(returned).toEqual(registryForContainer(dom.container).browsers)
    })

    it('returns what it just built, not what the page has since selected', async () => {
        const first = await init(dom.container, config('https://example.com/a.hic'))
        const second = await init(dom.another(), config('https://example.com/b.hic'))

        expect(first.dataset.url).toBe('https://example.com/a.hic')
        expect(second.dataset.url).toBe('https://example.com/b.hic')
    })

    it('hands back a browser whose registry is the one initRegistry returns', async () => {
        const browser = await init(dom.container, config('https://example.com/a.hic'))

        expect(browser.registry).toBe(registryForContainer(dom.container))
    })
})

describe('two embeds on one page -- #384', () => {

    const dom = withContainers()
    withStubbedLoads()

    it('leaves the first embed\'s DOM subtree standing when the second initializes', async () => {
        const other = dom.another()
        const mine = await initRegistry(dom.container, session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const mineRoots = mine.browsers.map(browser => browser.rootElement)

        const theirs = await initRegistry(other, config('https://example.com/c.hic'))

        expect(mineRoots.every(root => root.isConnected)).toBe(true)
        expect(mine.browsers).toHaveLength(2)
        expect(theirs.browsers).toHaveLength(1)
    })

    it('keeps the two embeds\' DOM subtrees disjoint', async () => {
        const other = dom.another()
        const mine = await initRegistry(dom.container, config('https://example.com/a.hic'))
        const theirs = await initRegistry(other, config('https://example.com/b.hic'))

        for (const browser of mine.browsers) {
            expect(dom.container.contains(browser.rootElement)).toBe(true)
            expect(other.contains(browser.rootElement)).toBe(false)
        }
        for (const browser of theirs.browsers) {
            expect(other.contains(browser.rootElement)).toBe(true)
            expect(dom.container.contains(browser.rootElement)).toBe(false)
        }
    })

    it('joins each embed\'s browsers into its own sync group and no further', async () => {
        // The second half of #384: `syncBrowsers()` used to cross-join every
        // browser on the page, so unrelated embeds panned each other.
        const mine = await initRegistry(dom.container, session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const theirs = await initRegistry(dom.another(), session('https://example.com/c.hic', 'https://example.com/d.hic'))

        const [a, b] = mine.browsers
        const [c, d] = theirs.browsers

        expect([...a.synchedBrowsers]).toEqual([b])
        expect([...b.synchedBrowsers]).toEqual([a])
        expect([...c.synchedBrowsers]).toEqual([d])
        expect([...d.synchedBrowsers]).toEqual([c])
    })

    it('propagates a pan to the embed\'s own browsers only', async () => {
        // Panning ends at `syncToOtherBrowsers`, which walks the sync group and
        // syncs each member. Which browsers it reaches is the whole claim; what
        // `syncState` then does to a browser needs a real dataset and has its
        // own tests.
        const mine = await initRegistry(dom.container, session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const theirs = await initRegistry(dom.another(), session('https://example.com/c.hic', 'https://example.com/d.hic'))

        const synced = []
        vi.spyOn(HICBrowser.prototype, 'syncState').mockImplementation(async function () {
            synced.push(this)
        })

        mine.browsers[0].syncToOtherBrowsers()

        expect(synced).toEqual([mine.browsers[1]])
        expect(synced.some(browser => theirs.browsers.includes(browser))).toBe(false)
    })

    it('leaves an embed unsynced from a browser deleted in the other embed', async () => {
        // Deleting reaches only the registry that owns the browser, so the
        // other embed's sync group is untouched.
        const mine = await initRegistry(dom.container, session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const theirs = await initRegistry(dom.another(), session('https://example.com/c.hic', 'https://example.com/d.hic'))

        theirs.delete(theirs.browsers[0])

        expect([...mine.browsers[0].synchedBrowsers]).toEqual([mine.browsers[1]])
        expect(theirs.browsers).toHaveLength(1)
        expect([...theirs.browsers[0].synchedBrowsers]).toEqual([])
    })
})

describe('registry lifecycle on real browsers', () => {

    const dom = withContainers()
    withStubbedLoads()

    /**
     * `test/testBrowserRegistry.js` drives the same lifecycle against
     * fabricated browsers, which is what keeps the registry constructible in
     * isolation. These are the counterpart: the browsers are real `HICBrowser`
     * instances built through `initRegistry`, so what is checked is that the
     * registry's contract still holds against the object it actually owns --
     * and that a browser one test builds does not survive into the next, which
     * is what no test could assume while the browser list was page-scoped.
     */

    it('starts every test with a registry nothing has leaked into', async () => {
        expect(registryForContainer(dom.container).browsers).toEqual([])

        await initRegistry(dom.container, config('https://example.com/a.hic'))

        expect(registryForContainer(dom.container).browsers).toHaveLength(1)
    })

    it('leaves nothing behind for the previous test to be seen by', () => {
        // Deliberately a repeat of the assertion above, and it fails if the
        // test before it leaked -- a registry is keyed by its container, and
        // each test builds a fresh one.
        expect(registryForContainer(dom.container).browsers).toEqual([])
        expect(registryForContainer(dom.container).currentBrowser).toBeUndefined()
    })

    it('selects a real browser and marks it in the DOM', async () => {
        const registry = await initRegistry(dom.container, session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const [first, second] = registry.browsers

        registry.select(second)

        expect(registry.currentBrowser).toBe(second)
        expect(second.rootElement.classList.contains('hic-root-selected')).toBe(true)
        expect(first.rootElement.classList.contains('hic-root-selected')).toBe(false)
    })

    it('falls selection through to a survivor when the current browser is deleted', async () => {
        const registry = await initRegistry(dom.container, session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const [outgoing, survivor] = registry.browsers

        registry.delete(outgoing)

        expect(registry.browsers).toEqual([survivor])
        expect(registry.currentBrowser).toBe(survivor)
        expect(outgoing.rootElement.isConnected).toBe(false)
    })

    it('takes the embed\'s DOM and selection down together', async () => {
        const registry = await initRegistry(dom.container, session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const roots = registry.browsers.map(browser => browser.rootElement)

        registry.deleteAll()

        expect(registry.browsers).toEqual([])
        expect(registry.currentBrowser).toBeUndefined()
        expect(roots.some(root => root.isConnected)).toBe(false)
    })

    it('updates every browser it owns and none it does not', async () => {
        const mine = await initRegistry(dom.container, session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const theirs = await initRegistry(dom.another(), config('https://example.com/c.hic'))

        const updated = []
        HICBrowser.prototype.update.mockImplementation(async function () {
            updated.push(this)
        })

        await mine.updateAll()

        expect(updated).toEqual(mine.browsers)
        expect(updated).not.toContain(theirs.browsers[0])
    })
})
