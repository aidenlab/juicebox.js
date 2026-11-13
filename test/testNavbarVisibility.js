import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import {resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import juicebox from '../js/index.js'
import HICBrowser from '../js/hicBrowser.js'
import {registryForContainer} from '../js/browserRegistry.js'
import EventBus from '../js/eventBus.js'
import {withContainers} from './utils/browserFixture.js'
import {withStubbedLoads} from './utils/stubbedLoads.js'
import {extractConfig} from '../js/urlUtils.js'

/**
 * A host hides and shows the navbar on every browser in a registry at once
 * (#745). The setting is the registry's, like the selected gene, so a browser
 * made while it is hidden comes up hidden and another embed is untouched.
 *
 * Read through the shipped stylesheet rather than a class name: hidden means
 * the navbar is not displayed and the root's `--nav-bar-height` -- the one
 * value both the root's and the content container's heights subtract (#746) --
 * is zero. jsdom does not resolve `calc()`, so the pixels were checked in a
 * real browser.
 */

// Out of process: sass mistakes test/setup.js's mocked `document` for a browser.
const stylesheet = execFileSync(process.execPath,
    [resolve(__dirname, '../node_modules/sass/sass.js'), '--no-source-map', resolve(__dirname, '../css/juicebox.scss')],
    {encoding: 'utf8'})

describe('navbar visibility', () => {

    const dom = withContainers()

    beforeEach(() => {
        const style = dom.window.document.createElement('style')
        style.textContent = stylesheet
        dom.window.document.head.appendChild(style)
    })

    function added(container) {
        const browser = new HICBrowser(container, {})
        registryForContainer(container).add(browser)
        return browser
    }

    function navbarShown(browser) {
        const navbar = browser.rootElement.querySelector('.hic-navbar-container')
        return dom.window.getComputedStyle(navbar).display !== 'none'
    }

    function navbarHeight(browser) {
        return dom.window.getComputedStyle(browser.rootElement).getPropertyValue('--nav-bar-height').trim()
    }

    // The registries live as long as their containers, and each test has fresh
    // ones; this only puts the page-wide answer back for the next suite.
    afterEach(() => {
        juicebox.setNavbarVisible(true)
        vi.restoreAllMocks()
    })

    it('is shown by default', () => {
        const browser = added(dom.container)

        expect(juicebox.isNavbarVisible()).toBe(true)
        expect(navbarShown(browser)).toBe(true)
        expect(navbarHeight(browser)).not.toBe('0px')
    })

    it('hides on every browser in the registry', () => {
        const browsers = [added(dom.container), added(dom.container)]

        juicebox.setNavbarVisible(false)

        expect(juicebox.isNavbarVisible()).toBe(false)
        for (const browser of browsers) {
            expect(navbarShown(browser)).toBe(false)
            expect(navbarHeight(browser)).toBe('0px')
        }
    })

    it('shows again exactly as before', () => {
        const browser = added(dom.container)
        const before = navbarHeight(browser)

        juicebox.setNavbarVisible(false)
        juicebox.setNavbarVisible(true)

        expect(navbarShown(browser)).toBe(true)
        expect(navbarHeight(browser)).toBe(before)
    })

    it('reaches a browser built while it is hidden', () => {
        added(dom.container)
        juicebox.setNavbarVisible(false)

        const later = added(dom.container)

        expect(navbarShown(later)).toBe(false)
    })

    it('reaches a browser hidden while it was still loading its map', async () => {
        // `createBrowser` constructs, awaits the load, and only then adds: a
        // set made in between finds the browser in no registry's list.
        const registry = added(dom.container).registry
        let finishLoad
        vi.spyOn(HICBrowser.prototype, 'init').mockImplementation(() => new Promise(resolve => finishLoad = resolve))

        const creating = juicebox.createBrowser(dom.container, {})
        registry.setNavbarVisible(false)
        finishLoad()
        const later = await creating

        expect(navbarShown(later)).toBe(false)
    })

    it('survives a reset, which rebuilds the root', () => {
        const browser = added(dom.container)
        juicebox.setNavbarVisible(false)

        browser.reset()

        expect(navbarShown(browser)).toBe(false)
    })

    it('leaves another registry on the page alone', () => {
        const other = added(dom.another())
        const browser = added(dom.container)

        juicebox.setNavbarVisible(false)

        expect(navbarShown(browser)).toBe(false)
        expect(navbarShown(other)).toBe(true)
        expect(other.registry.isNavbarVisible()).toBe(true)
    })

    describe('NavbarVisibilityChange', () => {

        const heard = []
        const listener = ({data}) => heard.push(data)

        beforeEach(() => {
            heard.length = 0
            EventBus.globalBus.subscribe('NavbarVisibilityChange', listener)
        })

        afterEach(() => EventBus.globalBus.unsubscribe('NavbarVisibilityChange', listener))

        it('is posted once per real change, naming the registry', () => {
            const browser = added(dom.container)

            juicebox.setNavbarVisible(false)
            juicebox.setNavbarVisible(true)

            expect(heard).toEqual([
                {registry: browser.registry, visible: false},
                {registry: browser.registry, visible: true}
            ])
        })

        it('is not posted by a set that changes nothing', () => {
            added(dom.container)

            juicebox.setNavbarVisible(true)
            juicebox.setNavbarVisible(false)
            juicebox.setNavbarVisible(false)

            expect(heard.map(({visible}) => visible)).toEqual([false])
        })
    })

    /**
     * A session records whether the navbar is shown, and restoring it shows
     * or hides it (#747). The field is the registry's, next to the selected
     * gene, and is always written (#754): a session saved while shown has to
     * show the navbar of a registry that hid it. One saved before #754 has no
     * field and leaves the setting alone. juicebox-mcp ADR-0009 records why it
     * rides in the session.
     */
    describe('in a session', () => {

        withStubbedLoads()

        const saved = {browsers: [{url: 'https://example.com/a.hic'}, {url: 'https://example.com/b.hic'}]}

        it('is recorded when hidden', async () => {
            const registry = registryForContainer(dom.container)
            await registry.restoreSession(structuredClone(saved))

            registry.setNavbarVisible(false)

            expect(registry.toJSON().navbarVisible).toBe(false)
        })

        it('is recorded when shown', async () => {
            const registry = registryForContainer(dom.container)
            await registry.restoreSession(structuredClone(saved))

            expect(registry.toJSON().navbarVisible).toBe(true)
        })

        it('shows a hidden registry from a session saved while shown', async () => {
            // A Page that starts hidden and joins a Room where the navbar is
            // shown restores the Room's session over its own setting. #754.
            const first = registryForContainer(dom.container)
            await first.restoreSession(structuredClone(saved))

            const second = registryForContainer(dom.another())
            second.setNavbarVisible(false)
            await second.restoreSession(first.toJSON())

            expect(second.isNavbarVisible()).toBe(true)
            expect(second.browsers.map(navbarShown)).toEqual([true, true])
        })

        it('hides every restored browser', async () => {
            const first = registryForContainer(dom.container)
            await first.restoreSession(structuredClone(saved))
            first.setNavbarVisible(false)

            const second = registryForContainer(dom.another())
            await second.restoreSession(first.toJSON())

            expect(second.isNavbarVisible()).toBe(false)
            expect(second.browsers).toHaveLength(2)
            for (const browser of second.browsers) {
                expect(navbarShown(browser)).toBe(false)
            }
        })

        it('stays shown after restoring a session without the field', async () => {
            const registry = registryForContainer(dom.container)

            await registry.restoreSession(structuredClone(saved))

            expect(registry.isNavbarVisible()).toBe(true)
            expect(registry.browsers.map(navbarShown)).toEqual([true, true])
        })

        it('is left alone by a session without the field', async () => {
            // Absent says nothing: a host that hid the navbar before `init`,
            // or restores a session it composed, keeps the navbar hidden.
            const registry = registryForContainer(dom.container)
            registry.setNavbarVisible(false)

            await registry.restoreSession(structuredClone(saved))

            expect(registry.isNavbarVisible()).toBe(false)
            expect(registry.browsers.map(navbarShown)).toEqual([false, false])
        })

        it('shows again from a session saying navbarVisible: true', async () => {
            const registry = registryForContainer(dom.container)
            registry.setNavbarVisible(false)

            await registry.restoreSession({...structuredClone(saved), navbarVisible: true})

            expect(registry.browsers.map(navbarShown)).toEqual([true, true])
        })

        it('posts NavbarVisibilityChange when the restore changes it, and only then', async () => {
            const heard = []
            const listener = ({data}) => heard.push(data.visible)
            EventBus.globalBus.subscribe('NavbarVisibilityChange', listener)
            try {
                const registry = registryForContainer(dom.container)
                const hidden = {...saved, navbarVisible: false}
                const shown = {...saved, navbarVisible: true}

                await registry.restoreSession(structuredClone(hidden))
                await registry.restoreSession(structuredClone(hidden))
                await registry.restoreSession(structuredClone(saved))
                await registry.restoreSession(structuredClone(shown))
                await registry.restoreSession(structuredClone(shown))

                expect(heard).toEqual([false, true])
            } finally {
                EventBus.globalBus.unsubscribe('NavbarVisibilityChange', listener)
            }
        })

        /**
         * The restore deletes every browser and selects one only after all of
         * them have loaded, so for the whole load no browser is current. The
         * navbar is the registry's, and the page-wide entries still reach it.
         * A Page joining a Room is restoring when its Header button is
         * clicked. #758.
         */
        describe('while restoring', () => {

            function restoringSlowly(registry, session) {
                const finishes = []
                vi.spyOn(HICBrowser.prototype, 'init').mockImplementation(() => new Promise(resolve => finishes.push(resolve)))
                const restoring = registry.restoreSession(session)
                return async () => {
                    finishes.forEach(finish => finish())
                    await restoring
                }
            }

            it('reports what the restore set', async () => {
                const registry = registryForContainer(dom.container)
                await registry.restoreSession(structuredClone(saved))
                registry.select(registry.browsers[0])

                const finish = restoringSlowly(registry, {...structuredClone(saved), navbarVisible: false})

                expect(juicebox.getCurrentBrowser()).toBeUndefined()
                expect(juicebox.isNavbarVisible()).toBe(false)
                await finish()
            })

            it('hides and posts NavbarVisibilityChange', async () => {
                const registry = registryForContainer(dom.container)
                await registry.restoreSession(structuredClone(saved))
                registry.select(registry.browsers[0])

                const heard = []
                const listener = ({data}) => heard.push(data)
                EventBus.globalBus.subscribe('NavbarVisibilityChange', listener)
                try {
                    const finish = restoringSlowly(registry, structuredClone(saved))

                    juicebox.setNavbarVisible(false)

                    expect(juicebox.isNavbarVisible()).toBe(false)
                    expect(heard).toEqual([{registry, visible: false}])

                    await finish()
                    expect(registry.browsers.map(navbarShown)).toEqual([false, false])
                } finally {
                    EventBus.globalBus.unsubscribe('NavbarVisibilityChange', listener)
                }
            })

            it('reaches the registry of a first restore, with nothing ever selected', async () => {
                const registry = registryForContainer(dom.container)

                const finish = restoringSlowly(registry, structuredClone(saved))
                juicebox.setNavbarVisible(false)
                await finish()

                expect(registry.isNavbarVisible()).toBe(false)
                expect(registry.browsers.map(navbarShown)).toEqual([false, false])
            })
        })

        it('survives the compressed ?session= form', async () => {
            const first = registryForContainer(dom.container)
            await first.restoreSession(structuredClone(saved))
            first.select(first.browsers[0])
            first.setNavbarVisible(false)

            // Through the share link's own reader, as a host restoring
            // `?session=` from its address bar does.
            const decoded = await extractConfig(`http://localhost/juicebox/?${juicebox.compressedSession()}`)

            expect(decoded.navbarVisible).toBe(false)

            const second = registryForContainer(dom.another())
            await second.restoreSession(decoded)

            expect(second.isNavbarVisible()).toBe(false)
            expect(second.browsers.map(navbarShown)).toEqual([false, false])
        })
    })
})
