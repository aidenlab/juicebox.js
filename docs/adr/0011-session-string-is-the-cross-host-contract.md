# ADR-0011 — The session string is the cross-host contract; the URL is not

**Status:** Accepted
**Date:** 2026-08-24
**Related:** ADR-0006 (fact 6, decisions 1, 7 and 9 — this ADR refines them and
amends none), #518, #502 / PR #517 (the corpus that found this),
`test/data/wireFormatCorpus.js`, `docs/url.md`, Spacewalk
`src/sessionURLCodec.js`, `src/launchIntent.js`, `src/sessionServices.js`

## Context

ADR-0006 is titled "The session wire format is the contract; **one decoder**
reads it." That is one decoder *in this repo*. Harvesting the corpus (#502)
established that the `session=` parameter has a second reader: Spacewalk sets
`queryParametersSupported: false` and never reaches `extractConfig` at all,
reading `?session=` in `src/launchIntent.js` and decoding it in
`src/sessionURLCodec.js` — ADR-0006 fact 6's bypass, in production, in a host
app.

#518 tabulated three format spellings the two decoders disagree on. Grilling the
issue on 2026-08-24 changed what that table means in three ways.

1. **Two of the three rows are spellings nothing writes.** Every `data:` fixture
   in the corpus is `provenance: 'synthesized'`
   (`wireFormatCorpus.js:314, 597, 619`); the one harvested `data:` fixture,
   `reject-session-gzip-data-uri`, is annotated as harvested for being *a form
   Spacewalk accepts*, not a string seen in the wild. `blob:` is the only
   spelling either repo emits.

2. **The live divergence is not a format at all — it is the encoding.**
   Spacewalk's `getShareURL` (`sessionServices.js:167-176`) takes
   `hic.compressedSession()`, splits it, and `encodeURIComponent`s the value, so
   every Spacewalk share link carries `session=blob%3A…`. juicebox's
   `extractQuery` (`sessionCodec.js:405-430`) does not percent-decode, and
   `isCompressedSession` tests `startsWith('blob:')` — so the value sniffs as
   *not compressed*, falls to the URL arm, and juicebox tries to fetch
   `blob%3A…` as a document. Spacewalk reads its own links because
   `launchIntent.js:29` decodes the whole query once. juicebox-web writes the
   value raw. Each app is self-consistent; the pair is not.

3. **There is a fifth row #518 did not have.** `uncompressSessionURL` has two
   branches — `/gzip;base64`, and `else → slice(5)`. juicebox's `session=`
   adapter has a third arm (`sessionCodec.js:775-800`): a value that is not
   compressed is a **URL**, fetched, and the fetched document sniffed. Spacewalk
   has no such arm, so `?session=https://…` gets five characters sliced off it
   and the remainder handed to `BGZip.uncompressString`. That is a form
   `docs/url.md` documents and juicebox supports, silently mangled by the other
   reader.

One more fact shapes the remedy: `sessionBootstrapper.js:34-37` runs
`uncompressSessionURL` over **all three** sources in one loop — Spacewalk's own
session, igv's, and juicebox's. It was never a juicebox decoder Spacewalk
reimplemented. It is a generic `BGZip`-decompress-and-parse helper serving three
apps, all of whose payloads are `BGZip.compressString` output.

## Decision

**1. The contract is the session string, not the URL.** A *session string* is
the payload — `blob:…`, `data:…`, a bare JSON document. A *session parameter* is
a host's query parameter carrying one. Every juicebox host owes the same session
*string* set; no host owes another its query string. ADR-0006 said the contract
is the wire format and not any function signature; this says which half of a URL
the wire format is.

The rejected reading is that a `?session=` link is portable between host apps.
Nothing has ever promised it: juicebox-web's URL and Spacewalk's are different
URLs that happen to carry the same payload, and Spacewalk's launch URL composes
three different apps' sessions under three parameter names of its own choosing.
Promising portability would make every host's query-string convention a
compatibility surface.

**2. `data:application/gzip;base64,` joins the accepted set.**
`decodeSessionString` gains a `/gzip;base64` test routing to
`BGZip.decodeDataURI` ahead of the raw-payload path. Five lines and a fixture
whose `outcome` flips.

Dropping it instead — putting it on ADR-0006 decision 1's exception list — was
the cheaper option and is refused for decision 1's own reason: the contract is
frozen as the decoder's *accepted* set precisely because the sent set is not
enumerable from here. Spacewalk documents the form as one of two "historical
forms," which is weak evidence, but "unwritten by us" is not "unwritten by the
Java desktop app." Establishing provenance was considered and declined: a day of
archaeology to decide the fate of five lines is the wrong trade, and ADR-0006
already conceded the question is unanswerable from this repo.

**3. Neither repo imports the other's codec. A shared fixture keeps them
honest.** juicebox exports `test/data/wireFormatCorpus.js` through its
`exports` map; Spacewalk's suite runs the payload rows against
`uncompressSessionURL`.

Exporting `decodeSessionString`/`encodeSessionString` from `js/index.js` was the
first decision reached and then reversed on fact 4 above: Spacewalk would be
decoding *Spacewalk's* and *igv's* sessions with juicebox's codec, which points
the dependency arrow at the wrong app. Branching the loop so only the juicebox
payload took that path keeps the local helper — and the drift — while adding a
three-way branch to four lines. A third package for two consumers who are both
ours buys nothing.

What actually failed here was not that the code was duplicated. It was that
nobody could *see* the divergence: the two decoders drifted and it took the
corpus note, months later, to notice. A shared fixture addresses that directly
and leaves both repos' layering alone. It also means **no juicebox release is
required** for any of this.

*The corpus is exported as data.* It carries no compatibility promise for its
*shape* — a row may gain fields, as it does here — and is versioned with the
repo. It is not on `NAMESPACE_SURFACE` and is not part of ADR-0003's API
contract.

**4. Parameter encoding is the host's business, and Spacewalk stops encoding.**
`BGZip.compressString` emits URL-safe output, so the `encodeURIComponent` in
`getShareURL` is defensive and unnecessary. All three parameters are written
raw — one convention on one URL, rather than one parameter spelled differently
from its two neighbours for a reason no future reader could reconstruct.
`launchIntent`'s whole-query `decodeURIComponent` **stays**, so links already
shared still read; deleting it is a later change, if ever.

Teaching juicebox's sniff to percent-decode was rejected: it makes the decoder
absorb a host's URL convention, which is the layering decision 1 draws, and it
is ambiguous besides — a payload legitimately containing `%3A` becomes
undecidable. A narrow version (decode only when the raw value starts with
`blob%3A`) is narrower and still permanent.

**5. Spacewalk does not gain the session-URL arm, but stops mangling.** Parity
on that row would cost `sessionURLCodec.js` and `launchIntent.js` the property
their own headers say they exist for — no I/O, no bundler, unit-testable
by value — to support a form no Spacewalk link has ever carried. Instead the
`else` arm tests for a known compressed prefix and throws a named error on
anything else. The row becomes a **stated boundary** rather than a divergence.

Silent mangling was not defensible either way: a user handed a `JSON.parse`
failure about a payload, when the fault is "this app cannot open session URLs."

**6. Already-shared Spacewalk links stay unreadable by juicebox-web.** Decision
4 fixes future links; nothing fixes past ones, because decision 4 refused the
tolerance that would. Under decision 1 they were never portable, and no report
of anyone trying exists. Recorded because it was considered, not because it was
overlooked.

**7. The four session spellings are alternatives, not generations.**
`docs/url.md`'s session row (`:189`) becomes a table of `blob:<BGZip>`,
`data:<BGZip>`, `data:application/gzip;base64,…` and `<URL>`, with **no version
assigned to any of them** and a note that the URL spelling is juicebox-only
(decision 5).

Versioning the prefixes was rejected twice over. It would invent a fact —
nothing establishes which spelling came first, which is decision 2's declined
archaeology — and it would imply the *prefix* carries the version, when
ADR-0006 decision 7 deliberately put it inside the JSON.

## Consequences

- `reject-session-gzip-data-uri` becomes `session-gzip-data-uri` and its
  `outcome` flips `throws` → `decodes`. ADR-0006 requires every deliberate
  snapshot deviation carry an explicit comment; this ADR is that comment. Its
  `provenance: 'harvested'` and `role: 'load-bearing'` are unchanged — the
  second is more true than it was.
- Session fixtures gain a `payload` field: the session string, as distinct from
  `input`, the whole session parameter. The field *is* decision 1's distinction
  made executable, and it is what a consumer that never sees a query string
  consumes.
- juicebox's `exports` map gains one path. A github-installed dependency already
  ships the whole tree, so nothing about distribution changes; the entry makes
  the corpus a deliberate export rather than a file someone reached into
  `node_modules` for.
- The shared rows assert **outcome only** — decodes to this object, or rejects —
  and not error type. Decision 5 makes Spacewalk's rejection behaviour
  contractual; exporting `SessionDecodeError`'s taxonomy into an app with its
  own would be decision 3's dependency arrow in a smaller costume.
- ADR-0006 is not amended. Its reasoning is intact; it answered the question it
  asked, and this ADR answers one it did not know it had left open — that "one
  decoder" meant one *per repo*. Rewriting an accepted ADR to look prescient
  loses the record of when we learned this.
