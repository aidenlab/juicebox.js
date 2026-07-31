# Context — juicebox.js

The ubiquitous language of this codebase. When naming a module, a test, an issue
or a variable, use the term as defined here rather than a synonym.

juicebox.js is an **embeddable component**, not a standalone app. It renders Hi-C
contact maps and is embedded in host apps such as juicebox-web and Spacewalk. The
dev server and dashboard exist so developers can see the library in action
without a host app.

## Core concepts

**Contact map** — the 2D matrix of interaction frequencies between genomic loci.
The thing the user is looking at. A browser instance shows one primary contact
map and optionally a **control map** for comparison.

**Canonical state** — the seven fields on `State` (`js/hicState.js`) that fully
and unambiguously specify the view: `chr1`, `chr2`, `x`, `y`, `zoom`,
`pixelSize`, `normalization`. Everything else the user sees is derived from
these. See `docs/state-manipulation.md`.

**Projection** — anything derived from canonical state on read rather than
stored. The **locus** is the important one: chromosome BP coordinates computed
via `state.getLocus(dataset, viewDimensions)`, never stored, because view
dimensions can change without any state mutation.

**Chokepoint** — `state.setView`, the single method through which all canonical
state mutations flow. No code outside `js/hicState.js` mutates state fields
directly.

**Translator** — a thin method on `State` converting domain-specific input
(screen pixel deltas, BP loci, a peer browser's state) into canonical arguments
for the chokepoint. `panShift`, `updateWithLoci`, `setWithZoom` and friends.

**Bulk replacement** — the deliberate exception to the chokepoint: session and
URL restore replace the whole `State` object rather than mutating it, because at
restore time there is nothing to translate relative to.

## Rendering

**Image tile** — a square raster of the contact map at a given zoom, row and
column (`imageTileDimension`, currently 685 bins square). Cached, keyed by
chromosome pair, bin size, unit, grid position, normalization and display mode.
Notably *not* keyed by pan position or pixel size — those affect where a tile is
painted, not what it contains.

**Track tile** — an unrelated concept despite the shared word: a buffered span of
1D track features for one axis (`js/tile.js`). Has nothing to do with image
tiles. When either could be meant, say which.

**Display mode** — which map or combination is rendered: `A` (primary), `B`
(control), `AOB` (A over B, ratio), `BOA` (B over A, ratio), `AMB` (A minus B,
difference). The combining modes require matching resolutions on both maps, so
the primary map's zoom index is translated to the control map's equivalent.

**Color scale** — maps a score to a pixel color, with the score's magnitude
carried in alpha against a fixed hue. Single-sided (`ColorScale`) for the modes
that plot counts; *signed* (`SignedColorScale`) for the comparison modes, which
need one color above the neutral point and another below — `RatioColorScale`
for the ratios, where neutral is 1, and `DiffColorScale` for `AMB`, where it is
zero. A single-sided scale's threshold is derived from the data; a signed
scale's is user-driven.

**Zoom data** — a resolution-specific view of a matrix, carrying bin size, unit
and per-map average counts. Obtained from a matrix by zoom index.

**Bin** — the unit of resolution. Canonical `x`/`y` are bin positions, not base
pairs; `pixelSize` is pixels per bin.

**Live contact map** — a streaming map sourced from hic-straw rather than a
static `.hic` file, driven by Spacewalk. Emits ensemble contact *frequencies*
bounded in (0, 1] rather than raw counts, which is why the auto colour-scale
heuristics branch on `isLive`. Static `.hic` visualization remains the primary
focus of this library.

**Track pair** — one 1D track rendered on both axes, as a pair of renderers
sharing a track (`js/trackPair.js`).

## Architecture vocabulary

Refactoring work in this repo uses the deep-module vocabulary: **module**,
**interface**, **implementation**, **depth**, **seam**, **adapter**,
**leverage**, **locality**. Prefer **seam** over "boundary" and **interface**
over "API". A module is **deep** when a lot of behaviour sits behind a small
interface, **shallow** when the interface is nearly as complex as the
implementation.
