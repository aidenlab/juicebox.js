/**
 * Has this browser opted out of syncing, and does it have a dataset to sync?
 *
 * The single statement of the `synchable` rule. It was written out three times
 * until #562 -- here, in `HICBrowser.syncState`, and in
 * `StateManager.canBeSynched` -- and its three readers now share this one
 * expression rather than each restating it.
 *
 * @param {Object} browser
 * @returns {boolean}
 */
function isSynchable(browser) {
    return browser.synchable !== false && browser.dataset !== undefined
}

/**
 * May this browser take the state a sibling published?
 *
 * The inbound half of the sync-group rule: `pairSynchable` answers which
 * browsers sync with which, this answers whether one particular published state
 * can land on one particular browser. Same two membership questions, plus one
 * more -- the dataset has to know the chromosomes the state names by name,
 * since a sync state names them rather than indexing them.
 *
 * It lives here, not on `State`, because `synchable` is a group-membership fact
 * about the browser and not a fact about the view. See ADR-0009 decision 6.
 *
 * @param {Object} browser
 * @param {Object} syncState - as produced by `State.getSyncState`
 * @returns {boolean}
 */
function canBeSynched(browser, syncState) {

    if (!syncState || !isSynchable(browser)) {
        return false
    }

    return (
        browser.dataset.getChrIndexFromName(syncState.chr1Name) !== undefined &&
        browser.dataset.getChrIndexFromName(syncState.chr2Name) !== undefined
    )
}

/**
 * The sync-group pairing rule, as a pure function over a list of browsers.
 *
 * See decision 6 of `docs/adr/0004-browser-registry-per-container.md`: keeping
 * the rule independent of the registry is what lets a cross-registry sync group
 * later be one call over a concatenated array.
 *
 * A browser joins the group only if it has not opted out (`synchable === false`)
 * and has a dataset to sync. Each surviving combination is tested once rather
 * than in both orders, which `Dataset.isCompatible` permits: it compares genome
 * ids and chromosome sizes, so it is symmetric.
 *
 * @param {Array} browsers
 * @returns {Array<Array>} each compatible pair once, as `[a, b]`
 */
function pairSynchable(browsers) {

    const synchableBrowsers = browsers.filter(isSynchable)

    const pairs = []
    for (let i = 0; i < synchableBrowsers.length; i++) {
        for (let j = i + 1; j < synchableBrowsers.length; j++) {
            const [a, b] = [synchableBrowsers[i], synchableBrowsers[j]]
            if (a !== b && a.dataset.isCompatible(b.dataset)) {
                pairs.push([a, b])
            }
        }
    }

    return pairs
}

export {pairSynchable, canBeSynched, isSynchable}
