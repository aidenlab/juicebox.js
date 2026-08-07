import EventBus from './eventBus.js'
import HICEvent from './hicEvent.js'
import {pairSynchable} from './syncGroup.js'

/**
 * The owner of one embed's browsers: the list, which of them is current, and
 * their sync group. See `CONTEXT.md` and `docs/adr/0004-browser-registry-per-container.md`.
 *
 * A registry never constructs a browser -- `js/createBrowser.js` does that and
 * hands the result over. The registry reads only four things off a browser:
 * `rootElement`, `browserPanelDeleteButton`, `synchedBrowsers` and
 * `unsyncSelf()`. That is what makes it constructible in a test.
 *
 * There is still exactly one registry per page (#478 is the lift; keying
 * registries by container element is decisions 2 and 8 of the ADR, and lands
 * separately), so nothing here is yet reachable twice on one page.
 *
 * Two things the ADR calls for are deliberately absent, because #478 is a lift
 * and may not change observable behaviour:
 *
 * - selection does not fall through on delete, so `currentBrowser` can still
 *   name a browser that has left the DOM. That is #475, ADR decision 7.
 * - the sync group is still each browser's own `synchedBrowsers` set. What the
 *   registry owns is the *membership rule*: whose browsers get paired.
 */
class BrowserRegistry {

    constructor() {
        this.browsers = []
        this.currentBrowser = undefined
    }

    /**
     * Take ownership of a browser, without selecting it.
     *
     * The session path registers each browser *before* initializing it,
     * because loading a dataset consults the registry (`HICBrowser.unsyncSelf`,
     * `dataLoader`). Its delete button does not exist yet, so visibility is not
     * settled here; that path calls `refreshDeleteButtonVisibility` once
     * initialization has finished.
     */
    register(browser) {
        this.browsers.push(browser)
    }

    /**
     * Take ownership of a fully initialized browser and select it.
     */
    add(browser) {
        this.register(browser)
        this.select(browser)
        this.refreshDeleteButtonVisibility()
    }

    /**
     * Give up the browsers without tearing them down -- the opposite of
     * `deleteAll`, which removes their DOM. The session path clears before
     * rebuilding, its previous browsers having already been deleted.
     */
    clear() {
        this.browsers = []
    }

    /**
     * Make `browser` the current one, or clear the selection when given
     * `undefined`. Posts `BrowserSelect` only on a real transition to a
     * browser, which is the contract juicebox-web subscribes to.
     */
    select(browser) {

        if (browser === undefined) {
            this.currentBrowser?.rootElement.classList.remove('hic-root-selected')
            this.currentBrowser = undefined
            return
        }

        if (browser !== this.currentBrowser) {
            this.currentBrowser?.rootElement.classList.remove('hic-root-selected')
            browser.rootElement.classList.add('hic-root-selected')
            this.currentBrowser = browser
            EventBus.globalBus.post(HICEvent("BrowserSelect", browser))
        }
    }

    delete(browser) {
        browser.unsyncSelf()
        browser.rootElement.remove()
        this.browsers = this.browsers.filter(b => b !== browser)
        this.refreshDeleteButtonVisibility()
    }

    deleteAll() {
        for (const browser of this.browsers) {
            browser.rootElement.remove()
        }
        this.clear()
    }

    async updateAll() {
        for (const browser of this.browsers) {
            await browser.update()
        }
    }

    /**
     * Join the compatible browsers into each other's sync group. Defaults to
     * this registry's browsers; an explicit list is how a caller syncs a subset
     * (and, per decision 6 of the ADR, how a cross-registry group would later
     * be expressed).
     */
    sync(browsers) {
        for (const [b1, b2] of pairSynchable(browsers || this.browsers)) {
            b1.synchedBrowsers.add(b2)
            b2.synchedBrowsers.add(b1)
        }
    }

    /**
     * A browser can only be deleted while it has a sibling, so the button is
     * visible exactly when the registry holds more than one browser.
     */
    refreshDeleteButtonVisibility() {
        const display = this.browsers.length > 1 ? 'block' : 'none'
        for (const browser of this.browsers) {
            browser.browserPanelDeleteButton.style.display = display
        }
    }
}

export default BrowserRegistry
