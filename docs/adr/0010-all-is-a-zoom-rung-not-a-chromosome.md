# ADR-0010 — For a single-chromosome assembly, `All` is a zoom rung, not a chromosome

**Status:** Accepted
**Date:** 2026-08-24
**Related:** #236 (the request), #398 (the single-scaffold scale report this
neighbours), ADR-0006 (session wire format — `zoom` is a wire value),
ADR-0009 (restore coerces, never rejects), `CONTEXT.md` "Whole-genome view" /
"Sentinel zoom"

## Context

A `.hic` file whose assembly has one chromosome still declares an `All`
pseudo-chromosome, and juicebox offers it in the chromosome pulldown alongside
the sole scaffold. The two describe the same view. #236 asked, in 2018, for the
duplicate to be removed and for the whole-genome resolution to be added to the
ordinary resolution list.

Five facts, read out of the checkout on 2026-08-24:

**1. Nothing filters `All` from the pulldown.**
`ChromosomeSelector.respondToDataLoadWithDataset` (`js/chromosomeSelector.js:69`)
maps every entry of `dataset.chromosomes`, index 0 included.

**2. `All` is reachable by three paths besides the pulldown.** Zooming out past
`minZoom` forces `parseLocusString('All')` (`js/interactionHandler.js:310`); the
locus box renders and accepts the literal `'All'` (`js/hicLocusGoto.js:67`); and
a saved session or pasted URL can carry `chr1: 0` directly. Filtering the
pulldown alone would leave a view the menu says does not exist.

**3. The second half of the request cannot be satisfied by adding a number to a
list.** `minZoom` (`hicBrowser.js:1371`) delegates to
`matrix.findZoomForResolution`, which floors at index 0 — the coarsest
*declared* resolution — and `setChromosomesView` then clamps `pixelSize` up to
`DEFAULT_PIXEL_SIZE`. On a 2.4 Gbp scaffold the coarsest declared bin (typically
2.5 mb) still needs ~3.4 mb/px to fit a 700px viewport, so the whole scaffold
cannot be framed at all. The only coarser data in the file is the `All` matrix
at `wholeGenomeResolution`. `All` therefore has to survive as data even as it
disappears from the vocabulary.

**4. The transform is a unit match with no offset.** `wholeGenomeResolution` is
`chr.size * (1000/500)` where the `All` chromosome's `size` is in kb
(`hic-straw/src/hicFile.js:141`), so the value is in bp. For a one-chromosome
genome the cumulative offset is zero, so `All` bin *b* covers exactly bp
`[b·res, (b+1)·res)` of the sole scaffold. jrobinso's 2018 warning on #236 —
that `All` coordinates are kb-from-genome-start and lose chromosome identity —
is the general case; here it degenerates to nothing.

**5. `zoom` is a persisted wire value.** `State.toJSON` (`js/hicState.js:532`)
writes it raw into every saved session and shared URL, and twenty sites index
`bpResolutions[state.zoom]` — already disagreeing on shape, `hicState.js:217`
reading a raw number and `:230` reading `{binSize}`.

## Decision

For a dataset where `chromosomes.length === 2` — the `All` entry plus one real
chromosome, identified by `wholeGenomeChromosome` identity rather than by the
name test `genome.js:49` and `ruler.js:93` use — `All` stops being a chromosome
the user can pick and becomes the sole scaffold's coarsest zoom rung.

**1. The synthetic rung carries a sentinel zoom index, not a shifted real one.**
A named constant `-1`. Prepending a real entry at index 0 would shift every
declared index by one and silently corrupt every session ever saved; appending
one at the end would keep indices stable but put the coarsest rung at the fine
end of the array, where `interactionHandler`'s `resolutions[0]` and
`resolutions[length-1]` direction guards read the wrong ends. The sentinel
cannot collide with any persisted `zoom`, and it is honest that the rung is
synthesised rather than declared. The list is sorted explicitly by descending
`binSize` rather than relying on array position, which fixes the direction
guards as a side effect.

**2. `browser.binSizeForZoom()` is introduced, and only the sites the sentinel
path touches are converted.** Ruler, `State`'s locus and bin math, the tile
source. The other ~15 `bpResolutions[state.zoom]` sites keep their direct
indexing. Converting all twenty is #398's refactor wearing this ticket's name,
and it would land the raw-number-vs-`{binSize}` shape confusion in the same
diff. The accessor is left as the landing pad so #398 inherits a started job
rather than a surprise.

**3. The tile source keeps `isWholeGenome` true at the sentinel.** It derives
that from `0 === zd.chr1.index` (`js/imageTileSource.js:269`), and the sentinel
is served from the `All` matrix, so it stays true — which keeps the ×4
auto-threshold (`imageTileCore.js:204`). The threshold follows the *data*, and
at this rung the bins genuinely are whole-genome bins.

**4. `browser.isWholeGenome()` stays false at the sentinel.** It reads
`dataset.isWholeGenome(state.chr1)`, and `state.chr1` is the scaffold. The
resolution label stays "Resolution (kb)", the ruler draws scaffold coordinates,
and the locus box shows a real range. The vocabulary follows the *state*.

Decisions 3 and 4 make the two whole-genome tests #398 flagged as possibly
divergent — `dataset.isWholeGenome(chrIndex)` and `0 === zd.chr1.index` —
divergent **by design**. This is the invariant most likely to be "fixed" by
someone who has not read this file.

**5. Every `All` entry point resolves to the sole chromosome, at the state
layer.** Pulldown, locus-goto, session and URL all funnel through the same
redirect, silently, with no warning: by the premise of the ticket there is no
user-visible difference between the two views. Following ADR-0009, restore
coerces rather than rejects, so an eight-year-old session naming `chr 0` opens.

**6. The sentinel never crosses the process boundary.** Saving while on it
writes `chr1: 0, chr2: 0, zoom: 0` — the whole-genome view. For this genome that
is pixel-for-pixel the view the user was looking at, every existing consumer
already renders it, and our own restore redirects it back to the sentinel by
decision 5. `All` therefore survives exactly where it is still useful — as data
and as wire format — and disappears exactly where it was redundant.

## Consequences

- No coordination with juicebox-web or Spacewalk. Old sessions, new sessions and
  other consumers all keep working; this is a self-contained change rather than
  a three-repo release.
- Normalization needs no new rule. `#effectiveNormalization`
  (`js/imageTileSource.js:209`) already falls back to `NONE` per-resolution
  without writing state, and at the sentinel it makes the identical query the
  `All` view makes today.
- A B map cannot drop the rung. Genomes must match (`dataLoader.js:356`), so
  both datasets compute the same `wholeGenomeResolution`; the sentinel is
  appended after `getResolutions()`' intersection rather than passed through it.
- `zoomAndCenter`'s "jump from whole genome to chromosome" branch
  (`interactionHandler.js:345`) becomes unreachable for these datasets, since
  `state.chr1` is never 0. It is left in place for normal genomes.

## Considered and rejected

- **Filtering the pulldown only.** Leaves `All` reachable by three other paths.
- **Broadening the predicate** to "`All` and the sole chromosome describe the
  same view", which would also catch assemblies dominated by one scaffold.
  "Dominates" needs a threshold, and at 95%-one-scaffold the `All` view still
  shows the other 5% — it is not the same view. That is a different feature.
- **Keeping `All` and dropping the real chromosome.** Would make the sole view
  the one whose scale derivation #398 puts in doubt.
- **Doing part (2) only**, accepting that a large single scaffold cannot be
  framed whole. That is the status quo #398 is complaining about.
- **Publishing `zoom: -1`** and requiring consumers to update.
