# Juicebox.js — Punch List

**As of 2026-08-22. Candidate 6 is the active work; the gate (#557), the behaviour change behind it (#558), the back door beside it (#559), the honest change flag (#560) and both halves of the parallel branch (#561, #562) are in, so the frontier is the join — [#563](https://github.com/aidenlab/juicebox.js/issues/563), the fold, now unblocked.**

> **This is the working scratchpad — the only one.** Thrash it freely; nothing else has to
> agree with it. Where the durable facts live:
>
> | Question | Where it is answered |
> |---|---|
> | Why was this decided? | `docs/adr/` — append-only, never revised |
> | What does this word mean? | `CONTEXT.md` |
> | What do I do next on this ticket? | the GitHub issue |
> | Is the candidate done? | the table in [#466](https://github.com/aidenlab/juicebox.js/issues/466), updated at candidate boundaries |
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

# NOW — Candidate 6

**Fold `StateManager` into `State`, and make restore use the chokepoint.** Scoped by
[ADR-0009](adr/0009-restore-is-a-translator.md), filed as #557–#563.

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
| **#563** | `StateManager` folds into `State`, the setters go, and the discipline is written down | — **frontier**, all three blockers closed |

**#560, #561 and #562 were a parallel branch** off #559; #563 is the join, and all three legs are in. This is the first
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
gained is not visible in a snapshot; `test/testRestoreBackDoor.js` traps `activeState` itself and
asserts every state installed during that load came out of the chokepoint. **The `synchState`
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

## Pre-existing issues this candidate touches

Surveyed 2026-08-22. **None of these is a candidate-6 ticket** — they are older issues that live in
the code it moves, and the point of listing them is so the tickets are read with them in mind rather
than rediscovered one at a time.

| Issue | Open since | Relationship | Do what |
|---|---|---|---|
| ~~**#510**~~ | Aug 2026 | Was the frontier. Promoted from a candidate-5 follow-up by ADR-0009 | ✅ **fixed**, before the gate, exactly as ADR-0009 sequenced it |
| **#372** | Jul 2026 | Its **validation half is #561**. Restore is the first moment a valid normalization set exists | leave open; it narrows to notification |
| **#528** | Aug 2026 | **Answered by ADR-0009.** It asked whether a numeric seventh state token (`normalization: "2000"`) should be rejected or coerced; decisions 2 and 5 say coerce, at restore, against the dataset | ✅ re-labelled `ready-for-agent` and pointed at #561; use it as #561's fixture |
| **#280** | 2018 | **Hypothesis weakened by #566** — the rung it blames is unreachable, not racy. See below | linked both ways with #562; still open, needs the repro, do **not** close on the reading |
| **#473** | Aug 2026 | Same in-flight hazard as #469, on `TrackPair` rather than `ContactMatrixView`. Candidate 6 changes who owns state mutation, so it may get easier or harder | watch during #563 |
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

## The release note this candidate owes

**A saved view whose `pixelSize` or origin violates an invariant now opens clamped rather than as
written.** ✅ True as of #558. That is phase 4's **fifth** note and the **second** an end user can
hit. Clamping
silently is decision 2 — the same "coerce, never reject" rule the normalize stage already follows.

---

# NEXT — the three unpicked candidates

Nothing queues behind candidate 6; when it lands, the choice is open again. Each card in
`docs/architecture-review.html` carries a Consumer impact block — read it before filing anything.

| Candidate | Status | What is known |
|---|---|---|
| **11 · Give the track tile one owner** | ⚠️ breaking | the `TrackXYPairLoad` payload *is* the track pair, and juicebox-web reads its shape |
| **7 · Move the gesture state machines behind InteractionHandler** | largest remaining | must keep both crosshair paths firing for Spacewalk. ~300 lines of closures with no test surface. **The one candidate that may want `/wayfinder`** rather than `/to-tickets` — its shape is genuinely unknown, where candidate 4's was settled in a grilling session before any ticket existed |
| **10 · One dataset-load path** — *the live-map seam* | spans three repos | three named load methods must survive |

**The pattern to repeat, now proven five times: ADR → tickets → Outcome box on the card.** The ADR
is where the breaking question gets answered before code moves. Candidate 9 added the corollary: a
candidate scoped as needing no ADR can still owe one, and it comes due on the last ticket, when the
readers finally have to agree.

**Skill:** `/to-tickets` once the shape is settled, `/grilling` first when it is not. Full routing
rules, and the reason to file tickets *before* the blocker clears, are in
`docs/agents/triage-labels.md`.

**ADR numbering:** 0005 → candidate 8, 0006 → candidate 5, 0008 → candidate 9, 0009 → candidate 6.
**0007 was reserved for #477 and never written** — #477 landed without one — so the gap in
`docs/adr/` is deliberate, not a missing file. **ADR-0010 is next.**

When a candidate lands: tick it in [#466](https://github.com/aidenlab/juicebox.js/issues/466) and
add an Outcome box to its card. That is the only time either file is touched.

---

# DONE — candidates 1, 2, 3, 4, 5, 8, 9

Seven of eleven. Phases 0, 1 and 2 are complete. Full outcomes are in the green boxes in
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

# Phase 4 — Release

#466 sets the rule: **no release until every candidate is done.** Both consumers pin `v3.6.2`, so a
moving `master` costs them nothing until then.

Before releasing:

1. **Re-measure the consumer surface.** `docs/adr/0003-public-api-contract.md` goes stale the moment
   either app changes. It has already under-counted once, and candidate 8 added two members
   (`browser.dispose`, `registry.dispose`). #474 proposes making that re-runnable.
2. **Run #466's pre-release consumer verification checklist.** The registry click-through it carried
   over from candidate 4 is already checked off (#549); what remains is the 20-member consumer
   surface and the release notes below.
3. **Bump / tag / `gh release create` / repoint both consumers.**

**The release notes owed — five, from candidates 8, 5, 9 and 6:**

1. **A disposed browser now throws `DisposedBrowserError`** rather than silently no-op'ing
   (candidate 8). Neither known host can reach it; a third-party embedder might.
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
already gone stale once. Phase 4 step 1 is that measurement.

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
