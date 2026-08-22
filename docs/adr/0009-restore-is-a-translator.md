# ADR-0009 — Restore is a translator; the chokepoint clamps and coerces, never rejects

**Status:** Accepted
**Date:** 2026-08-22
**Related:** candidate 6 in `docs/architecture-review.html`, ADR-0006 decision 3
(`chr1 ≤ chr2` is enforced in `setView`), ADR-0003 (public API contract),
#411 (`docs/state-manipulation.md`, the discipline this extends), #468 (accessor
vocabulary), #466, #510 (the prerequisite fix), #372 (whose validation half
lands here)

## Context

Candidate 6's premise is that the mutation invariant should have one enforcer.
Six facts, read out of the checkout on 2026-08-22 rather than off the card:

**1. Restore does not go through the chokepoint, and the card is right about
what it skips.** `StateManager.setState` (`stateManager.js:83`) clones the
incoming state and applies `Math.max(state.pixelSize, minPS)` directly. It does
not call `State._adjustPixelSize`, so no `MAX_PIXEL_SIZE` cap applies; it does
not call `clampXY`; and it returns `resolutionChanged: true` unconditionally. A
`pixelSize` of 1e9 from a hand-edited URL survives intact — nothing in
`sessionCodec` or `normalizeSession` validates it either, so candidate 9 did not
close this.

**2. The card points at the wrong back door.** `browser.state = x` and
`browser.activeState = x` — the setters commented "direct assignment bypasses
validation" (`hicBrowser.js:540`) — have **zero production callers**. Their only
callers are tests: `test/utils/stubbedLoads.js`, `testAccessorVocabulary.js`,
`testEmbedScoping.js`, `testCoordinatorDelivery.js`, `testRepaintDuringReset.js`.
The live bypass is `setActiveDataset(dataset, state)`, which assigns
`activeState = state` with no validation at all from five `dataLoader` sites, and
which carries no warning comment.

**3. `StateManager` is twelve methods, not ten.** Eight are field get/set. Four
carry behaviour: `setState`, `getSyncState`, `canBeSynched`, `syncState` — the
card names three and misses `syncState`. `syncState` is a pass-through to
`State.sync` whose guard is already duplicated in its own caller
(`hicBrowser.js:955`).

**4. `synchable` is checked in three places** — `syncGroup.js:18` filters on it,
`hicBrowser.syncState:955` guards on it, `stateManager.canBeSynched:158` guards
on it again. The "two-and-a-half enforcers" shape the candidate exists to remove
is present one level up, in the sync path, and the card does not mention it.

**5. In a real browser the clamp would be real; in the test harness it is
always zero.** `appContainer.appendChild(this.rootElement)` runs synchronously in
the constructor (`hicBrowser.js:162`), before `init()` and before any load, and
`--hic-viewport-width/height` are written to `rootElement` immediately after, so
the CSS chain gives the viewport a definite size before restore runs. Probed
under the `withDOM()` fixture on 2026-08-22:

```
viewport in document  = true
viewport offsetWidth  = 0
viewport offsetHeight = 0
getViewDimensions()   = {"width":0,"height":0}
rootElement style     = --hic-viewport-width: 800px; --hic-viewport-height: 800px;
```

The test environment is `node` (`vitest.config.js`), JSDOM is opt-in per suite,
and JSDOM does no layout in any case. At width `0`, `maxX` in `clampXY` degrades
to the whole chromosome — still a clamp, to a far looser bound. `testState.js`
already stubs `getViewDimensions` at 800×800 for this reason.

**6. The defect is intermittent, which the card does not say.** `clampXY` is
reachable from `setView` and from `updateLayout()`, and `updateLayout()` is
called *only* when tracks change (`dataLoader.js:433`, `layoutController.js:168`
and `:187`, `annotationWidget.js:233` and `:247`). **A restored session carrying
a track gets clamped incidentally; a bare map restore never does.** The same
session behaves two ways depending on whether it has a track.

## Decision

**1. Restore becomes a translator, and `setActiveDataset` loses its `state`
parameter.** `setActiveDataset(dataset)` sets the dataset; state arrives only
through the chokepoint. The two-argument form is what lets a caller skip
validation, and all five skips are at its call sites.

The rejected alternative — keep the parameter, route the assignment through the
chokepoint inside the setter — hides a chokepoint call in a method named for
something else, which is how this door was built the first time. Dropping the
parameter makes the ordering explicit at every call site, which is also what the
gate is pinning.

**2. An invariant-violating restored state is clamped silently, never
rejected. This is the same rule as normalize.** ADR-0006 and #466 fixed
"defaults and coerces, never rejects" for the normalize stage; applying the
opposite rule to the adjacent stage would mean a session is accepted by one and
refused by the next.

The cost is stated rather than hidden: **a saved view at `pixelSize=1e9`, or with
an origin past the end of the chromosome, now opens somewhere different.** That
is a deliberate change to what a published link shows. Rejecting instead would
turn a link that renders something into a link that renders nothing, which is
strictly worse for the person holding it.

**3. `resolutionChanged` becomes honest, in a ticket of its own.** A restore
landing on the current zoom stops firing a resolution-changed repaint. This is
the invisible-failure-mode class — nothing throws, something just does not
redraw — so it never shares a ticket with decision 2. Bundled, a moved snapshot
would have two possible causes and could not be attributed. #536's lesson
inverted: separate the changes that can move output so each move has exactly one
explanation.

**4. The clamp gets one enforcer, and `updateLayout`'s `clampXY` call is deleted
in the same ticket as decision 2.** Fact 6 is the reason they cannot be
separated: deleting it first would *lose* clamping for track-carrying sessions,
and keeping it after is the second enforcer this candidate exists to remove.

**5. Normalization is validated against the loaded dataset here; the
notification stays #372.** Candidate 9 found `config.normalization` to be one of
exactly three fields `normalizeSession` provably cannot resolve — the valid set
does not exist until a dataset is loaded, and that moment is restore. So the
check has a natural home here and nowhere earlier. It is the same invariant at
the same moment as the clamp.

Candidate 6 does **not** own the error UX. #372 narrows from "silently renders
NONE" to "tell the user", which is a different question with a different
reviewer. This also closes the inconsistency `docs/state-manipulation.md:207`
records — the normalization write being a single field outside the chokepoint.

**6. The sync trio splits three ways; it is not one group.** The card says "move
the three real behaviours onto `State`", but the three are different things:

- `canBeSynched` → **`syncGroup.js`**. It is a group-membership question, and
  `syncGroup.js:18` already answers it in a different spelling. That duplication
  is fact 4.
- `getSyncState` → **`State`**, taking the dataset as a parameter. It is a
  projection of state through a dataset, which is what `State` already does —
  `setView(…, browser, dataset, viewDimensions)` established the convention.
- `syncState` → **deleted**. It is a pass-through whose guard its own caller
  already duplicates.

**7. The `state`/`activeState` setters are deleted; the getters stay.** Reading
`browser.state` is plausible host behaviour and #468 kept the alias vocabulary
reachable; writing it is not, and per fact 2 nothing does. The valuable half is
that **`test/utils/stubbedLoads.js` is rewritten to go through the chokepoint** —
a fixture that writes state directly cannot observe the invariant this candidate
exists to enforce.

ADR-0003's argument that "no measurable consumer" is not "no consumer" is why
the getters survive and only the setters go.

**8. The behaviour change is sequenced before the fold, inverting the card's
title.** *Fold `StateManager` into `State`* is a locality move no user can
observe; *make restore use the chokepoint* is where all the value and all the
risk sit. If the restore half turns out to be too breaking to ship, the fold
alone is not worth a candidate slot — and that is worth learning before spending
the moves, not after.

## How we know restore did not change

A new golden, in the shape #503 and #531 proved. It snapshots the **resolved
`State` after restore**, which neither existing golden covers: #503 snapshots the
decoded session, #531 the resolved config, and the stage between them is exactly
what this candidate moves. The corpus from #502 is reused as input.

**All five doors, not the two being touched.** `dataLoader`'s ladder has four
branches — `config.locus`, `config.state`, `config.synchState`, and the
`State.default` fallback — plus the live-map path at `:259`. Only two call
`browser.setState`. #504 is the reason to cover all of them: the live-map path
had drifted from the file path and lost a rung of the same ladder, and nothing
caught it. A golden scoped to the doors you are touching cannot see the door you
are not.

**Two stated viewports, not one.** Per fact 5 the honest in-harness measurement
is `0`, so the fixture must state a viewport; there is no alternative. It states
*two* because the candidate's whole claim is that clamping happens on restore,
and a single-viewport golden cannot distinguish a clamp from a coincidence. Two
sizes make the dependence visible in the snapshot itself, at roughly double the
corpus — cheap here.

## Sequencing

**#510 lands first, before the gate.** `State.default()` is
`new State(0, 0, 0, 0, 1, "NONE")` against a seven-parameter constructor, so
`y = 1`, `pixelSize = "NONE" → NaN → 1`, `normalization = undefined`; every
default view opens one bin below the origin. It is called from three `dataLoader`
sites this candidate moves, and it silently ignores its `configOrUndefined`
argument. Snapshotting a y-origin of `1` would bake the defect into the gate and
then require a deliberate snapshot move to unbake it. This is #499 and #500
before #503, and #531 before #532 — the third time the same rule applies: **the
fixes that legitimately move output land before the characterization, not after.**

Then, in order:

1. The golden — five doors, two viewports.
2. Restore through the chokepoint (decisions 1, 2, 4). Moves snapshots
   deliberately; `updateLayout`'s `clampXY` goes in this ticket.
3. `resolutionChanged` becomes honest (decision 3). Its own ticket, so its
   snapshot movement has one explanation.
4. Normalization validated against the dataset (decision 5).
5. The sync trio splits (decision 6).
6. The fold: `StateManager` collapses, the setters go, `stubbedLoads` goes
   through the chokepoint (decisions 7, 8).
7. `docs/state-manipulation.md` — its "Bulk replacement" and "Where to look in
   code" sections, plus the `:207` normalization note.

The doc update is the last ticket rather than a ticket of its own, per #536: the
ticket that makes the readers agree is the ticket that writes down what they now
agree on. A standalone doc ticket lands either too early to be true or after
everyone has stopped reading.

## Considered and rejected

**Reject an invalid restored state rather than clamp it.** It would contradict
the normalize stage's rule one seam over, and it converts a link that shows
something into a link that shows nothing. See decision 2.

**Move all three sync methods onto `State`, as the card says.** None of them is
about `State` alone: `getSyncState` reads `dataset.chromosomes` and
`dataset.bpResolutions`, `canBeSynched` reads the dataset *and*
`browser.synchable`. Moving `canBeSynched` onto `State` would create a fourth
copy of the `synchable` rule rather than removing the third.

**Split candidate 6 into two candidates.** The fold alone changes nothing
observable; the restore change alone leaves the get/set wrapper in place. They
stay one candidate, sequenced per decision 8.

**A single-viewport golden.** Cheaper, and blind to the exact property the
candidate is asserting. See *How we know*.

**Take #372 whole.** Its validation half belongs here; its notification half is
an error-surface question this candidate should not be deciding in passing.

## Consequences

- **Phase 4 gains a fifth release note, and the second one an end user can
  hit.** A saved view whose `pixelSize` or origin violates an invariant now opens
  clamped rather than as written. The other four are the `DisposedBrowserError`
  throw (candidate 8), `?juiceboxURL=` (candidate 5, #506), the empty-panel
  session (candidate 5, #500), and `miniMode` absorbing into `figureMode`
  (candidate 9, ADR-0008).
- **A host that initializes into a hidden container gets a weaker clamp.**
  `getViewDimensions()` reads `offsetWidth`/`offsetHeight`, which are `0` for a
  `display: none` subtree, and `maxX` then degrades to the whole chromosome.
  Neither known host does this today. It is not fixed here — the fix is to defer
  the clamp until the element is laid out, which is a rendering question, not a
  state question.
- **`docs/state-manipulation.md`'s "Bulk replacement" section stops describing a
  deliberate exception and starts describing a translator.** This ADR extends
  #411's discipline rather than contradicting it: the doc's own text says bulk
  replacement is an exception "because at startup the new state is the only state
  that exists," and the intermittency in fact 6 is what that reasoning missed.
- **#372 narrows to its notification half** and stays open.
- **The 70 tests in `testState.js`** — the card said 54 — cover `State` in
  isolation and none of them drives a restore. That is the gap the golden fills,
  and it is why "lands in the module with the repo's strongest tests" was not by
  itself an argument for skipping one.
