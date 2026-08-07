import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import BrowserRegistry, {registryForContainer} from '../js/browserRegistry.js'
import {getAllBrowsers, getCurrentBrowser, setCurrentBrowser} from '../js/createBrowser.js'
import HICBrowser from '../js/hicBrowser.js'
import {withDOM} from './utils/browserFixture.js'

/**
 * Finding a registry by its container element -- #479, decisions 2, 4, 8 and 9
 * of ADR-0004.
 *
 * These are the tests for the step the ADR calls the riskiest: keying registries
 * by container while the module-level functions keep delegating. A mistake there
 * changes what a host's `getAllBrowsers()` returns with nothing failing, so what
 * is asserted here is precisely the resolution policy -- which registry each
 * entry point lands on -- rather than anything about browsers themselves.
 *
 * Real elements, not plain objects: one of the promises being kept is that
 * juicebox writes nothing onto an element the host owns, and only a real element
 * can be inspected for that.
 */

/**
 * A JSDOM around each test in the calling describe, exposing the container the
 * fixture makes and a way to make more of them. Returns a holder rather than
 * the elements, which do not exist until `beforeEach` runs.
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

function fakeBrowser(name, registry) {
    const classes = new Set()
    return {
        name,
        registry,
        rootElement: {
            classList: {
                add: item => classes.add(item),
                remove: item => classes.delete(item)
            },
            remove: () => {
            }
        },
        browserPanelDeleteButton: {style: {display: 'none'}},
        synchedBrowsers: new Set(),
        unsyncSelf: () => {
        }
    }
}

describe('registryForContainer', () => {

    const dom = withContainers()

    it('hands back the same registry for the same container', () => {
        expect(registryForContainer(dom.container)).toBe(registryForContainer(dom.container))
    })

    it('hands back a registry', () => {
        expect(registryForContainer(dom.container)).toBeInstanceOf(BrowserRegistry)
    })

    it('hands back a different registry for a different container', () => {
        expect(registryForContainer(dom.container)).not.toBe(registryForContainer(dom.another()))
    })

    it('writes nothing onto the container element', () => {
        // The host owns that element. The registry is reached through a
        // module-level WeakMap precisely so nothing is stamped on it.
        const before = Object.getOwnPropertyNames(dom.container)
        registryForContainer(dom.container)
        expect(Object.getOwnPropertyNames(dom.container)).toEqual(before)
    })

    it('keeps two containers\' browser lists independent', () => {
        const one = registryForContainer(dom.container)
        const two = registryForContainer(dom.another())

        one.add(fakeBrowser('a', one))
        two.add(fakeBrowser('b', two))

        expect(one.browsers.map(browser => browser.name)).toEqual(['a'])
        expect(two.browsers.map(browser => browser.name)).toEqual(['b'])
    })

    it('keeps two containers\' current-browser pointers independent', () => {
        const one = registryForContainer(dom.container)
        const two = registryForContainer(dom.another())

        const a = fakeBrowser('a', one)
        const b = fakeBrowser('b', two)
        one.add(a)
        two.add(b)

        expect(one.currentBrowser).toBe(a)
        expect(two.currentBrowser).toBe(b)
    })
})

describe('registry back-pointer', () => {

    const dom = withContainers()

    it('is set on construction', () => {
        // Declared surface, per decision 9 -- `setCurrentBrowser(browser)`
        // resolves through it, so it cannot be absent at any point in a
        // browser's life, including during the `init()` that loads its dataset.
        const browser = new HICBrowser(dom.container, {})
        expect(browser.registry).toBe(registryForContainer(dom.container))
    })

    it('points two browsers in one container at one registry', () => {
        const first = new HICBrowser(dom.container, {})
        const second = new HICBrowser(dom.container, {})
        expect(first.registry).toBe(second.registry)
    })

    it('points browsers in different containers at different registries', () => {
        const first = new HICBrowser(dom.container, {})
        const second = new HICBrowser(dom.another(), {})
        expect(first.registry).not.toBe(second.registry)
    })
})

describe('the browser panel, driven through its own DOM handlers', () => {

    // The three gestures juicebox-web depends on -- select a panel, delete a
    // panel, open a second one -- exercised through the click handlers
    // `layoutController` wires, so what is under test is the whole route from
    // event to registry, not a hand-called module function.

    const dom = withContainers()

    function click(element) {
        element.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true}))
    }

    function navbarOf(browser) {
        return browser.rootElement.querySelector('.hic-navbar-container')
    }

    it('selects the browser whose navbar was clicked', () => {
        const registry = registryForContainer(dom.container)
        const first = new HICBrowser(dom.container, {})
        const second = new HICBrowser(dom.container, {})
        registry.add(first)
        registry.add(second)

        click(navbarOf(first))

        expect(getCurrentBrowser()).toBe(first)
        expect(registry.currentBrowser).toBe(first)
    })

    it('deletes the browser whose delete button was clicked', () => {
        const registry = registryForContainer(dom.container)
        const first = new HICBrowser(dom.container, {})
        const second = new HICBrowser(dom.container, {})
        registry.add(first)
        registry.add(second)

        click(second.browserPanelDeleteButton)

        expect(registry.browsers).toEqual([first])
    })

    it('leaves a second container untouched by either gesture', () => {
        // The whole point of #479: juicebox-web's panel gestures must not reach
        // across into another embed's list.
        const mine = new HICBrowser(dom.container, {})
        const theirs = new HICBrowser(dom.another(), {})
        mine.registry.add(mine)
        theirs.registry.add(theirs)

        click(navbarOf(mine))
        expect(theirs.registry.currentBrowser).toBe(theirs)

        click(mine.browserPanelDeleteButton)
        expect(theirs.registry.browsers).toEqual([theirs])
    })
})

describe('the zero-argument getters', () => {

    const dom = withContainers()

    function twoRegistries() {
        return [registryForContainer(dom.container), registryForContainer(dom.another())]
    }

    it('reports the most recently selected browser page-wide', () => {
        // Today's semantics exactly: module `currentBrowser` was only ever
        // "whoever setCurrentBrowser last received, from anywhere".
        const [one, two] = twoRegistries()
        const a = fakeBrowser('a', one)
        const b = fakeBrowser('b', two)

        setCurrentBrowser(a)
        expect(getCurrentBrowser()).toBe(a)

        setCurrentBrowser(b)
        expect(getCurrentBrowser()).toBe(b)
    })

    it('reports the browsers of the registry owning the current browser', () => {
        const [one, two] = twoRegistries()
        const a = fakeBrowser('a', one)
        const b = fakeBrowser('b', two)
        one.register(a)
        two.register(b)

        setCurrentBrowser(a)
        expect(getAllBrowsers()).toEqual([a])

        setCurrentBrowser(b)
        expect(getAllBrowsers()).toEqual([b])
    })

    it('clears the selection when setCurrentBrowser is given undefined', () => {
        // A published export, and `select` has always documented the undefined
        // case. There is no `browser.registry` to resolve through here, so the
        // page-wide pointer is what names the registry to clear.
        const [one] = twoRegistries()
        const a = fakeBrowser('a', one)

        setCurrentBrowser(a)
        setCurrentBrowser(undefined)

        expect(getCurrentBrowser()).toBeUndefined()
        expect(one.currentBrowser).toBeUndefined()
    })

    it('clears nothing when setCurrentBrowser is given undefined with no selection', () => {
        setCurrentBrowser(undefined)
        expect(() => setCurrentBrowser(undefined)).not.toThrow()
    })

    it('re-selecting an already-current browser still moves the page-wide pointer', () => {
        // `select` short-circuits when the browser is already its registry's
        // current one. The page-wide pointer must move anyway, or a host that
        // clicks back into the embed it started in gets the other embed.
        const [one, two] = twoRegistries()
        const a = fakeBrowser('a', one)
        const b = fakeBrowser('b', two)

        setCurrentBrowser(a)
        setCurrentBrowser(b)
        setCurrentBrowser(a)

        expect(getCurrentBrowser()).toBe(a)
    })
})
