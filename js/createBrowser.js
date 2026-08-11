/*
 * @author Jim Robinson Dec-2020
 */

import HICBrowser from './hicBrowser.js';
import {registryForContainer, getMostRecentlySelectedBrowser, currentRegistry} from './browserRegistry.js';
import {normalizeSession} from './normalizeSession.js';

const defaultSize = { width: 640, height: 640 };

/**
 * Module-level conveniences over the registries, kept and delegating per
 * decision 4 of ADR-0004 -- both known host apps import them, as ADR-0003
 * measures.
 *
 * There is no default registry: each function below resolves one, from its
 * container argument, from `browser.registry`, or -- for the two zero-argument
 * getters, which have nothing to resolve from -- from the browser most recently
 * selected page-wide. See `js/browserRegistry.js` and decisions 2, 8 and 9 of
 * `docs/adr/0004-browser-registry-per-container.md`.
 */

/**
 * The published single-browser door, and one of the two places a session is
 * resolved. #535.
 *
 * The two lines below are the seam: **above it a config is decided, below it a
 * config is read.** `buildBrowser` and `createBrowserList` are the below half --
 * neither normalizes, because by the time either runs the document it is handed
 * has been through the stage exactly once. The other door is
 * `BrowserRegistry.restoreSession`, which every session-shaped entry reaches:
 * `hic.init`, the query path it delegates to, and `hic.restoreSession`.
 *
 * ## Why the entry has two doors rather than one function
 *
 * Both are published surface (`js/publicApi.js`), so neither can be hidden
 * behind the other, and they take different shapes: a session for the restore, a
 * single browser config here. Two calls, one stage, and no path reaching both --
 * `createBrowser` adds a browser to a registry, it does not restore an embed.
 */
async function createBrowser(hicContainer, config, callback) {

    // A single browser config *is* a session with its one browser inlined, and
    // that is what this hands over: the config's own members as the session's,
    // and the config itself as the one browser. Session-level rules --
    // `syncDatasets`, the selected gene -- therefore reach it here exactly as
    // they reach a document naming `browsers`, which is the divergence #533
    // closed at this door.
    //
    // Spread rather than handed over as it is, because `browsers` is overwritten
    // in the copy: a `browsers` member on a single browser config is an ordinary
    // unread member, and letting it steer the stage would leave the object that
    // actually becomes `browser.config` undefaulted. The copy is discarded;
    // `config` is what is normalized. See js/normalizeSession.js.
    //
    // So a session-level rule that writes *down* onto the browsers reaches
    // `config` -- `syncDatasets` does -- and one that writes *up* onto the
    // session lands on the discarded copy. Only the selected-gene hoist writes
    // up, and this door has no registry to give it to: it is
    // `BrowserRegistry.restoreSession` that owns the gene. Nothing is lost here
    // that anything reads.
    normalizeSession({...config, browsers: [config]});

    return buildBrowser(hicContainer, config, callback);
}

/**
 * Build one browser from a config that has already been resolved, and register
 * it. Below the seam: it reads the config, it does not decide it.
 *
 * `createBrowserList` does not call this, and the near-repetition is deliberate:
 * it registers each browser *before* initializing it, because loading a dataset
 * consults the registry, and it initializes the whole list in parallel. This one
 * adds an initialized browser to a registry that already has browsers in it.
 * Folding them together would mean parameterizing the order of two calls, which
 * is how a two-line difference becomes a flag.
 */
async function buildBrowser(hicContainer, config, callback) {

    const browser = new HICBrowser(hicContainer, config);
    await browser.init(config);

    if (typeof callback === "function") callback();

    registryForContainer(hicContainer).add(browser);

    return browser;
}

/**
 * Build an embed's browsers from a session that has already been resolved.
 *
 * Below the seam, and internal: this is not exported from `js/index.js`, and its
 * one caller is `BrowserRegistry.restoreSession`, which is where the session
 * this walks was normalized. It used to normalize too -- a second call over a
 * document the restore had already resolved, harmless only because the stage is
 * idempotent -- and #535 is the ticket that removed it. What is left is a loop
 * that reads `browsers || [session]` and nothing that interprets a field.
 */
async function createBrowserList(hicContainer, session) {

    const registry = registryForContainer(hicContainer);

    const configList = session.browsers || [session];
    const initPromises = [];

    registry.clear();

    for (const config of configList) {

        const browser = new HICBrowser(hicContainer, config);

        // Registered before init: loading a dataset consults the registry.
        registry.register(browser);
        initPromises.push(browser.init(config));
    }
    await Promise.all(initPromises);

    registry.select(registry.browsers[0]);
    registry.refreshDeleteButtonVisibility();
}

function deleteAllBrowsers(hicContainer) {
    registryForContainer(hicContainer).deleteAll();
}

/**
 * Select `browser` in its own registry, or -- given `undefined` -- clear the
 * selection of whichever registry currently holds it.
 *
 * The `undefined` case is the one call that has no back-pointer to resolve
 * through, and it predates the registries: `select` has always accepted it. So
 * it falls back to the page-wide pointer, which in the single-embed case names
 * the same registry a browser argument would have.
 */
function setCurrentBrowser(browser) {

    if (undefined === browser) {
        currentRegistry()?.select(undefined);
        return;
    }

    browser.registry.select(browser);
}

function deleteBrowser(browser) {
    browser.registry.delete(browser);
}

/**
 * The browser most recently selected, anywhere on the page.
 *
 * A single-embed convenience: with two embeds it names whichever one the user
 * touched last, which is rarely what a caller holding a particular container
 * means. Multi-embed callers should reach the registry -- `browser.registry`,
 * or `registryForContainer(container)` -- instead of asking page-wide.
 */
function getCurrentBrowser() {
    return getMostRecentlySelectedBrowser();
}

/**
 * The browsers of the registry owning the current browser, and `[]` before
 * anything has been selected.
 *
 * The same single-embed convenience as `getCurrentBrowser`, and inherits its
 * caveat: which embed's list this is follows the page-wide selection. A
 * multi-embed caller wants `registryForContainer(container).browsers`.
 *
 * The empty case is reachable mid-initialization as well as before it:
 * `createBrowserList` registers every browser and only selects once they have
 * all initialized, so a caller reading this from inside a load sees `[]`. That
 * is the other reason to hold a registry rather than ask page-wide.
 */
function getAllBrowsers() {
    return currentRegistry()?.browsers || [];
}

export {
    defaultSize,
    createBrowser,
    createBrowserList,
    deleteBrowser,
    setCurrentBrowser,
    getCurrentBrowser,
    deleteAllBrowsers,
    getAllBrowsers
};
