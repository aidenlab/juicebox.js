# ADR-0022 — A repaint does not await track pairs

**Status:** Accepted — implemented in #774; decision 5 in #775; decision 6 in #776.

**Date:** 2026-11-13
**Related:** #763 (a paint that never settles freezes the map), #774 (the work),
#587 (the unindexed FASTA, the known instance), ADR-0017 (a restore does not
await tracks, and no load has a timeout), ADR-0003 (public API contract),
`CONTEXT.md` (*Update* vs *repaint*), `js/hicBrowser.js`, `js/trackPair.js`,
`js/browserRegistry.js`

## Context

A browser's `update()` awaited its `repaint()`, and the repaint awaited every 1D
track pair's paint in one `Promise.all` with the contact matrix. A track whose
feature fetch neither resolves nor rejects therefore left the update in flight
forever. Every later update was remembered as the single pending one and never
ran, so the map stopped repainting and the spinner stayed up.

It froze more than the map. The crosshairs refresh and the peer sync run after
the repaint, so the sync group stopped following too; and the registry's
`updateAll()` awaits panels in turn, so every panel after the stuck one waited
as well.

ADR-0017 stopped *restore* awaiting track loads, but a track loads cheaply and
fetches only when painted, so the hang moved from restore to the first update
after it. #587 fixes one case (an unindexed FASTA read whole); any track whose
fetch stalls — a huge unindexed file, a host that accepts the connection and
never answers — freezes the map the same way.

## Decision

**1. A repaint resolves once the contact matrix has painted.** Each track pair is
set painting and not awaited. `update()` and `updateAll()` resolve once the
matrix has painted, the crosshairs are refreshed and the peers are synced, with
tracks possibly still painting. Their jsdoc says so.

**2. Track pairs paint on their own.** A slow track paints late. Calls that
arrive while a pair's paint is in flight coalesce into that pair's single retry,
as they already did, so a stuck pair accumulates one retry, not one per pan, and
the other pairs keep painting.

**3. No timeout on a paint.** ADR-0017's reasoning applies unchanged: slow and
hung look the same from the client, and every duration is wrong for somebody's
large file.

**4. A paint that fails is the pair's, and is a warning.** The pair catches it,
logs it with `console.warn`, and keeps its last good tile; the update still
resolves. Not the alert dialog: a paint can fail on every pan, and the dialog is
for load failures (ADR-0017 decision 6).

**5. A paint that settles after its pair is removed is dropped silently** — it
draws nothing and does not start the retry coalesced into it. **Remove track** in
the gear menu is the escape hatch from a stuck pair; there is no new control. A
fetch cannot be cancelled, so discarding its late result stands in for
cancelling it, as ADR-0017 decision 8 does for loads. Implemented in #775.

**6. A track pair shows its own spinner while a paint fetches.** With the map
spinner now covering only the contact matrix, a slow track would otherwise sit
blank or stale with nothing to say it is working. The pair raises the track
spinner — the one a pending track shows (ADR-0017 decision 3) — on its x and y
track together, and only when a pass misses its tile cache and fetches, so a
pan within a cached tile does not flicker it. It comes down when the pass ends,
whether it paints, fails or is abandoned. As with a pending track, the user can
see *which* track is stuck. Implemented in #776; the DOM is checked by hand
(ADR-0013).

## Considered options

- **Keep awaiting, add a per-paint timeout.** Freezes the map for the timeout's
  length on every pan over a slow track, and misreports healthy large files.
- **Await tracks, but outside the update's critical section** (sync first, then
  await). Still holds the update, so later pans still coalesce behind the stuck
  track and the map still stops.
- **Report paint failures in the alert dialog.** A failing host fails on every
  pan: a modal per gesture.

## Consequences

- A caller that needs the tracks drawn after `await update()` cannot get it from
  `update()`. No host relies on the old meaning: Spacewalk calls the contact
  matrix view's `update()` directly, and juicebox-web calls neither.
- A stuck pair stays stuck until its fetch settles; its retry then paints the
  view current at that time. Removing the track is the user's escape hatch
  (decision 5): the fetch runs on, but its result is dropped.
- The resolved meaning of `update()` is public contract (ADR-0003): reverting to
  "resolved means tracks too" would be a breaking change in the other direction.
