# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## The label tells you which tool

The triage label is not a description of the work. It is a claim about whether the ticket **contains its own answer**, and that is what decides the tool.

| Label | What is true of the ticket | Tool to reach for |
| ----- | -------------------------- | ----------------- |
| `ready-for-agent` | Every decision is already made. Acceptance criteria say what done looks like. | `/implement`, or `/tdd` when the ticket is test-shaped |
| `ready-for-human` | A decision has to be made before code is written. The ticket asks questions instead of answering them. | `/grill-with-docs` — **not** `/implement` |
| `needs-triage` | Not yet sorted into either of the above | `/triage` |

The distinction is **specified vs. unspecified**, not *agent vs. human*. A ticket can be the riskiest in a set and still be `ready-for-agent`, if an ADR already answered every question it raises. A smaller change is `ready-for-human` when nobody has decided what the fix is.

When a `ready-for-human` ticket gets its answer, it is re-labelled `ready-for-agent` and rejoins the top row. That transition is the whole point of the label.

## Routing between skills

- **`/ask-matt`** — when you are unsure which of the above applies. It routes.
- **`/grilling`** before `/to-tickets` when a candidate's scope feels unsettled — cheaper to stress-test the plan than to rewrite the code.
- **`/grill-with-docs`** when the work turns on a decision rather than an implementation; it runs the interview and records the ADR in one pass.
- **`/to-tickets`** once the shape is settled. **`/wayfinder`** instead when the work's *shape* is unknown and has to be discovered ticket by ticket — a plain dependency chain is enough when a grilling session already settled the shape.
- **`/prototype`** when a question is faster to answer by trying it than by reasoning about it. Throwaway, not a branch.
- **`/handoff`** — each ticket should be sized for one context window. When one is not, compact and pass it on rather than degrading.
- **`/wait-what`** — when an agent's explanation of what it did does not land. Cheaper than reading the diff twice.

**File the tickets before the blocker clears, not after.** Decomposition never needs the thing it is blocked on; only implementation does. A candidate whose tickets exist and say "blocked on #N" is one `gh issue view` away from being resumable. A candidate settled only in an ADR has to be re-derived.
