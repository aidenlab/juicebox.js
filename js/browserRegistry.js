import {AlertDialog} from 'igv-ui'
import EventBus from './eventBus.js'
import HICEvent from './hicEvent.js'
import {pairSynchable, isolationReasons} from './syncGroup.js'
import {fanOutTracks, fanOutMap, fanOutControlMap} from './targetGroup.js'
import {normalizeSession} from './normalizeSession.js'
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
 * hands the result over. The registry reads only five things off a browser:
 * `rootElement`, `browserPanelDeleteButton`, `synchedBrowsers`,
 * `setIsolationReason()` and `dispose()` -- plus what the membership rules in
 * `syncGroup.js` read. That is what makes it constructible in a test. Nor does it tear one down:
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
     * The browsers the user has explicitly aimed a load at, as a set of
     * references. Private, and read only through `targetedBrowsers` below: what
     * a caller gets is the *resolved* set, derived from `browsers` on every
     * ask, so a browser that has left the registry cannot linger in it.
     *
     * The current browser **is** in here while an aim is in progress, even
     * though it would be targeted implicitly anyway. That redundancy is
     * load-bearing: an empty set is how `toggleTarget` knows the next
     * shift-click is starting a *new* aim rather than adding to one, which is
     * what makes the first click of an aim the one that selects.
     */
    #targeted = new Set()

    /**
     * Depth of the `#announce` wrapper below, so that a mutation which runs
     * another one inside it -- `releaseSlot` falling the selection through to a
     * survivor -- posts one `BrowserTargetChange` for the whole gesture rather
     * than one per nested step.
     */
    #announceDepth = 0

    #announceBefore = []

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
        // A browser arriving with its map already loaded -- `createBrowser`
        // loads before it hands over -- changes the open maps, and the load's
        // own recompute ran while this one was not yet in the list. #635.
        this.sync()
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
        // The aim goes with them. `targetedBrowsers` filters over `browsers`, so
        // leaving these behind would be invisible -- and invisible is exactly
        // the wrong thing to be holding references to browsers that are on
        // their way to being disposed.
        this.#targeted.clear()
    }

    /**
     * Make `browser` the current one, or clear the selection when given
     * `undefined`. Posts `BrowserSelect` only on a real transition to a
     * browser, which is the contract juicebox-web subscribes to.
     *
     * A browser this registry does not own is ignored, not an error -- see
     * `#select`.
     */
    select(browser) {
        this.#announce(() => this.#select(browser))
    }

    #select(browser) {

        // A browser this registry does not own -- one already deleted, above
        // all -- can never become current. The membership check is here rather
        // than only at the callers because this is the one door: `select`,
        // `retarget`, `toggleTarget` and `releaseSlot` all come through it, and
        // the invariant *the current browser is one of `browsers`* should not
        // depend on each of them remembering. A stray click that lands after a
        // delete is the case that made this necessary. #619.
        if (browser !== undefined && !this.browsers.includes(browser)) {
            return
        }

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
     * The browsers a *load* reaches: the current one, plus everything the user
     * has explicitly aimed at.
     *
     * NOTE: public API function
     *
     * A getter returning an array rather than a stored list, computed over
     * `browsers` on every ask, so it cannot drift out of sync with them: a
     * browser that has been deleted is gone from here whether or not anything
     * remembered to say so. In registry order, which is panel order.
     *
     * **The current browser is implicitly targeted.** So with nothing
     * explicitly aimed at, this is `[currentBrowser]` and a fan-out behaves
     * exactly as a single-browser load does today. That is what makes the
     * feature opt-in at the gesture rather than at the call site.
     *
     * A target set is *not* a sync group -- see `js/targetGroup.js` and
     * `docs/adr/0015`.
     */
    get targetedBrowsers() {
        return this.browsers.filter(browser => browser === this.currentBrowser || this.#targeted.has(browser))
    }

    /**
     * Put `browser` in the target set, or take it out. The single mutator: one
     * gesture -- shift-click on a panel's navbar -- and one method, rather than
     * a `target`/`untarget` pair no gesture asks for.
     *
     * NOTE: public API function
     *
     * Shift-clicking the current browser is a no-op, because the current
     * browser is targeted implicitly and there is no state in which it is not.
     * Returning early rather than adding it keeps that honest: recording it
     * would make it explicitly targeted, and it would then stay in the set
     * after it stopped being current, which is not what the user's shift-click
     * meant.
     *
     * The way *back* from a large target set is a plain click, which re-aims at
     * one browser -- see `retarget`.
     */
    toggleTarget(browser) {

        // A browser this registry does not own has no slot in its aim, and
        // recording one would be the retained reference `releaseSlot` exists to
        // avoid -- `targetedBrowsers` filters it out, so it would never be seen
        // again either.
        if (!this.browsers.includes(browser)) {
            return
        }

        this.#announce(() => {

            // The first shift-click of a new aim also **selects**. The load is
            // issued from the current browser, and the current browser is the
            // track's genome declaration (`js/targetGroup.js`), so without this
            // an aim inherits its genome from whichever panel happened to be
            // current -- typically the last one built, which the user never
            // touched. The panels they actually aimed at are then reported as
            // `genome-mismatch` and the track lands in the one panel they did
            // not choose. Selecting here makes the browser the aim *starts*
            // from the browser it is measured against.
            //
            // Semantically odd -- a gesture named for targeting also moves the
            // selection -- and deliberate: the alternative is an aim whose
            // origin the user cannot see or set.
            if (0 === this.#targeted.size) {
                this.#targeted.add(browser)
                this.#select(browser)
                return
            }

            // Every later click just joins or leaves. The selection does not
            // move again, so the aim keeps the origin its first click set.
            if (!this.#targeted.delete(browser)) {
                this.#targeted.add(browser)
            }
        })
    }

    /**
     * Load `configs` into every targeted browser at once, and report what
     * happened.
     *
     * NOTE: public API function
     *
     * The rules live in `js/targetGroup.js`; this is the registry-shaped door
     * to them. The **originating** browser is the current one: the menu a track
     * came from was built for whatever browser the widgets are reading, and
     * that browser is therefore the track's genome declaration.
     *
     * Raises no alert of its own. The caller reports the summary -- one report
     * per gesture, on whatever notification surface the host has.
     *
     * @param {Array<Object>} configs - track configs, as `loadTracks` takes them
     * @returns {Promise<{loaded: Array, failed: Array, skipped: Array}>}
     */
    async loadTracksIntoTargets(configs) {
        return fanOutTracks(this.currentBrowser, this.targetedBrowsers, configs)
    }

    /**
     * Load one map into every targeted browser, one after another, and report
     * what happened: the primary broadcast (#680).
     *
     * NOTE: public API function
     *
     * Named for the browser door it multiplies, as `loadTracksIntoTargets` is.
     * The rules live in `fanOutMap` in `js/targetGroup.js`: no origin, no
     * skips, serial. A panel whose genome the map replaces loses its tracks,
     * as in a single-panel load (#682, ADR-0019).
     *
     * Raises no alert of its own, including for a bot challenge. The caller
     * reports the summary.
     *
     * @param {Object} config - a map config, as `loadHicFile` takes it
     * @returns {Promise<{loaded: Array, failed: Array, skipped: Array}>}
     */
    async loadHicFileIntoTargets(config) {
        return fanOutMap(this.targetedBrowsers, config)
    }

    /**
     * Load one control ("B") map into every targeted browser that can take it,
     * one after another, and report what happened: the control broadcast
     * (#681).
     *
     * NOTE: public API function
     *
     * Named for the browser door it multiplies, as `loadHicFileIntoTargets` is.
     * The rules live in `fanOutControlMap` in `js/targetGroup.js`: no origin,
     * serial, and two skips -- `'no-primary'` up front, and
     * `'control-incompatible'` after the read, asked of each target's own
     * primary.
     *
     * Raises no alert of its own, for an incompatible map or a bot challenge.
     * The caller reports the summary.
     *
     * @param {Object} config - a map config, as `loadHicControlFile` takes it
     * @returns {Promise<{loaded: Array, failed: Array, skipped: Array}>}
     */
    async loadHicControlFileIntoTargets(config) {
        return fanOutControlMap(this.targetedBrowsers, config)
    }

    /**
     * Clear the aim and make `browser` current: the plain click.
     *
     * Internal -- a host selects through `select` and aims through
     * `toggleTarget`; this is the one gesture that does both, and it is the
     * only way back from a large target set.
     *
     * The clear is deliberately *not* folded into `select` itself, even though
     * every plain click ends there. `select` is also how a new browser becomes
     * current, how a deleted browser's selection falls through to a survivor,
     * and how a restore settles -- and none of those is the user re-aiming.
     * Per the lifecycle table in #615, adding a panel must not destroy the aim
     * the user set up.
     */
    retarget(browser) {

        // Early, as in `toggleTarget`: a plain click on a browser this registry
        // does not own should not clear the aim either. #619.
        if (!this.browsers.includes(browser)) {
            return
        }

        this.#announce(() => {
            this.#targeted.clear()
            this.#select(browser)
        })
    }

    /**
     * Is `browser` in the target set by an explicit gesture, rather than by
     * being the current one?
     *
     * Internal, and the question only `HICBrowser.reset` asks: a reset disposes
     * and rebuilds, and the target set has to survive that (unlike the sync
     * group, which is a rule that gets recomputed -- targeting is a user's act
     * a reset should not silently undo). `reset` captures this before the
     * teardown and hands it back to `reclaimSlot`.
     */
    isTargetedExplicitly(browser) {
        return this.#targeted.has(browser)
    }

    /**
     * Run `mutate`, and post `BrowserTargetChange` if the resolved target set
     * came out different.
     *
     * One place computes the set before and after, so every route that can
     * change it -- an explicit toggle, a re-aim, a selection moving, a browser
     * leaving or coming back -- announces without each having to work out
     * whether it did. The badge class is applied here for the same reason.
     *
     * The event carries the resolved array, so a host need not re-derive the
     * implicit-current rule, and the registry, because the bus is page-wide
     * while a target set is per embed. Plural name because the subject is a
     * set, unlike `BrowserSelect`.
     */
    #announce(mutate) {

        if (0 === this.#announceDepth++) {
            this.#announceBefore = this.targetedBrowsers
        }

        try {
            mutate()
        } finally {
            if (0 === --this.#announceDepth) {

                // An aim needs something to aim *between*: with fewer than two
                // browsers the explicit set says nothing the selection does not
                // already say, and drawing the anchor on a lone panel tells the
                // user they are in a multi-select that has no second member.
                // Both routes into that state end here -- a shift-click on the
                // only panel, and deletes whittling an aim down to one -- so
                // this is the one place it is refused. The *resolved* set is
                // unchanged either way (the current browser is targeted
                // implicitly), so this drops a badge, never a target. #621.
                if (this.browsers.length < 2) {
                    this.#targeted.clear()
                }

                const before = this.#announceBefore
                const after = this.targetedBrowsers

                // Repainted every time, not only when the set changed: the
                // *shape* of the set can change while its membership does not
                // -- the anchor is whichever targeted browser is also current,
                // and a selection moving inside the set moves the badge
                // without adding or removing a member.
                this.#paintTargetBadges(before)

                if (before.length !== after.length || after.some((browser, i) => browser !== before[i])) {
                    EventBus.globalBus.post(HICEvent("BrowserTargetChange", {registry: this, targetedBrowsers: after}))
                }
            }
        }
    }

    /**
     * Put the target-set badges on the panels, and take them off the ones that
     * no longer carry them.
     *
     * Three appearances, because a user has to tell three states apart at a
     * glance -- the plain selection, the browser an aim *starts* from, and the
     * rest of the aim:
     *
     * - plain click, no aim: the selected border only (grey). The current
     *   browser is implicitly targeted, but a set of one is just a selection
     *   and badging it would make every panel look aimed at.
     * - the anchor -- current *and* explicitly targeted, i.e. the first
     *   shift-click: `hic-root-target-anchor`, which recolors the selected
     *   border blue. Solid, because it is still the browser the widgets read.
     * - every later shift-click: `hic-root-targeted`, the dashed blue outline.
     *
     * Reads `#targeted` rather than `targetedBrowsers` on purpose: the getter
     * folds the implicit current browser in, and the distinction being drawn
     * here is exactly the one it folds away.
     *
     * @param {Array} departed - browsers that were in the set before the
     *   mutation. Painted too, so one that has since left the registry -- a
     *   delete, a reset's teardown -- has its badge taken off rather than
     *   keeping it on a detached element that may yet be reused.
     */
    #paintTargetBadges(departed = []) {

        for (const browser of new Set([...departed, ...this.browsers])) {

            const classList = browser.rootElement?.classList

            if (undefined === classList) {
                continue
            }

            const explicit = this.#targeted.has(browser)
            const anchor = explicit && browser === this.currentBrowser

            // add/remove rather than the two-argument `toggle`: the class list
            // is the one DOM surface the registry touches, and this keeps the
            // fakes the tests build to the two methods every other call here
            // already uses.
            classList[anchor ? 'add' : 'remove']('hic-root-target-anchor')
            classList[explicit && !anchor ? 'add' : 'remove']('hic-root-targeted')
        }
    }

    /**
     * Tear a browser down and give up its slot.
     *
     * The teardown itself is the browser's -- `dispose()` is the one path, per
     * ADR-0005 -- and it calls `releaseSlot` below on its way out. So this method is
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
     * Tear this embed down: dispose every browser it owns, take down the one
     * node the registry itself installed, and evict the registry from the
     * container map. Decisions 7 and 8 of ADR-0005.
     *
     * NOTE: public API function
     *
     * The counterpart of `initRegistry` the way `browser.dispose()` is the
     * counterpart of the constructor: a host that is done with an embed --
     * Spacewalk removing its Juicebox panel -- hands the container back empty.
     *
     * Eviction is what makes "dispose, then `hic.init()` the same element"
     * supported rather than accidental. `registryForContainer` creates lazily,
     * so the next call in builds a clean registry instead of finding this one.
     * Decision 8 of ADR-0004 keyed the map by container precisely so a dropped
     * container drops its registry; this is the explicit form of the same rule.
     *
     * Idempotent, for the same reason `browser.dispose()` is: a host that tears
     * down twice is doing the right thing twice. It is deliberately *not*
     * fatal, unlike a disposed browser -- a disposed registry is simply one
     * with no browsers, and what a host can observe is that a second `init()`
     * on the same container hands back a different object.
     */
    dispose() {

        this.deleteAll()

        // The registry's own contribution to the container, and the only node
        // no browser teardown looks at: an embed whose host raised one alert
        // would otherwise hand the container back non-empty.
        this.alertDialog?.container.remove()
        this.alertDialog = undefined

        evict(this)
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
        this.#announce(() => {
            this.browsers = this.browsers.filter(b => b !== browser)
            // Dropped rather than left to the `browsers` filter in
            // `targetedBrowsers`: a disposed browser is fatal on use, via
            // `#assertNotDisposed`, not merely stale, so the registry should
            // not still be holding a reference to one.
            this.#targeted.delete(browser)
            if (browser === this.currentBrowser) {
                this.#select(this.browsers[0])
            }
        })
        // The open maps have changed. Here rather than in `delete` and
        // `deleteAll`, because every door out -- those two, a host's own
        // `dispose()`, a `reset()` -- passes through this slot. `dispose()`
        // has already cut this browser's edges; what this adds is that the
        // survivors' membership is derived, not merely what was left. #635.
        this.sync()
        this.refreshDeleteButtonVisibility()
    }

    /**
     * Put a reconstructed browser back in the slot it held before it disposed
     * itself.
     *
     * The other half of `reset()`, and internal for the same reason
     * `releaseSlot` is: a browser tears itself down and rebuilds itself, and
     * tells its registry both times. A host never has a browser that is out of
     * its registry, because `reset()` returns before it can look.
     *
     * `index` is where the browser was, not where it goes: registry order is
     * panel order, so appending would move the panel. It is clamped because a
     * registry that lost browsers meanwhile is a registry with fewer slots than
     * it had.
     *
     * `wasCurrent` restores the selection *without* going through `select`,
     * deliberately: a reset does not change which browser is selected, and
     * posting `BrowserSelect` for the browser that was already selected would
     * announce a transition that never happened.
     *
     * @param {boolean} wasCurrent - whether this browser was the current one
     *   before it disposed itself.
     */
    reclaimSlot(browser, index, wasCurrent, wasTargeted) {

        this.#announce(() => {

            this.browsers.splice(Math.min(index, this.browsers.length), 0, browser)

            if (wasTargeted) {
                this.#targeted.add(browser)
            }

            if (wasCurrent) {
                this.currentBrowser = browser
                browser.rootElement.classList.add('hic-root-selected')
                mostRecentlySelectedBrowser = browser
            }
        })

        this.refreshDeleteButtonVisibility()
    }

    async updateAll() {
        for (const browser of this.browsers) {
            await browser.update()
        }
    }

    /**
     * Derive the sync group afresh: afterwards every browser in the list holds
     * exactly its partners under `pairSynchable`, and nothing else. Defaults to
     * this registry's browsers; an explicit list is how a caller syncs a subset
     * (and, per decision 6 of the ADR, how a cross-registry group would later
     * be expressed).
     *
     * Recomputed rather than accumulated, per ADR-0016 decision 6. It used to
     * only add, so a panel that loaded an incompatible map kept the pairing its
     * old map earned and went on receiving states its new genome cannot place.
     * Membership is a pure function of the open maps; nothing about it is worth
     * remembering between calls.
     *
     * An edge to a browser *outside* the list is dropped from both ends, so
     * the result is symmetric whatever the caller passes. It runs wherever the
     * open maps change: a load or a failed one (`dataLoader.js`), a browser
     * arriving (`add`) or leaving (`releaseSlot`), and a restore.
     *
     * The isolation marks are painted here too, from the same list, for the
     * reason the target badges are painted in `#announce`: this is the one
     * place membership changes, so a panel's mark cannot fall out of step with
     * its group -- and cannot move while the user pans, since panning never
     * reaches here. ADR-0016 decisions 7-8, #637.
     */
    sync(browsers = this.browsers) {

        for (const browser of browsers) {
            for (const peer of browser.synchedBrowsers) {
                peer.synchedBrowsers.delete(browser)
            }
            browser.synchedBrowsers.clear()
        }

        for (const [b1, b2] of pairSynchable(browsers)) {
            b1.synchedBrowsers.add(b2)
            b2.synchedBrowsers.add(b1)
        }

        const reasons = isolationReasons(browsers)
        for (const browser of browsers) {
            browser.setIsolationReason(reasons.get(browser))
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
     *
     * A browser with no dataset serializes to `null` and is dropped here rather
     * than written into the session: it names no map, and restoring it would
     * rebuild an empty panel. **Accepted asymmetry:** browser *count* does not
     * survive the round trip when one of them is empty -- an embed saved with
     * an empty panel open restores one panel short. ADR-0006 decision 6, #500.
     */
    toJSON() {

        const json = {
            browsers: this.browsers
                .map(browser => browser.toJSON())
                .filter(browserJson => null !== browserJson)
        }

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
     *
     * Resolves once every browser's map is usable, before its tracks have
     * loaded -- see the exported `restoreSession` (#667, ADR-0017 decision 1).
     */
    async restoreSession(session) {

        this.deleteAll()

        // The session-shaped entry, and since #535 the only place a restored
        // session is normalized: `createBrowserList` below used to do it again,
        // over a document this line had already resolved. Every session-shaped
        // door arrives here -- `hic.init`, the query path it delegates to,
        // `hic.restoreSession`, and this method reached directly off a registry
        // -- so one call here is one call per session, and everything past it
        // reads a resolved config rather than re-interpreting a raw one.
        //
        // It has to run before the next line rather than inside the creation it
        // drives, because this method *reads* a session-level member the stage
        // resolves: a document naming a selected gene only inside one of its
        // browsers has to have been hoisted before the line below looks for one
        // (#533, #481). Resolving the session and then reading it is the order
        // the seam is for.
        //
        // This one call is also what expands the URL shortcuts a session may
        // carry. That was a second `expandSessionUrlShortcuts(session)` line
        // here until #534, written because a session handed straight to this
        // method never meets the decoder -- which is exactly the gap the
        // normalize stage closes.
        normalizeSession(session)

        if (Object.hasOwn(session, 'selectedGene')) {
            this.selectedGene = session.selectedGene
        }

        await createBrowserList(this.container, session)

        // Whatever `syncDatasets` says. `false` already reached every browser
        // as `synchable: false` in the normalization above, so the recompute
        // pairs nothing -- and skipping it would leave whatever the loads
        // assembled on their way in standing instead of derived. #635.
        this.sync()
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

/**
 * Drop `registry` from the container map, so the next `registryForContainer`
 * for the same element builds a new one.
 *
 * Internal, and the outbound half of `dispose()`: a registry tears itself down
 * and evicts itself, rather than something outside reaching into the map.
 *
 * The identity check is what keeps `dispose()` idempotent once decision 8's
 * sequence is taken up: dispose an embed, `init()` the same container again,
 * and a host still holding the *first* registry can dispose it a second time.
 * Deleting by container alone would take the live embed's entry with it, and
 * the next `init()` would silently build a third registry over the second one's
 * browsers. A registry built without a container -- the tests that exercise one
 * without a document -- was never in the map, and matches nothing here.
 */
function evict(registry) {
    if (registriesByContainer.get(registry.container) === registry) {
        registriesByContainer.delete(registry.container)
    }
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
