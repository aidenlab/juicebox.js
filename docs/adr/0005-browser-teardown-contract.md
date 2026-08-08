# ADR-0005 — Browser teardown: `dispose()` is the one path, `reset()` keeps identity

**Status:** Accepted
**Date:** 2026-08-08
**Related:** candidate 8 in `docs/architecture-review.html`, ADR-0003 (public
API), ADR-0004 (browser registry, which left `dispose()` a call site waiting for
a body), #414 (event bus cleanup), #438 (scriptable probe harness), #469
(abandoning a repaint pass whose state was replaced), #466 (release gate)

## Context

`HICBrowser`'s constructor installs 29 fields. Four different methods claim to
undo some of that, and no two agree:

| Path | What it does | Public? |
|---|---|---|
| `reset()` (`hicBrowser.js:501`) | removes track XY pairs, clears image caches, empties `tracks`/`tracks2D`, blanks two labels, `clearState()`, `unsyncSelf()` | yes — `publicApi.js:110` |
| `clearSession()` (`hicBrowser.js:514`) | `clearState()`, `setDisplayMode('A')`, `unsyncSelf()` | no |
| `registry.delete()` (`browserRegistry.js:134`) | `unsyncSelf()`, `rootElement.remove()`, drop from list, fall selection through | yes, via `deleteBrowser` |
| `registry.deleteAll()` (`browserRegistry.js:146`) | `rootElement.remove()` only | yes, via `deleteAllBrowsers` |

Four facts, established by reading the checkout, shape the decision:

1. **`reset()` has no callers inside this repo.** Its only callers are
   juicebox-web (`initializationHelper.js:371`) and `dev/load-and-reset.html`. It
   is consumer surface and nothing else.

2. **`reset()` is already mostly redundant on juicebox-web's path.**
   `browser.reset()` clears state; the very next line, `browser.loadHicFile()`,
   calls `clearSession()`, which clears it again. `reset()`'s only unique
   contributions there are the track and image-cache teardown.

3. **Nothing anywhere removes `inputDialog`.** One construction site
   (`hicBrowser.js:100`, appended to the *host container*, outside
   `rootElement`), one read site (`trackMenuUtils.js:133`), zero teardown. Every
   delete path removes only `rootElement`, so every `restoreSession()` — which
   opens with `deleteAll()` — orphans one dialog per browser, permanently.

4. **`deleteAll()` skips `unsyncSelf()` and `delete()` does not.** So a session
   restore leaves surviving browsers holding references to deleted peers. This is
   a live bug on a path both hosts use, reachable today, independent of anything
   below.

Two claims on candidate 8's card are **stale and are not carried forward**:

- *"`this.eventBus` subscriptions never unsub"* and *"`globalBus` subscriptions
  never unsub"* — `grep -rn subscribe js/` returns zero subscription sites outside
  `eventBus.js`. #414 migrated every internal subscription to the coordinator and
  added `EventBus.unsubscribe()`. The only subscribers left are hosts, and
  juicebox cannot unsubscribe those on their behalf. See `publicApi.js:238-240`.
- *"`reset()` during in-flight render throws (#469)"* — the punch list's summary
  of #469 is wrong. Commit `f4f5ce5` resolved it with a **state-identity check**
  in `contactMatrixView.js:216`: a repaint pass compares `this.browser.state`
  against the object it started from and abandons if they differ. Nothing throws.
  This is a constraint on the work below, not a precedent for it.

The constraint that decides the shape: juicebox-web does

```js
const browser = hic.getCurrentBrowser()
browser.reset();
await browser.loadHicFile(config);
controlMapDropdown.enableIfMapLoaded(browser)
```

It holds one reference across all three lines and hands it onward. Both hosts pin
`v3.6.2`.

## Decision

**`dispose()` is the single teardown. `reset()` is dispose-then-construct on the
same instance, and browser identity survives it.**

1. **`reset()` preserves identity.** Same instance, same `id`, same registry slot.
   Dispose-and-reconstruct happens *inside* the object; the host's reference stays
   valid. "Symmetric with the constructor" is a claim about what gets torn down,
   not about who owns the pointer. **This makes candidate 8 non-breaking**, and
   removes it from the list of breaking candidates in the punch list.

2. **`reset()` must install a *new* `State` object, not mutate the existing one.**
   #469's abandonment check is identity-based. A reconstruction that reuses the
   State object leaves every in-flight repaint pass painting into a browser being
   rebuilt, silently. This is the single easiest way to break this work.

3. **`dispose()` removes `rootElement`; `reset()` restores its position.**
   `rootElement` is appended with plain `appendChild`, so sibling order is
   insertion order — a naive dispose-then-construct on the first of two panels
   re-appends it last and the panels visibly swap. `reset()` captures
   `rootElement.nextSibling` before disposing and re-inserts with `insertBefore`.
   Two lines, and it keeps the symmetry literally rather than aspirationally.

4. **The constructor records what it installs outside `rootElement`; `dispose()`
   walks that record.** `inputDialog` is the only member today, but the general
   mechanism is the candidate's actual point — one place to add cleanup when a
   field is added. Moving `InputDialog` inside `rootElement` instead was
   considered and is cheaper, but it changes a modal's stacking context for a leak
   the general fix closes anyway. Worth *testing*; not worth depending on.

5. **`dispose()` clears the per-browser bus and never touches `globalBus`.** The
   per-browser bus is owned by the browser and dies with it, so clearing its
   subscriber map is correct and releases host handler references — Spacewalk's
   `DidHideCrosshairs` handler is a real retention path today. `globalBus`
   outlives every browser and its registrations belong to the host. No
   `BrowserDispose` event: it would add public surface to solve a problem clearing
   the bus already solves.

6. **A disposed browser is fatal, not inert.** `dispose()` sets a flag and the
   published methods throw a named error thereafter. `registry.delete()` leaves a
   zombie the host may still hold — juicebox-web holds `browser` references across
   several call sites — and #469's precedent is to fail visibly rather than let a
   stale object drift. A thrown error appears in the host's console in
   development; a silent no-op appears as a blank panel in production.

7. **`dispose()` is published, at both levels.** `browser.dispose()` and
   `registry.dispose()` go into `js/publicApi.js` and ADR-0003's tables in the
   same PR. Spacewalk tears down its Juicebox panel and has no way to say so
   today. Per ADR-0003's "absence is not permission," a new reachable member
   becomes contract the moment it ships, so it is declared deliberately.

8. **`registry.dispose()` evicts the registry from the container `WeakMap`.** A
   host that disposes an embed and later calls `hic.init(sameContainer, config)`
   gets a clean registry, because `registryForContainer` creates lazily. ADR-0004
   decision 8 keyed the map by container precisely so a dropped container drops
   its registry; eviction is the explicit form of the same rule, and it makes
   "dispose then re-init the same container" supported rather than accidental.

9. **`clearSession()` is renamed `clearDataset()` and stays.** It is a genuinely
   different operation — the soft clear before loading a new dataset into a
   browser that is *staying*, deliberately preserving the DOM and widgets that
   `dispose()` destroys. Four teardown verbs was the disease; `dispose()` makes
   five unless the survivors say what they are. It is internal-only, so the rename
   is cheap and rides along in the `dispose()` ticket.

### Sequencing

**#438 does not block this candidate.** An earlier draft of this ADR said it did,
on the premise that counting orphaned dialogs needed a scriptable browser
harness. That was wrong: ADR-0004 built the test surface this needs, and the
assertion runs in JSDOM today. A throwaway probe against
`test/utils/browserFixture.js` confirms it —

```
container children after 3 build/delete cycles: 3
child classes: [ 'igv-ui-generic-dialog-container' × 3 ]
```

Every acceptance criterion in this candidate is a DOM-node count or an
object-graph check, and vitest does both. #438 remains needed for what JSDOM
cannot do — real canvas output, real gestures, pixel probes — which is none of
this work. It returns to the optional side track.

1. This ADR.
2. The `clearSession` → `clearDataset` rename, as prefactor.
3. The `deleteAll()` / `unsyncSelf()` bug (fact 4), standalone. A one-line fix on
   the critical path of the thing being refactored, landed before the
   restructuring so the candidate's diff stays pure. Independent of the rename.
4. `dispose()`, then `reset()` on top of it, then `registry.dispose()`.

## Considered and rejected

**`reset()` returns a new browser.** The literal reading of "reset becomes
dispose-then-construct," and what the card's Consumer impact block warned about.
It breaks juicebox-web at `initializationHelper.js:373` and turns a refactor into
a coordinated multi-repo release. It buys nothing reconstruction-in-place cannot
do.

**Deprecating `reset()` in favour of hosts calling `delete()` + `createBrowser()`
themselves.** Pushes lifecycle management into every host to save one method on a
published surface, and would strand `dev/load-and-reset.html`.

**Dropping the bus work entirely** (on the grounds that fact 5's staleness leaves
nothing internal to unsubscribe). Rejected because the per-browser bus still holds
*host* handler references after the browser is gone, which is the retention path
that matters.

**Folding the `deleteAll()` fix into the candidate.** The standing rule in this
repo is to file bugs found during refactoring and keep refactoring. The stated
exception is a bug on the critical path of the refactor itself, which this is.

## Consequences

- Candidate 8 is **not breaking**. The punch list's "four breaking candidates"
  becomes three: 5, 11, and whatever 6/7/9/10 turn into.
- The candidate is **smaller than its card**. Two of five "Before" bullets were
  already fixed by #414. What remains is the `inputDialog` leak, the DOM/position
  symmetry, the per-browser bus clear, and the consolidation of four verbs into
  two.
- `dispose()` and `registry.dispose()` widen the published surface, so ADR-0003's
  consumer tables go stale on the same day — which is #474's argument, and Phase 4
  step 1 has to re-measure regardless.
- Decision 6 means a host that currently calls a method on a deleted browser and
  gets away with it will now see an exception. Neither known host does this
  today; a third-party embedder might. This is the one behavioural change worth
  naming in release notes.
- Decision 2 is the failure mode to watch for in review: it is invisible and it
  only shows up under load latency. `test/testRepaintDuringReset.js` is where it
  gets pinned — the file already exists, from #469.
- The "no test surface" reflex is now wrong twice in this repo. ADR-0004 made
  browsers constructible in a test, and `test/utils/browserFixture.js` stands one
  up in JSDOM with a stubbed 2D context. Check it before concluding something
  needs #438.
