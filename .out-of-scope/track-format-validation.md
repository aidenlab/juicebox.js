# Track Format Validation

juicebox.js does not validate track file formats or maintain its own list of
recognized track extensions, and will not raise its own "unknown file type"
error at the track-load door.

## Why this is out of scope

Format inference for 1D tracks is igv.js's responsibility. juicebox.js passes a
track config through to igv.js and lets it decide what the file is; the only
format decisions juicebox makes are the two-dimensional ones it actually owns
(2D/bedpe annotations, and the `sequence` special case for FASTA). Adding a
juicebox-side allowlist would mean maintaining a second, always-drifting copy of
igv.js's format table, and a file igv.js gained support for would start being
rejected here first.

What juicebox does own is *surfacing* failures rather than swallowing them, and
that exists: `DataLoader.loadTracks` wraps the whole load in a handler that
reports to the user rather than logging quietly.

```js
} catch (error) {
    presentError(this.browser.registry, errorPrefix, error);
    console.error(error);
}
```

So the durable position is: igv.js decides what a file is and reports when it
cannot read one; juicebox displays that error. A silently-ignored track is a bug
in that chain, to be fixed where the silence is — not a case for a pre-flight
extension check.

## Prior requests

- #220 — "Loading unknown track file type should present error" (a `.hic` URL
  entered into the Track URL field, failing silently)
