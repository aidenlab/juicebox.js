# ADR-0002 — Keep `BrowserCoordinator`

**Status:** Accepted
**Last measured:** 2026-08-06
**Related:** issue #467 (the refactor this was written during), #466

## Context

Issue #467 collapsed the pass-through modules around `HICBrowser`. Three modules
looked alike from inside this repo — `BrowserUIManager`, `RenderCoordinator` and
`BrowserCoordinator` — and two of them were deleted:

- `BrowserUIManager` was a stringly-typed `Map` with one real method
  (`getComponent`). It became `createWidgets(browser)`, a function returning a
  plain record.
- `RenderCoordinator`'s body was entirely `this.browser.*`, and `HICBrowser`
  re-exposed all of it as identical passthroughs. It was folded into
  `HICBrowser.update` / `HICBrowser.repaint`.

`BrowserCoordinator` reads the same way — a class whose methods mostly reach back
through `this.browser` — and the next reader applying the same deletion test to it
will conclude it should go too.

**It should not.** The reason is invisible from inside this repo.

## Decision

`BrowserCoordinator` stays, and is now the sole owner of the widget record.

It is **a host extension point, not a third pass-through**. Spacewalk registers
against it:

```js
const unsubscribe = browser.coordinator.addCallback('onMapLoaded', ({dataset}) => { … })
```

`externalCallbacks` — `onMapLoaded`, `onControlMapLoaded`, `onLocusChange`,
`onGenomeChange`, `onBackgroundColorChange`, `onForegroundColorChange` — is the
supported way a host app hooks browser events without reaching into the internals.
juicebox.js is an embeddable component; that surface is the product, and grep in
this repo cannot see its callers because they live in juicebox-web and Spacewalk.

Deleting `BrowserCoordinator` therefore does not move complexity out of the
library, it moves a break into the host apps.

Two consequences of that, both deliberate:

- The `onX(…)` methods are the **one** internal calling convention. The 14
  `notify*` one-liners on `HICBrowser` that forwarded to them are gone; internal
  callers name `browser.coordinator.onX(…)` directly. Before #467 both
  conventions were live at once (`annotationWidget.js` used one,
  `hicColorScaleWidget.js` the other).
- The coordinator is constructed **before** the widgets, because the
  `ImageTileSource` observer closures in `createWidgets` notify it directly. The
  widget record is handed over afterwards via `adoptWidgets()`.

## Consequences

- `browser.coordinator` is public API. Renaming a method on it, or removing an
  entry from `externalCallbacks`, is a breaking change for the host apps and
  needs a coordinated release — see the release ceremony.
- The coordinator's per-widget `if (this.widgets.X)` guards are now always true
  (the record is fully populated). They are kept as-is; tightening them is not
  worth a behaviour risk in a pure-subtraction change.
- The methods that merely fan out to `externalCallbacks` (`onGenomeChange`,
  `onBackgroundColorChange`, `onForegroundColorChange`) look dead to a
  repo-local reader. They are not.

## Reversal

Only if the host apps stop registering callbacks against `browser.coordinator`.
Verify against juicebox-web and Spacewalk before concluding that — not against
this repo.
