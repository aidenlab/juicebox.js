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

**Bulk replacement** — the deliberate exception to the chokepoint: session and
URL restore replace the whole `State` object rather than mutating it, because at
restore time there is nothing to translate relative to.

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
