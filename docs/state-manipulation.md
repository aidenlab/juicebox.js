# State Manipulation in juicebox.js

This document catalogs every way the browser's `State` can be mutated. It exists because juicebox.js is, structurally, a state-manipulation machine plus a projection layer — almost every UI element is a different way to express "change canonical state." Knowing the full surface is essential before adding features or debugging unexpected view changes.

## Mental model

`State` (in `js/hicState.js`) holds **seven canonical fields** that fully and unambiguously specify the view:

| Field | Meaning |
|---|---|
| `chr1` | Chromosome index, x axis — always `≤ chr2` (see *axis ordering* below) |
| `chr2` | Chromosome index, y axis |
| `x` | Bin position, x axis |
| `y` | Bin position, y axis |
| `zoom` | Resolution index (into `dataset.bpResolutions`), or the **sentinel** `-1` — see below |
| `pixelSize` | Pixels per bin (display scaling) |
| `normalization` | Normalization vector ID (`'NONE'`, `'KR'`, etc.) |

These are the **source of truth.** Everything else the user sees — the BP locus shown in the goto box, the visible region's start/end, the URL/session payload — is a *projection* of these seven fields, derived on read.

Notably, **`locus`** (chromosome BP coordinates `{x: {chr, start, end}, y: {chr, start, end}}`) is **not stored**. It is computed on demand via `state.getLocus(dataset, viewDimensions)`. A pre-2026-05 version of the codebase stored `locus` as a redundant field on `State`; that was removed in issue #411 because it produced two sources of truth (the stored value sometimes diverged from what the canonical fields would derive).

## The chokepoint: `state.setView`

All state mutations flow through one method:

```
async state.setView(chr1, chr2, x, y, zoom, pixelSize,
                    browser, dataset, viewDimensions, options)
  → { chrChanged, resolutionChanged }
```

`setView` is the only place that:

- Enforces **axis ordering** — `chr1 ≤ chr2`, transposing `chr1↔chr2` and `x↔y` together
  when handed an unordered pair. See below.
- Detects whether `chr1`/`chr2` or `zoom` changed (against pre-mutation state, and
  against the *ordered* pair — a transposed re-set reports no change).
- Adjusts `pixelSize` through the standard floor-and-cap pipeline (`Math.max(1, x)` → floor by `minPixelSize` → `Math.min(MAX_PIXEL_SIZE, x)`).
- Mutates the canonical fields in a fixed order.
- Optionally clamps `x`/`y` to chromosome bounds.
- Redirects `All` to the sole scaffold on a **single-chromosome assembly**, landing
  the view on the sentinel zoom rung. See below.

### The sentinel zoom rung

On a dataset whose chromosome table is the `All` entry plus exactly one real
chromosome, `All` is not a chromosome the view can be at. `setView` rewrites such
a view to `{chr1: sole, chr2: sole, zoom: -1}` — `-1` being the **sentinel**, a
rung juicebox synthesises from the whole-genome matrix rather than reading off
the file's resolution ladder. `x`, `y` and `pixelSize` carry over untouched,
because the whole-genome bin and the sentinel bin are the same bin.

Two consequences worth knowing before touching this code:

- **`zoom` is not always an index into `bpResolutions`.** Read bin sizes through
  `dataset.binSizeForZoom(zoom)` or `browser.binSizeForZoom(zoom)`, and resolve
  matrix coordinates through `dataset.matrixViewForZoom(chr1, chr2, zoom)`.
- **The sentinel never crosses the process boundary.** `State.toJSON` writes it
  out as `{chr1: 0, chr2: 0, zoom: 0}`, the whole-genome view — which is the same
  picture for this assembly, and is redirected back on the way in.

ADR-0010 has the full reasoning, including why the two whole-genome tests
(`dataset.isWholeGenome(chrIndex)` and `0 === zd.chr1.index`) are divergent by
design at this rung.

### `setView` options

| Option | Default | Purpose |
|---|---|---|
| `useDefaultMin` | `false` | Apply `DEFAULT_PIXEL_SIZE` (= 1) as the floor instead of comparing against the incoming `pixelSize`. **Only `setWithZoom` sets this true** — it's what produces the visible "snap" when the resolution selector changes zoom, and is preserved as resolution-selector-only behavior. |
| `minPixelSize` | `undefined` | Caller-provided override; bypasses `browser.minPixelSize` lookup. Used by translators that have already computed it. |
| `clampXY` | `true` | Whether to clamp `x`/`y` to chromosome bounds after mutation. `updateWithLoci` sets this `false` (it has historically not clamped). |
| `adjustPixelSize` | `true` | Whether to run `pixelSize` through `_adjustPixelSize`. Pan paths set this `false`: panning never alters pixelSize, including by implicit floor. Translators that have already computed the final `pixelSize` themselves also set this `false`. |

### Invariants

> **1. No code outside `js/hicState.js` should mutate state fields directly.**

Every external caller goes through a translator (below), which itself goes through `setView`. This invariant is what makes locus-related bugs tractable to debug — there is exactly one place to look when state diverges from intent.

> **2. `chr1 ≤ chr2` — axis ordering.**

A `.hic` file stores one triangle of a symmetric matrix, so an x-axis of chr5 against a y-axis of chr2 is the same view as its transpose, not a second one. `setView` receives both chromosomes and both origins together and so transposes all four atomically; translators pass their pair through unordered and inherit the invariant. The `State` constructor transposes too, as belt-and-braces for states arriving from outside the chokepoint (a decoded session, a pasted URL).

Where a translator's own arithmetic depends on which chromosome sits on which axis — `updateWithLoci`'s zoom fit, `setChromosomesView`'s `minZoom`/`minPixelSize` lookups, both of which weigh one axis against the view width and the other against its height — it orders locally *for that computation only*, and still hands `setView` the caller's pair. See ADR-0006 decision 3 and #499.

## Translators on `State`

The translators are thin wrappers (typically ~10–20 lines each) that convert domain-specific inputs into canonical args and delegate to `setView`. They live as methods on `State`:

| Method | Translates… | Used by |
|---|---|---|
| `updateWithLoci(chr1Name, bpX, bpXMax, chr2Name, bpY, bpYMax, browser, width, height)` | BP loci → bin positions, target zoom from `bpPerPixelTarget` | Locus goto, gene search, programmatic `browser.goto()`, sweep zoom |
| `panShift(dx, dy, browser, dataset, viewDimensions)` | Screen pixel deltas → bin position deltas | Drag pan |
| `panWithZoom(zoom, pixelSize, anchorPx, anchorPy, binSize, browser, dataset, viewDimensions)` | Anchor pixel + new zoom/pixelSize → anchor-preserving bin position | Wheel zoom, pinch zoom |
| `setWithZoom(zoom, viewDimensions, browser, dataset)` | Target zoom only → view-center-preserving bin position; applies `useDefaultMin: true` | Resolution selector, zoom-step from `zoomAndCenter` |
| `sync(targetState, browser, genome, dataset)` | Peer-browser state (different binSize/dataset) → bin-converted local state | Cross-browser sync |
| `zoomBy(direction, centerPX, centerPY, browser, dataset, viewDimensions)` | Zoom direction at click point under resolution lock or zoom boundary → atomic recenter + pixelSize doubling/halving | Double-click and wheel zoom when locked or at boundary |
| `recenterByPixel(centerPX, centerPY, browser, dataset, viewDimensions)` | Click pixel → new view center (no zoom change) | The "free" branch of `zoomAndCenter`, before stepping zoom |
| `setChromosomesView(chr1Index, chr2Index, wholeChr, browser, dataset, viewDimensions)` | Two chromosome indices + wholeChr flag → reset view at minZoom (wholeChr) or zoom 0 (whole genome) | Chromosome selector, "go to All" parsing, double-click out from whole genome |

These are the **only** mutation paths. Everything below funnels into one of them.

## Entry points by user action

What the user does, what triggers, what mutates.

### Navigation bar — locus goto box

Component: `js/hicLocusGoto.js`

| User action | Path |
|---|---|
| Type a locus and press Enter | `LocusGoto.change` event → `browser.parseGotoInput(string)` → parses to `{chr, start, end}` pairs → `interactionHandler.goto(...)` → `state.updateWithLoci(...)` |
| Type `"All"` | `parseGotoInput` recognizes whole-genome → `interactionHandler.setChromosomes({wholeChr: true}, ...)` → `state.setChromosomesView(..., wholeChr=true)` |

### Navigation bar — chromosome selector

Component: `js/chromosomeSelector.js`

| User action | Path |
|---|---|
| Pick a chromosome from the dropdown | `chromosomeSelector` change handler → `browser.setChromosomes(xLocus, yLocus)` (with `wholeChr: true`) → `state.setChromosomesView(..., wholeChr=true)` |

### Navigation bar — resolution selector

Component: `js/hicResolutionSelector.js`

| User action | Path |
|---|---|
| Pick a resolution | `resolutionSelector.change` → `browser.setZoom(zoom)` → `interactionHandler.setZoom` → `state.setWithZoom(...)`. **This is the one path that snaps `pixelSize` to `DEFAULT_PIXEL_SIZE`** if it would otherwise be lower (via `useDefaultMin: true`). |

### Navigation bar — gene search

| User action | Path |
|---|---|
| Type a gene symbol, press Enter | `LocusGoto.change` → `parseGotoInput` falls through to `browser.lookupFeatureOrGene(...)` → `parseLocusString` → `goto(...)` → `state.updateWithLoci(...)` |

### Contact map area — drag

Component: `js/contactMatrixView.js`

| User action | Path |
|---|---|
| Mouse drag (or touch drag) | Pointer move handler → `browser.shiftPixels(dx, dy)` → `interactionHandler.shiftPixels` → `state.panShift(...)` |

### Contact map area — wheel scroll

| User action | Path |
|---|---|
| Wheel scroll (zoom-by-step, free) | Wheel handler → `browser.zoomAndCenter(direction, x, y)` → if not locked and not at boundary: `state.recenterByPixel(...)` then `state.setWithZoom(newZoomIndex)` |
| Wheel scroll (zoom-by-step, locked or at boundary) | Wheel handler → `browser.zoomAndCenter(direction, x, y)` → `state.zoomBy(direction, x, y, ...)` |

### Contact map area — double-click

| User action | Path |
|---|---|
| Double-click anywhere | Click handler → `browser.zoomAndCenter(1, x, y)` → same branching as wheel scroll |
| Double-click while at whole-genome view | Click handler → `interactionHandler.zoomAndCenter` whole-genome branch → `setChromosomes(...)` with `wholeChr: true` → `state.setChromosomesView(..., wholeChr=true)` |

### Contact map area — pinch (touch)

| User action | Path |
|---|---|
| Pinch zoom (touch) | Touch handler → `browser.pinchZoom(anchorX, anchorY, scale)` → `interactionHandler.pinchZoom`: computes new zoom and pixelSize, then either `state.panWithZoom(...)` (normal) or `interactionHandler.setChromosomes('1', '1')` (zooming below the lowest resolution) |

### Sweep zoom (rubber-band rectangle)

Component: `js/sweepZoom.js`

| User action | Path |
|---|---|
| Drag a rectangle (modifier key) | Sweep handler → computes BP bounds of selection → `browser.goto(chr1, bpX, bpXMax, chr2, bpY, bpYMax)` → `state.updateWithLoci(...)` |

### Ruler — clickable annotations

Component: `js/ruler.js`

| User action | Path |
|---|---|
| Click on a chromosome label in the ruler | `browser.parseGotoInput(label)` → `goto(...)` → `state.updateWithLoci(...)` |

### Cross-browser sync

When two or more browsers are linked (multi-panel mode):

| User action in browser A | Effect on browser B |
|---|---|
| Any state mutation (any of the above) | `browser.coordinator.onLocusChange` fires → linked browsers receive the event → `browser.syncState(syncState)` → `state.sync(...)` |

The receiving browser's mutation path is `state.sync`, regardless of what the source action was.

## Programmatic entry points (public browser API)

These are the API surfaces a host app or embedder calls directly. Each terminates in a translator.

| Browser API | Translator |
|---|---|
| `browser.goto(chr1, bpX, bpXMax, chr2, bpY, bpYMax)` | `state.updateWithLoci` |
| `browser.parseGotoInput(string)` | Parses, then dispatches to `goto` or `setChromosomes` depending on input |
| `browser.parseLocusString(string)` | Pure parsing helper — does **not** mutate. Returns `{chr, start, end}` for the caller to feed into another method. |
| `browser.setChromosomes(xLocus, yLocus)` | `state.setChromosomesView` |
| `browser.setZoom(zoom)` | `state.setWithZoom` |
| `browser.shiftPixels(dx, dy)` | `state.panShift` |
| `browser.pinchZoom(anchorX, anchorY, scaleFactor)` | `state.panWithZoom` (or `setChromosomes` at the lower bound) |
| `browser.zoomAndCenter(direction, x, y)` | `state.zoomBy` or `state.recenterByPixel` + `setWithZoom`, depending on lock/boundary |
| `browser.syncState(targetState)` | `state.sync` |

There is one more entry point, restore, which replaces the whole `State` object rather than mutating fields (see next section). It is a translator too.

## Restore (session and URL restoration)

Restore replaces the entire `State` object rather than mutating it field-by-field, and it is **a translator like every other one**: it clones the incoming state and hands the canonical six to `setView`. Used at startup and during session restore.

| Entry point | Path |
|---|---|
| `browser.setState(state)` | The chokepoint's one caller-facing name. It clones the incoming state, hands the canonical six to `setView` — so a restored state gets the same `MAX_PIXEL_SIZE` cap and x/y clamp as every gesture path — settles `normalization` against the loaded dataset, installs the clone, and publishes the locus change. |
| Loading a session JSON | `dataLoader` → `State.fromJSON(json)` → `browser.setState(state)`. Old payloads with a `locus` field are read-and-ignored (backward compatibility). |
| Loading via URL with `?session=...` | Same as above; URL → JSON → `fromJSON` → `setState`. |
| Loading via URL with a config-level `locus` string | After the dataset loads, `dataLoader` calls `browser.parseGotoInput(config.locus)` — i.e. a per-field translator rather than a whole-state replacement. |
| Loading via URL with a `state` token (legacy compact form) | `State.parse(string)` → `browser.setState(state)`. |

Restore used to be a deliberate exception to the chokepoint discipline, on the reasoning that at startup or restore the new state is the *only* state that exists, so there is nothing to "translate" relative to. [ADR-0009](adr/0009-restore-is-a-translator.md) retired that reasoning: an invariant with an exception has no enforcer, and `clampXY` was reachable from `updateLayout()` as well, which runs only when tracks change — so a restored session carrying a track was clamped and a bare map restore was not. The same saved session opened two ways.

**A restored state is clamped silently, never rejected** (ADR-0009 decision 2) — the same "coerce, never reject" rule the normalize stage one seam over follows. A saved view at `pixelSize=1e9`, or with an origin past the end of its chromosome, opens somewhere different rather than failing to open. The same rule settles `normalization`, which is the seventh field and not one of the canonical six: it is validated against the loaded dataset, which is the first moment the set of valid answers exists, and coerced to `NONE` rather than refused (#561).

Two consequences worth stating, because they are what "a translator like every other one" buys:

- **`chrChanged` and `resolutionChanged` are computed against the state going out of force**, the same comparison every gesture path makes. Restore used to report `resolutionChanged: true` unconditionally, which released the resolution lock on every restore (#560).
- **The state that lands is a clone.** The object a caller hands to `setState` is left alone, and stops being the state in force the moment it is accepted.

The replacement is followed by a render and the application continues normally — subsequent mutations go through translators as usual.

**The state field has exactly one writer.** `browser.state` and its `activeState` alias are getters over a private field; the setters that used to stand beside them are gone (#563, ADR-0009 decision 7). Reading canonical state is unrestricted, here as everywhere; *replacing* it is `setState`.

That is the field, not the object. The getter hands back the live `State`, so a `browser.state.<field> = x` from outside is still reachable — and for `normalization`, two production sites do it (see the next section). For the canonical six, the discipline that stops it is the same one it always was: they are written through translators, by convention, and `setView` is where the invariants are enforced.

## What is NOT a state mutation

For completeness, these UI elements affect display but do **not** change `State`:

- **Color scale widget** — adjusts contact-matrix pixel intensity mapping. Lives on `ColorScale` instances on the dataset/control dataset, not on `State`.
- **Normalization widget** — *does* set `state.normalization`, which is canonical. But the visualization side (re-rendering with a different vector) is a side effect; the state change itself is one field. It is not enumerated above because it is a single-field write rather than a view change: `normalization` is not one of the canonical six, and `setView` does not take it. It is still validated in one place — `HICBrowser.#resolveNormalization`, which restore and `init` both ask (#561) — so the field has an enforcer even though it does not have a translator. When that enforcer's answer differs from the request, the difference is a *substitution* and is announced in the widget rather than in a modal (#372, ADR-0012): a marker on the selector plus the reason in its `title`, transient, held by the widget and by nothing else.
- **2D track menu / annotation widget** — load/unload track data. Tracks are stored on the browser, not on `State`.
- **Control map widget (A/B compare)** — switches the active dataset. Affects `browser.dataset` (and the corresponding control-map view) but not the canonical six fields.
- **Sweep zoom rectangle drawing** — visual only, until the user releases the mouse and triggers `goto`.
- **Pan/zoom inertia animations** — pure rendering effects layered on top of state changes.

## Reading state

Where canonical fields are **read** is unrestricted — `state.chr1`, `state.x`, etc. are fair game from anywhere. The discipline is one-way: canonical state may be read freely; canonical state may be written only through `setView`.

For BP coordinates, always go through `state.getLocus(dataset, viewDimensions)`. Never store the result; recompute on demand. The locus is a function of canonical state plus view dimensions, and view dimensions can change (window resize, layout change) without any state mutation having happened.

## Where to look in code

- `js/hicState.js` — `State` class. Canonical fields, all translators, `setView`, `getLocus`, helpers (`_adjustPixelSize`, `clampXY`).
- `js/interactionHandler.js` — bridges UI events to translators. Should not mutate state fields directly.
- `js/syncGroup.js` — the sync-group rule: which browsers pair (`pairSynchable`) and whether one browser is in the group at all (`isSynchable`). The only reader of `synchable` (#562). `canBeSynched` lived here too until #566 deleted it with the `config.synchState` rung.
- `js/hicBrowser.js` — public API methods, mostly thin delegations to `interactionHandler`; the state itself (a private field), `setState`, and `resolveNormalization`. `js/stateManager.js` used to hold the field and the restore path; #563 folded it away once the behaviour had left it.
- `js/dataLoader.js` — session/URL ingestion path.
- `test/testState.js` — characterization tests for every translator and the chokepoint. The behavioral contract.

## History

The state-manipulation discipline was introduced in [issue #411](https://github.com/aidenlab/juicebox.js/issues/411) (May 2026), which introduced `setView`, made `locus` a derived projection, and migrated all seven legacy mutation paths to translators. Before that refactor, mutations were spread across five State methods (with subtly different validation), two inline-mutation blocks in `interactionHandler`, and a stored-but-also-derived `locus` field that was the structural cause of locus-related bugs.
