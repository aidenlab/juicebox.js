import {AlertDialog} from 'igv-ui'
import EventBus from './eventBus.js'
import HICEvent from './hicEvent.js'
import {pairSynchable} from './syncGroup.js'
import {expandSessionUrlShortcuts} from './urlUtils.js'
// A cycle, deliberately: `createBrowser.js` resolves its registry from a
// container, and `restoreSession` below needs browsers built. Neither module
// touches the other while it is being evaluated, so the cycle is inert -- and
// the alternative, letting the registry construct an `HICBrowser` itself, would
// break the rule that keeps it testable.
import {createBrowserList} from './createBrowser.js'

/**
 * The owner of one embed's browsers: the list, which of them is current, and
 * their sync group. See `CONTEXT.md` and `docs/adr/0004-browser-registry-per-container.md`.
 *
 * A registry never constructs a browser -- `js/createBrowser.js` does that and
 * hands the result over. The registry reads only four things off a browser:
 * `rootElement`, `browserPanelDeleteButton`, `synchedBrowsers` and `dispose()`.
 * That is what makes it constructible in a test. Nor does it tear one down:
 * `delete` and `deleteAll` call `dispose()`, and the browser gives its slot back.
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

    /**
     * Tear a browser down and give up its slot.
     *
     * The teardown itself is the browser's -- `dispose()` is the one path, per
     * ADR-0005 -- and it calls `evict` below on its way out. So this method is
     * one line, and `deleteAll` is the same line in a loop: two delete paths
     * that used to disagree about `unsyncSelf` and about the dialog outside
     * `rootElement` now cannot.
     */
    delete(browser) {
        browser.dispose()
    }

    deleteAll() {

        // Deselected first, and deliberately: `releaseSlot` falls the selection
        // through to a survivor, so disposing the current browser while others
        // are still queued to be disposed posts a `BrowserSelect` naming a
        // browser that is about to die. juicebox-web subscribes to that event,
        // and a restore opens with this method.
        this.select(undefined)

        // Over a copy: each dispose() releases its own slot from this list.
        for (const browser of [...this.browsers]) {
            browser.dispose()
        }

        // The postcondition, not the mechanism -- the loop above has already
        // emptied the list one slot at a time.
        this.clear()
    }

    /**
     * Give up a disposed browser's slot, falling the selection through to a
     * survivor.
     *
     * Internal, and the inbound half of `dispose()`: a browser tears itself
     * down and tells its registry, rather than the registry reaching into a
     * browser. Not declared surface -- a host deletes through `delete()`.
     *
     * Named for the slot rather than for eviction, because the glossary spends
     * *evict* on what a registry's own teardown does to the container map.
     */
    releaseSlot(browser) {
        this.browsers = this.browsers.filter(b => b !== browser)
        if (browser === this.currentBrowser) {
            this.select(this.browsers[0])
        }
        this.refreshDeleteButtonVisibility()
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
     * Serialize this embed as a session: its browsers, and the gene it has
     * selected.
     *
     * A session describes one embed, not the page. That is the whole point of
     * decision 5 of ADR-0004: the exported zero-argument `toJSON()` has no
     * container to resolve from and so follows the page-wide selection, but
     * what it resolves to is *a registry*, and everything in the document comes
     * from that one registry.
     */
    toJSON() {

        const json = {browsers: this.browsers.map(browser => browser.toJSON())}

        if (this.selectedGene) {
            json.selectedGene = this.selectedGene
        }

        return json
    }

    /**
     * Replace this embed's browsers with the ones a session names.
     *
     * The load-bearing half of #384: restoring is something one embed does to
     * itself, so the delete that opens it reaches only this registry's
     * browsers, and a host restoring into its second container keeps the first
     * one's DOM.
     *
     * The caption is not here -- it is a single page element outside every
     * container, so the exported `restoreSession` handles it. Everything else a
     * session carries belongs to one embed.
     */
    async restoreSession(session) {

        this.deleteAll()

        expandSessionUrlShortcuts(session)

        if (Object.hasOwn(session, 'selectedGene')) {
            this.selectedGene = session.selectedGene
        }

        await createBrowserList(this.container, session)

        if (false !== session.syncDatasets) {
            this.sync()
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

/**
 * The registry owning the page-wide current browser, and `undefined` before
 * anything has been selected.
 *
 * The resolution every zero-argument entry point makes: `getCurrentBrowser`,
 * `getAllBrowsers`, `setCurrentBrowser(undefined)` and `session.toJSON` all
 * have no container to resolve from and land here. Named once so the walk is
 * not written out at each of them -- and so the single-embed convenience they
 * share has a single place to be read about. See decision 4 of ADR-0004.
 */
function currentRegistry() {
    return mostRecentlySelectedBrowser?.registry
}

export default BrowserRegistry
export {registryForContainer, getMostRecentlySelectedBrowser, currentRegistry}
