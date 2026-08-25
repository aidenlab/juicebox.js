# Juicebox.js — Punch List

**As of 2026-08-24. The architecture review is closed and juicebox.js is released as `v4.0.0`.** Eight of eleven candidates landed; the three nobody picked — 7, 10 and 11 — were **descoped and carried out** of [#466](https://github.com/aidenlab/juicebox.js/issues/466) as [#580](https://github.com/aidenlab/juicebox.js/issues/580), [#581](https://github.com/aidenlab/juicebox.js/issues/581) and [#582](https://github.com/aidenlab/juicebox.js/issues/582), each `ready-for-human`. All five owed release notes shipped. **There is no tracking issue any more** — the three successors stand on their own, and the next move is picking one of them or not.

> **This is the working scratchpad — the only one.** Thrash it freely; nothing else has to
> agree with it. Where the durable facts live:
>
> | Question | Where it is answered |
> |---|---|
> | Why was this decided? | `docs/adr/` — append-only, never revised |
> | What does this word mean? | `CONTEXT.md` |
> | What do I do next on this ticket? | the GitHub issue |
> | Is the candidate done? | [#466](https://github.com/aidenlab/juicebox.js/issues/466) — **closed 2026-08-24**, and now history rather than status. Live state for the three survivors is #580, #581, #582 |
> | What is unblocked right now? | **query GitHub**, not this file — blocking edges are native |
> | Which skill do I reach for? | `docs/agents/triage-labels.md` |
> | What did the review originally say? | `docs/architecture-review.html` — **frozen**, cards are not edited |
>
> If a fact here contradicts one of those, the other one wins and this file is stale.
> **Do not create a second punch list** — candidate 4 did, and it had to be deleted. Per-candidate
> decomposition goes in issue bodies, where it cannot drift.

Three repos are involved:
- `~/JuiceboxDevelopment/juicebox.js`
- `~/JuiceboxDevelopment/juicebox-web` — pinned `v3.6.2`
- `~/SpacewalkDevelopment/spacewalk` — pinned `v3.6.2`

**All skills below except `/request-refactor-plan` must be typed by you** — they are marked
`disable-model-invocation` and cannot be self-started.

---

# JUST LANDED — Candidate 6

**Fold `StateManager` into `State`, and make restore use the chokepoint.** Scoped by
[ADR-0009](adr/0009-restore-is-a-translator.md), filed as #557–#563, landed 23 August 2026 as
`7eab0c1..83e5457`. **Eight of eleven candidates are done and nothing queues behind this one** — see
*NEXT* below, and the Outcome box on the card in `docs/architecture-review.html`.

## The chain

Blocking edges are **GitHub-native**. This table is a map, not the gate — query the tracker for
what is actually unblocked.

| # | Ticket | Blocked by |
|---|---|---|
| ~~**#510**~~ | `State.default()` passes six arguments to a seven-parameter constructor | ✅ **fixed** — the default view opens at the origin, and the ignored `config` parameter is gone from `State.default` and `decodeState` |
| ~~**#557**~~ | Gate: snapshot the resolved state every restore door produces today | ✅ **landed** — 450 records, five doors, two viewports |
| ~~**#558**~~ | Restore routes through the chokepoint, and the clamp gets one enforcer | ✅ **landed** — `StateManager.setState` delegates to `setView`, `updateLayout`'s `clampXY` is gone, **2 of the gate's 450 records moved** |
| ~~**#559**~~ | `setActiveDataset` loses its `state` parameter | ✅ **landed** — the parameter is gone from all five `dataLoader` sites, the `config.locus` door now reaches `setState`, and **the gate's `rungs` field moved on all 450 records while not one `state` field did** |
| ~~**#560**~~ | `resolutionChanged` tells the truth on restore | ✅ **landed** — the flag is computed against the state going out of force, and **not one of the gate's 450 records moved** |
| ~~**#561**~~ | Normalization is validated against the loaded dataset at restore | ✅ **landed** — a normalization the loaded dataset does not offer is coerced to `NONE` in the chokepoint, `NONE` short-circuiting ahead of the dataset |
| ~~**#562**~~ | The sync trio splits three ways | ✅ **landed** — `canBeSynched` to `syncGroup.js`, `getSyncState` to `State`, `StateManager.syncState` deleted; **the `synchable` guard on `HICBrowser.syncState` stayed**, see below |
| ~~**#563**~~ | `StateManager` folds into `State`, the setters go, and the discipline is written down | ✅ **landed** — `StateManager` is gone, the state is a private field on `HICBrowser` with one writer, and **neither golden moved**; the find was in the fixture, see below |

**#560, #561 and #562 were a parallel branch** off #559; #563 was the join, and all three legs went in first. This is the first
candidate with real fan-out rather than a linear chain — which is exactly why the edges are native
rather than read off a table here.

**#558 is the ticket that deliberately moves snapshots.** #560 was expected to move them for a
second, separately attributable reason, which is why it was not bundled into #558.

**#560 moved nothing, and the separation still earned its keep.** ADR-0009 decision 3 predicted a
snapshot move; the gate records the resolved `State` after restore, and a change flag is not a
resolved state, so there was nothing there to move. The prediction was wrong about the mechanism and
right about the discipline: had the flag been bundled into #558, the two records that *did* move
would have had two candidate explanations and no way to choose between them. A separation that costs
one ticket and buys an unambiguous attribution is worth making even when the movement it guards
against does not arrive.

The behaviour did change, where a snapshot cannot see it. `resolutionChanged` is what releases the
resolution lock in `browserCoordinator.onLocusChange`, and it is handed to external `onLocusChange`
callbacks as declared payload — so a restore onto the current zoom now leaves a locked resolution
locked. The repaint was never at stake: `hicBrowser.setState` calls `update()` on every restore,
flag or no. `test/testRestoreResolutionChanged.js` pins the lock, which is the observable half.

**What #558 actually moved: two records of 450**, both the `config.state` door in the `1600x400`
column, both an `x` clamp on a saved origin too near the end of its chromosome for a wide viewport —
and neither moved in the `800x800` column, which is the asymmetry that proves it is a clamp and not
a coincidence. The tally is in `test/testRestoreGolden.js`'s log. The `MAX_PIXEL_SIZE` cap fired on
nothing: the corpus's largest saved `pixelSize` is 8.02 against a cap of 128, so the cap is pinned by
a written test (`test/testRestoreClamp.js`) rather than by a snapshot.

## What the grilling cost the card

Read ADR-0009 before touching a ticket. Four of the card's claims did not survive scoping:

- **The card points at the wrong back door.** `browser.state = x` and `browser.activeState = x`
  carry the "bypasses validation" comment and have **zero production callers** — only tests. The
  live bypass is `setActiveDataset(dataset, state)`: five `dataLoader` sites, unvalidated, no
  comment.
- **The defect is intermittent.** `clampXY` is reachable from `updateLayout()`, which runs only
  when tracks change. A restored session carrying a track is clamped incidentally; a bare map
  restore never is. Same session, two behaviours — and it is why the gate states *two* viewports:
  at one, a golden cannot tell a clamp from a coincidence.
- **The sync trio is not one group.** Moving `canBeSynched` onto `State`, as the card says, would
  make a *fourth* copy of the `synchable` rule rather than removing the third. ✅ Held up in #562:
  the three copies collapsed to one `isSynchable` in `syncGroup.js`, and `State` gained only
  `getSyncState`, which is a projection through a dataset like `getLocus`.
- **Counts moved.** `StateManager` is twelve methods, not ten; `testState.js` is 70 tests, not 54,
  and **none of them drives a restore**.

**Measured rather than assumed:** the viewport *is* sized before restore runs in a real browser
(`rootElement` is appended in the constructor), so the clamp is not decorative — but it reads
`{width: 0, height: 0}` in the harness, so the gate's fixture must state one. Probe output is in the
ADR.

**What #559 actually moved: the `rungs` field on all 450 records, and no `state` field at all.**
`setActiveDataset(state)` — the count of states installed without the chokepoint seeing them — left
the file entirely, and `setState` arrived on the `config.locus` door in both viewport columns. The
`locus` door's validated state is overwritten by `parseGotoInput` a line later, so what the door
gained is not visible in a snapshot; `test/testRestoreBackDoor.js` trapped `activeState` itself and
asserted every state installed during that load came out of the chokepoint. **#563 made that
structural**: the field is private, there is nowhere to write it from, and what the file asserts now
is that the state left standing is one the chokepoint produced. **The `synchState`
branch was fixed but cannot be exercised in production: the rung is unreachable (#566), so #559's
third acceptance criterion is narrowed to a test that pins both the unreachability and the branch's
correctness for when #566 lifts it.**

**One thing #558 broke quietly and #559 had to finish.** The chokepoint installs a *clone*, so the
state a rung hands it stops being the state in force the moment it is accepted — and `onMapLoaded`
was publishing the handed-over object. Harmless while the rung's state was the installed one; a
whole-genome default published to hosts for a `?locus=` load once the `config.locus` rung went
through the chokepoint. Both paths now read the payload back off the browser. **The gate cannot see
this class of defect** — it records `browser.state`, never the callback's argument — which is worth
remembering for #560, #561 and #562, all three of which move the same seam.

**What #562 could not delete: `HICBrowser.syncState`'s `synchable` guard.** The ticket named it as
one of the three copies and expected the callers to carry the question. Both review axes found the
same seam from opposite sides: the load-end sync step in `dataLoader` filters peers on
`isCompatible` and **never looked at `synchable`**, so that guard was its only opt-out — and
`synchedBrowsers` is a snapshot from the last `registry.sync()`, so a host flipping `synchable`
afterwards was caught by the guard too. Deleting it strengthened one path and weakened the other,
which "moves code, does not change what syncing does" does not allow. The guard stayed, written as
`isSynchable(this)` — **one statement of the rule, three readers**, which is what the acceptance
criterion was actually protecting. `test/testSyncOptOut.js` pins both paths and fails without it.

**One split found while decomposing, against the ADR's own sequencing.** The ADR treats restore
through the chokepoint as one ticket; it is two. Three of the five `setActiveDataset` call sites are
immediately followed by `browser.setState`, which overwrites the unvalidated assignment — so #558
fixes those three by itself. The `locus` and `synchState` branches leave the unvalidated state
standing and need #559. **The ADR was right about the decision and wrong about the ticket boundary,
which is the ordinary way round:** ADRs find decisions, decomposition finds call sites.

## What #563 found, and it was in the test fixture

**The fold itself was uneventful** — `StateManager` was a wrapper re-wrapped by ten accessors, and
once #558–#562 had taken the behaviour out there was nothing on the far side of the delegation but
the field. `dataset` and `controlDataset` are plain fields on `HICBrowser`; the state is private,
because a public field cannot be read-only and read-only is the whole of the change. The
`state`/`activeState` **getters stayed and the setters went** (ADR-0009 decision 7, ADR-0003's
reasoning): reading is plausible host behaviour, writing is not, and nothing outside tests did it.

**The value was in `test/utils/stubbedLoads.js`, exactly as the ticket predicted.** Routing the
fixture through the chokepoint surfaced two defects in it, both invisible while it wrote the field:

- **The dataset was too thin to clamp against.** Two chromosomes, six resolutions, no `getMatrix` —
  so `clampXY` and `minPixelSize` could not have run against it at all. It uses `restoreDataset`
  now, the honest hg19 stand-in #557 built for the golden, which grew a `genomeId` override for the
  sync suites. One dataset stub, two purposes.
- **It decoded the state with the wrong function.** `State.fromJSON` where the two ladder rungs that
  carry a state call `decodeState`. A session blob spells its state as a comma-separated *string*,
  and `fromJSON` on a string returns a `State` whose every field is `undefined`. Nine suites had
  been standing on that, including the config golden's session-blob fixture — the one whose note
  reads *"if exactly one fixture in this file has to keep working, it is this one"*.

**One finding was filed rather than fixed: #575.** `init` writes `state.normalization` unvalidated
inside its `config.colorScale` branch, 35 lines above the validated write that overwrites it. Older
than candidate 6, and transient — but it is a second copy of a field write in the code #563 claims
has one enforcer, so it is filed against the claim rather than left to be rediscovered.

**The general form is worth keeping:** a fixture that writes canonical state directly cannot observe
the invariant the chokepoint exists to enforce, and it will not fail while it does. The gate proves
the production path did not change; it says nothing about whether the path the tests drive *is* the
production path. Neither golden moved on #563 — 450 restore records and 65 config records
byte-identical — which is the fold being a fold, and is not evidence about the fixture either way.

**Two tests changed instrument rather than claim.** `testRestoreResolutionChanged.js` read the flag
off the inner `setState`'s return value; there is no inner `setState` now, so it reads the
`onLocusChange` payload, which is what `js/publicApi.js` declares as contract and is the better
instrument anyway. `testAccessorVocabulary.js` gained a claim that the setters are gone, and lost
the one that wrote through them.

## Pre-existing issues this candidate touches

Surveyed 2026-08-22. **None of these is a candidate-6 ticket** — they are older issues that live in
the code it moves, and the point of listing them is so the tickets are read with them in mind rather
than rediscovered one at a time.

| Issue | Open since | Relationship | Do what |
|---|---|---|---|
| ~~**#510**~~ | Aug 2026 | Was the frontier. Promoted from a candidate-5 follow-up by ADR-0009 | ✅ **fixed**, before the gate, exactly as ADR-0009 sequenced it |
| **#372** | Jul 2026 | Its **validation half is #561**. Restore is the first moment a valid normalization set exists | ✅ narrowing recorded on the issue; open, `ready-for-human` — "tell the user" is an error-UX decision nobody has made |
| ~~**#528**~~ | Aug 2026 | **Answered by ADR-0009.** It asked whether a numeric seventh state token (`normalization: "2000"`) should be rejected or coerced; decisions 2 and 5 say coerce, at restore, against the dataset | ✅ **closed** — #561 coerces it, and the restore golden pins `"2000"` in, `"NONE"` out, at both viewports |
| **#280** | 2018 | **Hypothesis weakened by #566** — the rung it blames is unreachable, not racy. See below | linked both ways with #562; still open, needs the repro, do **not** close on the reading |
| **#473** | Aug 2026 | Same in-flight hazard as #469, on `TrackPair` rather than `ContactMatrixView`. Candidate 6 changed who owns state mutation | **neither easier nor harder** — the identity check `testRepaintDuringReset.js` pins is unaffected by the fold. Still open, `needs-triage` |
| ~~**#125**~~ | 2020 | Asked how `state` should be encoded for `loadHicFile`. The syntax in the question was always right; `docs/url.md` now documents v0 and v1 per ADR-0006 decision 2 | ✅ **answered and closed** |
| ~~**#283**~~ | 2018 | Share produced `?juiceboxURL=undefined`. Moot — nothing writes that format since #506; only the adapter that refuses it remains | ✅ **closed as moot** |

### The #280 hypothesis, written down so it is testable rather than remembered

"Load two maps by URL, share the link, reopen it — the maps are synced about 30% of the time."

The `synchState` branch of the load ladder consults `canBeSynched` **before** the dataset is
assigned, and `canBeSynched` returns false when `activeDataset` is undefined. So on a shared
two-map URL, whichever browser loses the load race falls through to the `else` branch and opens at
`State.default` instead of synced. A race would produce exactly the reported intermittency.

**Not reproduced, and the mechanism is now doubtful.** #566 found the `config.synchState` rung
*unreachable* rather than racy: `clearDataset()` runs four lines above it, so `canBeSynched` is
never true and every first load carrying a `synchState` takes the fallback — not 30% of the time,
always. A rung nothing takes cannot produce intermittency, so either #280 is a different bug or the
reading is wrong about which door it comes through.

**#562 landed without testing it**, deliberately: the check needs the repro, not another reading,
and #562 moved `canBeSynched` without changing what it answers. **#280 stays open and stays linked.**
The next honest move is to run its repro against a build with #566 lifted; until then it does not
belong in candidate 6's Outcome box.

## Filed during candidate 6, still open

| Issue | State | What it is |
|---|---|---|
| **#575** | `needs-triage` | `init` writes `state.normalization` unvalidated in its `config.colorScale` branch, 35 lines above the validated write that overwrites it. Found by the review axes on #563; older than the candidate, transient in effect |
| **#566** | `needs-triage` | The `config.synchState` restore rung is unreachable — `clearDataset()` runs four lines above a guard that needs a dataset. Pinned both ways in `testRestoreBackDoor.js`: unreachable today, correct for when this lifts |
| **#372** | `ready-for-human` | Narrowed to its notification half; the validation half landed in #561 |
| **#280** | — | Still open, still unreproduced; #566 weakened its mechanism. Needs the repro, not another reading |

## The release note this candidate owes

**A saved view whose `pixelSize` or origin violates an invariant now opens clamped rather than as
written.** ✅ True as of #558, and unchanged by the rest of the candidate. **A second note is owed
by #563:** `browser.state = x` and `browser.activeState = x` now throw. Neither host writes them,
which is why the setters went — but the accessors are declared public surface, so their removal is a
release note rather than an internal change. That is phase 4's **fifth** note and the **second** an end user can
hit. Clamping
silently is decision 2 — the same "coerce, never reject" rule the normalize stage already follows.

---

# NEXT — the three that were carried out

**#466 is closed and these three are no longer candidates; they are three ordinary issues.** They
were descoped on 24 August because #466's own rule — *no release until every candidate is done* —
had stopped gating the release and started blocking it: eight landed candidates and five owed
release notes sat unreleased on `master` behind three candidates nobody had picked in a month.

**None of the three was found wrong. All three were found unpicked** — which is why the cards in
`docs/architecture-review.html` are unedited, and each carries an amber *carried out* box rather
than a green Outcome box.

| Candidate | Issue | The decision it is waiting on |
|---|---|---|
| **7 · gesture state machines behind `InteractionHandler`** | [#580](https://github.com/aidenlab/juicebox.js/issues/580) | Whether its shape can be planned at all. ~300 lines of closures with **no test surface to read the behaviour off** — the first candidate where `/grill-with-docs` may not be enough and `/wayfinder` is the honest tool |
| **10 · one dataset-load path** — *the live-map seam* | [#581](https://github.com/aidenlab/juicebox.js/issues/581) | **Whether the live-map disguise was the right call.** Not a deduplication question, and the answer spans three repos — hic-straw (not in the review at all), Spacewalk, and the thin adapter here |
| **11 · give the track tile one owner** | [#582](https://github.com/aidenlab/juicebox.js/issues/582) | **Whether to split it.** Cache ownership is safe and fixes a real stale-tile bug; the ordering half reaches into published `TrackXYPairLoad` payload shape. Taking only the safe half may be the whole answer, and then it is a bug fix, not a candidate |

Each issue carries its card's Consumer impact block and what scoping already knows, so none of them
has to be re-derived from the HTML.

**The pattern, proven eight times: ADR → gate first → tickets → Outcome box on the card.** Candidate
9 added the corollary — a candidate scoped as needing no ADR can still owe one, and it comes due on
the last ticket, when the readers finally have to agree. **ADR-0014 is the next free number** (0007
was reserved for #477 and never written; the gap in `docs/adr/` is deliberate).

**Skill:** `/grill-with-docs` on any of the three — all are `ready-for-human`, meaning a decision
comes before code. `/to-tickets` only once the shape is settled. Routing rules are in
`docs/agents/triage-labels.md`.

**Rendering, gestures and dataset loading are still verified mostly by hand-running `dev/`,** so all
three face the gate problem the earlier candidates did: what pins today's behaviour before any of it
moves is the *first* question, not the last.

---

# DONE — candidates 1, 2, 3, 4, 5, 6, 8, 9

Eight of eleven. Phases 0, 1 and 2 are complete. Full outcomes are in the green boxes in
`docs/architecture-review.html` and on #466; the compressed version:

| # | Candidate | Outcome |
|---|---|---|
| 1 | Lift the tile pipeline out of the contact matrix view | `ecd44d9` (#428). 1116 → 761 lines; first rendering coverage in the repo |
| 2 | Delete the event bus; keep the coordinator | `66e68ec..3528717` (#414). Bus **kept** — both buses are consumer API. ADR-0002 |
| 3 | Collapse the pass-through modules around HICBrowser | `99c297b`, `18ac88b`, `d535e64` (#467, #468). Member-count target retired, not met |
| 4 | Give the browser registry an owner | ADR-0004 → #476, #478–#483. **Closes #384**, open since 2023, and #475 |
| 8 | Give the browser a teardown that matches its construction | ADR-0005 → #491–#496. Four teardown verbs → two. Not breaking |
| 5 | One decoder for session and URL | ADR-0006 → #499–#509. One deliberate break (`juiceboxURL=`); eight follow-ups filed |
| 9 | Give the config schema one reader | ADR-0008 → #531–#536. `normalizeSession` runs once at the entry; schema in `CONTEXT.md` |
| 6 | Fold `StateManager` into `State`, and make restore use the chokepoint | ADR-0009 → #510, #557–#563. Restore is a translator; `StateManager` deleted; the state has one writer. Owes a release note |

**Phase 3b — candidate 4's loose ends — is closed.** #477 scoped the `--hic-viewport-*` properties
to each browser's `rootElement` (`461535a`), and the registry click-through ran on 11 August as
#549, all six boxes. **Candidate 4 has no unverified claim left.**

Two lessons from 3b worth carrying, because both cost a re-run:

- **A manual box that names no gesture is a box nobody can check.** #549's original box read
  "confirm two panels size independently" — impossible, since nothing in the app resizes a browser
  and juicebox-web's clone copies the source's dimensions. It needed
  `dev/issue-477-per-browser-viewport-size.html` instead.
- **Verify against the thing, not the reading of it.** #479 was checked statically — 13 call sites,
  all resolving one registry — and that was not the same as clicking.

## Candidate 5's follow-ups

Eight were filed rather than fixed, per the standing file-and-keep-refactoring rule. **Two are
fixed** (#514, #515), and **#510** makes three — it landed ahead of candidate 6's gate.
Five remain: **#518**, **#519**, **#521**, **#525**, **#528** (now answered by ADR-0009
— see the table above). None of the five blocks anything.

---

# Phase 4 — Release: DONE, `v4.0.0`, 24 August 2026

#466 set the rule *no release until every candidate is done*. **That rule was retired rather than
satisfied** — see *NEXT* above. Both consumers were repointed off `v3.6.2`.

**Major, not minor.** `?juiceboxURL=` links are removed outright, a disposed browser throws, and a
saved view violating an invariant now opens clamped. Neither known host breaks — but a removed
public URL form is a major under semver, and ADR-0003's whole finding is that the browser-instance
surface is public in practice, so the number is the signal a third-party embedder gets.

## What the pre-release re-measurement found

**Every member either consumer uses is declared in `js/publicApi.js`. Zero undeclared members in
use** — across 160 commits, eight candidates, one deleted module and one removed wire format.

The drift was entirely in ADR-0003's hand-counted tables, and **it ran in both directions**, which
is the part worth carrying:

- juicebox-web has **dropped `browser.eventBus` entirely** (zero call sites) for
  `hic.EventBus.globalBus`, and **gained** `browser.coordinator.addCallback('onMapLoaded')` and a
  read of `hic.getCurrentBrowser().config`.
- Spacewalk has **dropped `browser.config`** and **gained** `browser.dataset` (for `dataset.isLive`)
  and `browser.loadHicFile`.

`browser.dispose()` and `registry.dispose()` have zero call sites in either consumer — candidate 8's
claim that neither known host can reach `DisposedBrowserError`, confirmed by measurement rather than
asserted.

**The measurement trap, because it will bite again:** Spacewalk embeds **igv as well as juicebox**,
and both are reached through a variable named `browser`. A naive
`grep -o 'browser\.[A-Za-z_]*' src/` returns ten members that are not ours — they are
`igvPanel.browser`. Scope to `src/juicebox/` and check call sites. This is the *inverse* of the
error that caused this whole review: there, grepping `js/` under-counted because the surface was
invisible from inside the repo; here, grepping a consumer over-counts because two libraries share a
noun. Same mistake both times — trusting a name match instead of resolving what the name refers to.
**#474 is still the fix**, and the full note is appended to `docs/adr/0003-public-api-contract.md`.

## The five release notes that shipped

1. **A disposed browser now throws `DisposedBrowserError`** rather than silently no-op'ing
   (candidate 8). Measured unreachable by both known hosts; a third-party embedder might hit it.
2. **`?juiceboxURL=` links no longer work** (candidate 5, #506). The one deliberate break in the
   wire format, and **not** the dead path ADR-0006 assumed: measured 9 August, bit.ly still expanded
   these and the session still decoded. How many exist was deliberately not measured beyond our own
   trackers (#509).
3. **A session saved while a browser panel was empty now restores with one fewer panel** (candidate
   5, #500), where before it produced a session that could not be reloaded at all. An improvement,
   but browser *count* no longer survives that round trip.
4. **A config saying `miniMode: true` now turns the locus box, map label and chromosome selector
   off** (candidate 9, #536, [ADR-0008](adr/0008-figuremode-absorbs-minimode.md)). `figureMode`
   absorbs `miniMode`; a mini map is a figure. Only reachable from a config a host passes in code.
5. **A saved view whose `pixelSize` or origin violates an invariant now opens clamped** (candidate
   6, #558, [ADR-0009](adr/0009-restore-is-a-translator.md)). Clamping silently is the same rule the
   normalize stage follows — coerce, never reject.

**2 and 5 are the only two an end user can hit.** 4 is the only one either known host could
plausibly trigger, and neither passes `miniMode` today.

---

# Side track — optional, not blocking

| Task | Issue | Skill |
|---|---|---|
| Give the browser-level probe harness a home | [#438](https://github.com/aidenlab/juicebox.js/issues/438) | `/implement 438` |
| Consumer-usage facts restated in four places | [#474](https://github.com/aidenlab/juicebox.js/issues/474) | `/implement 474` |

**#438 stays optional. Check `test/utils/browserFixture.js` before concluding anything needs it** —
ADR-0004 built that JSDOM surface, and a probe against it reproduced the `InputDialog` leak in three
lines. ADR-0005 briefly promoted #438 to blocking on the premise that candidate 8's node-counting
assertions needed a scriptable harness; they did not. What #438 is still for is what JSDOM cannot
do: real canvas output, real gestures, pixel probes. Candidate 6 is a fresh data point — its gate
had to *state* a viewport because the harness measures zero.

**#474 is the drift problem:** the consumer surface is hand-measured prose in four places and has
now gone stale **twice** — the v4.0.0 re-measurement found drift in both directions, and had to be
done by hand again to find it. See *Phase 4* above.

---

# The thing that caused all of this

`docs/architecture-review.html` was generated by `/architecture-review` **without a consumer lens**.
juicebox.js is an embeddable component; `HICBrowser` is not exported from `js/index.js`, so its
whole instance surface is public in practice and declared nowhere. Reasoning from `grep js/` returns
"no callers" for members two shipped apps depend on.

Candidate 4 is the proof the correction works: its card proposed `init()` return the registry, which
would have broken both hosts, and the Consumer impact block caught it. **Candidate 6 is the proof it
is not enough** — its card's "bypasses validation" claim was wrong in the other direction, naming a
door with no callers at all while missing the one called on every load. A consumer lens catches what
hosts *use*; it does not catch what a comment *asserts*.

**If that skill is ever re-run on this repo, it will make the same mistake** unless the consumer
step is added to the skill itself. That is a `/writing-great-skills` job on
`~/.claude/skills/architecture-review/`, not a juicebox.js task.

---

# Reading order, if you only read three things

1. `docs/adr/0003-public-api-contract.md` — what the public API actually is
2. The red banner at the top of `docs/architecture-review.html` — what was wrong and why
3. This list

For the pattern to copy on the next candidate: `docs/adr/0009-restore-is-a-translator.md` is the
most recent and the most complete — Context built from facts read out of the checkout rather than
off the card, decisions numbered, sequencing explicit, and a *Considered and rejected* section that
records what the card wanted and why it lost.
