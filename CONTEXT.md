# Context — juicebox.js

The ubiquitous language of this codebase. When naming a module, a test, an issue
or a variable, use the term as defined here rather than a synonym. This is a
glossary: each entry says what a term *is*, and points at the ADR or doc that
holds the rules and the history.

juicebox.js is an **embeddable component**, not a standalone app. It renders Hi-C
contact maps inside host apps such as juicebox-web and Spacewalk.

## Core concepts

**Contact map** — the 2D matrix of interaction frequencies between genomic loci;
the thing the user is looking at. A browser shows one primary contact map and
optionally a **control map** for comparison.

**Dataset** — the source a contact map is drawn from, and the object the browser
holds (`js/hicDataset.js`). Either a **`.hic` dataset**, read from a static file —
the primary case, and the one everything is tuned for — or a **live contact
map**, streamed from hic-straw for Spacewalk. `dataset.isLive` tells them apart.

**`datasetType`** — the same distinction spelled for hosts on the `onMapLoaded`
payload: `'live' | 'hic' | 'unknown'`. It does **not** mean primary vs control.
`'unknown'` is a legitimate published value — a `Dataset` subclass declining to
classify itself — not an error. Inside the repo, prefer `isLive`. Declared in
`COORDINATOR_PAYLOAD_SHAPES` (`js/publicApi.js`).

**The disguise** — a live contact map deliberately made to look like a `.hic`
dataset: same `Dataset`, same rendering path, same canonical state. Where it does
not hold, say so rather than treating live as a variant of file; `autoThreshold`,
`loadLiveContactMap` and sync membership are the known divergences. A live map is
a Spacewalk-only outlier, exempt from the file-map sync-membership rules of
ADR-0016: `loadLiveContactMap` does not recompute sync groups, and that is
deliberate (#638). The real work lives in hic-straw; juicebox.js holds a thin
adapter.

**Canonical state** — the seven fields on `State` (`js/hicState.js`) that fully
and unambiguously specify the view: `chr1`, `chr2`, `x`, `y`, `zoom`,
`pixelSize`, `normalization`. Everything else the user sees is derived from
these. See `docs/state-manipulation.md`.

**Axis ordering** — the invariant `chr1 ≤ chr2`. A `.hic` file stores one
triangle of a symmetric matrix, so a transposed view is the same view, not a
second one. The chokepoint transposes an unordered pair. ADR-0006 decision 3.

**Projection** — anything derived from canonical state on read rather than
stored. The **locus** is the important one: computed by
`state.getLocus(dataset, viewDimensions)`, never stored, because view dimensions
change without any state mutation.

**Chokepoint** — `state.setView`, the single method all canonical state
mutations flow through. Nothing outside `js/hicState.js` writes state fields.

**Translator** — a thin method on `State` converting domain input (pixel deltas,
BP loci, a peer browser's state) into arguments for the chokepoint: `panShift`,
`updateWithLoci`, `setWithZoom` and friends.

**Gesture recognizer** — what decides which gesture raw input on the viewport
is: drag, sweep, double-click, double-tap, pinch, wheel, or crosshairs held with
shift. It holds the in-progress gesture and names the intent, and does nothing
to the view itself — each intent is carried out elsewhere and reaches the
chokepoint through a translator. #580.
_Avoid_: gesture handler, interaction handler (the module that carries intents
out).

**Restore** — session and URL restore installing a whole new `State`, handed
through the chokepoint like any translator, so a restored view is clamped
silently, never rejected. The only writer of `browser.state`. ADR-0009.
_Avoid_: bulk replacement.

**Substitution** — rendering with a normalization other than the one asked for,
because that one is not on offer. Not a failure: announced in the normalization
widget, never in a modal, and sticky — canonical state is rewritten to name what
is actually drawn. ADR-0012.
_Avoid_: fallback, external change, unavailable. *Coercion* is reserved for the
restore-time act ADR-0009 names.

## Browser wiring

**Widget** — a UI control surrounding the contact map: the locus box, resolution
selector, normalization and colour-scale controls, control-map and chromosome
selectors, annotation button, scrollbars. It reads the browser, issues commands
to it, and is told when to refresh rather than watching for changes.

**Coordinator** — the single fan-out point that tells widgets, rulers and the
contact matrix view — three distinct things — to refresh
(`js/browserCoordinator.js`). Also the **host extension point**:
`coordinator.addCallback(name, fn)`. ADR-0002.

**Browser registry** — the owner of one embed: the browsers in one host
container, which of them is current, their sync group, selected gene, alert
dialog and teardown. Returned by `initRegistry(container, config)`; the unit of
isolation that lets two embeds share a page. ADR-0004.
_Avoid_: browser session, browser context, embed.

**Sync group** — the set of browsers a browser publishes its canonical state to.
A rule, not a container, and **static**: settled when panels pair, unchanged
while anyone pans. A browser joins when it has not opted out and its dataset
`canSyncWith` the other's — the same assembly **and** two-way chromosome parity:
each map can place every real chromosome the other carries, aliases and case
aside. So a subset `.hic` does not join a whole-genome group, and groups
partition the synchable panels. Recomputed wherever the open maps change, never
accumulated. Carries canonical state and view preferences, never dataset
choices. ADR-0014, ADR-0016.
_Avoid_: sync set, linked browsers.

**Sync state** — canonical state as a *peer* reads it: chromosomes by name and a
bin size rather than a zoom index, because the receiver may order its chromosomes
and resolutions differently. A projection (`State.getSyncState`), consumed by
`State.sync`. Membership already guarantees the receiver can place it, so the
one refusal a host sees is a newly loaded panel with no compatible peer,
reported as `onSyncRefused` rather than dropped silently. `js/syncGroup.js`,
ADR-0016.
_Avoid_: sync payload, target state.

**Isolation mark** — the quiet mark in a panel's navbar, beside the contact-map
label, on a panel holding a map that belongs to no sync group; its tooltip says
why (different assembly, mismatched coverage, or `synchable: false`). It shows
**isolation, never membership**: a panel with a partner is unmarked, whichever
group it is in. The **empty room** is exempt — fewer than two mapped panels mark
nothing. Moves only when the open maps change, never while anyone pans.
`isolationReasons` in `js/syncGroup.js`, ADR-0016 decisions 7–8.
_Avoid_: sync badge, unsynced indicator.

**Target set** — the browsers a *load* reaches: the ones the user has aimed at by
shift-clicking their navbars, plus the current browser. Its members are
**targeted browsers**. Not a sync group: membership is an explicit gesture, the
cargo is dataset choices, and it lasts until the user re-aims. ADR-0015.
_Avoid_: selection, selected browsers (spent on the current browser), target
group.

**View preference** — a setting the user makes on one browser that changes how
it interprets a gesture without being part of what the view *is*: user-set, per
browser, absent from canonical state. It decides what crosses a sync group, and
is why normalization and the colour scale do not. ADR-0014.

**Resolution lock** — the padlock beside the resolution selector, and the view
preference it holds: while closed, a zoom gesture changes pixel size rather than
the resolution rung.
_Avoid_: scale lock.

**Alert dialog** — the modal a load failure or unavailable option is reported
in, one per registry (`registry.presentAlert`). Not igv-ui's page-scoped `Alert`
singleton, which is no longer used. ADR-0004.

**Selected gene** — the gene name a search last resolved to, or a restored
session named. Per registry; not canonical state.

**Session** vs **browser registry** — a *session* is serialized configuration:
the JSON a user saves, pastes as a URL, or restores (`js/session.js`). A
*registry* is the live object that produces and consumes one. A registry has a
session; never call it one. A session describes one embed; the only part no
registry owns is the shared **caption** (`#hic-caption`).

**Empty browser** — a browser panel with no dataset, the normal transient state
while adding a map. It serializes to `null` and is dropped from the session.
ADR-0006 decision 6.

**Wire format** — the serialized spelling of a session, and a contract with
*users*: a link pasted into a paper years ago must still decode. **v0** is the
older query form in `docs/url.md`; **v1** is the current state and track strings
plus the session JSON. Juicebox reads both and writes v1. The accepted set is
pinned by `test/data/wireFormatCorpus.js` and `test/testDecoderGolden.js`, so a
snapshot that moves is a wire-format change. ADR-0006.

**Session string** vs **session parameter** — the *session string* is the
payload (`blob:…`, `data:…`, bare JSON, or a URL naming one); a *session
parameter* is a host app's query parameter carrying it. The session string is
the contract; the URL is not. ADR-0011.

**Session source** — *where* a session was read from: the `session=` parameter
itself, or a fetched URL. Carried on a `SessionDecodeError`
(`SESSION_SOURCES`, `js/sessionCodec.js`).

**Wire-format adapter** — one entry in `WIRE_FORMATS` (`js/sessionCodec.js`):
"does this input carry my format?" paired with "decode it". Folded in order, and
the order is format precedence. ADR-0006 decisions 9 and 10.

**Decode** vs **normalize** — two stages. *Decoding* turns a wire format into a
session document and is the only stage that knows a format exists.
*Normalizing* turns a session document into one every loader can consume, and
every entry path reaches it.

**Entry path** — a door a *config* comes in by: `hic.init`, `hic.restoreSession`,
`BrowserRegistry.restoreSession` and `createBrowser`. A session is resolved in
two places — `BrowserRegistry.restoreSession` and `createBrowser` — and no path
meets both. Tracks added at runtime come in by `HICBrowser.loadTracks`, which is
not a session entry.

**Restore door** — a door a *state* comes in by, one stage below the entry
paths: the rungs of `dataLoader.loadHicFile` (a config `locus`, a `state` token,
`State.default()`) and `loadLiveContactMap`. All reach the chokepoint. ADR-0009.

**Stated viewport** — a `{width, height}` a test fixture declares rather than
measures, because tests do no layout and a clamp against `{0, 0}` is not a
clamp. ADR-0009 fact 5.

**Resolved config** — a browser config after the normalize stage, which
`browser.config` then holds; the stage rewrites the host's own object in place.
Below that seam, code reads fields and never defaults them. The schema is in
`docs/config-schema.md`.

**Dispose** vs **reset** vs **clear dataset** — the three teardown verbs, most
destructive first. *Dispose*: the browser is going away and is dead afterwards;
`registry.delete()` and `deleteAll()` both go through it. *Reset*:
dispose-then-construct on the same instance, so a host's reference survives,
with a new `State`. *Clear dataset*: only the data goes; internal, run before a
load. Do not add a fourth. ADR-0005.
_Avoid_: `clearSession`.

**Update** vs **repaint** — a *repaint* redraws everything from current state,
once. An *update* wraps a repaint with coalescing of rapid calls and peer sync
afterwards. Callers ask for an update; only the update path repaints.

## Rendering

**Image tile** — a square raster of the contact map at a given zoom, row and
column (`imageTileDimension` bins square). Cached by what it contains —
chromosome pair, bin size, unit, grid position, normalization, display mode —
and not by pan position or pixel size, which only change where it is painted.

**Viewport** — the element the contact map is painted into
(`contactMatrixView.viewportElement`). Not the `--hic-viewport-*` custom
properties, which despite the name size the whole browser (`.hic-root`).

**Track tile** — unrelated to image tiles despite the word: a buffered span of 1D
track features for one axis (`js/tile.js`). When either could be meant, say
which.

**Display mode** — which map or combination is rendered: `A` (primary), `B`
(control), `AOB` and `BOA` (ratios), `AMB` (difference). The combining modes
need matching resolutions on both maps.

**Color scale** — maps a score to a pixel colour, magnitude in alpha against a
fixed hue. Single-sided (`ColorScale`) for the count modes, with a threshold
derived from the data; *signed* (`SignedColorScale`: `RatioColorScale`,
`DiffColorScale`) for the comparison modes, with a user-driven threshold.

**Zoom data** — a resolution-specific view of a matrix: bin size, unit and
per-map average counts. Obtained by zoom index.

**Bin** — the unit of resolution. Canonical `x`/`y` are bin positions, not base
pairs; `pixelSize` is pixels per bin.

**`All` chromosome** — the pseudo-chromosome at index 0 covering the whole
genome. A member of `dataset.chromosomes`, but not a real sequence.
_Avoid_: chr0, whole-genome chromosome.

**Whole-genome view** — the view whose `state.chr1` is `All`. Distinct from the
**whole-genome matrix** (the data `All` addresses) and the **whole-genome
resolution** (its single synthetic bin size). ADR-0010.

**Sentinel zoom** — zoom index `-1`, marking a synthesised resolution rung. It
cannot collide with a persisted `zoom` and is never serialized.

**Single-chromosome assembly** — a dataset whose chromosomes are `All` plus
exactly one real chromosome, so the whole-genome view and that chromosome show
the same picture.

**Live contact map** — a streaming map from hic-straw rather than a static
`.hic` file. Carries ensemble contact *frequencies* in (0, 1], not raw counts,
which is why the auto colour-scale heuristics branch on `isLive`.

**Track pair** — one 1D track rendered on both axes by a pair of renderers
(`js/trackPair.js`).

## Data access

**Gate** — a data host refusing a request a browser is able to make. Two are
known, refusing for unrelated reasons: the *bot challenge* and the *User-Agent
gate*. Say which. ADR-0001.

**Bot challenge** — a host answering an automated request with a CAPTCHA page
instead of the file: AWS WAF in front of `www.encodeproject.org`, under a
misleading `405`.
_Avoid_: "the 405".

**User-Agent gate** — a host serving `403` unless the request carries a
`User-Agent` it recognises, as the `hicfiles` and `dnazoo` S3 buckets do. No
browser can pass it.

**Gated bucket** — a host behind the User-Agent gate. Distinct from a
*challenged host*, behind the bot challenge, because the dev proxy treats the two
differently.

**Approved domains** — the sites ENCODE lets past its bot challenge:
`aidenlab.org` and `igv.org`. Why production works and localhost does not.
_Avoid_: allowlist.

**URL mapper** — the function juicebox applies to a data URL before fetching it,
registered once by the host app via `setUrlMapper`; unset in production.
ADR-0001.

**Unmapped URL** — a track config's pre-mapping URL, kept so a serialized
session never names the dev server.

**Dev proxy** — the development-only Vite plugin under `dev-proxy/` that
refetches gated hosts from Node. A workaround with an expiry condition, not
architecture. ADR-0001.

**Claimed host** — a host the dev proxy routes (`CHALLENGED_HOSTS`). Everything
else fetches directly, so a genuine CORS failure stays visible.

## The public surface

**Public surface** — everything a host app can reach: the exports of
`js/index.js`, every member of a browser instance and what those members reach,
the coordinator callback names, and posted events with their payloads. Mostly
undeclared by construction.

**Manifest** — `js/publicApi.js`, the public surface named as data and checked by
`test/testPublicApi.js`. Check it before deleting anything: "no callers in this
repo" is half a finding. ADR-0003.

## Architecture vocabulary

Refactoring here uses the deep-module vocabulary — **module**, **interface**,
**implementation**, **depth**, **seam**, **adapter**, **leverage**,
**locality**. Prefer *seam* over "boundary" and *interface* over "API".
