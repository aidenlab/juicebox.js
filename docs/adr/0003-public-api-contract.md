# ADR-0003 — What juicebox.js's public API actually is

**Status:** Superseded in part by `js/publicApi.js` (see *Reversal*)
**Last measured:** 2026-08-06, against `juicebox.js` HEAD, `juicebox-web` `7538049`, `spacewalk` `2776a3a` (both consumers pinned to `v3.6.2`)
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
