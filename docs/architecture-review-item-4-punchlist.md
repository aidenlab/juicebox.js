# Architecture Review Item 4 Punchlist

Candidate 4 of `docs/architecture-review.html` — *Give the browser registry an
owner* — decomposed into eight issues, each mapped to the skill you should reach
for when you pick it up.

Design decisions live in [ADR-0004](./adr/0004-browser-registry-per-container.md).
Vocabulary lives in [`CONTEXT.md`](../CONTEXT.md) (*browser registry* vs
*session*). This document is the operational layer: **which tool comes out of the
box for which ticket.**

## The label tells you which tool

The triage label is not a description of the work. It is a claim about whether
the ticket **contains its own answer**, and that is exactly what decides the tool.

| Label | What is true of the ticket | Tool to reach for |
|---|---|---|
| `ready-for-agent` | Every decision is already made. Acceptance criteria say what done looks like. | `/implement`, or `/tdd` when the ticket is test-shaped |
| `ready-for-human` | A decision has to be made before code is written. The ticket asks questions instead of answering them. | `/grill-with-docs` — **not** `/implement` |
| `needs-triage` | Not yet sorted into either of the above | `/triage` |

The distinction is **specified vs. unspecified**, not *agent vs. human*. #479 is
the riskiest ticket in this set and is `ready-for-agent`, because ADR-0004 already
answered every question it raises. #477 is a smaller change and is
`ready-for-human`, because nobody has decided what the fix is.

When a `ready-for-human` ticket gets its answer, it is re-labelled
`ready-for-agent` and rejoins the top row. That transition is the whole point of
the label.

## The chain

```
#476 ──┬──────────────────────────────────────────────► #483
       └─► #478 ─► #479 ─┬─► #481 ─────────────────────► #483
                         ├─► #482 ─────────────────────► #483
       └─► #478 ─────────┴─► #480 ─────────────────────► #483
```

Blocking edges are native GitHub dependencies, so the frontier is queryable:
`gh issue list --state open` filtered on
`issue_dependencies_summary.blocked_by == 0`.

---

### #476 — Extract `pairSynchable(browsers)` as a pure function

`ready-for-agent` · no blockers · **on the frontier now**

**Reach for `/tdd`.** This is the single most test-shaped ticket in the set: a
pure function with a fully enumerable input space and no DOM, no network, no
module state. The acceptance criteria already read as a test list — empty, single,
incompatible pair, compatible pair, mixed flags. Write them red, then extract the
function until they go green.

Then `/code-review` against `master` before merge, on the Standards axis. Nothing
observable changed, so the Spec axis has little to bite on.

---

### #478 — Introduce `BrowserRegistry` holding today's module state

`ready-for-agent` · blocked by #476

**Reach for `/implement`.** A pure lift of module state onto an object. ADR-0004
decisions 1 and 8 fix the name and the lookup, so there is nothing left to decide.

**Consider `/codebase-design` first** if the member list feels wrong once you are
in the code. That skill carries the deep-module vocabulary — interface, depth,
seam — which `CONTEXT.md` already adopts as this repo's architecture language. Use
it to argue about the registry's *interface*, not to relitigate the ADR.

Then `/code-review`.

---

### #479 — Key browser registries by container element

`ready-for-agent` · blocked by #478 · **the risky one**

**Reach for `/implement`**, but the acceptance criteria carry a manual step no
skill covers: smoke-test against a real juicebox-web checkout. A mistake here
silently changes what `getAllBrowsers()` returns and **nothing fails** — no test,
no error, no log line. That is the failure mode ADR-0003 was written about.

Then `/code-review` — and here the **Spec axis matters more than Standards**,
because the question is not "is this clean" but "does this still mean what
ADR-0004 said it means".

If the smoke test surfaces something odd in juicebox-web, switch to
`/diagnosing-bugs` rather than patching forward. The whole hazard of this ticket
is silent divergence, and a symptom you can see is worth stopping for.

---

### #480 — Selection falls through when the current browser is deleted

`ready-for-agent` · blocked by #478 · closes #475

**Reach for `/tdd`.** Four enumerated state transitions, all assertable against
browser-shaped test doubles: delete the current one, delete a non-current one,
empty the registry, confirm nothing dangles. `BrowserSelect` posting or not
posting is part of the assertion, not an afterthought — it is the contract
juicebox-web subscribes to.

Then `/code-review`.

---

### #481 — Move `selectedGene` and `Alert` onto the browser registry

`ready-for-agent` · blocked by #479

**Reach for `/implement`.** The scope section of ADR-0004 already drew the line —
two singletons move, two stay — so the judgement call is made. The one thing to
hold onto: the ticket's negative criteria (`inProgressCache` and the viewport CSS
variables untouched) are as binding as the positive ones. An agent that "helpfully"
scopes the CSS variables too has broken the ADR and stepped on #477.

Then `/code-review`, Spec axis, specifically checking the negatives.

---

### #482 — Sessions become browser registry methods

`ready-for-agent` · blocked by #479

**Reach for `/tdd`** for the round-trip criterion — save a registry's session,
restore it, compare canonical state — then `/implement` for the delegation
plumbing. The round trip is the assertion that actually proves the #384 DOM
destruction is gone, so lead with it.

Then `/code-review`.

---

### #483 — Export `initRegistry`, declare the surface, prove two embeds coexist

`ready-for-agent` · blocked by #476, #480, #481, #482 · closes #384

**Reach for `/implement`**, then `/code-review` on **both** axes — this is the
ticket that touches `js/publicApi.js`, so Spec is checking a published contract,
not an internal one.

Two notes on tooling around it:

- The ticket carries a documented downgrade path if the end-to-end panning test
  needs network fixtures. Take it. Do not let a hard test hold the refactor.
- This closes #384, which has an external reporter waiting since 2023. The
  release that ships it follows the house release ceremony, and ADR-0003's tables
  get re-measured against both consumers at that point.

If you run out of context mid-ticket — plausible, it is the widest one —
`/handoff` before you lose the thread rather than after.

---

### #477 — `--hic-viewport-*` CSS variables are page-scoped

`ready-for-human` · no blockers · **not** part of the chain

**Reach for `/grill-with-docs`. Do not reach for `/implement`.**

This ticket has no acceptance criteria. It has a *What a fix would need to decide*
section with two open questions: whether the properties move to each registry's
container or the rules that read them stop needing custom properties at all, and
whether any host reads them. Handing that to an implementation skill means the
agent picks, and an unweighed choice gets frozen into a rendering path.

The sequence is: `/grill-with-docs` to settle both questions and emit ADR-0005 →
`/to-tickets` to cut the result into specified work → re-label `ready-for-agent`
→ `/implement`. That is the same path this punchlist came down.

`/prototype` is a reasonable detour if the second question — can the stylesheet
rules resolve from a per-embed element at all — is faster to answer by trying it
than by reasoning about it. Throwaway, not a branch.

---

## Meta tools

- **`/ask-matt`** — when you are unsure which of the above applies. It routes.
- **`/handoff`** — each ticket is sized for one context window. When one is not,
  compact and pass it on rather than degrading.
- **`/wait-what`** — when an agent's explanation of what it did does not land.
  Cheaper than reading the diff twice.
- **`/wayfinder`** was the alternative to `/to-tickets` for this work and was not
  needed: wayfinder is for work whose *shape* is unknown and has to be discovered
  ticket by ticket. Item 4's shape was settled in a grilling session before any
  ticket existed, so a plain dependency chain was enough. If item 7 (~300 lines of
  gesture closures, the largest remaining deepening) gets picked up, that one may
  genuinely want wayfinder.
