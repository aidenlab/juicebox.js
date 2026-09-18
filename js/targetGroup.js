/**
 * The **target set**: the browsers a *load* reaches. Not a sync group.
 *
 * `js/syncGroup.js` holds the rule for what a browser publishes its canonical
 * state to; this module holds the rule for what a track load fans out to. They
 * are two different mechanisms for "one action reaching several browsers", and
 * the distinction is the load-bearing part of the design -- membership here is
 * an explicit user gesture rather than a computed rule, the cargo is dataset
 * choices rather than canonical state, and the lifetime is until the user
 * re-aims rather than standing. See `docs/adr/0015` and `CONTEXT.md`.
 *
 * One file per mechanism, so the distinction is visible in the tree and not
 * only in the ADR. Like `pairSynchable` and `canResolveSyncState` next door,
 * everything here is a pure function over browsers: no registry, no DOM, and so
 * unit-testable against fabricated objects.
 */

/**
 * Why this target cannot take the originating browser's tracks, or `undefined`
 * if it can.
 *
 * Two skips, and both are *skips* rather than throws -- the precedent is
 * `canResolveSyncState` (#605), which declines a state it cannot place rather
 * than failing the publication.
 *
 * - **`'no-dataset'`**: an empty browser is a normal transient state, not an
 *   error. A panel the user has opened but not yet loaded a map into is a
 *   perfectly ordinary thing to have aimed at.
 * - **`'genome-mismatch'`**: tracks carry no genome of their own, so the
 *   *originating* browser is the track's genome declaration -- the menu the
 *   track came from was built for that browser's genome. This is the skip that
 *   prevents the nasty failure: not an error, just a track drawn at meaningless
 *   coordinates in a panel nobody was watching.
 *
 * `genome` rather than `dataset.genomeId` because `genome` is what the 2D
 * loader is handed (`Track2D.loadTrack2D(config, browser.genome)`) and what a
 * 1D track resolves its chromosome names against.
 *
 * @param {Object} originating - the browser the load was issued from
 * @param {Object} target - a browser in the target set
 * @returns {string|undefined} the skip reason, or `undefined` to load
 */
function trackSkipReason(originating, target) {

    if (undefined === target.dataset) {
        return 'no-dataset'
    }

    if (target.genome?.id !== originating.genome?.id) {
        return 'genome-mismatch'
    }

    return undefined
}

/**
 * Load `configs` into every browser in `targets` that can take them.
 *
 * Named for the fan-out rather than for the registry method that calls it
 * (`registry.loadTracksIntoTargets`), so a grep or a stack trace says which of
 * the two is which.
 *
 * Concurrent and unbounded, over `Promise.allSettled`: one gesture, N loads,
 * and no target's failure stops another's. Concurrency is deliberately *not*
 * capped here -- #588 is the unbounded-track-load problem and it deserves one
 * global answer wherever it lands, not a second, local one in this file. What
 * this feature does is multiply that blast radius, which is why #588 names it.
 *
 * Each target gets its own copy of each config, because igv mutates what it is
 * handed: `DataLoader.loadTracks` sets `autoscale`, `height`, and sometimes
 * `type`/`format` on the object it is given, and igv's own track constructors
 * keep a reference to it. Sharing one object across N browsers would let the
 * first load's discoveries leak into the rest. The copy is shallow, which is
 * what the mutation is.
 *
 * **Raises no alert.** It returns the summary and the caller reports -- one
 * report per gesture, not one modal per browser, and *where* that report
 * appears is a host's decision. juicebox-web and Spacewalk have different
 * notification surfaces. This is why the fan-out needs a loader that throws:
 * `HICBrowser.loadTracks` catches, alerts and resolves, so a fan-out over it
 * could not tell failure from success.
 *
 * @param {Object} originating - the browser the load was issued from, and the
 *   track's genome declaration
 * @param {Array<Object>} targets - the resolved target set
 * @param {Array<Object>} configs - track configs, as `loadTracks` takes them
 * @param {Function} [load] - how one browser is loaded; the seam a test drives
 * @returns {Promise<{loaded: Array, failed: Array, skipped: Array}>}
 */
async function fanOutTracks(originating, targets, configs, load = (browser, ownConfigs) => browser.loadTracksOrThrow(ownConfigs)) {

    const summary = {loaded: [], failed: [], skipped: []}

    const attempted = []

    for (const target of targets) {
        const reason = trackSkipReason(originating, target)
        if (undefined === reason) {
            attempted.push(target)
        } else {
            summary.skipped.push({browser: target, reason})
        }
    }

    const settled = await Promise.allSettled(
        attempted.map(target => load(target, configs.map(config => ({...config}))))
    )

    settled.forEach((outcome, i) => {
        if ('fulfilled' === outcome.status) {
            summary.loaded.push(attempted[i])
        } else {
            summary.failed.push({browser: attempted[i], error: outcome.reason})
        }
    })

    return summary
}

/**
 * Load one map `config` into every browser in `targets`: the primary broadcast.
 *
 * Broadcast, not distribute -- every target takes the *same* map. #680.
 *
 * **Skips nothing**, so `skipped` is always empty. Both of `trackSkipReason`'s
 * skips exist because a track has no genome of its own; a map carries one,
 * built from the `.hic` file's own chromosome table, so a mismatched panel is
 * simply one whose genome is about to change, and an empty panel is the best
 * target there is. The key stays so a host can read both summaries with one
 * code path.
 *
 * **Origin-free** for the same reason: `fanOutTracks` takes an originating
 * browser because it is the track's genome declaration, and here nothing would
 * read it.
 *
 * **Serial**, deliberately, where `fanOutTracks` is concurrent. `loadHicFile`
 * ends by syncing the registry and then adopting a *peer's* sync state; run
 * several at once and the group is recomputed against a half-loaded registry
 * while each panel adopts whichever sibling finished first, so where the panels
 * end up would depend on network order. The concurrency argument of ADR-0015
 * decision 9 is about #588's unbounded track storm and does not carry: this is
 * at most one indexed read per panel. `test/testTargetGroup.js` pins the order.
 *
 * **`genomeChanged`** reports the one fact a host cannot derive afterwards:
 * which panels had a map on one genome and now have one on another. Nothing in
 * the library clears a panel's tracks when its map is replaced, so those are
 * the panels that may be drawing tracks at meaningless coordinates. A panel
 * that was empty had no genome and so no such tracks, and is not reported. A
 * genome-changed browser is also in `loaded`.
 *
 * Each target gets its own shallow copy of `config`: both loaders mutate what
 * they are handed (`config.name`, and `config.nvi` from the lookup table).
 * `locus` and `state` pass through untouched -- a host that puts one in the
 * config means it for the whole broadcast.
 *
 * **Raises no alert**, for the reasons `fanOutTracks` gives; the default load
 * is `loadHicFileOrThrow`, which rethrows a bot challenge unreported (#679).
 *
 * @param {Array<Object>} targets - the resolved target set
 * @param {Object} config - a map config, as `loadHicFile` takes it
 * @param {Function} [load] - how one browser is loaded; the seam a test drives
 * @returns {Promise<{loaded: Array, failed: Array, skipped: Array, genomeChanged: Array}>}
 */
async function fanOutMap(targets, config, load = (browser, ownConfig) => browser.loadHicFileOrThrow(ownConfig)) {

    const summary = {loaded: [], failed: [], skipped: [], genomeChanged: []}

    for (const target of targets) {

        const from = undefined === target.dataset ? undefined : target.genome?.id

        try {
            await load(target, {...config})
        } catch (error) {
            summary.failed.push({browser: target, error})
            continue
        }

        summary.loaded.push(target)

        const to = target.genome?.id
        if (undefined !== from && from !== to) {
            summary.genomeChanged.push({browser: target, from, to})
        }
    }

    return summary
}

export {trackSkipReason, fanOutTracks, fanOutMap}
