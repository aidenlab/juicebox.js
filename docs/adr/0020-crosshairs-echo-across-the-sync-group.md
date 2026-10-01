# ADR-0020 — Crosshairs echo across the sync group; the host hears only the source

**Status:** Accepted
**Date:** 2026-10-01
**Amends:** ADR-0014 (the "crosshairs, when they land" row of its category table)
**Related:** ADR-0003 (public surface), ADR-0013 (test tier), ADR-0016 (sync
membership), `CONTEXT.md` (*Crosshairs*, *Echo*, *Sync group*)

## Context

ADR-0014 deferred crosshairs whole, naming two open questions — the unit a
position travels in, and whether a mirrored crosshair fires the host's handler —
and pencilled them in as a *view preference*. They are not one: nobody sets them,
they last only while Shift is held, and they change no gesture's meaning. They
are a pointer position.

## Decision

1. **Crosshairs are a fourth, transient kind of thing**, outside ADR-0014's three
   categories. They are never serialized. ADR-0014's table row is withdrawn.
2. **The sync group echoes, by default, with no separate switch.** Membership is
   the only rule (ADR-0014 decision 5); `synchable: false` is the opt-out. An
   isolated panel has no echo.
3. **The position travels genomic** — chromosome name and bp per axis — and each
   receiver places it in its own pixels, hiding an axis whose position is out of
   view. Screen units would disagree across viewport sizes and across locked peers
   on different rungs. In the whole-genome view the position is a real chromosome,
   so peers ordering chromosomes differently still mark the same locus.
4. **The source is the panel the pointer is over now.** Entering a viewport with
   Shift held makes it the source without waiting for a keydown (macOS does not
   repeat modifier keys); leaving every viewport hides the crosshairs group-wide.
   A view change under a still pointer re-derives and re-publishes the position.
5. **The host hears once per pointer move, from the source, never from an echo.**
   Drawing guides and notifying the host are separate steps. The surface becomes
   two coordinator callbacks, `onCrosshairsMove({chr1, xBP, chr2, yBP, extents})`
   and `onCrosshairsHide()`; the viewport-fraction interpolants are dropped, since
   they are only correct when the viewport spans exactly the host's locus.
   The host is told only while the source shows a chromosome pair: in the
   whole-genome view the visible extents run along the genome and the locus
   along a chromosome, so the guides and echoes still draw (decision 3) and
   the host hears nothing -- a view change into it is an `onCrosshairsHide`.
6. **The old surface is deprecated, not removed**: `setCustomCrosshairsHandler`,
   `DidShowCrosshairs` and `DidHideCrosshairs` remain in 4.x as shims over the new
   callbacks, source-only, and go in 5.0. Spacewalk — the only known consumer —
   moves to the new callbacks at once.

## Considered and rejected

- **Echo to every panel in the registry**, or to the target set: the first asks a
  panel to place a locus it may not carry; the second ties crosshairs to a gesture
  aimed at loading data.
- **Fire the host from every panel drawing crosshairs**: N calls per move, each
  overwriting Spacewalk's single shared highlight.
- **A distinct style for echoes**: the pointer already marks the source.
