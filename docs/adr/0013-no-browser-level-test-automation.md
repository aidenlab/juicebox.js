# ADR-0013 — Browser-level test automation is declined; the seam is covered from node

**Status:** Accepted
**Date:** 2026-08-25
**Related:** #438 (the proposal this declines), #432/#436/#437 (the findings that
motivated it), `test/utils/browserFixture.js`, `test/utils/gestureBrowser.js`,
`test/testCoordinatorDelivery.js`, `docs/juicebox-punch-list.md`

## Context

#438 proposed giving a throwaway puppeteer harness a permanent home in the repo.
The harness had been built to dismiss #432, and it worked: a probe page exposing
`window.jbBrowser`, a driver that settled after each action and asserted against
the live object graph, and a `--sabotage` flag that severed
`coordinator.onColorScale` so every check went red on demand. It found two real
dead-code defects (#436, #437) in the process.

Its argument was structural, not incidental: the vitest suite is
`environment: 'node'`, so it could cover `ImageTileCore`, state, session and
colour scales, but **not** the wiring between them — coordinator notifications,
widget updates, event subscriptions with no publishers. Only a real browser could
see that seam.

That argument no longer holds, and the reason is worth recording, because the
harness is a good idea that keeps re-suggesting itself.

## Decision

**1. No browser-driver tier.** No puppeteer, no playwright, no `test/e2e/`. The
suite stays single-tier: vitest under `environment: 'node'`, `include:
['test/**/*.js']`.

**2. The seam is reached from node instead, by standing up a real browser
object.** `test/utils/browserFixture.js` installs a JSDOM window over the globals
for the duration of a test, stubs the 2D context with an inert Proxy, and
constructs an actual `HICBrowser` — real coordinator, real widgets, real
subscriptions. `test/utils/gestureBrowser.js` does the same for gesture paths.
`test/testCoordinatorDelivery.js` then pins exactly what #438 said was
unreachable: each notification reaches its collaborator, and reaches it **once**.
The dead subscriptions #436 removed were characterized there first.

The premise decayed measurably. When #438 was filed the suite was a handful of
files about pure pieces; it is now 57, most of them about wiring.

**3. Rendering, gestures and dataset loading stay hand-verified through `dev/`.**
This is the status quo made explicit rather than a new policy. The convention
that emerged on its own — a per-issue `dev/issue-NNN-*.html` page for the eyeball
check, paired with a node fixture test that pins the finding — is the documented
one. See `dev/issue-477-per-browser-viewport-size.html` and the
`bug-daphne-qin-*.html` pages.

## Considered options

**Rebuild #438 as filed.** Rejected. Its closing offer — "I have the working
harness" — expired: the harness lived in a session scratchpad and is gone, with
no trace of `jbBrowser`, puppeteer or `--sabotage` anywhere in the repo. A yes
would have been a build-from-scratch bought on the strength of an argument that
had since been answered another way.

**Rescope to the narrow residue.** JSDOM genuinely cannot reach three things: real
pixels (the 2D context is a no-op), real `.hic` decode over the network, and real
async settle timing. A pixel oracle for those is a coherent and much smaller
project than #438 describes. Rejected **for now**, on evidence rather than
principle: in the 3.5 weeks after #438 was filed, 23 bugs were found and fixed —
including geometry (#477) and pinch-gesture (#589) defects, the two classes most
likely to need a real browser — and none of them needed one. Reopen this if a
defect actually escapes that way; the residue, not the original scope, is the
thing to build.

## Consequences

- **The `--sabotage` convention is worth keeping even without the harness.** Its
  point generalizes: a green test that cannot be made to go red is worse than no
  test. It applies to the node fixtures unchanged.
- **This constrains CI, which does not exist.** There is no `.github/` in this
  repo. If CI is ever added, the suite is `npm run test:run` and needs no browser,
  no Chrome cache discovery, and no network fixture — which is a real benefit of
  this decision, not a coincidence of it.
- **The network-fixture question #438 raised dissolves.** It only mattered because
  the harness loaded a real map. Fixture reachability remains a live concern for
  the hand-run `dev/` pages, where it is documented in
  `dev/generic-test-harness.html` and ADR-0001.
