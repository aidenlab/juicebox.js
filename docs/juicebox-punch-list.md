# Juicebox.js — Punch List

**As of 2026-09-18, `v4.5.0` plus master.** The architecture review closed at `v4.0.0` with eight of eleven
candidates landed. The three left over are open issues, each waiting on a decision:
[#580](https://github.com/aidenlab/juicebox.js/issues/580),
[#581](https://github.com/aidenlab/juicebox.js/issues/581) and
[#582](https://github.com/aidenlab/juicebox.js/issues/582). Since then, v4.1–v4.4 shipped the
sync-group and targeting work (ADR-0010 to ADR-0016), none of it a review candidate; since
v4.5.0 the target set carries contact maps too (ADR-0018).

> **This is the working scratchpad — the only one.** Thrash it freely; nothing else has to
> agree with it. Where the durable facts live:
>
> | Question | Where it is answered |
> |---|---|
> | Why was this decided? | `docs/adr/` — append-only, never revised |
> | What does this word mean? | `CONTEXT.md` |
> | What refactor is next, and why? | `docs/architecture-review.html` — the backlog |
> | What shape is the code in? | `docs/architecture-map.html` |
> | What do I do next on this ticket? | the GitHub issue |
> | What is unblocked right now? | **query GitHub**, not this file — blocking edges are native |
> | Which skill do I reach for? | `docs/agents/triage-labels.md` |
> | How do I cut a release? | `docs/release-ceremony.md` |
>
> If a fact here contradicts one of those, the other one wins and this file is stale.
> **Do not create a second punch list.** Per-candidate decomposition goes in issue bodies,
> where it cannot drift.

Three repos are involved:
- `~/JuiceboxDevelopment/juicebox.js`
- `~/JuiceboxDevelopment/juicebox-web` — pinned `v4.5.0`
- `~/SpacewalkDevelopment/spacewalk` — pinned `v4.5.0`

---

# NEXT — the three left over from the review

None of the three was found wrong; all three were found unpicked. Each is `ready-for-human`:
a decision comes first, then an ADR, then tickets.

| Candidate | Issue | The decision it is waiting on |
|---|---|---|
| **10 · one dataset-load path** — *the live-map seam* | [#581](https://github.com/aidenlab/juicebox.js/issues/581) | **Was the live-map disguise the right call?** Spans three repos — hic-straw, Spacewalk, and the thin adapter here |
| **7 · gesture state machines behind `InteractionHandler`** | [#580](https://github.com/aidenlab/juicebox.js/issues/580) | **Can its shape be planned at all?** ~300 lines of closures with no test surface to read the behaviour off. `/wayfinder` may be the honest tool rather than `/grill-with-docs` |
| **11 · give the track tile one owner** | [#582](https://github.com/aidenlab/juicebox.js/issues/582) | **Split it?** Cache ownership is safe and fixes a real stale-tile bug; the ordering half reaches into the published `TrackXYPairLoad` payload |

**Rendering, gestures and dataset loading are still verified mostly by hand**, and ADR-0013
declined browser-level automation. For all three, what pins today's behaviour before anything
moves is the *first* question.

**Not yet a candidate: the hub is growing again.** `hicBrowser.js` went from 1235 to 1831 lines
and `browserRegistry.js` from 429 to 846 across v4.1–v4.5 and the map broadcast. The pure rules came out as
`syncGroup.js` and `targetGroup.js`; the wiring stayed in the hub. No card covers that code. The
next architecture scan should start there, and add its cards to the existing review.

**ADR-0019 is the next free number.** 0007 was reserved for #477 and never written; the gap is
deliberate.

---

# Open issues in code the candidates would move

Surveyed 2026-09-10. None blocks anything. Listed so a candidate's tickets are read with them in
mind rather than rediscovered — **query GitHub for live state**.

| Issue | Touches | What it is |
|---|---|---|
| [#638](https://github.com/aidenlab/juicebox.js/issues/638) | #581 | Loading a live contact map leaves a one-sided sync edge — the live path's own copy of the post-load sync step |
| [#567](https://github.com/aidenlab/juicebox.js/issues/567) | #581 | Every live contact map opens one bp below the origin, and nothing clamps it back |
| [#591](https://github.com/aidenlab/juicebox.js/issues/591) | #581, #582 | Two sources of truth for bin size: the map draws from `zd.zoom.binSize`, everything else from `dataset.bpResolutions[zoom]` |
| [#587](https://github.com/aidenlab/juicebox.js/issues/587), [#588](https://github.com/aidenlab/juicebox.js/issues/588) | restore | Restoring blocks on 1D track loads, serially and unbounded; a pre-#584 session hangs on an unindexed sequence track |
| [#525](https://github.com/aidenlab/juicebox.js/issues/525) | `normalizeSession` | Forcing every track to `COLLAPSED` — override or default? |
| [#642](https://github.com/aidenlab/juicebox.js/issues/642) | sync groups | Chromosome aliases don't pair outside hg19/hg38/mm10 |
| [#435](https://github.com/aidenlab/juicebox.js/issues/435) | #580 | Anchored smooth zoom: confirm the anchoring reading and decide on an explicit anchor parameter |

**One defect is known and not filed.** `encodeSessionString` hands raw JSON to igv-utils'
`BGZip.compressString`, which truncates every character above U+00FF (`charCodeAt` into a
`Uint8Array`). A curly quote or em-dash in a caption, dataset name or track name comes back wrong
from a shared link. Found by the original review; still live at `v4.4.0`.

---

# DONE — eight of eleven

One line each; the reasons are in the ADRs.

| # | Candidate | Record |
|---|---|---|
| 1 | Lift the tile pipeline out of the contact matrix view | #428 |
| 2 | Delete the event bus; keep the coordinator — the buses were kept, both are consumer API | ADR-0002 · #414 |
| 3 | Collapse the pass-through modules around HICBrowser | #467, #468 |
| 4 | Give the browser registry an owner | ADR-0004 |
| 8 | Give the browser a teardown that matches its construction | ADR-0005 |
| 5 | One decoder for session and URL | ADR-0006, ADR-0011 |
| 9 | Give the config schema one reader | ADR-0008 · `docs/config-schema.md` |
| 6 | Fold `StateManager` into `State`, and make restore use the chokepoint | ADR-0009 |

---

# What to carry into the next candidate

- **Consumer lens first.** `HICBrowser` is not exported, but hosts get instances from `init()`,
  so its whole surface is public in practice. "No callers in `js/`" is half a finding: check
  `js/publicApi.js` and ADR-0003. `npm run measure-consumers` re-measures both hosts (#474).
- **The measurement trap.** Spacewalk embeds igv as well as juicebox, and both are reached through
  a variable named `browser`. Resolve what a name refers to; don't trust the match.
- **ADR → gate → tickets.** Every landed candidate followed it. A candidate scoped as needing no
  ADR can still owe one, and it comes due on the last ticket.
- **A gate proves the production path did not change — not that the tests drive it.** A fixture
  that writes canonical state directly cannot observe the invariant the chokepoint enforces.
- **A gate's byte-identical criterion can be made impossible by the work itself.** Tally the diff
  by hand and log the kinds of movement.
- **A claim in a comment is a claim, not a finding** — re-check it before building on it.
