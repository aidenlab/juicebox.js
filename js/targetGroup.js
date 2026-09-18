/**
 * The **target set**: the browsers a *load* reaches. Not a sync group.
 *
 * `js/syncGroup.js` holds the rule for what a browser publishes its canonical
 * state to; this module holds the rules for what a load fans out to -- tracks,
 * a primary map broadcast (#680), and a control map broadcast (#681). They
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
 * the panels that may be drawing tracks at meaningless coordinates. Read off
 * `genome`, not `dataset`: `clearDataset()` leaves the genome and the tracks
 * behind, so a panel whose last load failed has no dataset but still has tracks
 * on its old genome. A panel that never had a map has no genome and is not
 * reported. A genome-changed browser is also in `loaded`.
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
    return fanOutSerially(targets, config, load)
}

/**
 * Why this target cannot take a control map, or `undefined` if it might.
 *
 * - **`'no-primary'`**: a control map is the "B" of a panel's "A", and this
 *   panel has no "A". Read off `dataset`, not `genome`: `clearDataset()`
 *   leaves the genome behind, so a panel whose last map load failed has a
 *   genome and nothing to pair a control with.
 *
 * "Might", because the other skip cannot be known here: whether this panel's
 * primary pairs with the control map is asked of the control dataset, after
 * the read. That one is `'control-incompatible'`; see `fanOutControlMap`.
 *
 * @param {Object} target - a browser in the target set
 * @returns {string|undefined} the skip reason, or `undefined` to load
 */
function controlSkipReason(target) {
    return undefined === target.dataset ? 'no-primary' : undefined
}

/**
 * Load one control ("B") map `config` into every browser in `targets` that can
 * take it: the control broadcast. #681.
 *
 * Two skips, and the second is post-flight -- the first in the target set
 * that cannot be known before the read:
 *
 * - **`'no-primary'`**, known up front; see `controlSkipReason`. Nothing is
 *   read for such a panel.
 * - **`'control-incompatible'`**: this panel's primary cannot pair with the
 *   control map. Compatibility is asked of the downloaded control dataset, so
 *   it is known only after the read, and it arrives as the `code` that
 *   `loadHicControlFileOrThrow` declares on what it throws (#679). The code,
 *   never the message -- #471 is what sniffing a message costs.
 *
 * Both are *skips*, not failures, by analogy with ADR-0015 decision 5: a
 * mismatch is a declined placement, not an error. The analogy rather than the
 * decision itself, because decision 5 measures against the originating browser
 * before the load, and this measures against the target's own primary after it.
 *
 * **Origin-free**, and more sharply than `fanOutMap`: compatibility is asked
 * against each target's *own* primary, never the originating browser's.
 * **Serial**, for `fanOutMap`'s reason. `genomeChanged` is kept for the shared
 * shape and is empty in practice, since a control map never replaces a panel's
 * genome.
 *
 * Display mode does not travel. It is a dataset choice of its own (ADR-0014),
 * and this gesture's cargo is a control map, not a display mode; the fan-out
 * changes no more of it than a single-panel control load does, which is none.
 *
 * **Raises no alert**, for the reasons `fanOutTracks` gives -- neither for an
 * incompatible map, which the public loader would raise once per panel, nor
 * for a bot challenge.
 *
 * @param {Array<Object>} targets - the resolved target set
 * @param {Object} config - a map config, as `loadHicControlFile` takes it
 * @param {Function} [load] - how one browser is loaded; the seam a test drives
 * @returns {Promise<{loaded: Array, failed: Array, skipped: Array, genomeChanged: Array}>}
 */
async function fanOutControlMap(targets, config, load = (browser, ownConfig) => browser.loadHicControlFileOrThrow(ownConfig)) {
    return fanOutSerially(targets, config, load, {
        skipReason: controlSkipReason,
        declinedReason: error => 'control-incompatible' === error?.code ? 'control-incompatible' : undefined
    })
}

/**
 * The serial fan-out both map broadcasts run on: one target at a time, each
 * with its own shallow copy of `config`, no target's failure stopping the next.
 *
 * `skipReason` is asked before a target is loaded and `declinedReason` of what
 * its load threw; either one naming a reason makes the target `skipped` rather
 * than `loaded` or `failed`. The defaults skip nothing, which is the primary
 * broadcast.
 *
 * @param {Array<Object>} targets - the resolved target set
 * @param {Object} config - a map config, copied once per target
 * @param {Function} load - how one browser is loaded
 * @param {Object} [skips]
 * @param {Function} [skips.skipReason] - target -> reason, or `undefined` to load
 * @param {Function} [skips.declinedReason] - thrown error -> reason, or `undefined` for a failure
 * @returns {Promise<{loaded: Array, failed: Array, skipped: Array, genomeChanged: Array}>}
 */
async function fanOutSerially(targets, config, load, {skipReason = () => undefined, declinedReason = () => undefined} = {}) {

    const summary = {loaded: [], failed: [], skipped: [], genomeChanged: []}

    for (const target of targets) {

        const skipped = skipReason(target)
        if (undefined !== skipped) {
            summary.skipped.push({browser: target, reason: skipped})
            continue
        }

        const from = target.genome?.id

        try {
            await load(target, {...config})
        } catch (error) {
            const declined = declinedReason(error)
            if (undefined === declined) {
                summary.failed.push({browser: target, error})
            } else {
                summary.skipped.push({browser: target, reason: declined})
            }
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

export {trackSkipReason, fanOutTracks, fanOutMap, controlSkipReason, fanOutControlMap}
