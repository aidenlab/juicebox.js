# ADR-0008 — `figureMode` absorbs `miniMode`, and a mini map is a figure

**Status:** Accepted
**Date:** 2026-08-11
**Related:** candidate 9 in `docs/architecture-review.html`, ADR-0006 decision 8
(decode and normalize are two stages), ADR-0003 (public API contract — the
surface this changes), #466, #531 (the golden gate that exposed it), #536 (the
ticket that closed it)

## Context

Candidate 9's premise is that one reader decides what a config means. #536 took
the last inline defaults out of the readers below the entry seam. Three of them
were mechanical — a default is a default wherever it is applied, and moving it up
changes nothing but where it is written.

The fourth was not. Two config fields spelled the same idea and **two different
readers disagreed about it**:

- `HICBrowser` read `this.figureMode = config.figureMode || config.miniMode`,
  with the comment "Mini mode for backward compatibility".
- `normalizeSession.setWidgetVisibilityDefaults` keyed on `config.figureMode ===
  true` only, and turns off the locus box, the map label and the chromosome
  selector when it fires.

So a config saying `miniMode: true` produced a browser that called itself a
figure (`browser.figureMode === true`) and *kept all three chrome elements*,
because the stage that decides chrome never heard of `miniMode`. Every entry
path agreed with every other, and none agreed with itself. #531 pinned it as the
fixture `mini-mode-the-legacy-spelling-of-figure-mode`, whose note has said since
it was written that #536 is where the schema would say which spelling wins.

This is the only *decision* candidate 9 raised. ADR-0006 decision 8 draws the
decode/normalize seam and says one stage decides; it does not say what the stage
should decide here. The candidate was scoped as possibly needing no ADR of its
own, and this is the exception.

Neither spelling has a written definition anywhere. `docs/url.md` does not
document `miniMode`, no wire format encodes it, and nothing juicebox writes
emits it — it can only arrive in a config a host passes in code.

## Decision

**`figureMode` wins, by absorbing `miniMode`.** `normalizeSession.resolveFigureMode`
writes `miniMode` into `figureMode` when a config names the old spelling and not
the new one; everything below the seam reads `figureMode` alone.

**A mini map is a figure**: the three display flags now go off for a config that
says `miniMode`, which they did not before. That is the behaviour change, and it
is chosen rather than tolerated. The two readings were "`miniMode` means chrome
off" and "`miniMode` means a browser that thinks it is a figure but is drawn like
an ordinary embed"; the second is not a feature anyone specified, it is the shape
of a rule that was only half applied.

`miniMode` is **not** deleted, and not rejected — it stays on the config,
carried through unread, like any member juicebox does not know. The normalize
stage defaults and coerces; it never rejects (#466).

The guard is `if (!config.figureMode && config.miniMode)`, not `||=`: a config
naming neither gains no `figureMode` member. Truthiness rather than `=== true`,
because truthiness is what `HICBrowser` applied.

## Considered and rejected

- **Teach `setWidgetVisibilityDefaults` about `miniMode` as well.** Same
  behaviour, two fields to read forever, and every future reader has to know both
  spellings. The point of the candidate is one reader; this leaves the schema
  with a synonym in it.
- **`miniMode` wins — keep the chrome on and stop treating it as a figure.**
  This is the other way to make the readers agree, and it is a *worse* answer for
  the same reason it is a tempting one: it makes `browser.figureMode` false for a
  config that asked for a mini map, which no host asked for either. It also
  preserves the field's ambiguity rather than resolving it.
- **Delete `miniMode`.** It is a public-surface break, and it is exactly what
  "normalize never rejects" forbids. A config that works today must keep working.
- **Leave the disagreement and file it.** The frontier ticket for the candidate
  is #536; deferring the one open decision past the last ticket is how a
  divergence survives a refactor that existed to close it.

## Consequences

- **A host passing `miniMode: true` loses the locus box, the map label and the
  chromosome selector**, and gets what `figureMode` has always given. Neither
  known host app names `miniMode`: it appears nowhere in juicebox-web's or
  Spacewalk's source (measured 2026-08-11, the sibling checkouts). The population
  this can reach is third-party embeds and hand-written configs, which is the
  same population ADR-0003's tables cannot see.
- A host that wants the old behaviour has a spelling for it and always did:
  `miniMode: true` plus the three flags set explicitly, or simply not asking for
  a mini map. The three flags are honoured on their own — only a literal
  `figureMode === true` overrides them.
- `test/testConfigGolden.js` moves in one fixture across all four doors, logged
  in that file's authorised-movements table. It is the only *behavioural*
  movement in #536; the rest of that ticket's snapshot diff is fields appearing
  in the resolved config because a default moved up into it.
- The resolved-config schema in `CONTEXT.md` records the rule, and this ADR is
  what it points at for the reasoning.
