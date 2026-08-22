# Juicebox.js — Punch List

**As of 2026-08-22 — candidate 6 is picked.** Ordered. Work top to bottom; each phase assumes the one above it.

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

### Landed after this list was last written

Everything below closed on 11 August, after the previous revision of this file was written, so it
read as open here while being done in the tracker. **No candidate work had happened since 9
landed** when this section was written; candidate 6 was picked on 22 August, below.

| # | What | Commit |
|---|---|---|
| #549 | Runtime click-through of the registry — candidate 4's last unverified claim | manual run, plus `dev/issue-477-per-browser-viewport-size.html` (`4d53391`) |
| #477 | `--hic-viewport-*` scoped to each browser's `rootElement` | `461535a` |
| #471 | `onMapLoaded` documented a `datasetType` vocabulary the code never spoke | `ca22bd6`, `7c333f8` |
| #514 | A bare-threshold `colorScale` decoded to `NaN` colour components | `6a70dc3`, `13bdc3e` |
| #515 | An empty data-range field decoded to `NaN` bounds | `aeef59e`, `d326658` |

**Two of candidate 5's eight follow-ups are therefore closed.** Six are still open: **#510**,
**#518**, **#519**, **#521**, **#525**, **#528**. Five of them block nothing. **#510 now does** —
ADR-0009 promoted it from a loose follow-up to candidate 6's prerequisite, and it lands before any
candidate-6 ticket exists.

---

## Phase 3 — The remaining four candidates. **6 is picked.**

Four candidates in `docs/architecture-review.html` are open and **none of them is filed yet**. One is
breaking as currently scoped. Candidate 8 was settled by ADR-0005, candidate 5 by ADR-0006, and
candidate 9 by ADR-0006 decision 8 plus ADR-0008; all three have landed. Each card carries a
Consumer impact block; read it before filing anything.

**Candidate 6 is picked, and ADR-0009 is written.** The choice was open — 9 was the frontier and is
done, so nothing queued behind it — and 6 was taken on its merits: it is the smallest of the four,
it inherits 9's chokepoint reasoning directly, and #510 plus the y-axis defect both sit in code it
moves anyway. **Next step is `/to-tickets` against ADR-0009.** The other three are still unpicked and
the order in the table below is *not* a recommendation.

| Candidate | Status |
|---|---|
| **9 · Give the config schema one reader** | ✅ **done — #531–#536 all landed.** One reader (`js/normalizeSession.js`), run once at the entry, with the schema written down in `CONTEXT.md`. Seam drawn by ADR-0006 decision 8. One ADR opened after all — **ADR-0008**, for the single decision the seam did not settle: `figureMode` absorbs `miniMode` |
| **11 · Give the track tile one owner** | ⚠️ breaking |
| **6 · Fold StateManager into State, and make restore use the chokepoint** | 🔵 **picked — ADR-0009.** Seven tickets planned, gated by #510. Not yet filed |
| **7 · Move the gesture state machines behind InteractionHandler** | watch |
| **10 · One dataset-load path** — *this is the live-map seam* | watch |

### 9 — done. Kept because the reasoning is the template for the next one.

**The first decision was whether it needed an ADR at all, and the answer moved.** ADR-0006 decision 8
already drew the seam: decode and normalize are two stages, and 5 deliberately stopped at the line.
What was left on the wrong side of it was `fixDefaults` and the `selectedGene`
reconciliation (#481) — both crossed in #533 — plus **shortcut expansion running twice** — once on the URL path, once again
in `restoreSession`, because a session handed straight to `restoreSession` bypasses the decoder
entirely. One `normalizeSession` stage that *both* entry paths pass through made one of those
copies deletable, and #534 deleted both in favour of a third that every door meets. That deletion was held back from 5 on purpose: both at once doubles the blast
radius on `hic.init`, the most-used public surface.

So the hard question — where the seam goes and why — is answered. The one genuinely open piece was
**whether normalizing at both entry points changes what `restoreSession` accepts**, and that is
consumer-facing, so it might have been worth an ADR.

**Decided: no ADR.** The answer is "no change to what is *accepted*" — normalize **defaults and
coerces, never rejects**, which is an acceptance criterion on every ticket that could violate it.
What *does* change is what `restoreSession` *produces*, and only for the three divergences #533
closes deliberately. That is `/to-tickets` against decision 8, not a fresh ADR.

**Amended at #536, the last ticket:** one decision did come up that decision 8 does not cover —
`HICBrowser` read `miniMode` as a figure mode and the normalize stage did not, so the two readers
disagreed about the same config and the fix had to pick a winner. That is consumer-visible and is
**ADR-0008**. (ADR-0009 has since gone to candidate 6.)

**Filed as six tickets, gate first** — the shape candidate 5 proved:

| # | Ticket | Blocked by |
|---|---|---|
| #531 | Gate: snapshot the resolved config every entry path produces today | — **landed** |
| #532 | Extract `normalizeSession`: a pure, session-shaped normalize stage | #531 — **landed** |
| #533 | Move the remaining normalization across the seam | #532 — **landed** |
| #534 | Delete the duplicate URL-shortcut expansion | #533 — **landed** |
| #535 | Normalize once, at the entry | #533 — **landed** |
| #536 | Downstream readers stop defaulting, and the schema is written down | #535 — **landed** |

#534 and #535 ran in parallel after #533. **#533, #534 and #536 are the tickets that deliberately move
snapshots** — #536 was expected to be neutral and was not, for a reason worth carrying: a default
moved *up* into the stage becomes a **field of the resolved config**, and the config is snapshotted.
Every fixture gained `synchable` and `backgroundColor` with no behaviour change at all, one fixture
(`mini-mode`) moved behaviourally because that is the divergence it was written to expose, and one
query fixture moved `displayMode` at construction only because the write it records happened a stage
earlier. #533 closes three divergences at once: track defaults skipped by `restoreSession`, the
`selectedGene` reconciliation, and `syncDatasets` honoured by `createBrowserList` but not
`createBrowser`. #534 closes the fourth — the two browser-creation doors reached directly handed an
unexpanded `*s3/…` to the loader — and moves the *decoder's* golden file as well, since a shortcut
now leaves the decoder as it arrived. The estimate that #534 would be snapshot-neutral was wrong for
one reason worth remembering: deleting a duplicated rule in favour of a shared stage necessarily
widens the rule to every caller of that stage, and widening is visible. Blocking edges are GitHub-native, so the frontier is queryable rather than read
off this table.

**Two card corrections found while decomposing**, both from candidate 5 landing — recorded here and
in #466 rather than on the frozen card: `normalizeConfig` **already exists** in `createBrowser.js`
(browser-shaped, unexported, called once per browser), so #532 deepens it rather than inventing it,
and the new stage is named `normalizeSession` to avoid the collision. `fixDefaults` now lives in
`sessionCodec.js`, not `urlUtils.js`. The card also lists `js/browserUIManager.js`, which candidate
3 deleted.

**9 inherited the gate 5 had to build, and built one of its own on top of it** (#531, the resolved
config through every door). Both held: every moved fixture across the candidate is one someone can
explain, in a table in the file that holds it. **#525 was a filed instance of the bug 9 existed to
fix:** `fixDefaults` forced every track to `COLLAPSED`, so the URL path and the direct-restore path
disagreed about the same session. #533 closed the disagreement by moving the pass to the shared
stage; **#525 is still open** and now asks one question rather than two — whether forcing
`COLLAPSED` at all is right, about one stage rather than about which door you came in by.

**What candidate 5 confirmed, and 9 confirmed again:** the pattern held a third time — ADR →
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
  #521, #525, #528) came out of this candidate without derailing it. Two — #514 and #515 — have
  since been fixed on their own, which is the rest of the rule working: filed work does get done,
  just not on the refactor's critical path.

**What candidate 9 added, worth carrying into whichever is next:**

- **A gate can have an acceptance criterion that the work makes impossible, and that is not a
  failure of either.** Every candidate-9 ticket carried "the snapshots come back byte-identical".
  #536 moved 63 and could not have done otherwise: **a default moved *up* into a shared stage
  becomes a field of the thing being snapshotted.** The discipline that saved it was tallying the
  whole diff by hand before updating, and writing the three kinds of movement into the log — not
  the criterion.
- **"Two stages own different questions" is a claim to re-check, not a conclusion to inherit.**
  #533 justified keeping a duplicated track rule in the loader on the grounds that the loader knew
  something the document did not. It did not — the field it keyed on came from the config. The real
  gap was a *door with no stage behind it*, and finding it deleted the duplicate.
- **The last ticket is where the deferred decision comes due.** "May not need its own ADR" survived
  five tickets and broke on the sixth, because the question the seam does not answer is the one
  nothing forces you to answer until the readers have to agree. Expect it, rather than treating it
  as scope creep.

**11** — the `TrackXYPairLoad` payload *is* the track pair, and juicebox-web reads its shape.

### 6 — picked 22 August. ADR-0009 is written; tickets are next.

**Grilled before filing, and the card lost four claims.** Read
[ADR-0009](adr/0009-restore-is-a-translator.md) before the tickets — the short version:

- **The card points at the wrong back door.** `browser.state = x` and `browser.activeState = x`
  carry the "bypasses validation" comment and have **zero production callers** — only tests. The
  live bypass is `setActiveDataset(dataset, state)`: five `dataLoader` sites, unvalidated, no
  comment. Decision 1 drops the parameter.
- **The defect is intermittent.** `clampXY` is reachable from `updateLayout()`, which runs only
  when tracks change. A restored session carrying a track is clamped incidentally; a bare map
  restore never is. Same session, two behaviours — and it is why the gate states *two* viewports:
  with one it cannot tell a clamp from a coincidence.
- **The sync trio is not one group.** Moving `canBeSynched` onto `State`, as the card says, would
  make a *fourth* copy of the `synchable` rule rather than removing the third. It splits three
  ways instead.
- **Counts moved.** `StateManager` is twelve methods, not ten; `testState.js` is 70 tests, not 54,
  and **none of them drives a restore**.

**Measured, not assumed:** the viewport *is* sized before restore runs in a real browser, so the
clamp is not decorative — but it reads `0` in the harness, so the gate's fixture must state one.
Probe output is in the ADR.

**#510 lands first, alone, before the gate.** Third time that rule applies (#499/#500 before #503,
#531 before #532). It has been re-briefed to say so.

**The one release-note consequence:** clamping silently means a saved view at `pixelSize=1e9` now
opens somewhere different. That is phase 4's **fifth** note and the second an end user can hit.

Accessor names remain load-bearing — #468 settled the vocabulary and decision 7 keeps the getters,
deleting only the setters.

**7** — must keep both crosshair paths firing for Spacewalk. Largest remaining deepening, ~300
lines of closures with no test surface. **The one candidate that may want `/wayfinder`** rather
than `/to-tickets`: its shape is genuinely unknown, where candidate 4's was settled in a grilling
session before any ticket existed.

**10** — three named load methods must survive.

**Skill:** `/to-tickets` against ADR-0009 for candidate 6; the same when you pick another up. Full routing rules, and the reason to file tickets
*before* the blocker clears, are in `docs/agents/triage-labels.md`. **ADR-0005 went to candidate 8, ADR-0006 to
candidate 5, ADR-0008 to candidate 9 (`figureMode` absorbs `miniMode`) and ADR-0009 to candidate 6.
ADR-0007 was reserved for #477 and never written — #477 landed without one — so the number is a
deliberate gap, not a missing file. ADR-0010 is the next free number.**

When a candidate lands: tick it in [#466](https://github.com/aidenlab/juicebox.js/issues/466) and
add an Outcome box to its card. That is the only time either file is touched.

---

## Phase 3b — Loose ends from candidate 4.

| Task | Issue | Skill |
|---|---|---|
| ~~`--hic-viewport-*` CSS variables are page-scoped~~ | [#477](https://github.com/aidenlab/juicebox.js/issues/477) | **done** — `/grill-with-docs`, no ADR |
| ~~Runtime click-through of the registry against juicebox-web~~ | [#549](https://github.com/aidenlab/juicebox.js/issues/549) | **done** — manual, run 2026-08-11 |

**#477 is done, so "candidate 4 is done" now does mean two embeds can be sized independently.**
The grilling closed all three of its open questions, and none of them landed where the issue
guessed. The properties moved to each **browser's** `rootElement`, not to the registry's
container — a container holds many browsers, so container scoping would have left the same bug
inside juicebox-web's own clone-a-browser layout. The rules did **not** need rewriting: `.hic-root`
is their only reader and custom properties inherit, so the change is which element they are
written to and nothing else. And no host reads them — checked against both consumers per
ADR-0003. No ADR was written; the outcome is appended to ADR-0004's scope section, which is what
deferred it. (0007 is therefore still unclaimed; 0005 went to candidate 8's teardown contract,
0006 to candidate 5's wire format.)

One behaviour change ships with it: a browser constructed without `width`/`height` used to inherit
whatever the last-sized browser wrote to the page, and now falls back to the stylesheet's 640px.

**The click-through is done, so candidate 4 has no unverified claim left.** It was filed as #549
rather than carried in someone's head, run against `npm run dev` on 2026-08-11, and all six boxes
passed. Nothing misbehaved, so no follow-ups came out of it. The result is recorded on #466's
pre-release checklist, which is where phase 4 reads it.

**One thing the run changed, and it is a lesson rather than a defect.** The box originally read
"while two panels exist, confirm they now size independently", and that cannot be clicked: nothing
in the app resizes a browser — there is no resize gesture — and juicebox-web's clone copies the
source browser's dimensions (`initializationHelper.js:387`), so both panels are the same size by
construction and pre-/post-#477 look identical there. The box was split in two: juicebox-web can
only confirm the weak version (clone sizing), and #477's actual claim needed a harness —
`dev/issue-477-per-browser-viewport-size.html`, four browsers at three sizes plus one unsized built
*last*, so the old last-writer-wins behaviour would show. Its real gate is the assertion that
`document.documentElement` carries no inline `--hic-viewport-*` at all. **A manual box that names
no gesture is a box nobody can check** — that is worth catching at filing time on the next one.

---

## Phase 4 — Release.

#466 sets the rule: **no release until every candidate is done.** Both consumers pin `v3.6.2`,
so a moving `master` costs them nothing until then.

Before releasing:
1. Re-measure the consumer surface — `docs/adr/0003-public-api-contract.md` goes stale the moment
   either app changes. It already under-counted once, and candidate 8 added two members to it
   (`browser.dispose`, `registry.dispose`). #474 proposes making that re-runnable.
2. Run #466's pre-release consumer verification checklist. The registry click-through it carried
   over from candidate 4 is **already checked off** (#549, 11 August); what remains unchecked there
   is the 20-member consumer surface and the four release notes below.
3. Bump / tag / `gh release create` / repoint both consumers.

**The release notes owed so far — four, from candidates 8, 5 and 9:**

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
4. **A config saying `miniMode: true` now turns the locus box, map label and chromosome selector
   off** (candidate 9, #536, [ADR-0008](adr/0008-figuremode-absorbs-minimode.md)). `figureMode`
   absorbs `miniMode` and a mini map is a figure. Before, such a config produced a browser that
   called itself a figure and kept all three chrome elements — every entry path agreeing with the
   others and none with itself. `miniMode` is not deleted or rejected; it is carried through unread.
   Only reachable from a config a host passes in code — no wire format encodes `miniMode`.

Note that 2 is the only one that can affect an end user rather than an embedder; 4 is the only one
either known host could plausibly hit, and neither passes `miniMode` today.

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
