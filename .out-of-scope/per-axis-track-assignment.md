# Per-Axis Track Assignment

juicebox.js does not offer a control for running a given 1D track along only the
X axis or only the Y axis. Every 1D track is drawn along both.

## Why this is out of scope

A Hi-C contact map is a symmetric 2D view, and juicebox's whole 1D-track model is
built on that symmetry. `TrackPair` (`js/trackPair.js`) is the unit of track
state: one loaded track, two renderers, one `x` and one `y`, constructed together
and torn down together.

```js
class TrackPair {
    constructor(browser, track) {
        this.browser = browser
        this.track = track
        this.x = undefined
        this.y = undefined
    }
```

Everything downstream inherits that pairing — the gear menu, the color picker,
the data-range dialog, reordering, and the session format all address the pair,
not a side. Making a track single-axis is therefore not a rendering flag; it
means splitting `TrackPair` into an axis-optional container and revisiting every
call site that assumes both halves exist.

The original request named the blocker itself and never resolved it: it is not
clear where the track label goes when a track is Y-only, and the row/column
layout has no place to put one. Eight years produced no answer and no second
request, which is the strongest available evidence that the symmetric model is
the right one for this component.

Downstream consumers that need an asymmetric arrangement are better served by
igv.js directly, which is linear by design.

## Prior requests

- #95 — "Have any given track run either along X or along Y" (filed as an
  explicit "dream feature, not core"; later narrowed to X-only, then dormant)
