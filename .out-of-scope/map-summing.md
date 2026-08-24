# Summing Contact Maps

juicebox.js does not sum two or more contact maps into a combined map, and will
not grow the feature. Desktop Juicebox has it; this component does not.

## Why this is out of scope

juicebox.js does have a two-map story, but it is a **display-time** one. When a
control map is loaded, the second map participates through the color scale —
`ratioColorScale.js`, `diffColorScale.js` and the A/B display modes in
`ContactMatrixView` — comparing the two maps' already-rendered values per bin at
paint time. Nothing in the pipeline combines contact records before they become
pixels.

Summing is the other kind of operation. Two maps can only be added meaningfully
at the level of raw observed counts, which means reconciling resolutions, bin
boundaries, genome builds and normalization between the files, then producing a
new matrix that has its own norm vectors and its own expected-value curves. That
is a data-processing job, and it belongs where the other data-processing jobs
live — Juicer Tools, which already produces combined `.hic` files.

The resulting combined file then loads here like any other map, which is the
division this component is built around: juicebox.js visualizes `.hic` files,
it does not manufacture them.

## Prior requests

- #299 — "warn: js doesn't support summing"
