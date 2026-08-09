# Juicebox.js — Punch List

**As of 2026-08-08.** Ordered. Work top to bottom; each phase assumes the one above it.

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

Phases 0, 1 and 2 are complete, and so are two of the Phase 3 candidates.

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

**The pattern to repeat: ADR → tickets → Outcome box on the card.** Candidate 4 ran it and it
worked — its card proposed a shape that would have broken both hosts, and the Consumer impact
block caught it before any code was written. Candidate 4 also spawned a second punch list of its
own; that was the mistake. The decomposition belonged in the issue bodies, where it would not
have needed keeping in sync. Its reusable parts now live in `docs/agents/triage-labels.md`, its
ADR correction in ADR-0004's addendum, and the file is deleted (`git log` has it if needed).

---

## Phase 3 — The remaining six candidates.

Six candidates in `docs/architecture-review.html` are open. **Two are breaking as currently
scoped** — candidate 8 was the third until ADR-0005 settled it, and it has now landed. Each card
carries a Consumer impact block; read it before filing anything.

| Candidate | Status |
|---|---|
| **5 · One decoder for session and URL** | **ADR-0006 + tickets #499–#509 filed** — start at #499, #500, #501, #502 |
| **11 · Give the track tile one owner** | ⚠️ breaking |
| **6 · Fold StateManager into State, and make restore use the chokepoint** | watch |
| **7 · Move the gesture state machines behind InteractionHandler** | watch |
| **9 · Give the config schema one reader** | watch |
| **10 · One dataset-load path** — *this is the live-map seam* | watch |

**5 — ADR-0006 is written** (`docs/adr/0006-session-wire-format-and-one-decoder.md`), so the next
step is `/to-tickets` against it. Ten decisions; the load-bearing ones: the compatibility contract
is the decoder's currently-accepted set frozen as fixtures, with bit.ly `juiceboxURL=` the one
named drop; url.md becomes a versioned spec (v0 = 7-token state, v1 = 9-token + session JSON);
`chr1 ≤ chr2` becomes a real invariant enforced in `setView`; one encoder for the session-JSON form
only; and decode/normalize is drawn as a seam here but **crossed in candidate 9**, not in 5.

**Tickets are filed: #499–#509**, with native GitHub blocking edges, so the frontier is a query
rather than a reading exercise — a ticket is startable exactly when `blocked_by == 0`.

| | Ticket | Gated on |
|---|---|---|
| **Start here** | #499 axis ordering · #500 empty browsers · #501 versioned url.md + delete `stringify` · #502 fixture corpus | nothing |
| **The gate** | #503 golden-file snapshot — **no decoder code moves until it is green** | #499, #500, #502 |
| Collapse | #504 pure `sniffFormat`/`decodeState` → #505 `decodeSession` + injected loader → #506 drop bit.ly | linear |
| Payoff | #507 `encodeSession` + round-trip property test → #508 version field | #500, #505 |
| Off-chain | #509 external citation harvest (`ready-for-human`, gates nothing) · #510 `State.default()` defect | — |

#499 and #500 gate the snapshot because both legitimately move decoded output; baselining before
them would bake in behaviour already decided against. #499 is **a live bug today with no session
involved** — any `goto` whose y-axis chromosome index is below the x-axis's renders one way and
reloads transposed.

The ADR is not breaking for the archive — the `State` constructor already transposes, so links in
the wild decode exactly as they do now.

**What candidate 8 confirmed, worth carrying into 5:** ADR → tickets → Outcome box works, and the
ADR is where the breaking/not-breaking question gets answered. 8 was on the breaking list until
ADR-0005 found that `reset()` could keep browser identity; nothing about the code changed, only
what had been established before writing it. Two smaller lessons: the general mechanism beat the
named instance (the constructor records what it installs outside `rootElement`, and that record
caught a *second* leak the card never named — the contact matrix view's document-level gesture
handlers, #494); and the invisible failure mode named on the card as a review gate became a test
rather than a warning (`test/testRepaintDuringReset.js`, #495).

**11** — the `TrackXYPairLoad` payload *is* the track pair, and juicebox-web reads its shape.

**6** — accessor names are load-bearing; #468 already settled the vocabulary.

**7** — must keep both crosshair paths firing for Spacewalk. Largest remaining deepening, ~300
lines of closures with no test surface. **The one candidate that may want `/wayfinder`** rather
than `/to-tickets`: its shape is genuinely unknown, where candidate 4's was settled in a grilling
session before any ticket existed.

**9** — `hic.init(container, config)` is the most-used public surface. Pairs with 5 — decode,
then normalize.

**10** — three named load methods must survive.

**Skill:** `/to-tickets` when you pick one up. Full routing rules, and the reason to file tickets
*before* the blocker clears, are in `docs/agents/triage-labels.md`. **ADR-0006 went to candidate 5**;
**ADR-0007 is the next free number**, and #477 takes it.

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

**The release note candidate 8 owes:** a disposed browser now throws `DisposedBrowserError` rather
than silently no-op'ing. Neither known host can reach it — nothing called `dispose()` before it
existed — but a third-party embedder calling a method on a deleted browser and getting away with
it will now see an exception. It is the one behavioural change on the list so far.

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
