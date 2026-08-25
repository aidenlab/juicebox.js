# ADR-0003 — What juicebox.js's public API actually is

**Status:** Superseded in part by `js/publicApi.js` (see *Reversal*)
**Last measured:** 2026-08-24, for the v4.0.0 release — see *Re-measurement* at the end. The tables below are the 2026-08-06 measurement and are kept as history.
**Related:** #466 (architecture review tracker), ADR-0002

This ADR exists because `docs/architecture-review.html` was written without it, and
produced at least one wrong verdict as a result. See *Why this was written*.

> **Read `js/publicApi.js` for the surface itself.** Decision 3 below deferred the
> question of how to mark the surface in code; #470 answered it, and the manifest
> is now the source of truth. A contract test checks it, so it cannot silently go
> stale the way the tables below did — two of their entries were already wrong
> within a week of being measured.
>
> What stays here is what a manifest cannot carry: *why* the surface is what it
> is, which consumer uses what, and the reasoning about third parties. The tables
> below are kept as the measurement they were, dated, not as a live index.

## Context

juicebox.js is **an embeddable component, not an application.** Its correctness
condition is not "the dev harness still works" — it is "the host apps still work,
and so does an embedder we have never heard of."

Two consumers are known and can be measured:

- **juicebox-web** (`~/JuiceboxDevelopment/juicebox-web`)
- **Spacewalk** (`~/SpacewalkDevelopment/spacewalk`)

Both pin `github:aidenlab/juicebox.js#v3.6.2`. Neither tracks `master`, which is
why a moving `master` costs them nothing *until a release* — and why the release
is the moment every accumulated breakage arrives at once.

### The structural problem

`js/index.js` exports twelve names. **`HICBrowser` is not one of them.** Hosts
obtain browser instances from `init()`, `createBrowser()` or `getCurrentBrowser()`,
and then use them. So the entire browser-instance surface is public in practice and
declared nowhere — there is no export list to consult, no `@public` marker, no
test that fails.

The consequence: **the deletion test cannot be answered from inside this repo.**
Asking "does anything call this?" and grepping `js/` returns *no* for members that
two shipped applications depend on. Every refactor that trusts that grep is
reasoning from a false negative.

## The measured surface

Everything below was measured, not assumed. Two caveats that apply to the whole
section: these are the *known* consumers at one commit each, and a member's absence
here is **not** evidence that no one uses it — see *Third parties*.

### Namespace — `js/index.js` (declared, 12 exports)

| Export | juicebox-web | Spacewalk |
|---|---|---|
| `init` | ✔ | — |
| `createBrowser` | ✔ | — |
| `getCurrentBrowser` | ✔ (10 sites) | ✔ |
| `setCurrentBrowser` | ✔ | — |
| `getAllBrowsers` | ✔ | — |
| `restoreSession` | ✔ | ✔ |
| `compressedSession` | ✔ | ✔ |
| `toJSON` | ✔ | ✔ |
| `setUrlMapper` | ✔ | ✔ |
| `EventBus` | ✔ (globalBus) | — |
| `version` | — | — |
| `igvxhr` | — | — |

Ten of twelve are live. This part of the contract is healthy: it is declared, and
it is used roughly as intended.

### Browser instance — undeclared, 17 members in use

| Member | juicebox-web | Spacewalk | Notes |
|---|---|---|---|
| `loadHicFile` | ✔ | ✔ | delegation to `dataLoader` |
| `loadTracks` | ✔ | — | delegation to `dataLoader` |
| `loadHicControlFile` | ✔ | — | delegation to `dataLoader` |
| `loadLiveContactMap` | — | ✔ | delegation to `dataLoader` |
| `parseGotoInput` | — | ✔ (3 sites) | delegation to `interactions` |
| `reset` | ✔ | — | real method |
| `dataset` | ✔ (3 sites) | ✔ | accessor; SW also reads `.isLive` |
| `activeDataset` | — | ✔ (4 sites) | accessor; SW also reads `.isLive` |
| `genome` | — | ✔ | truthiness guard only |
| `id` | — | ✔ (9 sites) | used to build DOM selectors |
| `rootElement` | — | ✔ | `.querySelector('.hic-navbar-container')` |
| `contactMatrixView` | — | ✔ (9 sites) | calls `.update()`, reads `.ctx` |
| `layoutController` | ✔ | ✔ | see below |
| `eventBus` | ✔ | ✔ | see below |
| `coordinator` | — | ✔ | `.addCallback(...)` — ADR-0002 |
| `setCustomCrosshairsHandler` | — | ✔ | real method |
| `config` | ✔ | — | reads `{width, height}` back off the browser |

**Added since the measurement:** `dispose` (#493, decision 7 of ADR-0005). It has
no row above because the table measures what hosts *use*, and no host can use a
method that did not exist when they were measured — Spacewalk tears its Juicebox
panel down and had no way to say so. It is published deliberately, and it changes
the meaning of every other row: after `dispose()` the browser is a zombie, and
each method here throws `DisposedBrowserError` rather than quietly doing nothing.
That is the behaviour change worth naming in release notes.

**Five of these are the "zero-behaviour delegations"** that candidate 3's card
counted as deletable: `loadHicFile`, `loadTracks`, `loadHicControlFile`,
`loadLiveContactMap`, `parseGotoInput`. Four of them have **no internal callers at
all** — they exist solely for hosts. Deleting them would not remove a hop; it would
promote `dataLoader` and `interactions` from internal collaborators to published
names, freezing the browser's internal decomposition into the contract.

### Browser registry — added since the measurement

The measurement predates the per-container registry, so no row above names one:
`initRegistry()` and `browser.registry` (ADR-0004, #483 and #479) hand a host an
object this table never saw. Its declared members live in `REGISTRY_SURFACE` —
that manifest, not this table, is the current list.

**Added since the measurement:** `registry.dispose` (#496, decisions 7 and 8 of
ADR-0005), the embed-level counterpart of `browser.dispose` above and of
`initRegistry`. It disposes every browser the registry owns and then **evicts the
registry from the container map**, so a host that takes its embed down and later
calls `hic.init()` on the same element gets a clean registry rather than a dead
one. Neither known host can be measured using it, for the same reason
`browser.dispose` cannot: it did not exist when they were measured, and Spacewalk
removing its Juicebox panel is exactly the case it is for.

Unlike a disposed browser, a disposed *registry* is not fatal — it is simply a
registry with no browsers, and what a host can observe is that a second `init()`
on the same container hands back a different object. Nothing here throws.

### Sub-surfaces reached *through* those members

These are contract too, and are easy to miss because they are one dot further out:

- `layoutController.removeTrackXYPair(pair)` — juicebox-web
- `layoutController.getContactMatrixViewport()` — Spacewalk
- `contactMatrixView.update()`, `contactMatrixView.ctx` — Spacewalk
- `contactMatrixView.viewportElement` — Spacewalk sizes its live-map view from
  it. **Missed by the measurement above** and found while reviewing #470, which
  is the argument for the manifest in one line: the table was hand-built and
  incomplete within a week.
- `coordinator.addCallback(name, fn)` — Spacewalk registers `onMapLoaded`,
  `onBackgroundColorChange` and `onForegroundColorChange`. The coordinator accepts
  **six** names and throws on anything else, so all six are published behaviour;
  `onControlMapLoaded`, `onLocusChange` and `onGenomeChange` are registerable and
  currently unused.
- `dataset.isLive`, `activeDataset.isLive` — Spacewalk

**Event payloads are contract too.** juicebox-web's `TrackXYPairLoad` /
`TrackXYPairRemoval` handlers receive the track pair itself and read
`data.track.config.format` and `data.track.name` off it, then hand the same object
back to `layoutController.removeTrackXYPair(...)`. So `TrackPair.track` and its
`config.format` are published shape, not internals — relevant to candidate 11.

### The event bus — the sharpest case

Events **posted** by juicebox.js at HEAD (7):

| Event | Bus | Subscribed by |
|---|---|---|
| `GenomeChange` | global | juicebox-web (2 sites) |
| `BrowserSelect` | global | juicebox-web |
| `TrackXYPairLoad` | global | juicebox-web |
| `TrackXYPairRemoval` | global | juicebox-web |
| `DidHideCrosshairs` | per-browser | **Spacewalk** |
| `DidShowCrosshairs` | per-browser | nobody |
| `DragStopped` | per-browser | nobody |

Subscriptions **inside** juicebox.js (8): `UpdateContactMapMousePosition`,
`NormalizationChange`, `TrackLoad2D`, `TrackState2D`, `ColorChange`,
`NormVectorIndexLoad`, `NormalizationFileLoad`, `NormalizationExternalChange`.
**None of these events is posted anywhere.** They were migrated to the coordinator
and the subscriptions were left behind.

So the bus has **zero live internal subscribers and five live external ones.** It
looks dead from inside and is load-bearing from outside. That is the whole thesis
of this ADR in one data point.

### A regression this surfaced

juicebox-web subscribes `browser.eventBus.subscribe("MapLoad", checkControlMapDropdown)`
(`initializationHelper.js:570`). **juicebox.js has not posted `MapLoad` since PR
#406** ("Refactor browser god object", 2025-12-02), which shipped in `v3.1.0`. The
subscription has been silently dead for eight months; `checkControlMapDropdown`
never fires, so the control-map dropdown is only ever enabled by the direct call
made at subscribe time.

Nothing failed. No test broke, no error was logged, and the review that catalogued
the event bus recorded the per-browser bus as having "zero subscribers" — true of
this repo, false of the product. **This is what the missing consumer lens costs,
and it has already been paid once.**

## Decision

**Document the surface; do not freeze it yet.**

1. **The measured surface above is the contract as of v3.6.2.** Changing any member
   on it — renaming, removing, changing its signature or its return type — is a
   breaking change requiring a coordinated release across both consumers, per the
   release ceremony.

2. **The deletion test is not valid against `js/` alone.** Before deleting any
   member reachable from a browser instance, from `js/index.js`, or from an object
   returned by either, grep both consumer checkouts. "No callers in this repo" is
   not a finding; it is half a finding.

3. **No code changes here.** No `@public` markers, no explicit facade, no export
   changes. Marking the intended surface in code is a real improvement and a real
   design decision — it belongs in its own candidate, argued on its own merits, not
   smuggled in through a documentation ADR. This ADR only establishes what is true
   today.

4. **Absence from the table is not permission.** See below.

### Third parties

juicebox.js is MIT, published, and embeddable by anyone. The two consumers here are
the ones we can *see*; they are not the population. A member that appears in no
column above may still be in use by an embedder we have no visibility into.

Practical consequence: absence from the table lowers the risk of changing something,
it does not zero it. For anything that looks like a load, a session, a state or a
lifecycle call, prefer deprecation over deletion even when both columns are empty.
For genuinely internal machinery — a private helper, a field with no accessor — the
table is sufficient.

## Consequences

- **Refactor candidates need a consumer line.** Every card in
  `docs/architecture-review.html` now carries one. A candidate whose card says
  "no external impact" has been checked; one that says nothing has not.
- **The pre-release checklist in #466 is necessary but insufficient.** Verifying at
  release time catches breakage after the design decision has been made and the
  code written. The lens has to be applied when the candidate is *scoped*.
- **Member counts are not a design target.** Candidate 3's `80 → ~49` was computed
  by counting members that forward without adding behaviour. That is a property of
  the code; it is not a property of the design, because for an embeddable component
  a forwarding member *is* the interface. See #467.
- **Two consumers is a small sample.** Both are aidenlab projects that evolve
  alongside this one, so they under-represent how a stranger would use the library
  — they know which internals are safe to reach into because they were there when
  those internals were written.

## Reversal

**This has now happened.** #470 marked the surface in code as `js/publicApi.js`,
enforced by `test/testPublicApi.js`. Per the plan set out here, the manifest is the
source of truth and this ADR is history: it keeps the reasoning and the
consumer-usage evidence, and hands the surface itself over.

Decision 3 said no `@public` markers, no explicit facade, no export changes. The
manifest honours all three — it is a declaration, not a wrapper. `HICBrowser` is
still not exported, and nothing about how hosts obtain a browser changed.

One gap the marker does not close: the events listed above are declared in the
manifest but not enforced, because proving an event is still *posted* requires
driving a real map load. That is the `MapLoad` failure mode, and it stays open
until #438 gives the probe harness a home.

The tables above still go stale the moment either consumer changes. Re-measure
them at each release rather than trusting them — and when you do, update the
manifest, not just the tables.

---

## Re-measurement — 2026-08-24, for the v4.0.0 release

Appended, not revised: this ADR is append-only and the tables above stay as the
measurement they were.

Measured against `juicebox.js` at `close-466-descope-and-release-v4.0.0`,
`juicebox-web` `master` and `spacewalk` `main`, as the pre-release step #466
called for. **The result is the one that matters: every member either consumer
uses today is declared in `js/publicApi.js`. Zero undeclared members in use.**

The drift is entirely in the tables above, and it ran in **both directions** —
which is the finding, because the failure this ADR was written about was drift in
one direction only.

| Consumer | What moved | Where |
|---|---|---|
| juicebox-web | **`browser.eventBus` has zero call sites.** All four global-bus subscriptions go through `hic.EventBus.globalBus` instead | `initializationHelper.js:140, 142, 223, 241, 253` |
| juicebox-web | **gained** `browser.coordinator.addCallback('onMapLoaded', …)` | `controlMapDropdown.js:37` |
| juicebox-web | **gained** a read of `hic.getCurrentBrowser().config` for `{width, height}` — the tables attributed `browser.config` to Spacewalk alone | `initializationHelper.js:386` |
| Spacewalk | **`browser.config` has zero call sites** | — |
| Spacewalk | **gained** `browser.dataset`, read for `dataset.isLive` | `juicebox/hicMapState.js:19` |
| Spacewalk | **gained** `browser.loadHicFile` — the tables had it as juicebox-web's alone | `juicebox/juiceboxPanel.js:301` |

`browser.dispose()` and `registry.dispose()` have **zero call sites in either
consumer**, which confirms in measurement what candidate 8 asserted in prose:
neither known host can reach `DisposedBrowserError`. It ships as a release note
for third-party embedders, not for these two.

### One measurement trap worth writing down

Spacewalk embeds **igv as well as juicebox**, and both are reached through a
variable named `browser`. A naive `grep -o 'browser\.[A-Za-z_]*' src/` returns
`trackViews`, `search`, `loadGenome`, `referenceFrameList`, `loadTrackList`,
`removeAllTracks`, `loadSession`, `toJSON`, `compressedSession` and
`columnContainer` — **none of which are ours.** They are `igvPanel.browser`. The
count has to be scoped to `src/juicebox/` and checked call site by call site.

This is the inverse of the error in *Why this was written*: there, grepping `js/`
under-counted because the surface was invisible from inside the repo. Here,
grepping a consumer **over-counts** because two libraries share a noun. Both are
the same mistake — trusting a name match instead of resolving what the name
refers to — and #474 remains the fix for both: make the measurement re-runnable
rather than re-reasoned.

### Consequence

**Nothing was required of the release.** The manifest held across eight refactor
candidates and 160 commits, including two that deleted a module (`StateManager`)
and one that removed a wire format (`?juiceboxURL=`). The half of the contract
that drifted is the half nothing executes.

---

## Appended — 2026-08-25: `config.colorScale`'s threshold is a directive

Appended, not revised, per the rule above. This adds a clause to the contract
rather than re-measuring it: the surface did not change, but something a host may
rely on was true only by accident and is now stated.

**A `colorScale` on a config names the contrast the map opens at. The first
render draws at that threshold; it does not compute one and overwrite it.**

This was never written down, and until #575 it was not reliably true. The
mechanism is a cache seed: `contactMatrixView.setColorScale` files the threshold
in `imageTileSource.thresholdCache` under `colorScaleKey(state, displayMode)`,
and the first render pass reads the same key back. Where the key matches, the
host's value stands. Where it does not, `#ensureColorScale` refetches contact
records and replaces the threshold with the 95th percentile of the data.

Before #575, `init` seeded that cache *above* the normalization enforcer, so the
key carried the **requested** normalization while the render looked up the
**resolved** one. The two agree only when nothing was substituted. So the
directive was honoured when the request happened to be valid and silently
discarded when it was not — which is not a contract, it is a coin flip.

### Why this is a contract rather than a hint

`toJSON` writes `colorScale` into every saved session (`hicBrowser.js:1365`), and
session restore comes back through `init`'s config. So the population relying on
this is not a hypothetical embedder reading an options table — it is **every
published juicebox link**. A link reopening at a different contrast than the one
it was saved at is the same class of harm ADR-0009 decision 2 argues against for
`pixelSize` and origin: a link that no longer shows what it was made to show.

The measurement tables above cannot see this. They record which *members* a
consumer calls, and this is a claim about what a member *does* with a field.
`browser.config` and `restoreSession` are both in the tables; the behaviour that
makes them worth calling was not.

### What follows

- **The ordering in `init` is load-bearing and commented as such.** The
  `config.colorScale` branch sits below the normalization write. Moving it back
  up reintroduces the defect silently — nothing throws, a threshold is just
  different. `test/testRestoreNormalization.js` pins which normalization the seed
  lands under; `test/testImageTileSource.js` pins that a matching seed suppresses
  the automatic threshold and a mismatched one does not.
- **The threshold is still per-normalization.** Nothing here says it should be.
  A host's "open at this contrast" is arguably not a statement about
  normalization at all, and keying it that way is what made the ordering matter
  in the first place. #575 fixed the ordering rather than the keying, deliberately
  — decoupling the seed from `colorScaleKey` touches the render path's cache
  protocol and belongs on its own card, argued on its own merits.
- **The comparison modes are excluded, and were already.** `#ensureColorScale`
  returns early for `AOB`, `BOA` and `AMB`: a signed scale's threshold is
  user-driven and never derived from the data, so there is no automatic value for
  a host directive to be overwritten by. CONTEXT.md's *Color scale* entry states
  this distinction.
