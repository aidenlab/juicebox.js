# ADR-0012 — A normalization substitution is announced in the widget, never in a modal

**Status:** Accepted
**Date:** 2026-08-25
**Related:** #372 (the 2022 report this settles), ADR-0009 decision 5 (which
deferred the error UX to here), ADR-0003 (public API contract), #425 (the missing
`Alert` import that made the original failure silent), #561, `CONTEXT.md`
(*Substitution*)

## Context

Three places can render with a normalization other than the one asked for:

1. **Restore or `config.normalization`** — `HICBrowser.#resolveNormalization`
   checks the request against the loaded dataset's option set (an *intersection*
   of both files' sets when a control map is loaded, `hicBrowser.js:392`) and
   coerces. Silent, until now.
2. **Mid-render** — `imageTileSource.#effectiveNormalization` finds no vector at
   this chromosome and resolution, and falls back to `NONE` once per render pass.
   This is the case #372 actually reported (KR at 1000BP on chrY); it raised a
   modal.
3. **A hic-straw read error** — `dataLoader.js:101` and `:327`.

Cases 1 and 2 are the same event with different scopes. Case 3 is not the same
event at all: it is a failure.

## Decision

**1. The normalization widget is the surface; the modal is deleted.** A saved
link that opens correctly on `NONE` is not an error, and a modal raised mid-render
says it is. The widget already displays the effective value; what was missing was
the reason. Cases 1 and 2 now share one notification path, fired from
`#resolveNormalization`'s two call sites and from the render pass, and both land
as a visible marker on the selector plus a `title` carrying the reason. A `title`
alone was rejected: invisible on touch, no affordance, and the same silence the
report has been open about since 2022.

**2. The reason is transient and is not an eighth state field.** It rides as an
argument on the notification, is held only by the widget, and is cleared on
chromosome change, zoom change, or a user selection — any of which can make it
false. Canonical state is seven fields (`docs/state-manipulation.md`); a durable
reason would be an eighth by another name. The cost is stated rather than hidden:
after a view change the user sits on `NONE` with no explanation of how they got
there. That is the price of decision 3.

**3. A substitution is sticky.** State is rewritten to name what is drawn, so a
zoom back out to a resolution that *does* carry KR stays on `NONE` until the user
asks for KR again. The alternative — keep the request in state and re-attempt each
pass — reintroduces exactly the lie ADR-0009 removed: state naming something the
view is not drawing.

**4. A read failure keeps its modal.** Case 3 is not a substitution, and giving it
the quiet surface would hide a genuine error. Its separate defect — it updates the
widget to `NONE` without writing state, so the widget and the state disagree — is
filed on its own rather than fixed in passing here.

## Explicit no-s

- **No host-facing callback.** `onNormalizationExternalChange` stays internal and
  absent from `js/publicApi.js`. Publishing it is a contract and no host has asked;
  ADR-0003's "absence is not permission" applies in both directions.
- **Case 2's direct `state.normalization` write stays outside the chokepoint.** It
  is the documented exception at `docs/state-manipulation.md:237`. Routing it
  through `browser.setNormalization` would trigger a repaint from inside a render
  pass, which is a re-entrancy hazard, not a cleanup.
