import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {withDOM} from './utils/browserFixture.js'
import {deleteBrowser, deleteAllBrowsers, setCurrentBrowser, getCurrentBrowser} from '../js/createBrowser.js'

/**
 * Browser teardown -- see #414.
 *
 * #414 filed this as an event bus leak: "widget references stay live in
 * `eventBus.subscribers` for the lifetime of the page". That mechanism does not
 * hold. `this.eventBus = new EventBus()` is per browser, so the subscriber map
 * is collected with the browser -- and after the eight dead subscriptions were
 * removed, no internal object is in it at all.
 *
 * The retention the diagnosis was reaching for is one module up:
 * `createBrowser.js` holds the selected browser in `currentBrowser`, and
 * `deleteBrowser` never cleared it. Deleting the selected browser left a
 * detached browser and its whole DOM subtree reachable from module scope for
 * the lifetime of the page.
 *
 * It is also a correctness bug, and the sharper half: `getCurrentBrowser` is
 * exported from `js/index.js`, so a host could be handed a browser that has
 * been removed from the page.
 */

/**
 * A browser-shaped stand-in. deleteBrowser only needs these three members, and
 * a real HICBrowser would drag a map load in behind it.
 */
function stubBrowser(document) {
    const rootElement = document.createElement('div')
    document.body.appendChild(rootElement)
    return {
        rootElement,
        browserPanelDeleteButton: {style: {}},
        unsyncSelf: () => {}
    }
}

describe('deleteBrowser', () => {

    let fixture

    beforeEach(() => {
        fixture = withDOM()
    })

    afterEach(() => {
        setCurrentBrowser(undefined)
        fixture.restore()
    })

    it('stops pointing at a browser it just deleted', () => {
        const browser = stubBrowser(fixture.window.document)
        setCurrentBrowser(browser)
        expect(getCurrentBrowser()).toBe(browser)

        deleteBrowser(browser)

        expect(getCurrentBrowser()).toBeUndefined()
    })

    it('leaves a different current browser alone', () => {
        const current = stubBrowser(fixture.window.document)
        const other = stubBrowser(fixture.window.document)
        setCurrentBrowser(current)

        deleteBrowser(other)

        expect(getCurrentBrowser()).toBe(current)
    })

    it('takes the browser out of the document', () => {
        const browser = stubBrowser(fixture.window.document)
        setCurrentBrowser(browser)

        deleteBrowser(browser)

        expect(browser.rootElement.isConnected).toBe(false)
    })

    it('stops pointing at anything after deleting all browsers', () => {
        const browser = stubBrowser(fixture.window.document)
        setCurrentBrowser(browser)

        deleteAllBrowsers()

        expect(getCurrentBrowser()).toBeUndefined()
    })
})
