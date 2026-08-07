/*
 *  The MIT License (MIT)
 *
 * Copyright (c) 2016-2017 The Regents of the University of California
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
 * following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial
 * portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,  FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * The declared public surface of juicebox.js.
 *
 * juicebox.js is an embeddable component, not an application. Its correctness
 * condition is not "the dev harness still works" -- it is "the host apps still
 * work, and so does an embedder we have never heard of."
 *
 * Most of that surface is not visible from inside this repo. `js/index.js`
 * exports twelve names and `HICBrowser` is not one of them: hosts get browser
 * instances from `init()` and then use them directly. So asking "does anything
 * call this?" and grepping `js/` returns *no* for members two shipped
 * applications depend on. Every refactor that trusts that grep is reasoning
 * from a false negative -- and one already has, see ADR-0003.
 *
 * This module is the fix. It names the surface as data so there is somewhere to
 * look, and `test/testPublicApi.js` reads it so there is something that breaks.
 *
 * **A name in this file is a promise.** Renaming it, removing it, or changing
 * its signature or return type is a breaking change requiring a coordinated
 * release across both known consumers -- see the release ceremony.
 *
 * **Absence from this file is not permission.** juicebox.js is MIT, published
 * and embeddable by anyone; the consumers we can measure are not the
 * population. For anything resembling a load, a session, a state or a
 * lifecycle call, prefer deprecation over deletion even when this file is
 * silent. For genuinely internal machinery, this file is sufficient.
 *
 * Nothing imports this module at runtime, so it never reaches a consumer
 * bundle. It is not in `package.json`'s `files` either -- this is repo source,
 * read here or on GitHub, not something an installed package exposes.
 */

/**
 * Names exported from `js/index.js`.
 *
 * This half of the contract is healthy: it is declared in an explicit export
 * block and used roughly as intended. It is listed here so the whole surface
 * sits in one place, and so the test can check both directions -- an addition
 * here is as much a contract change as a removal.
 */
export const NAMESPACE_SURFACE = [
    'version',
    'init',
    // The registry's front door, new in #483. `init` is a wrapper over it and
    // keeps its own return type, so this is an addition to the surface rather
    // than a change to it. Decision 3 of ADR-0004.
    'initRegistry',
    'toJSON',
    'restoreSession',
    'compressedSession',
    'createBrowser',
    'getCurrentBrowser',
    'setCurrentBrowser',
    'getAllBrowsers',
    'igvxhr',
    'EventBus',
    'setUrlMapper'
]

/**
 * Browser instance members that exist as soon as a browser is constructed.
 *
 * This is the undeclared half of the contract, and the reason this file exists.
 * `HICBrowser` is not exported; hosts receive instances from `init()`,
 * `createBrowser()` or `getCurrentBrowser()` and use them directly.
 *
 * Five of these -- the four load methods and `parseGotoInput` -- forward to an
 * internal collaborator without adding behaviour, and four of those have no
 * internal callers at all: they exist solely for hosts. They look like
 * deletable indirection from inside this repo and are not. Removing them would
 * not remove a hop, it would promote the collaborators they delegate to from
 * internal detail to published name, freezing this decomposition into the
 * contract. See #467.
 *
 * Seven more are assigned in the constructor rather than declared on the
 * prototype, so they are invisible to any check that reflects on the class
 * instead of building an instance.
 */
export const BROWSER_SURFACE = [
    // Delegating loaders and lookups -- no internal callers, hosts only
    'loadHicFile',
    'loadTracks',
    'loadHicControlFile',
    'loadLiveContactMap',
    'parseGotoInput',

    // Real methods
    'reset',
    'setCustomCrosshairsHandler',

    // Accessors -- present from construction, populated by a load.
    //
    // `dataset`/`state` is the canonical vocabulary; `activeDataset` and
    // `activeState` are aliases for the same two accessors, and no internal
    // code reads either. `activeDataset` is here because Spacewalk reads it.
    // `state` and `activeState` have no measured reader in either host -- they
    // are declared because we have decided to keep them, and this file is where
    // that decision has to be visible, per "absence is not permission" above.
    // See #468.
    'dataset',
    'activeDataset',
    'state',
    'activeState',

    // Constructor-assigned fields
    'id',
    'config',
    // The registry owning this browser's embed. Declared deliberately rather
    // than acquired by accident: `setCurrentBrowser(browser)` resolves through
    // it, so it is load-bearing from the moment it ships, and it is the route a
    // multi-embed host takes when the page-wide getters are the wrong question.
    // Decision 9 of ADR-0004, #479.
    'registry',
    'rootElement',
    'eventBus',
    'coordinator',
    'layoutController',
    'contactMatrixView'
]

/**
 * Members of the `BrowserRegistry` a host is handed.
 *
 * A host reaches a registry two ways, both declared surface: `initRegistry()`
 * returns one, and `browser.registry` is one. Per "absence is not permission"
 * above, everything reachable on that object becomes contract the moment it
 * ships -- so the set is chosen here deliberately rather than being whatever
 * the class happens to expose. Decisions 3 and 9 of ADR-0004, #483.
 *
 * This is the multi-embed answer to the page-wide getters: a host with two
 * embeds asks a registry what its browsers are and which one is current,
 * instead of asking `getAllBrowsers()` page-wide and getting whichever embed
 * the user touched last.
 *
 * Deliberately *not* declared, and internal: `register`, `clear` and
 * `refreshDeleteButtonVisibility`, which are steps of the initialization path
 * -- a browser is registered before it is initialized, and visibility is
 * settled once -- and mean nothing to a caller outside it; and `alertDialog`,
 * which is the lazily built igv-ui dialog behind `presentAlert`. A host raises
 * an alert; which widget the registry does it with is ours to change.
 */
export const REGISTRY_SURFACE = [
    // The element this registry owns, which is what it is keyed by.
    'container',

    // The embed's browsers and which of them is current. The invariant is
    // decision 7's: a non-empty registry has a current browser.
    'browsers',
    'currentBrowser',

    // Per embed rather than page-wide because it is serialized per session.
    'selectedGene',

    // Lifecycle. `add` and `delete` are the registry-scoped counterparts of the
    // exported `createBrowser` and `setCurrentBrowser`.
    'add',
    'select',
    'delete',
    'deleteAll',
    'updateAll',

    // The sync group's membership rule, over this registry's browsers by
    // default. Decision 6.
    'sync',

    // A session describes one embed; these are where one is actually written
    // and read. The exported `toJSON`/`restoreSession` delegate here.
    'toJSON',
    'restoreSession',

    // This embed's own alert dialog, rather than igv-ui's page-wide singleton.
    'presentAlert'
]

/**
 * Surface that does not exist until a map has loaded.
 *
 * These are contract exactly like `BROWSER_SURFACE`, but they cannot be
 * asserted against a freshly constructed browser: nothing assigns them until a
 * dataset arrives. `genome`, for instance, is set by the data loader, and
 * Spacewalk guards on its presence.
 *
 * They are declared separately rather than dropped, because the whole failure
 * this file addresses is that undeclared surface is invisible surface. A member
 * that is hard to test is not thereby less of a promise.
 *
 * Each entry names the path a host reads and where it is populated.
 */
export const POST_LOAD_SURFACE = [
    {path: 'browser.genome', populatedBy: 'dataLoader, on map load'},
    {path: 'browser.dataset.isLive', populatedBy: 'the Dataset constructor'},
    {path: 'browser.activeDataset.isLive', populatedBy: 'the Dataset constructor'}
]

/**
 * Contract reached one dot further out, through a member of `BROWSER_SURFACE`.
 *
 * These are the easiest part of the surface to miss, because nothing about them
 * looks public from the browser's own member list: a host that holds
 * `browser.layoutController` can call anything on it, and two do. Handing back
 * an internal collaborator publishes the parts of it that get used.
 *
 * `owner` is the browser member the host reaches through; `member` is what it
 * uses on the far side.
 */
export const SUB_SURFACES = [
    {owner: 'layoutController', member: 'removeTrackXYPair'},
    {owner: 'layoutController', member: 'getContactMatrixViewport'},
    {owner: 'contactMatrixView', member: 'update'},
    {owner: 'contactMatrixView', member: 'ctx'},
    // Spacewalk sizes its live-map view from this element. Missing from
    // ADR-0003's measurement and found while reviewing #470 -- which is the
    // point: a hand-measured table missed it, and a test would not have.
    {owner: 'contactMatrixView', member: 'viewportElement'},
    {owner: 'coordinator', member: 'addCallback'},
    // Spacewalk subscribes DidHideCrosshairs on the per-browser bus. Nothing in
    // this repo subscribes to either bus any more -- the coordinator is the
    // internal route -- so these three are read only from outside. unsubscribe
    // is new in #414: a host holding a handler on a browser it later discards
    // had no way to let go.
    {owner: 'eventBus', member: 'subscribe'},
    {owner: 'eventBus', member: 'unsubscribe'},
    {owner: 'eventBus', member: 'post'}
]

/**
 * Event names accepted by `browser.coordinator.addCallback(name, fn)`.
 *
 * This is the host extension point -- how an embedder learns about map loads,
 * locus changes and colour changes without subscribing to the event bus. See
 * ADR-0002 for why the coordinator is not going away.
 *
 * All six are declared, not just the three a known consumer happens to use
 * today: `addCallback` throws on an unrecognised name, so the set it accepts is
 * already published behaviour. Narrowing it would break a host that registered
 * one of the other three, silently and only at runtime.
 *
 * The coordinator got here on its own -- it validates against its own declared
 * list and throws. That is the only self-describing, self-enforcing piece of
 * the browser contract, and it is the pattern this whole module generalises.
 */
export const COORDINATOR_CALLBACKS = [
    'onMapLoaded',
    'onControlMapLoaded',
    'onLocusChange',
    'onGenomeChange',
    'onBackgroundColorChange',
    'onForegroundColorChange'
]

/**
 * Events juicebox.js posts, and the bus each travels on.
 *
 * The event bus is the sharpest case in the whole contract. Every internal
 * subscription was migrated to the coordinator, so from inside this repo the
 * bus looks dead -- and from outside it is load-bearing: five of these have
 * external subscribers and no internal ones. A review that counted subscribers
 * by grepping `js/` concluded the per-browser bus had none, which was true of
 * this repo and false of the product.
 *
 * **These names are declared but not enforced.** The test asserts the plumbing
 * they travel over, not that each is still posted -- proving an event still
 * fires means driving a real map load and watching the bus, which needs the
 * probe harness of #438.
 *
 * That is a real gap, and it is worth naming precisely: juicebox-web subscribed
 * to a `MapLoad` event that stopped being posted in December 2025 and nobody
 * noticed for eight months. Nothing in this file would catch that happening
 * again. Removing a name here is caught by review; removing the *post* that
 * feeds it is not.
 */
export const EVENTS_POSTED = [
    {name: 'GenomeChange', bus: 'global'},
    {name: 'BrowserSelect', bus: 'global'},
    {name: 'TrackXYPairLoad', bus: 'global'},
    {name: 'TrackXYPairRemoval', bus: 'global'},
    {name: 'DidHideCrosshairs', bus: 'browser'},
    {name: 'DidShowCrosshairs', bus: 'browser'},
    {name: 'DragStopped', bus: 'browser'}
]

/**
 * Event payload shape that a host reads into.
 *
 * `TrackXYPairLoad` and `TrackXYPairRemoval` carry the track pair itself.
 * juicebox-web reads the track and its config format off the payload, then
 * hands the same object back to `layoutController.removeTrackXYPair`. So the
 * payload's internals are published shape, not an implementation detail -- a
 * refactor that changed what a track pair looks like would break a host that
 * never named the type.
 *
 * Declaration only; verifying it means posting a real track load.
 */
export const EVENT_PAYLOAD_SHAPES = [
    {event: 'TrackXYPairLoad', payload: 'the TrackPair itself', readsInto: ['track', 'track.name', 'track.config.format']},
    {event: 'TrackXYPairRemoval', payload: 'the TrackPair itself', readsInto: ['track', 'track.name', 'track.config.format']}
]
