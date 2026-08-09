# The juicebox.js URL wire format

This page is the **specification** for the URLs juicebox.js decodes. It is not a
description of the current implementation that may drift from it: session links
get pasted into mail and papers and must still decode years later, so what is
written here is the contract, and the decoder is expected to match it. Where the
two disagree, that is a bug in one of them and worth a ticket.

Two versions of the query form exist, **v0** and **v1**. Both are accepted;
neither is deprecated. Juicebox **writes neither of them** — the only URL it
emits today is the compressed session link described under
[Session forms](#session-forms). The query form is read-only inbound: links in
the wild, links in papers, and links written by the Java desktop application.

All parameter values must be URL encoded.

> **Maintenance obligation.** This page is the only complete record of the state
> encoding — `State.stringify()`, which used to be the executable copy, was
> deleted in #501 because nothing called it. The partial executable record is
> `State.parse` plus the wire-format tests at the bottom of
> `test/testState.js`. Change one, change all three. See
> [ADR-0006](adr/0006-session-wire-format-and-one-decoder.md) decisions 2 and 5.

## Query parameters

| Parameter | Description |
| --------- | ----------- |
| `hicUrl` | URL of the `.hic` file |
| `name` | display name for the map |
| `controlUrl` | URL of the `.hic` file for the control map |
| `controlName` | display name for the control map |
| `displayMode` | control-map display mode (`A`, `B`, `AOB`, `BOA`, …) |
| `state` | the view — see [state](#state) |
| `colorScale` | colour scale — see [colorScale](#colorscale) |
| `tracks` | the tracks — see [tracks](#tracks) |
| `selectedGene` | gene name to resolve to a locus after load |
| `nvi` | normalization-vector index for `hicUrl`, as `position,size` |
| `controlNvi` | normalization-vector index for `controlUrl` |
| `cycle` | cycle through maps rather than showing them side by side |

The parameter carrying tracks is **`tracks`**, plural. Earlier revisions of this
page said `track`; that was a documentation typo, not a v0 parameter name — no
code path has ever read the singular spelling.

## state

A comma-separated string. Two layouts, told apart by token count: **seven or
fewer tokens is v0, more than seven is v1.**

Chromosome indices are positions in the `.hic` file's chromosome list, where
index 0 is the whole genome, 1 is the first chromosome, 2 the second, and so on.
The resolution index is a position in the file's own resolution list, lowest
resolution first. `x` and `y` are the map origin in **bins**, not base pairs.

### v0 — seven tokens

| token | description |
| ----- | ----------- |
| 1 | index of the x-axis chromosome |
| 2 | index of the y-axis chromosome |
| 3 | index of the resolution level |
| 4 | x position of the map origin, in bins |
| 5 | y position of the map origin, in bins |
| 6 | pixel size — the size of one bin in screen pixels |
| 7 | normalization (optional; absent means `NONE`) |

```
state=3,3,6,5537.98746,5537.749239047619,1,KR
```

### v1 — nine tokens

Identical to v0 through token 5, then **two filler tokens**, then pixel size and
normalization shifted right by two. Eight tokens — v1 with the normalization
omitted — is v1 too: the discriminator is *more than seven*, not *exactly nine*.

| token | description |
| ----- | ----------- |
| 1 | index of the x-axis chromosome |
| 2 | index of the y-axis chromosome |
| 3 | index of the resolution level |
| 4 | x position of the map origin, in bins |
| 5 | y position of the map origin, in bins |
| 6 | filler — see below |
| 7 | filler — see below |
| 8 | pixel size |
| 9 | normalization (optional; absent means `NONE`) |

```
state=3,5,6,100,200,0,0,2,KR
```

**The two filler tokens are the retired view width and height**, in screen
pixels. They were real fields on `State` until March 2025 (`5a933f3`), when the
view dimensions became something the browser measures rather than something the
state carries; the encoder then wrote literal zeroes in their place until it too
was deleted. **The decoder has never read them.** Links harvested from before
2025 carry a genuine viewport size there — `…,100,200,1250,1250,2,KR` — and
decode to exactly the same view as the same link with zeroes. Do not reuse the
positions for anything else.

### Axis ordering

`chr1 ≤ chr2` is an invariant of `State`: a `.hic` file stores one triangle of a
symmetric matrix, so `(chr5, chr2)` and `(chr2, chr5)` name the same view. A
state string naming the axes in the other order decodes to its **transpose** —
the same contacts with the axes flipped about the diagonal — with `x` and `y`
swapped alongside the chromosomes. This is not a rejection and not a repair;
it is the same view arriving under its second spelling. See
[ADR-0006](adr/0006-session-wire-format-and-one-decoder.md) decision 3.

## colorScale

A comma-separated string. The scale runs from 0 (white) to the threshold (the
full colour).

| token | description |
| ----- | ----------- |
| 1 | threshold — the contact value at maximum colour intensity |
| 2 | red component of the maximum colour (0–255) |
| 3 | green component (0–255) |
| 4 | blue component (0–255) |

A bare threshold with no RGB components is accepted and common in harvested
links (`colorScale=18.89619862813927`). It is **not** a request for the default
colour: the missing components decode to `NaN` and the map renders
`rgba(NaN,NaN,NaN,α)`. Filed as #514 — write all four tokens until it is fixed.

A **signed** scale — used for ratio and difference maps, which need one colour
above the midpoint and another below — is written as a tag, then the threshold,
then the positive and negative scales, colon-separated. Each of the two is a
`colorScale` string in its own right. The tag is `R:` for the ratio scale (AOB /
BOA) and `D:` for the difference scale (AMB); anything else is a plain
single-sided scale.

```
colorScale=R:2:5,255,0,0:5,0,0,255
```

## tracks

One string carrying every track. Tracks are separated by **triple bars**
(`|||`); fields within a track by a **single bar** (`|`).

The canonical layout is **four fields**:

| field | description |
| ----- | ----------- |
| 1 | URL of the track file |
| 2 | track name; a literal `$` here decodes to `|`, which is how a name containing a bar survives the separator |
| 3 | data range, as a dash-delimited string (`0-50`, or `-5-5` for a range starting below zero) |
| 4 | colour — any colour string JavaScript recognizes, e.g. `rgb(100, 0, 0)` |

```
tracks=http://…/GM12878_CTCF_orientation.bed|GM12878_CTCF_orientation.bed||rgb(22, 129, 198)
```

Empty fields are allowed and common — the example above supplies no data range.
An empty **data range** decodes to `NaN` bounds, which the decoder's own
`fixDefaults` pass then deletes, so what leaves the decoder has no range at all
and the track picks its own. Filed as #515: the repair is real but it is a
second pass undoing the first, and only inputs that go through the decoder reach
it — a session handed straight to `restoreSession` is never swept.

**Three fields** is accepted, and is the v0 layout. The colour is always the
last field, so the three-field form decodes as `url | name | colour` with no
data range. Earlier revisions of this page described the middle field of the
three-field form as the data range; **that has never been true of any decoder
here** — field 2 has always been read as the name. A three-field string written
against the old documentation loads its data range as the track's name.

**Fewer than three fields is not a supported layout.** A two-field string is
mis-split (the whole string is taken as the URL), and a bare URL with no bars is
read as a track whose colour is its own URL. Write four fields, padding with
empties.

## Session forms

Beyond the query form, the decoder accepts three whole-session parameters. These
carry an array of browsers rather than a single map, and each browser's contents
follow the same rules as above.

| Parameter | Description |
| --------- | ----------- |
| `session=` | **v1 session JSON**. A `blob:` or `data:` prefix means the rest is compressed and base64-encoded — the only form juicebox writes, as juicebox-web's share link. Anything else is loaded as a URL or file and may be either compressed or plain JSON. |
| `juicebox={…},{…}` | one brace-wrapped query string per browser, comma-separated. Read-only legacy. |
| `juiceboxData=` | the `juicebox=` value above, compressed. **Not** session JSON — the two share one code path, and the only difference is that this one is decompressed first. Read-only legacy. |
| `juiceboxURL=` | a bit.ly short link to expand and re-decode. **Deprecated, and the one format deliberately dropped** — see ADR-0006 decision 1. The decoder still takes this path today; #506 removes it. ADR-0006 expected it to be dead already, on the grounds that the bit.ly endpoint wants a credential we no longer hold; measured 2026-08-09 (#502) it is **not** dead — a link expands and its session decodes in full. #506 therefore removes working behaviour. |

Session JSON has no `version` field today; its absence means v1. When one is
added (#508) it will be written but never required.
