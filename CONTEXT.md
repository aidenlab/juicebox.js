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

**Dataset** — the source a contact map is drawn from, and the object the browser
holds (`js/hicDataset.js`). Two kinds, distinguished by `dataset.isLive`:

- a **`.hic` dataset** reads a static file over the network. This is
  juicebox.js's primary purpose and the case everything is tuned for.
- a **live contact map** streams from hic-straw instead of reading a file. Built
  for Spacewalk, which needed contact maps generated as it runs.

**`datasetType`** — the same distinction spelled for hosts, as `'live' | 'hic' |
'unknown'`. It rides out as a field of the `onMapLoaded` payload. It does **not**
mean primary vs control: which map loaded is expressed by *which coordinator
method is called*, and a `"main"`/`"control"` reading is the vestigial one its
JSDoc carried for eight months. `'unknown'` is legitimate rather than an error —
a `Dataset` is an extension point, and a subclass declining to classify itself is
better published honestly than reported as one of the two kinds it is not. Prefer
`isLive` inside this repo; `datasetType` exists for the payload, and the two must
not be able to disagree. The vocabulary is declared in `COORDINATOR_PAYLOAD_SHAPES`
and pinned by `test/testMapLoadedPayload.js`, which drives both load paths — the
live path published a fourth spelling of its own until #471.

**The disguise** — a live contact map is deliberately made to *look like* a
`.hic` dataset from juicebox.js's side: same `Dataset`, same rendering path, same
canonical state. This was an expediency, and it mostly works. Where it does not
hold, say so explicitly rather than treating live as a variant of file:

- `imageTileCore.autoThreshold` takes the 75th percentile rather than the 95th
  and clamps to 1 for live maps — a real rendering divergence.
- `loadLiveContactMap` is its own load path, not a parameter to the file path.

The core of this work lives in **hic-straw**, not here; juicebox.js holds a thin
adapter. When touching it, expect the seam to span three repos. See the
live-map note on candidate 10 in `docs/architecture-review.html`.

**Canonical state** — the seven fields on `State` (`js/hicState.js`) that fully
and unambiguously specify the view: `chr1`, `chr2`, `x`, `y`, `zoom`,
`pixelSize`, `normalization`. Everything else the user sees is derived from
these. See `docs/state-manipulation.md`.

**Axis ordering** — the invariant `chr1 ≤ chr2`, part of what makes canonical
state *unambiguous*. A `.hic` file stores one triangle of a symmetric matrix, so
an x-axis of chr5 against a y-axis of chr2 is the same view as its transpose,
not a second one. A state naming the axes in the other order is a second
spelling of a view that already has one, which is why the ordering is an
invariant rather than a convention — see `docs/adr/0006`.

Enforced in **`setView`**, the chokepoint: it receives both chromosomes and both
origins together, so when handed an unordered pair it transposes all four
atomically. Callers — including the translators — never order their arguments;
they inherit the invariant by delegating. The `State` constructor transposes too,
as belt-and-braces for states arriving from outside the chokepoint (a decoded
session, a pasted URL); on canonical state that transposition is a no-op, which
is what makes save → restore the identity.

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

**Restore** — session and URL restore replacing the whole `State` object rather
than mutating it field by field. Called *bulk replacement* until #563, when the
name stopped earning its keep: it used to be the chokepoint's deliberate
exception, on the reasoning that at restore time there is nothing to translate
relative to, and #558 retired that. `HICBrowser.setState` hands the canonical
six to `setView` like any other translator, so a restored view is clamped and
capped exactly as a gesture is — silently, never rejected (ADR-0009 decision 2).
It is also the **only** writer of the state: `browser.state` and `activeState`
are getters over a private field as of #563.

**Substitution** — the act of rendering with a normalization other than the one
asked for, because the one asked for is not on offer. Three causes, which the
user can act on differently: the file carries no such vector at all; both maps
carry it but their *intersection* does not, so unloading the control map would
bring it back; or the vector exists but not at this chromosome and resolution,
so panning or zooming would. A substitution is not a failure — a link that opens
on `NONE` opened correctly — and it is announced in the normalization widget,
never in a modal (ADR-0012). It is always *sticky*: the canonical state is
rewritten to name what is actually drawn, so state cannot disagree with the view.
_Avoid_: fallback, external change, unavailable. *Coercion* stays reserved for
the restore-time act ADR-0009 named.

## Browser wiring

**Widget** — a UI control surrounding the contact map: the locus box, resolution
selector, normalization and colour-scale controls, control-map selector,
chromosome selector, annotation button, scrollbars. A widget reads the browser
and issues commands to it; it is told when to refresh rather than watching for
changes itself.

**Coordinator** — the single fan-out point that tells widgets, rulers and the
contact matrix view to refresh when something they display has changed
(`js/browserCoordinator.js`). It is also the **host extension point**: a host app
registers with `coordinator.addCallback(name, fn)` to learn about map loads,
locus changes and colour changes. Deleting it would push its fan-out back into
`HICBrowser` and is not on the table — see `docs/adr/0002`.

**Browser registry** — the owner of one embed: the browsers in a single host
container, which of them is current, their sync group, their selected gene,
their alert dialog, and their teardown. One registry per container element. It
is the thing `initRegistry(container, config)` returns, and the unit of
isolation that lets two embeds coexist on a page — see `docs/adr/0004`.
_Avoid_: browser session, browser context, embed.

**Sync group** — the set of browsers a browser publishes its canonical state to.
Membership is a rule rather than a container: a browser joins when it has not
opted out and its dataset is compatible with the other's. What travels the group
is canonical state and, by deliberate exception, view preferences — never dataset
choices. See `docs/adr/0014`.
_Avoid_: sync set, linked browsers.

**Sync state** — canonical state as a *peer* reads it: chromosomes by name and a
bin size rather than a zoom index, because the receiving browser may order its
chromosomes differently and offer a different resolution array. A projection
(`State.getSyncState(dataset)`), consumed by `State.sync` on the other side.
Membership decides who is handed one; whether a particular one can be acted on
is a separate question, because a receiver's genome need not know every name a
peer can publish — `canResolveSyncState` in `js/syncGroup.js`, issue #605.
_Avoid_: sync payload, target state.

**View preference** — a setting the user makes on one browser that changes how
that browser interprets a gesture, without being part of what the view *is*.
Three properties define the category: the user sets it, it is scoped to a single
browser, and it is absent from canonical state. The **resolution lock** is the
first one named. This is the distinction that decides what crosses a sync group,
and it is the reason normalization and the colour scale do not — `docs/adr/0014`.

**Resolution lock** — the padlock beside the resolution selector, and the view
preference it holds: while it is closed, a zoom gesture changes pixel size rather
than moving to a different resolution rung.
_Avoid_: **scale lock**, which collides with both *colour scale* and *pixel
size*. The lock is honoured on local gesture paths only; sync is not one of them
— issue #608.

**Alert dialog** — the modal a load failure or an unavailable option is reported
in, one per registry, built in that registry's container on first use
(`registry.presentAlert`). Distinct from igv-ui's `Alert` singleton, which is
page-scoped and no longer used here: the singleton rebound itself to whichever
container initialized last, so one embed's failures surfaced in another's.

**Selected gene** — the gene name a search last resolved to, or a restored
session last named. Per registry, because it is serialized per session. Not
canonical state: `state.selectedGene` is a per-browser copy the state carries
for serialization, not something the view is derived from.

**Session** vs **browser registry** — a *session* is serialized configuration:
the JSON a user saves, pastes as a URL, or restores (`js/session.js`, `toJSON`,
`restoreSession`, `compressedSession`). A *browser registry* is the live object
that produces and consumes one. A registry has a session; it is not one. Never
call the registry a session.

A session describes **one embed**, not the page: `registry.toJSON()` and
`registry.restoreSession(config)` are where the work happens, and the exported
functions of the same name delegate to a registry — `restoreSession` to the one
owning the container it is given, `toJSON` to the same page-wide default the
zero-argument getters use. The only part of a session no registry owns is the
**caption**, a single `#hic-caption` element outside every container that two
embeds share.

**Empty browser** — a browser panel with no dataset, the normal transient state
while a user is partway through adding a map. It serializes to `null` and the
registry drops it, so it is absent from the session rather than present as a
browser naming no map. **Accepted asymmetry:** browser *count* does not survive
the round trip when one of them is empty — an embed saved with an empty panel
open restores one panel short. ADR-0006 decision 6.

**Wire format** — the serialized spelling of a session, as distinct from the
session itself. It is a contract with *users*, not just with host apps: a link
pasted into mail or a paper years ago must still decode. Two versions are
accepted. **v0** is the older query form documented in `docs/url.md` — a
7-token state string, a 3-token track string. **v1** is the 9-token state, the
4-token track string, and the session JSON that `compressedSession` writes.
Juicebox reads both and writes only v1. See `docs/adr/0006`.

A session JSON juicebox writes says so, in a top-level `version` field holding
the number 1; **a session that says nothing is v1**, which is every session ever
saved before the field existed. It is the format's field, not the document's:
stamped by the encoder, taken off by the decoder, never seen by
`restoreSession`. Numbered on the same v0/v1 sequence as the rest of this
paragraph — v0 has no session JSON, so 1 is the first number it can hold. See
`docs/url.md` "Version" and ADR-0006 decision 7.

The accepted set is pinned, not described: `test/data/wireFormatCorpus.js` holds
one fixture per format and per decoder branch, and `test/testDecoderGolden.js`
snapshots what today's decoder makes of each. Those snapshots *are* the
compatibility contract in executable form, so a snapshot that moves is a change
to the wire format until shown otherwise. That file's header carries the
convention for updating one.

What the corpus pins is the *accepted set*, not the *sent set*. Its fixtures come
from the three repos, the published docs, and our own issue trackers; links
published outside all of those — in a paper, a lab wiki, a dataset landing page —
have never been sampled. The contract is frozen against what the decoder takes,
and the evidence that this matches what users send is partial by decision. See
`test/data/wireFormatCorpus.js`'s harvest-scope note.

**Session string** vs **session parameter** — a *session string* is the payload:
`blob:…`, `data:…`, `data:application/gzip;base64,…`, a bare JSON document, or a
URL naming one (`docs/url.md` spells the four out; the URL spelling is
juicebox-only). A *session
parameter* is a host application's query parameter carrying one — juicebox-web
writes `?session=<string>` raw, Spacewalk composes three apps' sessions under
three parameter names of its own. **The session string is the contract; the URL
is not.** Every juicebox host owes the same session-string set; no host owes
another its query string, so a whole URL is not portable between host apps even
where the payload inside it is. In `test/data/wireFormatCorpus.js` a fixture's
`payload` is the session string and its `input` is the session parameter. See
ADR-0011.

Juicebox is not the only reader of the format. Spacewalk decodes `?session=`
itself (`src/sessionURLCodec.js`), because it sets
`queryParametersSupported: false` and never reaches juicebox's decoder — so
ADR-0006's "one decoder" is one decoder *per repo*. The two are kept in
agreement by a shared fixture rather than shared code: the corpus is exported
and Spacewalk's suite runs its payload rows. ADR-0011.

**Session source** — *where* a session was read from, as distinct from what it
says: the `session=` parameter itself, or a fetched URL. The two arms of the
`session` adapter, and a fact a user needs when a link will not open — "which of
my links is this?" is the first question a refusal has to answer. It is carried
outward on the `source` field of a `SessionDecodeError` and spelled into that
error's message, both from `SESSION_SOURCES` (`js/sessionCodec.js`).
Vocabulary of the `session=` format only: the legacy braced parameters name
themselves in their own messages. #521.

A **local path** is not a third source: it is fetched by the URL arm and reports
as one. #519.

**Wire-format adapter** — one entry in `WIRE_FORMATS` (`js/sessionCodec.js`):
the pair of "does this input carry my format?" and "decode it into the shared
decode context." The array is the only place a format is named, so adding a
fifth is adding an entry. The adapters are folded **in order**, and the order is
the format precedence the old straight-line decoder expressed by statement order.
ADR-0006 decisions 9 and 10.

**Decode** vs **normalize** — two stages, not one. *Decoding* turns a wire
format into a session document and is the only stage that knows a format exists.
*Normalizing* turns a session document into one every loader can consume —
applying defaults, expanding URL shortcuts, reconciling a selected gene — and is
reached by every entry path, including a session handed straight to
`restoreSession`. Format knowledge never crosses into normalize.

**Entry path** — one of the doors a config comes in by: `hic.init`,
`hic.restoreSession`, `BrowserRegistry.restoreSession` and `createBrowser`. The
query/URL form reaches `HICBrowser` through `init`, and the three session-shaped
doors all arrive at `BrowserRegistry.restoreSession`, so there are two places a
session is resolved and no path meets both (#535). All of them accept a single
browser config, since a session with its one browser inlined is the shape
`session.browsers || [session]` reads.

`createBrowserList` was a fifth door until #535 and is now *below* the seam: it
builds an embed's browsers from a session its caller has already resolved.
`test/testConfigGolden.js` still snapshots it as a column, because what it hands
a browser is where the other columns end too.

**Restore door** — a *different* set of doors from the entry paths above, and
the word is overloaded on purpose because ADR-0009 uses it that way. An entry
path is where a **config** comes in; a restore door is where a **state** comes
in, one stage further down. There are four, and they are branches rather than
published methods: `dataLoader.loadHicFile` walks a three-**rung** ladder — a
config-level `locus`, a `state` token, and the `State.default()` fallback — and
`dataLoader.loadLiveContactMap` is a fourth door walking its own copy of the
middle of that ladder. Only two rungs reach `browser.setState`.
`test/testRestoreGolden.js` snapshots all four (#557). There was a fifth, a
`config.synchState` rung, deleted by #566: it was unreachable, and the job it
was written for in 2017 had been taken over by the sync step at the end of a
load.

A **stated viewport** is a `{width, height}` a fixture declares rather than
measures. The test environment is `node`, JSDOM is opt-in per suite and does no
layout regardless, so `getViewDimensions()` in a test answers `{0, 0}` — and a
clamp measured against zero is not a clamp. Stating it is the only honest option;
ADR-0009 fact 5.

A **track** has one door of its own: `HICBrowser.loadTracks(configs)`, which a
host calls at runtime with track configs that were never part of a session. It
resolves them through the same stage (#536). It is not a session entry — nothing
about a session or a browser is decided there — so "two places a session is
resolved" still holds.

**Resolved config** — a browser config *after* the normalize stage has had it,
which is the object `browser.config` then holds. Not a copy: the stage rewrites
the host's own object in place, so the host's config and the browser's are one
object. It is an observable surface, because juicebox-web reads `browser.config`
back (ADR-0003), and `test/testConfigGolden.js` snapshots it at every door
(#531).

One reader decides it: `js/normalizeSession.js`, run once per session at the
entry (#535) — `BrowserRegistry.restoreSession` for a session,
`createBrowser` for a single browser config, `HICBrowser.loadTracks` for tracks
added at runtime. **Everything below that seam reads fields.** A `??`, a
`|| default`, an `x !== false` or a string-to-object coercion **applied to a
config field** in the browser, the widgets or the loaders is a bug, not a
convenience: it puts a second answer where there is meant to be one, and it is
invisible in `browser.config` (#536). A component defaulting its *own*
constructor parameter is not that — `ContactMatrixView` names a background
colour for a view built without a config behind it, and never reads a config to
do it. The stage **defaults and coerces; it never rejects** — a config is the
most-used public surface juicebox has, so anything unrecognized is carried
through untouched.

**The schema** — what a resolved browser config carries. Fields not listed are
carried through unread, which is deliberate: a host may keep its own members on
the object.

| Field | Resolved to |
|---|---|
| `showLocusGoto`, `showHicContactMapLabel`, `showChromosomeSelector` | **Defaulted** to `true`; all three forced `false` when `figureMode === true`, which beats an explicit `true` |
| `figureMode` | **Absorbs `miniMode`**, the legacy spelling: a config naming `miniMode` and no `figureMode` gets `figureMode` set from it. One that names neither gains no member. `miniMode` is left on the config, unread. See ADR-0008 |
| `synchable` | **Defaulted** to `true`. Only a literal `false` opts out. A session-level `syncDatasets: false` writes `false` here on every browser, overriding what a browser said |
| `backgroundColor` | **Coerced** from `"r,g,b"` to `{r, g, b}`; **defaulted** to white |
| `colorScale` | **Coerced** from its wire spelling to a `ColorScale` (or the signed scale its tag names) |
| `displayMode` | Set to `"A"` when `cycle` is truthy — the cycle starts on the primary map |
| `url`, `controlUrl`, every track's `url` | **Coerced**: a `*s3/`, `*s3e/`, `*s3_/`, `*s3e_/` or `*enc/` prefix expands to the URL it stands for. Non-strings (a local `File`) pass through |
| `tracks[]` | Each track: the default annotation colour `rgb(22, 129, 198)` dropped so the renderer's own applies, `NaN` data-range bounds dropped, `displayMode` forced to `"COLLAPSED"` (an override, not a default — see #525). A `tracks` that is not an array is left alone |
| `selectedGene` | Session-level. Hoisted up from a browser that names one, last writer winning, unless the session names its own |
| `state` | **Not** resolved here: it arrives as a `State` from the query path and as a plain object from a host config, and `DataLoader` decodes it at load time. A known type divergence, pinned as a probe in the corpus |

Three things a config carries are honoured on one path only, and are not part of
the resolved schema:

- **`queryParametersSupported`** is read by `initRegistry` *before* normalize, to
  decide whether the address bar replaces the config it was passed. It cannot be
  resolved by a stage that runs after that decision.
- **`width` / `height`** are read by the browser constructor, which calls
  `setViewportSize` when both are present. Not a default — there is no default
  size in a config. A browser given neither is sized by the stylesheet, not by
  whatever browser was sized last (#477).
- **`nvi`** may be filled in at load time from a lookup table keyed on the map's
  URL (`js/nvi.js`). That is the loader answering a question about a *file*, and
  it reaches maps loaded at runtime as well as those a session named.

The loaders and `init()` answer four more questions, and none of them is a
document's to answer — each needs the load, the layout or the dataset:

- a track's **`height`** comes from the live layout, and **`autoscale`** is set
  when a track config names no `max`;
- a map's **`name`** is extracted from the file behind its URL, and a live
  contact map — which has no URL — falls back to `"Live Contact Map"`;
- **`normalization`** is checked against the loaded dataset's own set of
  normalizations and falls back to `NONE` if the map does not carry the one
  asked for. The only field still checked below the seam, and it *cannot* move
  up: the valid set does not exist until a dataset is loaded. Since #561 the
  rule is written once, in `browser.resolveNormalization`, and the same
  enforcer coerces the `normalization` a restored *state* carries — which is a
  different field arriving by a different door, asked the same question at the
  same moment (ADR-0009 decision 5).

Everything else below the seam is a plain field read.

**Dispose** vs **reset** vs **clear dataset** — the three teardown verbs, in
descending order of how much they destroy. See `docs/adr/0005`.

- **Dispose** — the browser is going away. `dispose()` removes every element the
  constructor appended, including the ones outside `rootElement`, gives up the
  document-level gesture handlers the contact matrix view installs, clears the
  per-browser event bus, unsyncs from peers, and releases the registry slot. A
  disposed browser is dead: calling a published method on it throws. This is the
  *one* teardown — `registry.delete()` and `registry.deleteAll()` both go through
  it. A registry disposes too, which evicts it from the container map.
- **Reset** — the browser stays, but everything it holds goes. `reset()` is
  dispose-then-construct on the same instance: same object, same `id`, same
  registry slot, same position among its siblings. A host's reference survives
  it. Reset installs a *new* `State` object rather than mutating the old one —
  in-flight repaints detect a replaced browser by state identity.
- **Clear dataset** — the browser and its DOM stay, only the data goes.
  `clearDataset()` is the soft clear a load runs before installing a new dataset.
  Internal only. _Avoid_: `clearSession`, which named a session it never touched.

Do not add a fourth verb. Four of these drifted apart once already, and no two of
them agreed about `unsyncSelf`.

**Update** vs **repaint** — not synonyms. A **repaint** redraws everything from
current state: rulers, track pairs, contact matrix, once, with no coordination.
An **update** wraps a repaint in the things that must happen around it —
collapsing rapid calls (a drag issues far more than can be drawn) and
synchronizing peer browsers afterwards. Widgets and gestures ask for an
*update*; only the update path should call *repaint* directly.

## Rendering

**Image tile** — a square raster of the contact map at a given zoom, row and
column (`imageTileDimension`, currently 685 bins square). Cached, keyed by
chromosome pair, bin size, unit, grid position, normalization and display mode.
Notably *not* keyed by pan position or pixel size — those affect where a tile is
painted, not what it contains.

**Viewport** — the element the contact map is painted into
(`contactMatrixView.viewportElement`), sized as a percentage of its container so
that adding tracks shrinks it. Distinguish it from the `--hic-viewport-*` custom
properties, which despite the name size `.hic-root` — the whole browser, navbar
and axes included — with the viewport as one term in that sum. A config's
`width`/`height` set those properties, so they name the browser's size, not the
element's. Per browser, on its own `rootElement`: a container holds many
browsers, so the unit of isolation (the registry's container) and the unit of
sizing (the browser) are not the same element.

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

**`All` chromosome** — the pseudo-chromosome a `.hic` file declares at index 0,
covering the whole genome in kb-from-genome-start coordinates. A member of
`dataset.chromosomes` but not a real sequence.
_Avoid_: chr0, whole-genome chromosome.

**Whole-genome view** — the view whose `state.chr1` is the `All` chromosome. Not
the same thing as the **whole-genome matrix**, the chr0-vs-chr0 data the `All`
entry addresses, nor the **whole-genome resolution**, the single synthetic bin
size that matrix is stored at. The three can be held apart: a view can read the
whole-genome matrix without being a whole-genome view (see ADR-0010).

**Sentinel zoom** — a zoom index of `-1`, marking a resolution rung that is
synthesised rather than declared by the file. Reserved so it can never collide
with a persisted `zoom`, which indexes `bpResolutions`. Never serialized.

**Single-chromosome assembly** — a dataset whose `chromosomes` holds the `All`
entry and exactly one real chromosome, so the whole-genome view and that
chromosome describe the same picture.

**Live contact map** — a streaming map sourced from hic-straw rather than a
static `.hic` file, driven by Spacewalk. Emits ensemble contact *frequencies*
bounded in (0, 1] rather than raw counts, which is why the auto colour-scale
heuristics branch on `isLive`. Static `.hic` visualization remains the primary
focus of this library.

**Track pair** — one 1D track rendered on both axes, as a pair of renderers
sharing a track (`js/trackPair.js`).

## Data access

**Gate** — the general term for a data host refusing the request a browser is
able to make. Two are known, and they refuse for unrelated reasons: the *bot
challenge* and the *User-Agent allowlist*. Say which gate you mean; a fix for
one does nothing for the other.

**Bot challenge** — a data host answering an automated request with a CAPTCHA
page instead of the file. The known case is AWS WAF in front of
`www.encodeproject.org`, which serves `X-Amzn-Waf-Action: captcha` under a
misleading `405`. It checks requests that *look like a browser* against the
domains ENCODE has approved; a request that identifies honestly skips the check
and is served. Say *bot challenge*, not "the 405" — the status code is a lie.

**User-Agent gate** — the other gate: a host serving `403` unless the request
carries a `User-Agent` it recognises. `hicfiles.s3.amazonaws.com` and
`dnazoo.s3.amazonaws.com` match a case-sensitive prefix, `IGV` among them. No
browser passes it: measured 2026-08-04, a browser sends its own `User-Agent`
whatever the caller asks for, via `fetch` or XHR alike. Unrelated to CORS, and
unrelated to bucket permissions; both were ruled out.

**Gated bucket** — a host behind the User-Agent allowlist. Named separately from
*challenged host* (behind the bot challenge) because the proxy treats them
differently: a challenged host answers with a redirect the proxy hands back,
while a gated bucket serves its object directly, making the dev server a real
data path.

**Approved domains** — the sites ENCODE permits to fetch without a bot challenge:
`aidenlab.org` and `igv.org`. ENCODE's list, on ENCODE's infrastructure, not
editable from here. It is why both production host apps work and localhost does
not — and it governs **browser traffic only**, since a request that does not claim
to be a browser never reaches the check. Avoid the word *allowlist* here: three
different things in this problem answer to it.

**URL mapper** — the function juicebox applies to a data URL before it is
fetched: handed to hic-straw as `config.mapUrl` for a `.hic` read, applied at the
fetch for a 2D annotation, and written into the config for a 1D track, since igv
reads those through loaders juicebox cannot reach into. Registered once by the
host app via `setUrlMapper`; unset in production. The library cannot detect dev
mode itself, because consumers get a production-baked `dist`. See
`docs/adr/0001`.

**Unmapped URL** — a track config's pre-mapping URL, carried alongside the mapped
one so `HICBrowser.toJSON` can serialize the original. The 1D rewrite is the only
one that touches a config, and a session must never name the dev server.

**Dev proxy** — the `apply: 'serve'` Vite plugin under `dev-proxy/` that refetches
gated hosts from Node, where the headers a browser cannot set are ours to
choose. What it sends, and what comes back, depends on the gate: a challenged
host gets an allowlisted `Origin` and answers with a redirect the proxy hands
straight back to the browser; a gated bucket gets an `IGV`-prefixed `User-Agent`
and streams its bytes through the dev server. Development only, host-scoped,
covering `.hic` and track reads. A workaround with an expiry condition, not
architecture. See
`docs/adr/0001`.

**Claimed host** — a host the dev proxy routes, declared in `CHALLENGED_HOSTS`
together with the headers its gate wants. Everything else fetches directly, on
purpose: a genuine CORS or permissions failure has to stay visible in
development.

## The public surface

**Public surface** — everything a host app can reach: the names exported from
`js/index.js`, every member of a browser instance, anything reached through one
of those members, the coordinator callback names, and the events posted with the
shape of their payloads. Most of it is *undeclared by construction* —
`HICBrowser` is not exported, so hosts get instances from `init()` and use them
directly, and the surface never appears in an export list.

**Manifest** — `js/publicApi.js`, which names that surface as data.
`test/testPublicApi.js` reads it and fails when a declared name goes missing.
Nothing imports the manifest at runtime; it exists so there is somewhere to look
and something that breaks.

The manifest is the source of truth for **what** the surface is. `docs/adr/0003`
keeps what a list of names cannot carry — *why* the surface is what it is, and
**which consumer uses what**, which is re-measured at each release. Update both:
the manifest when the surface changes, the ADR's tables when a consumer does.

**The deletion test is not valid against `js/` alone.** Before removing anything
reachable from a browser instance or from the namespace, check the manifest.
"No callers in this repo" is half a finding — four members have *no* internal
callers at all and exist solely for hosts. A name on the manifest is a
coordinated release across both consumers, not a deletion.

Absence from the manifest lowers the risk of changing something; it does not zero
it. juicebox.js is published and embeddable by anyone, so for anything resembling
a load, a session, a state or a lifecycle call, prefer deprecation over deletion.

## Architecture vocabulary

Refactoring work in this repo uses the deep-module vocabulary: **module**,
**interface**, **implementation**, **depth**, **seam**, **adapter**,
**leverage**, **locality**. Prefer **seam** over "boundary" and **interface**
over "API". A module is **deep** when a lot of behaviour sits behind a small
interface, **shallow** when the interface is nearly as complex as the
implementation.
