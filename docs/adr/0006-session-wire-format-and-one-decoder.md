# ADR-0006 — The session wire format is the contract; one decoder reads it

**Status:** Accepted
**Date:** 2026-08-08
**Related:** candidates 5 and 9 in `docs/architecture-review.html`, ADR-0003
(public API contract — whose tables do *not* measure the population this ADR
protects), ADR-0004 (registry owns `toJSON`/`restoreSession`), #466 (release
gate), #481 (`selectedGene` reconciliation), `docs/url.md`

## Context

Candidate 5 proposes collapsing eight encodings, three state decoders and four
config decoders behind one `decodeSession` interface. The card frames this as
internal duplication. **It is not primarily that.** Six facts, established by
reading the checkout at `93bdb2d`, reframe the work:

1. **`State.stringify()` has zero callers in all three repos.** The only URL
   juicebox writes today is juicebox-web's share link,
   `` `${base}?${hic.compressedSession()}` `` (`initializationHelper.js:586`) —
   that is, `?session=blob:<compressed JSON>`. Every other format the decoder
   accepts — `hicUrl=&state=&tracks=`, `juicebox={…},{…}`, `juiceboxData=`,
   `juiceboxURL=` — is **read-only legacy inbound**. The card's "no encoder at
   all for 4 formats" is true, and describes formats we deliberately stopped
   writing rather than a gap to fill.

2. **`extractConfig` is not public.** One caller, `init.js:50`, gated on
   `config.queryParametersSupported !== false`; it is not exported from
   `js/index.js`. The public contract here is the **wire format**, not any
   function signature. This is the sense in which candidate 5 is "breaking" —
   and ADR-0003's method tables cannot see it at all.

3. **`docs/url.md` is wrong in three ways, not the two the card names.** The
   card has `track` vs `tracks` (`urlUtils.js:184`) and 3-token vs 4-token track
   strings. It misses that url.md documents a **7-token state** while
   `State.stringify()` emits **9** (`chr1,chr2,zoom,x,y,0,0,pixelSize,norm`).
   `State.parse` (`hicState.js:443`) has a `<=7` branch and a `>7` branch and
   both are live. Nothing in this repo has ever written the 9-token form.

4. **`chr1 ≤ chr2` is enforced at construction and not at mutation.** The `State`
   constructor (`hicState.js:55-68`) transposes `chr1↔chr2` *and* `x↔y` when
   `chr1 > chr2`. `setView` — the declared chokepoint — assigns them raw
   (`:183-187`). `setChromosomesView:319-320` normalizes with `Math.min`/`Math.max`;
   **`updateWithLoci:294-300` does not.** So `goto()` with a y-axis chromosome of
   lower index than the x-axis leaves a live state the constructor would have
   rejected, `toJSON` writes it faithfully, and `fromJSON` transposes it on the
   way back. **Save → restore is not the identity**, and the round-trip property
   test candidate 5 wants would fail on day one.

5. **`browser.toJSON()` returns the string `"{}"`** when a browser has no dataset
   (`hicBrowser.js:1057`), and `registry.toJSON()` maps over browsers
   unconditionally with no filter. Saving a session while any browser is empty
   produces a session that cannot be reloaded.

6. **Shortcut expansion already runs twice** — `decodeQuery:241,250,307` on the
   URL path, and `expandSessionUrlShortcuts` again at
   `browserRegistry.restoreSession:313`. The second copy exists *because*
   sessions handed straight to `restoreSession` bypass the decoder entirely. It
   is evidence that decode and normalize are two stages that have never been
   named as such.

The population this ADR protects is **users**, not the two host apps: session
URLs get pasted into mail and papers and must still decode years later. That is
why the decision below is about a format, and only secondarily about modules.

## Decision

**1. The compatibility contract is the decoder's currently-accepted set, frozen,
with a named exception list.** Not "every string any Juicebox ever emitted" —
that is unfalsifiable, since the Java desktop app's output cannot be enumerated
from here. Not "only what we write today" — the whole risk is the inbound
population we cannot see. What the current decoder accepts becomes the spec,
captured as fixtures, and anything intentionally dropped is named here.

*Exception list — dropped deliberately:* `juiceboxURL=` (legacy bit.ly). This ADR
originally justified the drop by asserting that the mojibake bearer token at
`urlUtils.js:405` would draw a 401; **measured 2026-08-09 (#502), it does not** —
`v4/expand` accepts it for a public link and the session decodes in full. See the
consequence below. The drop stands on the remaining grounds: nothing writes the
format, it cannot be tested without the network, and its
single-brace-repair bug (`:417`, `replace("{", "%7B")` with a string pattern,
which repairs only the first pair and so mangles any multi-browser link from
browser 2 on) becomes moot rather than fixed.

**2. `docs/url.md` describes format v0; the code accepts v0 and v1; both are
documented.** v0 is the 7-token state and 3-token track string. v1 is the
9-token state, the 4-token track string, and the session JSON. Neither is
"wrong" — the two branches in `State.parse` become *intentional* rather than
accidental, which is precisely what the collapse must preserve. url.md's `track`
(singular) is a plain documentation typo, not a v0 parameter name: no code path
has ever read `track`.

**3. `chr1 ≤ chr2` is an invariant of `State`, enforced in `setView`.** A `.hic`
file stores one triangle of a symmetric matrix; `(chr5, chr2)` and `(chr2, chr5)`
are the same view, and a second spelling of a view that already has one is
exactly what makes a round-trip test unwritable. `setView` receives
`chr1, chr2, x, y` together and swaps all four atomically. `updateWithLoci` is
fixed to swap `x` with `y` when it swaps the chromosomes. The constructor's
transposition stays as belt-and-braces; `setChromosomesView`'s `Math.min`/
`Math.max` becomes redundant and is deleted **in a later commit**, once the
`setView` change is proven.

The rejected alternative — delete the constructor's transposition, let `State`
record whatever it is handed, and decode becomes trivially the identity — is
worse: a state could then name a triangle the file does not store, moving the
bug out of restore and into the render path.

*This is non-breaking for the archive.* The constructor already transposes today,
so sessions in the wild carrying `chr1 > chr2` decode exactly as they do now —
to the transposed view, same contacts, axes flipped about the diagonal. The fix
only stops *new* sessions being written in the unordered spelling.

**4. One encoder, for the session-JSON form only.** `encodeSession` is the
inverse of `decodeSession` for the format we actually emit, and
`decode(encode(x)) === x` becomes a property test. Legacy formats get
**decode-only** fixtures. Writing encoders for all four would resurrect
`State.stringify` as a live encoder for a format nothing has written in years,
and we would then own it forever.

**5. `State.stringify()` is deleted — after url.md carries the 9-token layout,
never before.** It is currently the only executable description of v1's state
encoding. Moving it into a fixture generator was considered and rejected as
circular: a fixture written by our encoder proves our decoder agrees with our
encoder, not that either matches what is in the wild.

**6. `browser.toJSON()` returns `null` for a browser with no dataset, and
`registry.toJSON()` filters those out.** Returning `{}` fixes the crash but saves
a browser naming no map, which restore then rebuilds as an empty panel —
round-tripping "nothing" as a browser is not an identity worth having. Throwing
is hostile: an empty panel is a normal transient state while a user is adding a
map. **Accepted asymmetry:** browser *count* does not survive the round trip when
one is empty.

**7. The session JSON gains a `version` field on write; its absence means v1 on
read, and it is never required.** It buys nothing now — its entire value is to
whoever does this again in 2029, who otherwise re-runs this candidate to add a
discriminator.

**8. Decode and normalize are two stages. This ADR draws the seam; candidate 9
moves the code across it.** Normalization currently lives inside the decoder:
`fixDefaults` (`urlUtils.js:197`) and the `selectedGene` reconciliation
(`:174-191`, #481). Both belong behind a `normalizeSession` stage that *both*
entry paths pass through — the URL path and the direct-`restoreSession` path.
Once they do, one of the two shortcut-expansion copies (fact 6) is deletable.
**That deletion is candidate 9's, not candidate 5's.** Shipping both at once
doubles the blast radius on `hic.init`, the most-used public surface.

**9. New module `js/sessionCodec.js`; nothing is added to `publicApi.js`.**
`urlUtils.js` is three unrelated jobs under a name describing one. `sniffFormat`
and `decodeState` become pure functions testable with string literals.
`extractConfig` stays internal — adding a decoder function to the public surface
would create a second, weaker contract we would then owe compatibility to.

**10. `decodeSession` takes an injected loader rather than doing its own I/O.**
The two I/O sites are `igvxhr.loadString` (`urlUtils.js:108`) and `expandURL`'s
bitly fetch (`:129`, moot per decision 1). Hoisting the fetching into `init.js`
was rejected: the caller would have to know the format to know whether more I/O
is needed, putting format knowledge back on the wrong side of the seam. An
injected loader makes the whole decode path drivable from a test with a fake
loader and string literals — which is the point of the candidate.

## How we know the decoder did not change

**A golden-file characterization test, and it is the first ticket in the
candidate — it lands before one line of decoder code moves.** Every fixture is
run through today's `extractConfig`, the decoded output is snapshotted verbatim,
and the refactor passes when the snapshots are byte-identical.

Hand-written assertions were rejected: they re-encode one reader's understanding
of the code, and would bless misreadings as spec. A snapshot is indifferent to
whether anyone understood it.

The fixture corpus is **harvested first, then synthesized to fill gaps**.
Harvested URLs — from `git log`, `dev/*.html`, juicebox-web, published docs, and
papers citing Juicebox links — are evidence about the real inbound population,
the thing ADR-0003 does not measure. Synthesized one-per-branch literals cover
what harvesting misses. Harvested fixtures are marked load-bearing; synthesized
ones are marked branch coverage.

Two things to accept going in: the snapshots capture **bugs as well as
behaviour**, so every deliberate deviation needs an explicit, commented snapshot
update; and decision 3's `setView` fix will legitimately move some snapshots,
which is why **it lands before the snapshot is taken**, not after.

## Sequencing

Three fixes precede the refactor, because the refactor's acceptance test cannot
be written until they are in:

1. `setView` enforces `chr1 ≤ chr2`; `updateWithLoci` swaps `x`/`y` (decision 3).
   *This is a live bug today, independent of sessions:* any `goto` where the
   y-axis chromosome index is below the x-axis's renders one way and reloads
   another.
2. `browser.toJSON()` returns `null`; `registry.toJSON()` filters (decision 6).
   The property test cannot be written against an encoder that emits a string.
3. url.md documents v0 and v1 (decision 2), then `State.stringify()` is deleted
   (decision 5).

Then: harvest fixtures → snapshot → collapse the decoders → `encodeSession` and
the round-trip property test. Candidate 9 follows with the normalize stage.

## Consequences

- **`State.default()`'s dropped argument (`hicState.js:500`) is filed
  separately and not fixed here.** `new State(0, 0, 0, 0, 1, "NONE")` against a
  seven-parameter constructor shifts everything right of `y`, so every default
  view opens one bin below the origin. It is in the blast radius but is not a
  prerequisite — the standing rule is file-and-keep-refactoring, and this one
  does not block the property test the way decisions 3 and 6 do.
- Legacy `juiceboxURL=` links stop working. This ADR assumed they already did.
  **They do not.** Harvesting the fixture corpus (#502) ran
  `?juiceboxURL=http://bit.ly/2C1VSHy` through the decoder on 2026-08-09: bit.ly
  expanded it and the two-browser session decoded in full. The mojibake bearer
  token at `urlUtils.js:405` is accepted by `v4/expand` for a public link. The
  decision stands — a format we cannot write, cannot test without the network,
  and whose brace repair is broken from browser 2 on is still the right one to
  drop — but #506 is removing live behaviour, not tidying a dead path, and the
  corpus carries the fixture that says so.
- Sessions saved with an empty browser will restore with one fewer panel rather
  than failing to restore at all.
- `docs/url.md` becomes a **versioned format specification** and acquires the
  maintenance obligation that implies. It has already drifted once; decision 5
  removes the executable copy that was keeping v1 honest, so the spec is now the
  only record.
