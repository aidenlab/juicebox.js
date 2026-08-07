import {AlertDialog} from 'igv-ui'
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
 * One registry owns one container element; `registryForContainer` below is how
 * every entry point finds the right one.
 *
 * The registry holds the invariant *a non-empty registry has a current
 * browser*: deleting the current one falls selection through to a survivor, and
 * `currentBrowser` is `undefined` only while the registry is empty. Decision 7.
 *
 * One thing the ADR calls for is still absent: the sync group is each browser's
 * own `synchedBrowsers` set. What the registry owns is the *membership rule*:
 * whose browsers get paired.
 *
 * It is also where the two page-scoped singletons that were plainly per-embed
 * have landed: the selected gene and the alert dialog. See #481.
 */
class BrowserRegistry {

    /**
     * @param {Element} [container] - the host element this registry owns.
     *   Absent only in tests that exercise the registry without a document.
     */
    constructor(container) {
        this.container = container
        this.browsers = []
        this.currentBrowser = undefined

        /**
         * The gene a search last resolved to, or a restored session last named.
         *
         * Per registry rather than page-wide because it is serialized *per
         * session*: two embeds restoring different sessions have different
         * selected genes, and the module-level `Globals.selectedGene` gave them
         * one. #481.
         */
        this.selectedGene = undefined

        // Built on first alert rather than in the constructor: constructing a
        // registry must not put a dialog in the host's element.
        this.alertDialog = undefined
    }

    /**
     * Show `alert` in this embed's own dialog.
     *
     * igv-ui's `Alert` singleton is re-bound to a container on every
     * initialization, so the last embed to initialize captured every other
     * embed's alerts. Each registry owns an `AlertDialog` in the container it
     * owns instead. #481.
     */
    presentAlert(alert, callback) {
        this.alertDialog ??= new AlertDialog(this.container ?? document.body)
        this.alertDialog.present(alert, callback)
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
            if (mostRecentlySelectedBrowser === this.currentBrowser) {
                mostRecentlySelectedBrowser = undefined
            }
            this.currentBrowser?.rootElement.classList.remove('hic-root-selected')
            this.currentBrowser = undefined
            return
        }

        // Outside the transition check below: a browser already current in its
        // own registry is not necessarily the last one selected page-wide.
        mostRecentlySelectedBrowser = browser

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
        if (browser === this.currentBrowser) {
            this.select(this.browsers[0])
        }
        this.refreshDeleteButtonVisibility()
    }

    deleteAll() {
        for (const browser of this.browsers) {
            browser.rootElement.remove()
        }
        this.clear()
        this.select(undefined)
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

/**
 * Every registry on the page, keyed by the container element it owns.
 *
 * A `WeakMap` rather than a property on the container, per decision 8 of the
 * ADR: the host owns that element, and juicebox writes nothing onto it. The
 * weak key also means a host that drops its container drops the registry with
 * it, without juicebox having to be told.
 */
const registriesByContainer = new WeakMap()

/**
 * The browser most recently handed to any registry's `select`, page-wide.
 *
 * This is what the old module-level `currentBrowser` in `createBrowser.js`
 * always was -- "whoever `setCurrentBrowser` last received, from anywhere" --
 * and keeping it byte-for-byte is what lets `getCurrentBrowser()` survive the
 * move to per-container registries unchanged. See decision 4.
 */
let mostRecentlySelectedBrowser

/**
 * The registry owning `container`, created on first ask.
 *
 * Every entry point into juicebox resolves its registry through here, so
 * calling in twice with the same element finds the same registry -- which is
 * what makes a second `init()` on one container replace its contents rather
 * than open a rival embed. A different element gets a different registry, which
 * is #384. Decision 2.
 */
function registryForContainer(container) {

    let registry = registriesByContainer.get(container)

    if (undefined === registry) {
        registry = new BrowserRegistry(container)
        registriesByContainer.set(container, registry)
    }

    return registry
}

function getMostRecentlySelectedBrowser() {
    return mostRecentlySelectedBrowser
}

export default BrowserRegistry
export {registryForContainer, getMostRecentlySelectedBrowser}
