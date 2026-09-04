/**
 * Has this browser opted out of syncing, and does it have a dataset to sync?
 *
 * The single statement of the `synchable` rule. It was written out three times
 * until #562 -- here, in `HICBrowser.syncState`, and in
 * `StateManager.canBeSynched` -- and its readers now share this one expression
 * rather than each restating it. The third reader, `canBeSynched`, went with
 * the `config.synchState` rung it was the only production caller of (#566);
 * `HICBrowser.syncState` and `pairSynchable` below are what is left.
 *
 * @param {Object} browser
 * @returns {boolean}
 */
function isSynchable(browser) {
    return browser.synchable !== false && browser.dataset !== undefined
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

/**
 * Can this genome place both chromosomes a sync state names?
 *
 * Deliberately *not* part of `isSynchable`. Membership is a property of the two
 * browsers -- have they opted out, do they have maps -- and holds across every
 * state they exchange; this is a property of one particular state, and a pair
 * that legitimately syncs can still fail on a single publication. Folding it
 * into the membership rule would change who pairs, not just who syncs.
 *
 * Asked of the **genome** because the genome is what `State.sync` consumes: it
 * dereferences `genome.getChromosome(name).index`, and a name it cannot resolve
 * is the TypeError #605 is about. Not the dataset's `getChrIndexFromName` --
 * the expression `canBeSynched` carried until #566 deleted it -- which is an
 * exact, case-sensitive scan and so *stricter* than the lookup it would be
 * guarding: the genome aliases `1` to `chr1` and `MT` to `chrM`, and matches
 * case-insensitively. Guarding with the stricter expression would refuse peer
 * states that sync correctly today, trading a rare throw for a routine false
 * negative. What this admits is exactly what `State.sync` can use.
 *
 * Reachable because `Dataset.isCompatible` short-circuits to `true` on a known
 * genome-id pair without comparing chromosomes at all, so a subset `.hic`
 * labelled `hg38` pairs with a whole-genome one and is then published names it
 * does not have.
 *
 * @param {Object} genome - the receiving browser's genome
 * @param {Object} syncState - as `State.getSyncState` publishes it
 * @returns {boolean}
 */
function canResolveSyncState(genome, syncState) {
    const resolves = name => 'string' === typeof name && undefined !== genome?.getChromosome(name)
    return resolves(syncState.chr1Name) && resolves(syncState.chr2Name)
}

export {pairSynchable, isSynchable, canResolveSyncState}
