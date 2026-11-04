# Resizing in collaborative rooms

Notes from a design discussion, November 2026. They follow on from
[`pixel-size-and-resizing.html`](pixel-size-and-resizing.html), which explains
bin size, pixel size, the locus as a projection, and what fires when the view
changes. Read that first. This document records why that one was written and
where the discussion had got to. It is a starting point for a strategy, not the
strategy itself.

## The motivation

juicebox-mcp (`~/JuiceboxDevelopment/juicebox-mcp`) introduces the **room**: a
room id and a join URL that participants share. The room is live. When one
participant zooms, pans or loads a map, the others see the result.

Claude and ChatGPT both show the Juicebox page in a side panel. The map is a
fixed size, so when a participant narrows the panel, part of the map is hidden.
Making the map resizable is the obvious fix, and it leads straight into bin size
and pixel size. Holding a locus at a new size changes the pixel size, and may
change the bin size too.

The question: **what is the correct way to resize when every collaborator should
be looking at the same thing?** The working assumption was that the room should
always hold the locus for everyone, whatever the bin-to-pixel relationship works
out to on each screen.

## The short answer

Yes, the room should share the **locus**. `pixelSize` belongs to one
participant's screen, like their font size, and should not be shared state. What
the collaborators agree on is the genomic rectangle. Each page works out its own
zoom and pixel size from its own width, which is what `goto`
(`State.updateWithLoci`) already does.

Three findings refine that.

## Finding 1: the room does not share the locus today

The remote relays `browser.getSyncState()` and applies it on the far side with
`browser.syncState()`:

- sender: `packages/remote/src/observe.js` `sendLocus` (about line 244), driven
  by `onLocusChange` (line 76). Drags are throttled; other changes are debounced.
- receiver: `observe.js` line 168, `browser.syncState(syncState)`.

`getSyncState` carries the chromosome names, `binSize`, `binX`, `binY` and
`pixelSize` (`js/hicState.js:488`). `State.sync` (`js/hicState.js:499`) keeps the
publisher's **top-left corner and base pairs per pixel**, not its extent. That is
policy A in the HTML document: a larger receiver sees more genome.

It only looks like "everyone sees the same thing" because every page is the same
fixed size. Once any participant's viewport is a different size, the room
diverges, with or without a resize feature.

Late joiners have the same problem. The stored session is `HICBrowser.toJSON()`,
which saves the state (and so `pixelSize`) and no width or height.

**So the real change is to what the room sends, not to resizing.**

## Finding 2: same locus does not mean the same picture

The rung is chosen against the viewport width:

| Viewport | 8 Mb at | Bin size | pixelSize | Bins across |
|---|---|---|---|---|
| 640 px | 12,500 bp/px | 25 kb | 2 | 320 |
| 1024 px | 7,812.5 bp/px | 10 kb | 1.28 | 800 |

The region is the same but the data is not. That matters because the room also
relays the **colour scale** (`COLOR_SCALE_CHANGE`). Counts per bin grow roughly
with bin area, so a 25 kb bin holds about 6× the contacts of a 10 kb bin. A shared
threshold therefore draws the 10 kb participant's map much paler.

If "the same thing" means the same picture, share the **bin size** along with the
locus. Each page then sets `pixelSize = its width ÷ the number of bins`: the same
bins, the same counts, the same colours, at a different scale. This is the "C,
locked" column of the HTML document.

## Finding 3: the smallest screen sets the limit

A bin cannot be narrower than a pixel: `_adjustPixelSize` floors `pixelSize` at 1.
If the publisher is on 10 kb bins across 800 bins and a narrowed side panel is
480 px wide, that panel cannot hold 800 bins. If it kept 10 kb it would show
4.8 Mb, not 8. It has to fall back to the 25 kb bins (320 bins at 1.5 px).

The rule that follows:

1. **The same locus, always.**
2. **The same bin size whenever it fits.**
3. **A coarser bin size, locally, when it does not.**

The same region is always achievable. Identical bins on every screen are not.

## Proposed shape

- **Resizing is local and silent.** When a participant's panel changes size, the
  page re-fits the room's locus to its new viewport once the drag ends, and does
  not broadcast. Their region has not changed, only their pixels. Without this,
  one participant narrowing a sidebar would re-zoom everyone else.
- **The room message carries the locus and the bin size**, from
  `state.getLocus(dataset, viewDimensions)`. The receiver applies it with `goto`
  against its own width, with the fallback in finding 3, instead of `syncState`.
- **The viewport stays square.** A non-square viewport is not supported
  (`CONTEXT.md`), so size it to the smaller of the panel's width and height.
- **The stored session carries the locus too.** juicebox.js sessions can already
  carry a config `locus`, so a late joiner fits the region to their own screen.
- **The whole-genome and whole-chromosome views are a special case.** Send "show
  all of chr1" rather than base pairs: `minZoom` and `minPixelSize` depend on the
  viewport, and `State.sync` already special-cases `All` (#716).

### Where the work lands

- **juicebox.js:** a public resize method. It writes the viewport size
  (`setViewportSize`, `js/layoutController.js:384`), re-lays out
  (`updateLayout()`), re-fits the locus without telling the host that the user
  moved, and keeps the viewport square. It also needs a locus-based way for a host
  to apply a peer's view. The in-page `syncState` should keep its scale semantics,
  because sync groups inside one page rely on it.
- **juicebox-remote (juicebox-mcp):** the `LOCUS_CHANGE` payload changes. This is
  the compatibility contract between pages in a room, so it wants an ADR and a
  plan for pages on the old and new formats in the same room.

## Open questions for the next session

1. **What does "the same thing" mean to a user?** The same region, or the same
   bins and colours? This decides whether bin size is shared at all.
2. **Who chooses the bin size?** The publisher, with each receiver coarsening
   locally (finding 3)? Or the room, from the smallest participant? The room does
   not know the participants' sizes today.
3. **How does the page learn it was resized?** The page fills the host's panel,
   so a `ResizeObserver` on the container is the likely signal. Should juicebox.js
   own that observer, or should the host (juicebox-view) call a resize method?
4. **What happens around the square?** Letterbox the spare space, or let the
   panel's shape drive something else?
5. **Echo and drift.** A locus round trip passes through rounding
   (`getLocus` rounds to bp) and the clamp at chromosome ends. Does a re-fit on
   one page ever come back as a change to another? The remote's `guarded` flag
   suppresses echoes of applied changes; a local re-fit has to be suppressed too.
6. **Mixed versions in one room.** How do old and new pages coexist while the
   payload changes?
7. **A locus requested by Claude.** `goto_locus` from the MCP already sends a
   locus. Under this model it becomes the room's locus directly, and each page fits
   it to its own size. Does anything in the tool contract promise more than that?
8. **The resolution lock.** If one participant locks the resolution, is that lock
   a room-wide preference, as it is across an in-page sync group (ADR-0014)?

## References

- [`pixel-size-and-resizing.html`](pixel-size-and-resizing.html): the companion
  document. Figures 4 and 5, and the "What fires" section, matter most here.
- `docs/state-manipulation.md`: the chokepoint and its translators.
- juicebox-mcp `docs/how-juicebox-mcp-works.html` and `GLOSSARY.md`: rooms, join
  links and peers.
- juicebox-mcp `packages/remote/src/observe.js`: what the room sends and applies.
