# Normalization Vector As A 1D Track

juicebox.js does not render a normalization vector as a 1D track alongside the
contact map, the way Desktop Juicebox does.

## Why this is out of scope

Normalization in juicebox.js is a property of the *matrix*, not a signal to plot.
The whole normalization path exists to answer one question — which normalization
should the tiles be drawn with — and it ends at the color scale:

```js
// DataLoader.loadNormalizationFile
const normVectors = await this.browser.dataset.hicFile.readNormalizationVectorFile(
    url, this.browser.dataset.chromosomes
);
for (let type of normVectors['types']) {
    // ...register the type as a selectable normalization
    this.browser.coordinator.onNormVectorIndexLoad(this.browser.dataset);
}
```

The vectors are read, their *types* are registered as options in the
normalization selector, and the values themselves are consumed inside straw when
tiles are built. Nothing downstream models a normalization vector as a track.

Making one a track means the opposite framing: a per-bin signal with its own
data range, autoscale behaviour, color, gear menu, session serialization, and a
`TrackPair` on both axes — all the machinery 1D tracks carry, wrapped around a
value that is currently an implementation detail of rendering. That is a new
track type, not a display toggle.

It is also a **parity** request rather than a need. Desktop Juicebox is a
full application, and its feature surface is not the target for this component;
juicebox.js is embedded in hosts that supply their own track UI, and a host that
genuinely wants the vector plotted can fetch it and hand it in as an ordinary
1D track config. That path already works and requires nothing from this library.

## Prior requests

- #284 — "Feature request: normalization vector" (requesting Desktop Juicebox's
  load-normalization-vector-as-track behaviour)
