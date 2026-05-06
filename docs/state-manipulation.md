# State Manipulation in juicebox.js

This document catalogs every way the browser's `State` can be mutated. It exists because juicebox.js is, structurally, a state-manipulation machine plus a projection layer — almost every UI element is a different way to express "change canonical state." Knowing the full surface is essential before adding features or debugging unexpected view changes.

## Mental model

`State` (in `js/hicState.js`) holds **seven canonical fields** that fully and unambiguously specify the view:

| Field | Meaning |
|---|---|
| `chr1` | Chromosome index, x axis |
| `chr2` | Chromosome index, y axis |
| `x` | Bin position, x axis |
| `y` | Bin position, y axis |
| `zoom` | Resolution index (into `dataset.bpResolutions`) |
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

- Detects whether `chr1`/`chr2` or `zoom` changed (against pre-mutation state).
- Adjusts `pixelSize` through the standard floor-and-cap pipeline (`Math.max(1, x)` → floor by `minPixelSize` → `Math.min(MAX_PIXEL_SIZE, x)`).
- Mutates the canonical fields in a fixed order.
- Optionally clamps `x`/`y` to chromosome bounds.

### `setView` options

| Option | Default | Purpose |
|---|---|---|
| `useDefaultMin` | `false` | Apply `DEFAULT_PIXEL_SIZE` (= 1) as the floor instead of comparing against the incoming `pixelSize`. **Only `setWithZoom` sets this true** — it's what produces the visible "snap" when the resolution selector changes zoom, and is preserved as resolution-selector-only behavior. |
| `minPixelSize` | `undefined` | Caller-provided override; bypasses `browser.minPixelSize` lookup. Used by translators that have already computed it. |
| `clampXY` | `true` | Whether to clamp `x`/`y` to chromosome bounds after mutation. `updateWithLoci` sets this `false` (it has historically not clamped). |
| `adjustPixelSize` | `true` | Whether to run `pixelSize` through `_adjustPixelSize`. Pan paths set this `false`: panning never alters pixelSize, including by implicit floor. Translators that have already computed the final `pixelSize` themselves also set this `false`. |

### Invariant

> **No code outside `js/hicState.js` should mutate state fields directly.**

Every external caller goes through a translator (below), which itself goes through `setView`. This invariant is what makes locus-related bugs tractable to debug — there is exactly one place to look when state diverges from intent.

## Translators on `State`

The translators are thin wrappers (typically ~10–20 lines each) that convert domain-specific inputs into canonical args and delegate to `setView`. They live as methods on `State`:

| Method | Translates… | Used by |
|---|---|---|
| `updateWithLoci(chr1Name, bpX, bpXMax, chr2Name, bpY, bpYMax, browser, width, height)` | BP loci → bin positions, target zoom from `bpPerPixelTarget` | Locus goto, gene search, programmatic `browser.goto()`, sweep zoom |
| `panShift(dx, dy, browser, dataset, viewDimensions)` | Screen pixel deltas → bin position deltas | Drag pan |
| `panWithZoom(zoom, pixelSize, anchorPx, anchorPy, binSize, browser, dataset, viewDimensions, bpResolutions)` | Anchor pixel + new zoom/pixelSize → anchor-preserving bin position | Wheel zoom, pinch zoom |
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
| Any state mutation (any of the above) | `browser.notifyLocusChange` fires → linked browsers receive the event → `browser.syncState(syncState)` → `state.sync(...)` |

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

There are also two **bulk replacement** APIs that bypass the translator layer (see next section).

## Bulk replacement (session and URL restoration)

These paths replace the entire `State` object rather than mutate it field-by-field. They do not go through `setView`. Used at startup and during session restore.

| Entry point | Path |
|---|---|
| `browser.setState(state)` | `stateManager.setState(state)`: clones the incoming state, applies a `minPixelSize` floor on `pixelSize`. No translator involved. |
| Loading a session JSON | `dataLoader` → `State.fromJSON(json)` → `browser.setState(state)`. Old payloads with a `locus` field are read-and-ignored (backward compatibility). |
| Loading via URL with `?session=...` | Same as above; URL → JSON → `fromJSON` → `setState`. |
| Loading via URL with a config-level `locus` string | After the dataset loads, `dataLoader` calls `browser.parseGotoInput(config.locus)` — i.e. translator path, not bulk replacement. |
| Loading via URL with a `state` token (legacy compact form) | `State.parse(string)` → `browser.setState(state)`. |

Bulk replacement is a deliberate exception to the chokepoint discipline: at startup or restore, the new state is the *only* state that exists, so there's nothing to "translate" relative to. The replacement is followed by a render and the application continues normally — subsequent mutations go through translators as usual.

## What is NOT a state mutation

For completeness, these UI elements affect display but do **not** change `State`:

- **Color scale widget** — adjusts contact-matrix pixel intensity mapping. Lives on `ColorScale` instances on the dataset/control dataset, not on `State`.
- **Normalization widget** — *does* set `state.normalization`, which is canonical. But the visualization side (re-rendering with a different vector) is a side effect; the state change itself is one field. Not enumerated above because it's a single field write currently outside the chokepoint discipline (a known small inconsistency, not yet folded into `setView`).
- **2D track menu / annotation widget** — load/unload track data. Tracks are stored on the browser, not on `State`.
- **Control map widget (A/B compare)** — switches the active dataset. Affects `stateManager.activeDataset` (and the corresponding control-map view) but not the canonical six fields.
- **Sweep zoom rectangle drawing** — visual only, until the user releases the mouse and triggers `goto`.
- **Pan/zoom inertia animations** — pure rendering effects layered on top of state changes.

## Reading state

Where canonical fields are **read** is unrestricted — `state.chr1`, `state.x`, etc. are fair game from anywhere. The discipline is one-way: canonical state may be read freely; canonical state may be written only through `setView`.

For BP coordinates, always go through `state.getLocus(dataset, viewDimensions)`. Never store the result; recompute on demand. The locus is a function of canonical state plus view dimensions, and view dimensions can change (window resize, layout change) without any state mutation having happened.

## Where to look in code

- `js/hicState.js` — `State` class. Canonical fields, all translators, `setView`, `getLocus`, helpers (`_adjustPixelSize`, `clampXY`).
- `js/interactionHandler.js` — bridges UI events to translators. Should not mutate state fields directly.
- `js/stateManager.js` — bulk replacement (`setState`, `setControlState`, `syncState`), state cloning for the active/control split.
- `js/hicBrowser.js` — public API methods. Mostly thin delegations to `interactionHandler` or `stateManager`.
- `js/dataLoader.js` — session/URL ingestion path.
- `test/testState.js` — characterization tests for every translator and the chokepoint. The behavioral contract.

## History

The state-manipulation discipline was introduced in [issue #411](https://github.com/aidenlab/juicebox.js/issues/411) (May 2026), which introduced `setView`, made `locus` a derived projection, and migrated all seven legacy mutation paths to translators. Before that refactor, mutations were spread across five State methods (with subtly different validation), two inline-mutation blocks in `interactionHandler`, and a stored-but-also-derived `locus` field that was the structural cause of locus-related bugs.
