import {describe, it, expect, vi} from 'vitest'
import HICBrowser from '../js/hicBrowser.js'
import {registryForContainer} from '../js/browserRegistry.js'
import EventBus from '../js/eventBus.js'
import {withContainers} from './utils/browserFixture.js'
import {withStubbedLoads} from './utils/stubbedLoads.js'

/**
 * `reset()` as dispose-then-construct on the same instance -- #494, decisions 1
 * and 3 of ADR-0005.
 *
 * Everything here is an identity claim. `reset()` has no callers inside this
 * repo: juicebox-web holds one reference across three lines and hands it
 * onward, so the object, its `id`, its registry slot, its place among its
 * siblings and its selection have to come out the far side of a reset
 * unchanged. That is what makes the candidate non-breaking, and it is the only
 * thing these tests are about -- the *contents* being fresh is `dispose()`'s
 * and the constructor's business, and testBrowserDispose.js covers it.
 */

/** What one live browser contributes to its container: root element + dialog. */
const NODES_PER_LIVE_BROWSER = 2

const roots = container => [...container.children].filter(element => element.classList.contains('hic-root'))

/** A registered, selected browser -- the state a host's reference is taken from. */
function registered(container) {
    const registry = registryForContainer(container)
    const browser = new HICBrowser(container, {})
    registry.add(browser)
    return {registry, browser}
}

describe('HICBrowser.reset', () => {

    const dom = withContainers()
    withStubbedLoads()

    it('keeps the object, its id and its registry slot', () => {
        const {registry, browser} = registered(dom.container)
        const id = browser.id

        browser.reset()

        expect(browser.id).toBe(id)
        expect(registry.browsers).toEqual([browser])
        expect(registry.currentBrowser).toBe(browser)
    })

    it('rebuilds its DOM under the id it kept', () => {
        // The ids of the elements inside `rootElement` are minted from
        // `browser.id` during construction, so reconstructing under a fresh one
        // and renaming the browser afterwards would leave the browser called
        // something its own markup has never heard of.
        const {browser} = registered(dom.container)

        browser.reset()

        expect(browser.rootElement.querySelector(`[id^="${browser.id}"]`)).not.toBeNull()
    })

    it('leaves the browser usable -- the juicebox-web sequence', async () => {
        // const browser = hic.getCurrentBrowser(); browser.reset();
        // await browser.loadHicFile(config); enableIfMapLoaded(browser)
        // One reference, three lines, then handed onward.
        const {registry, browser} = registered(dom.container)

        browser.reset()
        await browser.loadHicFile({url: 'https://example.com/a.hic'})

        expect(browser.dataset.url).toBe('https://example.com/a.hic')
        expect(browser.state).toBeDefined()
        expect(registry.currentBrowser).toBe(browser)
    })

    it('rebuilds rather than reuses -- the widgets are new', () => {
        const {browser} = registered(dom.container)
        const contactMatrixView = browser.contactMatrixView

        browser.reset()

        expect(browser.contactMatrixView).not.toBe(contactMatrixView)
        expect(browser.rootElement.isConnected).toBe(true)
    })

    it('installs a new State object rather than mutating the old one', async () => {
        // Decision 2's failure mode is invisible: #469's abandonment check is
        // identity-based, so a repaint pass in flight over a browser being
        // rebuilt is only stopped if the State object it started from is gone.
        const {browser} = registered(dom.container)
        await browser.loadHicFile({url: 'https://example.com/a.hic'})
        const state = browser.state

        browser.reset()

        expect(browser.state).not.toBe(state)
    })

    it('holds its position among its siblings', () => {
        // rootElement is appended, so sibling order is insertion order: a naive
        // dispose-then-construct on the first of two panels re-appends it last
        // and the panels visibly swap. Decision 3.
        const {browser: first} = registered(dom.container)
        const {browser: second} = registered(dom.container)

        first.reset()

        expect(roots(dom.container)).toEqual([first.rootElement, second.rootElement])
    })

    it('leaves the selection where it found it', () => {
        const {registry, browser: first} = registered(dom.container)
        const {browser: second} = registered(dom.container)

        first.reset()

        expect(registry.browsers).toEqual([first, second])
        expect(registry.currentBrowser).toBe(second)
    })

    it('announces no selection change, because there is none', () => {
        // dispose() falls the selection through to a survivor, which would post
        // a BrowserSelect naming a sibling and then another naming this browser
        // again. juicebox-web subscribes to that event, and nothing about which
        // browser is selected has changed.
        const {browser} = registered(dom.container)
        registered(dom.container)
        const selections = []
        const handler = event => selections.push(event.data)
        EventBus.globalBus.subscribe('BrowserSelect', handler)

        try {
            browser.reset()
            expect(selections).toEqual([])
        } finally {
            EventBus.globalBus.unsubscribe('BrowserSelect', handler)
        }
    })

    it('keeps the current browser marked as such in the DOM', () => {
        const {registry, browser} = registered(dom.container)

        browser.reset()

        expect(browser.rootElement.classList.contains('hic-root-selected')).toBe(true)
        expect(registry.currentBrowser).toBe(browser)
    })

    it('leaves no orphans behind, however many times it runs', () => {
        const {registry, browser} = registered(dom.container)

        for (let cycle = 0; cycle < 3; cycle++) {
            browser.reset()
        }

        expect(dom.container.children.length).toBe(NODES_PER_LIVE_BROWSER)

        registry.delete(browser)
        expect(dom.container.children.length).toBe(0)
    })

    it('tears down through dispose() -- there is no fifth teardown verb', () => {
        const {browser} = registered(dom.container)
        const dispose = vi.spyOn(browser, 'dispose')

        browser.reset()

        expect(dispose).toHaveBeenCalledTimes(1)
        dispose.mockRestore()
    })

    it('leaves a browser that can still be disposed', () => {
        const {registry, browser} = registered(dom.container)

        browser.reset()
        browser.dispose()

        expect(registry.browsers).toEqual([])
        expect(dom.container.children.length).toBe(0)
    })

    it('drops the custom crosshairs handler the host installed', () => {
        // A reconstructed browser is a newly constructed browser: the handler
        // closes over the view it was given, and that view is gone.
        const {browser} = registered(dom.container)
        browser.setCustomCrosshairsHandler(() => undefined)

        browser.reset()

        expect(browser.customCrosshairsHandler).toBeUndefined()
    })

    it('does not accumulate document-level gesture handlers', () => {
        // Reconstruction builds a second contact matrix view over the same
        // document. Its keyup handler posts DidHideCrosshairs -- which
        // Spacewalk subscribes to -- so a leaked one is a duplicate event per
        // reset the browser has ever had.
        const {browser} = registered(dom.container)
        const view = browser.contactMatrixView
        view.addMouseHandlers(view.viewportElement)
        const installed = [...view.documentListeners]
        const removed = vi.spyOn(document, 'removeEventListener')

        browser.reset()

        expect(installed.length).toBeGreaterThan(0)
        for (const [type, handler] of installed) {
            expect(removed).toHaveBeenCalledWith(type, handler)
        }
        expect(view.documentListeners).toEqual([])
        removed.mockRestore()
    })

    it('keeps its peers unsynced', () => {
        // reset() unsyncs, as it always has: the browser stays on the page, so
        // the registry re-pairs it on the next sync().
        const {registry, browser: first} = registered(dom.container)
        const {browser: second} = registered(dom.container)
        registry.sync()

        first.reset()

        expect([...second.synchedBrowsers]).toEqual([])
        expect([...first.synchedBrowsers]).toEqual([])
    })

    it('clears the dataset it was showing', async () => {
        const {browser} = registered(dom.container)
        await browser.loadHicFile({url: 'https://example.com/a.hic'})

        browser.reset()

        expect(browser.dataset).toBeUndefined()
        expect(browser.contactMapLabel.textContent).toBe('')
    })
})
