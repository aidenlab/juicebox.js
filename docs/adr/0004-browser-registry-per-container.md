# ADR-0004 — One browser registry per host container

**Status:** Accepted
**Date:** 2026-08-07
**Related:** #384 (multiple instances on one page), #475 (`deleteBrowser` leaves
`currentBrowser` dangling), ADR-0003 (public API), candidate 4 and candidate 8 in
`docs/architecture-review.html`

## Context

The set of live browsers is a module-level `let` in `js/createBrowser.js:14`,
scoped to the **page** rather than to the embed. Four consequences follow:

- A host calling `hic.init()` on a second container has its first browser's DOM
  removed, because `restoreSession` opens with `deleteAllBrowsers()`. This is
  #384, open since 2023 and previously undiagnosed.
- `syncBrowsers()` cross-joins every browser on the page regardless of container,
  so unrelated embeds silently pan each other.
- `deleteBrowser` never clears `currentBrowser`, so `getCurrentBrowser()` — an
  exported name — can hand a host a browser that is no longer on the page (#475).
- No test constructs a browser, because test N leaks into test N+1.

The constraint that shapes everything below: **both known consumers depend on the
current surface.** juicebox-web uses every registry export — `getCurrentBrowser`
(10 sites), `getAllBrowsers`, `setCurrentBrowser`, `createBrowser`, `init` — and
Spacewalk uses `getCurrentBrowser`. Neither calls `init()` more than once. So the
multi-container case has **no known consumer**; it is the third-party embedder who
filed #384. A fix that breaks the two hosts we can measure in order to serve the
one we cannot is a bad trade.

## Decision

**A `BrowserRegistry` owns one embed, keyed by its container element, introduced
additively.**

1. **`BrowserRegistry`, not `BrowserSession`.** The architecture review's diagram
   called it a session. In this codebase a *session* is already serialized
   configuration — `toJSON`, `restoreSession`, `compressedSession`. Reusing the
   word would make `restoreSession` permanently ambiguous. See `CONTEXT.md`.

2. **Scoped to the container element, not to the `init()` call.** A second
   `init()` on the *same* element finds the existing registry and replaces its
   contents, preserving today's semantics exactly. A different element gets a
   different registry, which is #384.

3. **Acquired through a new `initRegistry(container, config)`.** `init()` becomes
   a thin wrapper — `const r = await initRegistry(...); return r.browsers.length
   === 1 ? r.browsers[0] : r.browsers` — so its return type is untouched and both
   hosts see zero change.

4. **The four module-level functions stay and delegate.** Three need no default:
   `createBrowser(container, …)` resolves its registry from the container,
   `setCurrentBrowser(browser)` from `browser.registry`. Only the zero-arg getters
   need a policy: `getCurrentBrowser()` is the most recently selected browser
   page-wide — byte-for-byte today's semantics, since module `currentBrowser` is
   already just "whoever `setCurrentBrowser` last received" — and
   `getAllBrowsers()` returns the browsers of that browser's registry. Both are
   documented as single-embed conveniences.

5. **Sessions are per embed.** `registry.toJSON()` and
   `registry.restoreSession(config)` are the real methods; the module-level
   functions delegate. This is what actually stops the second `init()` ripping out
   the first's DOM.

6. **Sync groups are registry-scoped, with no cross-registry opt-in.** The pairing
   rule comes out as a pure `pairSynchable(browsers)` over a list, so a
   cross-registry group is later one call over a concatenated array. Designing the
   opt-in now would be an API for a use case nobody has asked for.

7. **Deleting the current browser falls selection through** to another browser in
   the registry, `undefined` only when it is empty. This closes #475 and keeps the
   invariant "a non-empty registry has a current browser." The alternative —
   posting `BrowserSelect` with `undefined` — widens that event's payload contract
   for a case juicebox-web has never had to handle.

8. **Registries are found via a module-level `WeakMap<Element, BrowserRegistry>`,**
   not a property stamped on the container. The host owns that element.

9. **`browser.registry` is a new published member.** Decision 4 requires it, and
   per ADR-0003's "absence is not permission" it becomes contract the moment it
   ships — so it is declared in `js/publicApi.js` deliberately rather than
   becoming surface by accident.

### Scope — what this deliberately does not do

`Globals.selectedGene` and the `Alert` singleton move onto the registry; both are
already per-`init()` in spirit, and `selectedGene` is serialized per session, so
page scope is plainly wrong.

`inProgressCache` (`contactMatrixView.js:723`) stays page-scoped. It is keyed by
URL, and sharing it across embeds is a benefit rather than a leak.

The `--hic-viewport-*` CSS custom properties written to `document.documentElement`
(`layoutController.js:246`) stay page-scoped and are **filed as their own issue**.
Two embeds still cannot have different viewport sizes. Fixing that is a rendering
change, not a lifecycle change, and folding it in here would couple two unrelated
refactors.

> **Resolved by #477.** `--hic-viewport-width/height` are now written to each
> browser's `rootElement`. Two things that ADR was wrong about, both found by
> reading the code rather than the issue: the scope unit is the **browser**, not
> the container this ADR keys registries by — juicebox-web clones a second
> browser into the container it was given, so container scoping would have left
> last-writer-wins in place inside one embed — and no stylesheet rewrite was
> needed, since `.hic-root` is the only rule reading them and custom properties
> inherit. `--hic-viewport-spinner-size` shares the prefix but is a constant no
> code writes, and stays in `:root`.

Teardown lands separately as candidate 8. The registry calls today's
`deleteBrowser` body; `dispose()` later replaces that body behind the same call
site. Blocking this on candidate 8 would couple it to an unresolved contract
question in juicebox-web (`browser.reset()` followed by `loadHicFile` on the same
instance).

## Considered and rejected

**`init()` returns the registry.** The obvious shape, and the one that will be
proposed again. It changes what `init` resolves to — today a browser or a list of
them — and both hosts depend on that. Making the registry array-like *and*
browser-like to compensate is a compatibility shim we would carry forever. Doing
it cleanly instead makes this a major version rather than a refactor.

**Scoping a registry to the `init()` call rather than the element.** Invents a
state today's code cannot reach: two registries fighting over one container's DOM.

**Deleting the module-level functions.** Ten of the twelve `js/index.js` exports
are live in a shipped host (ADR-0003). Removing them is a coordinated multi-repo
release, not a refactor.

## Consequences

- Two embeds coexist except for viewport sizing, which remains page-wide.
- The registry's interface becomes the test surface. Browsers become constructible
  in a test for the first time, because test N no longer leaks into test N+1.
- `getCurrentBrowser()` acquires a policy — "most recently selected page-wide" —
  that is invisible and correct in the single-embed case and needs reading in the
  multi-embed one. This is the price of keeping the function.
- The riskiest step is keying registries by container while the module functions
  keep delegating: a mistake there silently changes what juicebox-web's
  `getAllBrowsers()` returns, with nothing failing. Smoke-test that step against a
  real juicebox-web checkout before building on it.

## Addendum — what shipped, 8 August 2026

Implemented as #476, #478–#483 (`78a5d0b..9fde9a2`). #384 and #475 closed with it.

**Decision 4 did not ship as written.** It said the module-level functions would
delegate to a *default registry*. There is no default registry. `createBrowser`
resolves from its container argument and `setCurrentBrowser` from a new
`browser.registry` back-pointer; only the two zero-argument getters needed the
"most recently selected page-wide" policy. The decision text above is left as
written — this addendum is the correction, and #486 records the difference.

**One acceptance criterion was never met.** #479's runtime click-through against a
running juicebox-web was verified statically only: 13 call sites read, all
resolving one registry, no headless browser available. That is this ADR's one
unverified claim; it is carried on #466's pre-release checklist.

**#477 remains open**, so "the registry has an owner" does not yet mean
"multi-embed works" — two embeds coexist but still cannot have different viewport
sizes.
