# Juicebox.js — Punch List

**As of 2026-08-10.** Ordered. Work top to bottom; each phase assumes the one above it.

> **This is the working scratchpad — the only one.** Thrash it freely; nothing else has to
> agree with it. Where the durable facts live:
>
> | Question | Where it is answered |
> |---|---|
> | Why was this decided? | `docs/adr/` — append-only, never revised |
> | What does this word mean? | `CONTEXT.md` |
> | What do I do next on this ticket? | the GitHub issue |
> | Is the candidate done? | the table in [#466](https://github.com/aidenlab/juicebox.js/issues/466), updated at candidate boundaries |
> | Which skill do I reach for? | `docs/agents/triage-labels.md` |
> | What did the review originally say? | `docs/architecture-review.html` — **frozen**, cards are not edited |
>
> If a fact here contradicts one of those, the other one wins and this file is stale.
> Do not create a second punch list; per-candidate decomposition goes in issue bodies.

Three repos are involved:
- `~/JuiceboxDevelopment/juicebox.js`
- `~/JuiceboxDevelopment/juicebox-web` — pinned `v3.6.2`
- `~/SpacewalkDevelopment/spacewalk` — pinned `v3.6.2`

**All skills below except `/request-refactor-plan` must be typed by you** — they are marked
`disable-model-invocation` and cannot be self-started.

---

## Done since the 6 August list

Phases 0, 1 and 2 are complete, and so are three of the Phase 3 candidates.

| # | Task | Outcome |
|---|---|---|
| 0.1 | Re-brief the event-bus issue | #414 re-briefed and then implemented |
| 0.2 | Dead `MapLoad` subscription | juicebox-web#61 closed |
| 0.3 | Inert session guard | spacewalk#84 closed |
| 1.1 | Mark the intended public surface in code | #470 → `js/publicApi.js` + `test/testPublicApi.js`, PR #472 |
| 2.1 | One accessor vocabulary | #468 closed |
| 2.2 | Event system cleanup | #414 closed — bus **kept**, both buses are consumer API |
| 2.3 | A repaint pass outliving the state it started from | #469 closed — it *abandons* the pass on a state-identity check (`f4f5ce5`), it does not throw. The earlier summary here said "throws"; that was wrong, and ADR-0005 depends on which it is |
| 3 · c4 | Browser registry owner | ADR-0004 → #476, #478–#483, `78a5d0b..9fde9a2`. **Closes #384** (open since 2023) and #475 |
| 3 · c8 | Browser teardown | ADR-0005 → #491–#496, `000a43a..8d50359`. `dispose()` at both levels, `reset()` keeps identity, four teardown verbs → two. Not breaking. Tests 439 → 497 |
| 3 · c5 | One decoder for session and URL | ADR-0006 → #499–#509, `7d93be4..683ed54`. `js/sessionCodec.js` (950 lines) holds every format decision; `urlUtils.js` (60) holds the one read. Golden snapshot gated the whole thing. Not breaking except the one named drop (`juiceboxURL=`, #506). Tests 497 → 731. Eight follow-ups filed: #510, #514, #515, #518, #519, #521, #525, #528 |

**The pattern to repeat: ADR → tickets → Outcome box on the card.** Candidate 4 ran it and it
worked — its card proposed a shape that would have broken both hosts, and the Consumer impact
block caught it before any code was written. Candidate 4 also spawned a second punch list of its
own; that was the mistake. The decomposition belonged in the issue bodies, where it would not
have needed keeping in sync. Its reusable parts now live in `docs/agents/triage-labels.md`, its
ADR correction in ADR-0004's addendum, and the file is deleted (`git log` has it if needed).

---

## Phase 3 — The remaining five candidates.

Five candidates in `docs/architecture-review.html` are open. **One is breaking as currently
scoped** — candidate 8 was settled by ADR-0005 and candidate 5 by ADR-0006, and both have landed.
Each card carries a Consumer impact block; read it before filing anything.

| Candidate | Status |
|---|---|
| **9 · Give the config schema one reader** | **filed — #531–#536**; #531, #532 and #533 landed, frontier is #534 and #535 in parallel. Seam already drawn by ADR-0006 decision 8; no ADR opened |
| **11 · Give the track tile one owner** | ⚠️ breaking |
| **6 · Fold StateManager into State, and make restore use the chokepoint** | watch |
| **7 · Move the gesture state machines behind InteractionHandler** | watch |
| **10 · One dataset-load path** — *this is the live-map seam* | watch |

**9 — start here, and the first decision is whether it needs an ADR at all.** ADR-0006 decision 8
already drew the seam: decode and normalize are two stages, and 5 deliberately stopped at the line.
What was left on the wrong side of it was `fixDefaults` and the `selectedGene`
reconciliation (#481) — both crossed in #533 — plus **shortcut expansion running twice** — once on the URL path, once again
in `restoreSession`, because a session handed straight to `restoreSession` bypasses the decoder
entirely. One `normalizeSession` stage that *both* entry paths pass through makes one of those
copies deletable. That deletion was held back from 5 on purpose: both at once doubles the blast
radius on `hic.init`, the most-used public surface.

So the hard question — where the seam goes and why — is answered. The one genuinely open piece was
**whether normalizing at both entry points changes what `restoreSession` accepts**, and that is
consumer-facing, so it might have been worth an ADR.

**Decided: no ADR.** The answer is "no change to what is *accepted*" — normalize **defaults and
coerces, never rejects**, which is an acceptance criterion on every ticket that could violate it.
What *does* change is what `restoreSession` *produces*, and only for the three divergences #533
closes deliberately. That is `/to-tickets` against decision 8, not a fresh ADR. ADR-0008 stays the
next free number.

**Filed as six tickets, gate first** — the shape candidate 5 proved:

| # | Ticket | Blocked by |
|---|---|---|
| #531 | Gate: snapshot the resolved config every entry path produces today | — **landed** |
| #532 | Extract `normalizeSession`: a pure, session-shaped normalize stage | #531 — **landed** |
| #533 | Move the remaining normalization across the seam | #532 — **landed** |
| #534 | Delete the duplicate URL-shortcut expansion | #533 — **frontier** |
| #535 | Normalize once, at the entry | #533 — **frontier** |
| #536 | Downstream readers stop defaulting, and the schema is written down | #535 |

#534 and #535 run in parallel after #533. **#533 is the only ticket that deliberately moves
snapshots** — it closes three divergences at once: track defaults skipped by `restoreSession`, the
`selectedGene` reconciliation, and `syncDatasets` honoured by `createBrowserList` but not
`createBrowser`. Blocking edges are GitHub-native, so the frontier is queryable rather than read
off this table.

**Two card corrections found while decomposing**, both from candidate 5 landing — recorded here and
in #466 rather than on the frozen card: `normalizeConfig` **already exists** in `createBrowser.js`
(browser-shaped, unexported, called once per browser), so #532 deepens it rather than inventing it,
and the new stage is named `normalizeSession` to avoid the collision. `fixDefaults` now lives in
`sessionCodec.js`, not `urlUtils.js`. The card also lists `js/browserUIManager.js`, which candidate
3 deleted.

**9 inherits the gate 5 had to build.** The golden-file snapshot over the wire-format corpus is
green and covers every accepted format; normalization changes are exactly the kind that move
decoded output, so the snapshot is 9's acceptance test too, and every moved fixture must be one
someone can explain. **#525 was a filed instance of the bug 9 exists to fix:** `fixDefaults`
forced every track to `COLLAPSED`, so the URL path and the direct-restore path disagreed about the
same session. #533 closed the disagreement by moving the pass to the shared stage; what #525 still
asks — whether forcing `COLLAPSED` at all is right — is now a question about one stage rather than
about which door you came in by.

**What candidate 5 confirmed, worth carrying into 9:** the pattern held a third time — ADR →
tickets → Outcome box — and the ADR is again where the breaking/not-breaking question got answered
before any code moved. Three lessons specific to this kind of work:

- **The characterization snapshot must land before anything moves, and the fixes that legitimately
  move output must land before *it*.** #499 and #500 gated #503 for exactly that reason. Baselining
  first would have pinned behaviour already decided against.
- **A "dead" path is not dead until measured.** ADR-0006 justified dropping `juiceboxURL=` partly
  on an assumed 401; measured, bit.ly still expanded it and the session still decoded. The drop
  stood on other grounds, but the ADR's consequences section had to be corrected — #506 removed
  live behaviour.
- **File and keep refactoring worked at scale.** Eight follow-ups (#510, #514, #515, #518, #519,
  #521, #525, #528) came out of this candidate without derailing it.

**11** — the `TrackXYPairLoad` payload *is* the track pair, and juicebox-web reads its shape.

**6** — accessor names are load-bearing; #468 already settled the vocabulary. Pairs naturally with
9: both are about restore going through the chokepoint rather than around it.

**7** — must keep both crosshair paths firing for Spacewalk. Largest remaining deepening, ~300
lines of closures with no test surface. **The one candidate that may want `/wayfinder`** rather
than `/to-tickets`: its shape is genuinely unknown, where candidate 4's was settled in a grilling
session before any ticket existed.

**10** — three named load methods must survive.

**Skill:** `/to-tickets` when you pick one up. Full routing rules, and the reason to file tickets
*before* the blocker clears, are in `docs/agents/triage-labels.md`. **ADR-0005 went to candidate 8
and ADR-0006 to candidate 5. ADR-0007 is claimed by #477, so ADR-0008 is the next free number** —
and candidate 9 does not need one, per above.

When a candidate lands: tick it in [#466](https://github.com/aidenlab/juicebox.js/issues/466) and
add an Outcome box to its card. That is the only time either file is touched.

---

## Phase 3b — Loose ends from candidate 4.

| Task | Issue | Skill |
|---|---|---|
| `--hic-viewport-*` CSS variables are page-scoped | [#477](https://github.com/aidenlab/juicebox.js/issues/477) | `/grill-with-docs` — **not** `/implement` |
| Runtime click-through of the registry against juicebox-web | *not filed* | manual |

**#477 is the reason "candidate 4 is done" does not mean "multi-embed works."** Two embeds
coexist; they still cannot have different viewport sizes. It is `ready-for-human` because it has
open questions rather than acceptance criteria — whether the properties move to each registry's
container or the rules stop needing custom properties at all, and whether any host reads them.
The sequence is `/grill-with-docs` → ADR-0007 → `/to-tickets` → re-label → `/implement`.
(0005 went to candidate 8's teardown contract, 0006 to candidate 5's wire format.)

**The click-through is candidate 4's one unverified claim.** #479 was the ticket flagged as
carrying a manual step no skill covers, and it was verified statically only — 13 juicebox-web call
sites read, all resolving one registry, no headless browser available. Browser panel
add/delete/select and session save against a running juicebox-web. Do it before the release, and
add it to #466's checklist so it is not carried in someone's head.

---

## Phase 4 — Release.

#466 sets the rule: **no release until every candidate is done.** Both consumers pin `v3.6.2`,
so a moving `master` costs them nothing until then.

Before releasing:
1. Re-measure the consumer surface — `docs/adr/0003-public-api-contract.md` goes stale the moment
   either app changes. It already under-counted once, and candidate 8 added two members to it
   (`browser.dispose`, `registry.dispose`). #474 proposes making that re-runnable.
2. Run #466's pre-release consumer verification checklist, **plus the registry click-through above**.
3. Bump / tag / `gh release create` / repoint both consumers.

**The release notes owed so far — three, from candidates 8 and 5:**

1. **A disposed browser now throws `DisposedBrowserError`** rather than silently no-op'ing
   (candidate 8). Neither known host can reach it — nothing called `dispose()` before it existed —
   but a third-party embedder calling a method on a deleted browser and getting away with it will
   now see an exception.
2. **`?juiceboxURL=` links no longer work** (candidate 5, #506). This is the one deliberate break in
   the wire format, and it is **not** the dead path ADR-0006 originally assumed: measured on
   9 August, bit.ly still expanded these links and the session still decoded in full. Any published
   link in that form is now broken. How many exist is unknown and, per #509, was deliberately not
   measured beyond our own issue trackers.
3. **A session saved while a browser panel was empty now restores with one fewer panel** (candidate
   5, #500), where before it produced a session that could not be reloaded at all. Strictly an
   improvement, but browser *count* no longer survives that round trip, which is worth saying out
   loud rather than letting a host discover it.

Note that 2 is the only one that can affect an end user rather than an embedder.

---

## Side track — optional, not blocking

| Task | Issue | Skill |
|---|---|---|
| Give the browser-level probe harness a home | [#438](https://github.com/aidenlab/juicebox.js/issues/438) | `/implement 438` |
| Consumer-usage facts restated in four places | [#474](https://github.com/aidenlab/juicebox.js/issues/474) | `/implement 474` |

#438 stays optional. ADR-0005 briefly promoted it to blocking on the premise that candidate 8's
node-counting assertions needed a scriptable harness; they do not — ADR-0004 built the JSDOM test
surface (`test/utils/browserFixture.js`) and a probe against it reproduces the `InputDialog` leak
in three lines. **Check that fixture before concluding anything needs #438.** What #438 is still
for is what JSDOM cannot do: real canvas output, real gestures, pixel probes. The `dev/` harnesses
that could not load are repaired — `load-and-reset.html` and `non_synched_maps.html` still point at
`hicfiles.s3.amazonaws.com` but route through `hic.setUrlMapper(devMapUrl)` per ADR-0001, so they
work with the dev proxy running. #429 is closed. What is missing is a *scriptable* harness.

#474 is the drift problem: the consumer surface is hand-measured prose in four places and has
already gone stale once. Phase 4 step 1 is that measurement.

---

## The thing that caused all of this

`docs/architecture-review.html` was generated by `/architecture-review` **without a consumer
lens**. juicebox.js is an embeddable component; `HICBrowser` is not exported from `js/index.js`,
so its whole instance surface is public in practice and declared nowhere. Reasoning from
`grep js/` returns "no callers" for members two shipped apps depend on.

Candidate 4 is the proof the correction works: its card proposed `init()` return the registry,
which would have broken both hosts, and the Consumer impact block is what caught it. ADR-0004
rejected that shape and added `initRegistry()` instead. **If that skill is ever re-run on this
repo, it will make the same mistake** unless the consumer step is added to the skill itself. That
is a `/writing-great-skills` job on `~/.claude/skills/architecture-review/`, not a juicebox.js
task — which is why it is not in a phase above.

---

## Reading order, if you only read three things

1. `docs/adr/0003-public-api-contract.md` — what the public API actually is
2. The red banner at the top of `docs/architecture-review.html` — what was wrong and why
3. This list

For the pattern to copy on the next candidate: `docs/adr/0004-browser-registry-per-container.md`,
including its addendum on where the plan bent.
