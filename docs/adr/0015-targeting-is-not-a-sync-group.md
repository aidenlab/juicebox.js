# ADR-0015 — Targeting is not a sync group: dataset choices fan out by an explicit aim

**Status:** Accepted
**Date:** 2026-09-05
**Amended:** 2026-09-18 — contact maps are no longer out of scope, so decision
1's *cargo* row now reads "dataset choices (tracks and contact maps)"; see the
amendment under *Consequences* and ADR-0018. No decision here is reversed — a
consequence is.
**Related:** #615 (the feature), #588 (unbounded, serial track loads — whose
blast radius this multiplies), ADR-0014 (what crosses a sync group, and the
sentence this is the other half of), ADR-0004 (browser registry per container,
decision 6 — a membership rule kept out of the registry), ADR-0013 (test tier),
`CONTEXT.md` (*Target set*, *Sync group*), `js/targetGroup.js`,
`js/syncGroup.js`

## Context

A collaborator loads the same track into three or four panels by hand, one panel
at a time, and asked for one gesture that does it once.

juicebox.js already has a mechanism for "one action reaching several browsers":
the sync group. It would have been the obvious place to put this, and putting it
there would have been wrong. ADR-0014 settled what crosses a sync group —
canonical state always, view preferences by deliberate exception, **dataset
choices never** — and tracks are squarely a dataset choice. Widening the sync
payload to carry them would have re-opened, one widget at a time, exactly the
argument ADR-0014 exists to close.

So this is the other half of ADR-0014's sentence. Dataset choices *do* propagate;
they propagate by a different mechanism, with different membership, and the risk
worth recording is that a future reader finds two mechanisms for the same-sounding
thing and no note saying why there are two.

## Decision

**1. A target set is a second, distinct mechanism, and the distinction is the
design.**

| | sync group | target set |
| --- | --- | --- |
| membership | a computed rule (compatible dataset, not opted out) | an explicit user gesture |
| cargo | canonical state, plus view preferences | dataset choices (tracks) |
| lifetime | standing | until re-aimed |

A sync group answers *whose view follows mine*. A target set answers *where does
this load land*. Neither implies the other: two panels can sync without being
aimed at together, and two panels can be aimed at together while one of them has
opted out of syncing.

**2. One file per mechanism.** `js/targetGroup.js` sits beside `js/syncGroup.js`,
holding the skip predicate and the fan-out as pure functions over browsers — no
registry, no DOM, unit-testable exactly as `pairSynchable` and
`canResolveSyncState` are. The distinction is then visible in the file tree and
not only in this document.

**3. The current browser is targeted implicitly.** `registry.targetedBrowsers` is
a getter computing `{currentBrowser} ∪ explicit` over the registry's `browsers`,
so it cannot drift out of sync with them and a deleted browser cannot linger in
it. With nothing explicitly aimed at, the set is `[currentBrowser]` and every
load behaves exactly as it does today. That is what makes the feature opt-in at
the *gesture* rather than at the call site.

The current browser **is** also recorded in the explicit set while an aim is in
progress, even though it would be resolved into the set anyway. That redundancy is
load-bearing: an empty explicit set is how the gesture knows the next shift-click
starts a *new* aim rather than adding to one — see decision 4a.

**4. Shift-click aims; plain click re-aims.** Shift-click on a panel's **navbar**
toggles that browser in or out; a plain click clears the set and makes that panel
current, which is the only way back from a large aim. The navbar and not the whole
panel, because a shift over the contact map already means crosshairs.

The clear lives in the gesture (`registry.retarget`) and deliberately not inside
`select()`, even though every plain click ends there: `select` is also how a new
browser becomes current, how a deleted browser's selection falls through to a
survivor, and how a restore settles — and none of those is the user re-aiming.
Folding the clear into `select` would mean that adding a panel silently destroys
the aim, which decision 6 says it must not.

**4a. The first shift-click of a new aim also selects.** This was decided the
other way first — targeting and selection are different questions, so a gesture
named for one should not move the other — and testing the harness showed why that
is wrong.

The fan-out is issued from the current browser, and decision 5 makes the current
browser the *track's genome declaration*. So an aim inherits its genome from
whichever panel happened to be current, which is the last one built. Shift-click
two hg38 panels while an mm10 panel is current and the two panels the user chose
are reported `genome-mismatch` while the track lands in the one panel they never
touched. Every symptom points at targeting being broken; nothing is, except the
question of where the aim is measured from.

Selecting on the first click makes the browser an aim *starts from* the browser it
is *measured against*, which is the only pair a user can see. Later clicks in the
same aim do not move the selection, so the origin stays where the user put it.

Shift-clicking the current browser remains a no-op in everything observable — the
resolved set and the event are unchanged — and internally it starts the aim.

**4b. The badges ship in the library, not in the harness.** `hic-root-targeted`
and `hic-root-target-anchor` are applied by the registry, beside
`hic-root-selected`, and styled in `css/juicebox.scss`. The gesture that sets a
target set is library-side — shift-click is bound in `layoutController` — so its
feedback has to be, or every host would have to reimplement the same outline to
stop the gesture from looking broken. They are *separate* classes and separate
visuals deliberately: the selected border keeps meaning what it means, because a
user still needs to see at a glance which panel the widgets are reading.

Four appearances, because the first shift-click must not look like a plain click:

| state | appearance |
| --- | --- |
| unselected | grey border |
| selected, no aim | dark border |
| the anchor — current *and* explicitly targeted, i.e. the first shift-click | blue border |
| aimed at, not current | blue dashed outline |

The current browser is targeted implicitly, but an implicit set of one is just a
selection, so it carries no badge — only an *explicit* target wears one. Borders
are a pixel thicker than before across every state so the color reads at a
glance; the width lives on `.hic-root` itself, not on the state classes, so
selecting a panel cannot resize it. `dev/multi-browser-targeting.html` overrides
the rules with louder ones; that is a harness decision, not the library's.

**5. Skip, do not throw.** A target with no dataset, or on a genome other than the
**originating** browser's, is skipped and reported as skipped. Tracks carry no
genome of their own, so the browser the load was issued from is the track's genome
declaration — the menu it came from was built for that browser's genome. This is
the skip that prevents the nasty failure: not an error, just a track drawn at
meaningless coordinates in a panel nobody was watching. The precedent is #605's
`canResolveSyncState`, which declines a state it cannot place rather than failing
the publication.

**6. Lifecycle.**

| event | target set |
| --- | --- |
| browser deleted | dropped, in `releaseSlot` — a disposed browser is fatal on use, not merely stale |
| browser added | does **not** join — a panel just created was not part of the aim the user set up |
| `browser.reset()` | **survives** |
| session restore | cleared; never serialized |
| fewer than two browsers left | **lapses** — an explicit set of one is just a selection |

The last row is enforced in one place, `#announce`, because both routes into it
end there: a shift-click on the only panel, and deletes whittling an aim down to
its last member. Neither should leave the user looking at the anchor border of a
multi-select that has no second member. It costs nothing, because the *resolved*
set is `[currentBrowser]` either way — what lapses is the badge, not a target —
and an aim of one that later gains a neighbour does not come back: adding a panel
must not resurrect an aim the user can no longer see. #621.

The reset row is the one that diverges from the sync group, and on purpose: sync
membership is a *rule* that gets recomputed, so losing it costs nothing; targeting
is a user's act, and a reset should not silently undo it. `HICBrowser.reset`
therefore captures explicit membership before the teardown and hands it back to
`reclaimSlot`, next to the slot and the selection it already restores.

A target set is per registry and never spans two embeds. That falls out of
ADR-0004's isolation, and there is no caller for the alternative: a fan-out is
issued *through* a registry.

**7. juicebox.js raises no alert.** `loadTracksIntoTargets` returns
`{loaded, failed, skipped}` and the caller reports — one report per gesture, not
one modal per browser. *Where* it appears is a host's decision, and juicebox-web
and Spacewalk have different notification surfaces.

This is what forced the loader split. `DataLoader.loadTracks` catches, alerts and
resolves, so a fan-out over it could not tell failure from success. The work is now
a private `#loadTracks`, with two wrappers over it: the public `loadTracks`, which
reports, and `loadTracksOrThrow`, which the fan-out calls. The spinner is started
in the body and stopped by each wrapper rather than wrapped around the body,
because that is what keeps the public method **byte-identical in behaviour** —
including the order in which it reports and then puts the spinner away. That
behaviour is contract: `HICBrowser.loadTracks` is published surface and two hosts
call it.

**8. Nothing existing becomes plural.** `currentBrowser`, `BrowserSelect`,
`HICBrowser.loadTracks` and `layoutController.removeTrackXYPair` mean exactly what
they meant before. A host opts in by calling the new method. The new event is
`BrowserTargetChange` — plural name because the subject is a set, unlike
`BrowserSelect`, whose payload is one browser — and it carries the resolved array,
so a host need not re-derive decision 3's implicit-current rule, plus the registry,
because the bus is page-wide while a target set is per embed.

**9. Concurrency is not capped here.** The fan-out is `Promise.allSettled`,
unbounded. #588 is the unbounded, serial track-load problem, and it deserves one
global answer wherever it lands rather than a second, local, wrong-place one in
this file. What this feature does is multiply that blast radius — one click now
issues N times the track loads — which is worth knowing when #588 is picked up.

## Consequences

**Undoing a fan-out is asymmetric, and shipped that way.** One click creates
tracks in four panels; removing them costs four per-panel deletes through the gear
popup or the annotation trash. Loading lives in the host's nav bar and fans out
easily; deletion is buried in per-track widgets and has no satisfying design yet.
Recorded here rather than discovered later, on the argument that shipping the
asymmetry produces better information about what deletion should look like than
guessing now would.

**Contact maps are out of scope.** The collaborator asked for maps as well as
tracks; this pass narrows to 1D tracks and 2D annotations. So are 2D annotation
attributes — colour, display mode, ordering, visibility — which are closer to view
preferences, and which ADR-0014 already puts outside what travels between
browsers.

> **Amended 2026-09-18 (#680, #681).** Contact maps are now in scope: a primary
> or control map broadcasts to the target set through `loadHicFileIntoTargets`
> and `loadHicControlFileIntoTargets`. The map fan-out is serial where this one is
> concurrent, has no originating browser, and inverts the skip set — ADR-0018
> records why. The 2D annotation attributes above are still out of scope.

**No user sees this until juicebox-web ships against it.** The track menu that
would call `loadTracksIntoTargets` lives in juicebox-web, so the feature is
reachable here only through `dev/multi-browser-targeting.html` until that host is
repointed at a release carrying it.

**The gesture and the badge have no automated test**, per ADR-0013. The rules and
the registry's half — membership, the implicit member, both skip paths, the
lifecycle table, the event — are covered from node in `test/testTargetGroup.js` and
`test/testBrowserTargeting.js`. The dev harness carries a map-less panel and a
different-genome panel deliberately: those are the two skip paths, and a harness
that only showed the happy path is the one that would let the skip rule rot.
