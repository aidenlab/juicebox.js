# Juicebox.js — Punch List

**As of 2026-08-07.** Ordered. Work top to bottom; each phase assumes the one above it.

Three repos are involved:
- `~/JuiceboxDevelopment/juicebox.js`
- `~/JuiceboxDevelopment/juicebox-web` — pinned `v3.6.2`
- `~/SpacewalkDevelopment/spacewalk` — pinned `v3.6.2`

**All skills below except `/request-refactor-plan` must be typed by you** — they are marked
`disable-model-invocation` and cannot be self-started.

---

## Done since the 6 August list

Phases 0, 1 and 2 are complete, and so is the first of the Phase 3 candidates.

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

Candidate 4 also produced `docs/architecture-review-item-4-punchlist.md` — the ticket
decomposition and which skill fits which ticket. That ADR-then-punchlist-then-revise-the-card
pattern is the one to repeat for the candidates below.

---

## Phase 3 — The remaining seven candidates.

Seven candidates in `docs/architecture-review.html` are open. **Three are breaking as currently
scoped** — candidate 8 was the fourth until ADR-0005 settled it. Each card carries a Consumer
impact block; read it before filing anything.

| Candidate | Status |
|---|---|
| **8 · Give the browser a teardown that matches its construction** | ✅ contract settled — ADR-0005 · **not breaking** · tickets filed, unblocked |
| **5 · One decoder for session and URL** | ⚠️ breaking |
| **11 · Give the track tile one owner** | ⚠️ breaking |
| **6 · Fold StateManager into State, and make restore use the chokepoint** | watch |
| **7 · Move the gesture state machines behind InteractionHandler** | watch |
| **9 · Give the config schema one reader** | watch |
| **10 · One dataset-load path** — *this is the live-map seam* | watch |

**8** — **settled in `docs/adr/0005-browser-teardown-contract.md`.** `reset()` keeps browser
identity, so juicebox-web's `reset()` → `loadHicFile()` → `enableIfMapLoaded(browser)` is
untouched and this candidate is no longer breaking. The candidate is also *smaller* than its card:
two of its five "Before" bullets — both event-bus lines — were already fixed by #414, and
`grep -rn subscribe js/` now returns nothing outside `eventBus.js`. What remains is the
`inputDialog` leak (one construction site, zero teardown, leaks once per session restore), the
sibling-position symmetry, clearing the per-browser bus, and folding four teardown verbs into two.

Two things found while grilling it that are **not** part of the candidate:
- `deleteAll()` skips `unsyncSelf()` and `delete()` does not, so every `restoreSession()` leaves
  browsers holding references to deleted peers. Live bug, both hosts, one-line fix. Lands *before*
  the refactor — it is on the refactor's critical path, which is the standing exception to
  "file it and keep refactoring."
- `reset()` must install a **new** `State` object, not mutate the old one, or #469's
  identity-based abandonment check stops firing. Invisible, untested, only shows up under load
  latency. This is the review-gate on the whole candidate.

**5** — the contract is with **users**, not just the two host apps: shared session URLs must still
decode. Needs its own ADR first.

**11** — the `TrackXYPairLoad` payload *is* the track pair, and juicebox-web reads its shape.

**6** — accessor names are load-bearing; #468 already settled the vocabulary.

**7** — must keep both crosshair paths firing for Spacewalk. Largest remaining deepening, ~300
lines of closures with no test surface.

**9** — `hic.init(container, config)` is the most-used public surface. Pairs with 5 — decode,
then normalize.

**10** — three named load methods must survive.

**Skill:** `/to-tickets` when you pick one up. For candidate 5, write the ADR first
(`/grill-with-docs` runs the interview and records the ADR in one pass) — it turns on a decision,
not an implementation. Candidate 8's ADR is done.

**File the tickets before the blocker clears, not after.** Decomposition never needs the thing
it is blocked on; only implementation does. A candidate whose tickets exist and say "blocked on
#N" is one `gh issue view` away from being resumable. A candidate settled only in an ADR has to
be re-derived.

If a candidate's scope feels unsettled, `/grilling` before `/to-tickets` — cheaper to stress-test
the plan than to rewrite the code.

Track everything against [#466](https://github.com/aidenlab/juicebox.js/issues/466).

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
The sequence is `/grill-with-docs` → ADR-0006 → `/to-tickets` → re-label → `/implement`.
(0005 went to candidate 8's teardown contract.)

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
   either app changes. It already under-counted once. #474 proposes making that re-runnable.
2. Run #466's pre-release consumer verification checklist, **plus the registry click-through above**.
3. Bump / tag / `gh release create` / repoint both consumers.

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

For the pattern to copy on the next candidate: `docs/adr/0004-browser-registry-per-container.md`
and `docs/architecture-review-item-4-punchlist.md`, in that order.
