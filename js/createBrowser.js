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

async function createBrowser(hicContainer, config, callback) {

    // Wrapped rather than handed over as it is: this door takes a browser
    // config and *only* a browser config, so a `browsers` member on it is an
    // ordinary unread member and must not steer the stage away from the object
    // that actually becomes `browser.config`. The wrapper is discarded;
    // `config` is what is normalized. See js/normalizeSession.js.
    normalizeSession({browsers: [config]});

    const browser = new HICBrowser(hicContainer, config);
    await browser.init(config);

    if (typeof callback === "function") callback();

    registryForContainer(hicContainer).add(browser);

    return browser;
}

async function createBrowserList(hicContainer, session) {

    const registry = registryForContainer(hicContainer);

    // One call for the whole document: the stage walks the same
    // `browsers || [session]` shape this loop does. See js/normalizeSession.js.
    normalizeSession(session);

    const configList = session.browsers || [session];
    const initPromises = [];

    registry.clear();

    for (const config of configList) {

        if (session.syncDatasets === false) {
            config.synchable = false;
        }

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
