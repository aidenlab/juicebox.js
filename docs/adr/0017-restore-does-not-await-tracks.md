# ADR-0017 — A restore does not await tracks, and no track load has a timeout

**Status:** Accepted — decided in the #588 grilling; partially implemented. Decision 6
landed in #663, decision 3 in #664 (a restore still awaits its tracks there); the rest
of #588 is pending.

**Date:** 2026-09-15
**Related:** #588 (the work), #584 (where the hang was found), #587 (the unindexed
FASTA, the one known never-settling track), #615 (`loadTracksOrThrow`, the
target-set fan-out), ADR-0003 (public API contract), ADR-0004 (the alert dialog),
ADR-0005 (dispose / reset), `CONTEXT.md` (*Pending track*, *Restore*),
`js/hicBrowser.js`, `js/dataLoader.js`

## Context

`restoreSession` resolved only once every track in the session had loaded:
`BrowserRegistry.restoreSession` → `createBrowserList` → `HICBrowser.init` →
`DataLoader.loadTracks`. Three facts made that worse than the ticket first said.

1. **The map was not usable meanwhile.** `init` awaits tracks in the same
   `Promise.all` as the normalization vector files, and everything after it —
   resolving the session's normalization, seeding its colour scale, the first
   `update()`, lowering the interaction shield — waited too. One slow track froze
   the map, not just the gutter.
2. **Nothing bounded it.** A track that fails is reported; a track that neither
   resolves nor rejects spun forever with no error.
3. **1D tracks loaded serially, and one failure lost them all.** `igv.createTrack`
   was awaited inside the loop, so a throw exited it: later tracks were never
   tried and earlier ones never reached layout.

Both hosts were checked. juicebox-web resyncs the control-map dropdown after
`await hic.restoreSession` (`js/initializationHelper.js`); Spacewalk reads
`getCurrentBrowser()` and applies a locus (`src/juicebox/juiceboxPanel.js`).
Neither reads tracks.

## Decision

**1. A restore resolves once the maps are usable.** `restoreSession` resolves
when every browser's maps, normalization vectors, normalization and colour scale
are applied and the interaction shield is down. 1D and 2D tracks may still be
loading. Its jsdoc says so; there is no new "tracks done" signal for hosts.

**2. No timeout, on any track load.** Slow and hung are indistinguishable from
the client, and every duration is wrong for somebody's large BAM. The escape hatch
is the user's: see 4.

**3. A pending 1D track is a placeholder row**, reserved in its session position
when the load starts, carrying the track's name and the small track spinner. It
becomes the track pair on load and is removed on failure. The map spinner never
shows for a track load — at restore or at runtime (`loadTracks`,
`loadTracksOrThrow`, the target-set fan-out), whose promises still resolve after
their own tracks. Reserving rows up front also stops the map jumping as each late
track lands.

**4. A placeholder can be dismissed**, which drops the track from the session.

**5. A pending track is part of the session.** `toJSON` writes it from its
config, so a save made while it loads keeps it. A failed track is dropped, as
today.

**6. 1D tracks load in parallel, each settling alone.** Everything that loads is
laid out in session order; failures are collected into one report. `loadTracks`
shows it in the alert dialog; `loadTracksOrThrow` rejects with it. Failures stay
modal even when they arrive after the map is usable — the alert dialog is where
load failures go.

**7. 2D tracks are not awaited and get no indicator.** They draw when they
arrive; a failure is reported. They have no row, and the 2D Annotations panel is
rarely open.

**8. A load that settles after its placeholder is gone is discarded silently** —
no layout, no alert — whether the placeholder was dismissed, the browser disposed
or reset, or the session replaced by another restore. `igv.createTrack` cannot be
cancelled, so this is what stands in for cancellation.

## Considered options

- **Keep awaiting, add a per-track timeout.** Preserves "resolved means fully
  materialised", but still freezes the map for the timeout's length and fails
  healthy large files.
- **Stop awaiting, and add a timeout anyway.** The timeout would misreport slow
  files as failed to buy a distinction dismissal gives the user directly.
- **A navbar "N tracks loading" indicator** instead of placeholder rows. Says that
  something is loading but not which track is stuck.
- **Non-modal failure on the placeholder row.** Less intrusive, but gives restore
  failures a surface no other load failure uses.

## Consequences

- A host sequencing work after `await restoreSession(...)` that needs tracks has
  to wait for them itself. The two known hosts do not.
- The resolved meaning of `restoreSession` is a public contract (ADR-0003):
  reverting to "resolved means tracks too" would be a breaking change in the
  other direction.
