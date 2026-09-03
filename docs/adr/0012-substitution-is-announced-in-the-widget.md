# ADR-0012 — A normalization substitution is announced in the widget, never in a modal

**Status:** Accepted
**Date:** 2026-08-25
**Related:** #372 (the 2022 report this settles), ADR-0009 decision 5 (which
deferred the error UX to here), ADR-0003 (public API contract), #425 (the missing
`Alert` import that made the original failure silent), #561, #600 (case 3's
missing state write, restated under decision 4), `CONTEXT.md` (*Substitution*)

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
3. **hic-straw's own `alert` hook** — injected at `dataLoader.js:101` and `:327`.

Cases 1 and 2 are the same event with different scopes. Case 3 was recorded here
as a read failure, and that was **wrong** — see the correction below.

## Decision

**1. The normalization widget is the surface; the modal is deleted.** A saved
link that opens correctly on `NONE` is not an error, and a modal raised mid-render
says it is. The widget already displays the effective value; what was missing was
the reason. Cases 1 and 2 now share one notification path, fired from
`#resolveNormalization`'s two call sites and from the render pass, and both land
as a visible marker on the selector. A `title` alone was rejected: invisible on
touch, no affordance, and the same silence the report has been open about since
2022 — and hand-testing showed a marker plus a title is barely better, because an
18px-or-smaller glyph whose only answer is a one-second hover delay still leaves
the user with no idea what it is for. So the marker is a **click target**: it
carries the reason in its own `title`, and clicking it opens a small non-modal
note that states the reason as text on the page. The note is not a dialog — it
explains without interrupting, which is the whole distinction this ADR draws.

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

**4. Case 3 is a substitution too, and its modal is deleted.** This decision
originally read "a read failure keeps its modal", on the premise that hic-straw's
injected `alert` was an error channel. Hand-testing #372 showed it is not. That
callback has exactly **one** caller in the library — `hicFile.getNormalizationVector`,
when `isNormalizationValueAvailableAtResolution` says no (`hic-straw/src/hicFile.js:594`)
— and it raises the sentence *"Normalization option SCALE not available at
resolution 10000. Will use NONE."* That is case 2, arriving through the file
reader instead of through the render pass. Genuine hic-straw read errors throw;
they never reach this hook. So it announces in the widget like the others, via
`dataLoader.#announceStrawSubstitution`, and there is no `onNormalizationReadFailure`.

This also undermines **#600**, which was filed against the same mistaken premise
("case C calls `onNormalizationExternalChange('NONE')` but never writes state").
The path is a substitution, not a failure, so the question that issue asks needs
restating before it can be answered.

Restated, and answered: #600 observed a real divergence — the widget said `NONE`
while state still said `KR` — and, believing the path to be a failure, proposed
deleting the widget update. Under this decision the remedy is the other one.
Case 3 keeps its announcement and gains the state write decision 3 requires of
every substitution, so it is sticky like the other two and the next render pass
stops re-asking for a vector the file has already refused.

**5. Which of the first two reasons applies is asked of the primary file.** With a
control map loaded the offered set is an intersection, and a normalization missing
from an intersection is missing for one of two causes with different remedies: the
primary file never carried it, or the primary file carries it and the control map
does not. Only the second is fixed by unloading the control map. Selecting on the
control map's mere *presence* would tell half of those users to perform a remedy
that cannot work, which is worse than the silence this ADR is replacing.

## Explicit no-s

- **No host-facing callback.** The notification hook — `onNormalizationExternalChange`
  before this change, `onNormalizationSubstituted` after it, the rename being free
  precisely because it is not published — stays internal and absent from
  `js/publicApi.js`. Publishing it is a contract and no host has asked;
  ADR-0003's "absence is not permission" applies in both directions.
- **Case 2's detection was dead code.** `imageTileSource.#effectiveNormalization`
  called the async `Dataset.hasNormalizationVector` without awaiting it, so the
  check tested a Promise — always truthy — and the substitution branch was
  unreachable. The modal users actually saw was always hic-straw's. Fixing the
  `await` is what makes decision 1 observable at all; the unit fixture missed it
  because its dataset double was synchronous where the real one is not.

- **Cases 2 and 3 write `state.normalization` outside the chokepoint.** It is the
  documented exception at `docs/state-manipulation.md:237`. Routing either through
  `browser.setNormalization` would trigger a repaint from inside a render pass —
  case 3's hook fires from inside a tile fetch — which is a re-entrancy hazard,
  not a cleanup.
