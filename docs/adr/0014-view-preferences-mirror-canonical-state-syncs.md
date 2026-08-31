# ADR-0014 — View preferences mirror across a sync group; canonical state syncs; dataset choices do neither

**Status:** Accepted
**Date:** 2026-08-31
**Related:** #608 (the two lock/sync defects this does *not* fix), ADR-0004
(browser registry, decision 6 — the sync-group membership rule), ADR-0006
(session wire format), ADR-0013 (test tier), `CONTEXT.md` (*Sync group*, *View
preference*, *Resolution lock*), `js/syncGroup.js`, `js/hicState.js`
(`getSyncState`)

## Context

A collaborator asked that toggling the resolution lock in one of N synced
browsers close the padlock in the others too, and made the same request for
crosshairs. Neither is unreasonable, and neither is what sync does today:
`State.getSyncState` publishes exactly six fields — `chr1Name`, `chr2Name`,
`binSize`, `binX`, `binY`, `pixelSize` — all of them view geometry. No widget
state has ever crossed the sync boundary.

Answering the request one widget at a time is the trap. The same argument applies
verbatim to normalization, the colour-scale threshold, background colour, display
mode and track loading, and each new request would re-open an argument nobody had
written down. What was needed first was the rule.

The grilling session that produced this ADR also settled the *scope*: the
resolution lock ships, crosshairs are deferred whole. Crosshairs turned out not
to be a widget at all — they are a Shift-held transient driven by mousemove, and
mirroring them raises questions the lock does not (wire unit, and whether a
mirrored crosshair should fire a host's `customCrosshairsHandler`, which in
Spacewalk drives 3D highlighting under a single shared key). Those are real
decisions, and bundling them would have held the small change hostage to the
large one.

## Decision

**1. Three categories, not two.** Every browser-scoped thing a user can change
falls into exactly one:

| Category | Travels the sync group as | Examples |
| --- | --- | --- |
| **Canonical state** | the sync payload, on every update | the seven `State` fields |
| **View preference** | a mirror, on every transition | resolution lock; crosshairs, when they land |
| **Dataset choice** | nothing | normalization, colour scale, background colour, display mode, tracks, control map |

A **view preference** is defined by three properties together: the user sets it,
it is scoped to one browser, and it is not part of what the view *is*. The test
that separates it from a dataset choice is whether it changes **how a gesture is
interpreted** or **what data is shown**.

**2. A view preference is mirrored, not shared.** Each browser keeps its own
copy; the user's action writes the same value into its peers. The sync group does
**not** own the property. A peer may therefore diverge — and does, whenever its
own resolution changes clear its lock — and that divergence is accepted rather
than designed out. The alternative, a group-level property, would have removed
per-browser control and introduced a second thing that owns state.

**3. Every transition mirrors, not only the user's click.** The lock is a claim
about the group, so whatever voids it on one browser voids it on all of them: the
padlock clicked open, the coordinator's auto-clear on a resolution change, and
the auto-clear on a map load.

This was decided the other way first — mirror the click, keep the auto-clears
local, on the argument that a resolution change already reaches each browser
independently. That argument is true in the common case and false in the one that
matters: a peer whose dataset lacks the matching rung reports `zoomChanged:
false`, keeps its lock, and shows an icon the rest of the group has stopped
agreeing with. Since parity is the whole point of the feature (see Context),
tolerating a parity break was incoherent — it optimized a cost while leaving the
goal unmet.

The cost is genuinely small. Pan and drag report `resolutionChanged: false`, so
the fan-out fires per *rung crossing*, not per frame, and each hop is a boolean
and two class toggles. What makes it small is decision 3a.

**3a. A write that changes nothing does nothing.** `setResolutionLocked` returns
early when the value already holds. Without that, every resolution change in a
never-locked session would fan out to announce that nothing happened, and a
mirrored clear would do O(N²) hops as each peer's own auto-clear re-broadcast.
With it, the hot path is one comparison, fan-out happens only on a real
transition, and the recursion question does not arise: a peer set to a value it
already holds stops there. No other guard is written, and none is needed.

**3b. The map-load clear is included, on the collaborator's call.** A new map in
one panel unlocks the group. The narrower reading — that only a *resolution*
change should void the lock, since a map load is a panel reset rather than a
resolution move — was considered and set aside as more subtlety than the feature
warrants. Mechanically it works because `clearDataset()` removes the loading
browser from its peers' sets but deliberately leaves its own standing (#492), so
the browser can still reach the group on its way past. **Consequence:** a map
load that changes genome unlocks the peers and *then* drops out of their group,
which is the intended reading of "a new map voids the lock" but is worth knowing.

**4. Mirroring does not ride in the sync payload.** It is a separate fan-out over
the same `synchedBrowsers` set. Two reasons: the sync payload is sent on every
`update()` and a preference changes on a click, so riding along would ship it
thousands of times per drag to say nothing changed; and the payload *is*
canonical state, which a view preference by definition is not. Keeping them
separate keeps the vocabulary and the code agreeing.

**5. The sync group is the only membership rule.** Mirroring reuses
`synchedBrowsers` rather than defining its own set, even though some preferences
(the lock among them) are genome-independent and could sensibly reach further. A
second membership rule is a second thing to reason about, and "synced" is already
the word the user's mental model uses for these panels. Per ADR-0004 decision 6,
the rule stays a pure function over a list of browsers, so a cross-registry group
remains one call over a concatenated array.

**6. No public surface.** No coordinator callback, no bus event. No host uses the
resolution lock; `js/publicApi.js` is a pinned contract and is not widened
speculatively.

**7. Nothing serialized.** A view preference does not enter the session wire
format. `resolutionLocked` does not survive a session round trip today, and this
change does not alter that. It is a real gap, and deliberately a separate one:
adding a field to the wire format engages ADR-0006 and ADR-0011 and has nothing
to do with mirroring.

## Considered and rejected

- **Mirror everything a widget holds.** Rejected on the colour scale, which is
  the instructive case: two maps are often held at *deliberately* different
  thresholds, and unlike the lock the threshold is persisted in the session, so
  mirroring it would silently rewrite what a user saved. A rule that damages the
  clearest case is the wrong rule.
- **A group-level property.** See decision 2.
- **Fix the lock instead of mirroring it.** `State.sync` ignores the receiver's
  `resolutionLocked`, so a locked browser follows a peer's resolution change
  anyway, and the coordinator then clears the lock it just defeated. That is a
  genuine defect and it is filed as #608 — but fixing it means a locked browser
  *stops following its peers' resolution*, which is a product decision about what
  "synced" means, not a repair. It is deliberately not bundled here.

## Consequences

- Mirroring the lock **incidentally mitigates** #608 on gesture paths: once the
  peer is locked too, its own wheel and drag honour the lock, so no resolution
  change propagates back. The dropdown and locus-goto paths are unaffected, and
  neither defect is fixed.
- Padlocks agree in every case reachable through the UI. The rung-mismatch
  divergence that decision 3 originally accepted is closed by mirroring the
  auto-clears.
- The next "why doesn't X sync?" request has a written answer, and re-opening it
  means superseding this ADR rather than re-arguing from scratch.
