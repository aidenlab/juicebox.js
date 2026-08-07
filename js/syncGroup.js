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

    const synchableBrowsers = browsers.filter(b => b.synchable !== false && b.dataset !== undefined)

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

export {pairSynchable}
