# ADR-0018 — A contact map broadcasts to the target set: serially, origin-free, and with the skips inverted

**Status:** Accepted — landed as #684 (#679, the silent loaders), #685 (#680, the
primary broadcast) and #686 (#681, the control broadcast).

**Date:** 2026-09-18
**Amended:** 2026-09-23 — ADR-0019 settles #682: a genome change clears the
panel's tracks. The `genomeChanged` key of decision 7 is removed before it
shipped, and the *tracks survive the swap* consequence no longer holds; see the
amendments under each.
**Related:** #615 (the target set, and the collaborator's request that named
maps), #680 (primary broadcast), #681 (control broadcast), #679
(`loadHicFileOrThrow`, `loadHicControlFileOrThrow` and the declared
`'control-incompatible'` code), #682 (tracks left behind by a genome change),
#588 (the track storm ADR-0015 decision 9 defers to), ADR-0015 (targeting is not a
sync group — the mechanism this extends, and the consequence this reverses),
ADR-0016 (static sync membership — why broadcast panels end up in one group),
ADR-0014 (a control map and display mode are dataset choices), ADR-0013 (test
tier), `CONTEXT.md` (*Target set*, *Sync group*), `js/targetGroup.js`,
`js/browserRegistry.js`

## Context

ADR-0015 built the target set for tracks and said, in its consequences, that
contact maps were out of scope. The collaborator who asked for the gesture had
asked for maps as well, and #680 and #681 carried it to them.

The result is two fan-outs in `js/targetGroup.js` that look like they should be
one. `fanOutTracks` takes an originating browser, skips before it loads, and
runs every target at once. `fanOutMap` and `fanOutControlMap` take no origin,
run one target at a time, and — for the control map — skip *after* the load. A
reader who finds both, with only ADR-0015 to go on, has a document telling them
the second pair does not exist. This records why each difference is there.

## Decision

**1. Broadcast, not distribute.** One map reaches every target. Putting a
different map in each panel is a different feature: it needs an order (which
map goes where) and a gesture that expresses one, and the target set is an
unordered set of browsers. Nothing here provides for it.

**2. Serial, where tracks are concurrent.** `loadHicFile` ends with
`registry.sync()` and then adopts a peer's sync state. Neither step is safe to
run N times at once: the group would be recomputed against a registry in which
some targets hold the new map and some do not, and each panel would adopt
whichever sibling happened to finish first. The end state would depend on
network order. So both map broadcasts run on one serial helper,
`fanOutSerially`, and `test/testTargetGroup.js` pins the order.

ADR-0015 decision 9's defence of unbounded concurrency does not carry across.
It is an argument about #588's track storm — one gesture issuing N times an
unbounded number of track loads. A map broadcast is at most one indexed read per
panel, and being serial costs little.

**3. Origin-free, where tracks have an anchor.** `fanOutTracks` takes an
originating browser because a track has no genome of its own: the panel the load
came from is the track's genome declaration (ADR-0015 decision 5). A map declares
its own genome, built from the `.hic` file's chromosome table, and a control
map's compatibility is asked against *each target's own* primary. In both cases
there is no reader for an `originating` parameter, so neither function takes
one.

The anchor badge — `hic-root-target-anchor`, ADR-0015 decision 4b — stays on
screen during a map broadcast and means nothing to it. It marks where a *track*
load's genome is measured from. That is why it is written down here: without
this note, a user or a reviewer will reasonably ask why the anchor panel is not
treated differently, and the answer is that for a map, no panel is the anchor.

**4. The skip sets invert.**

| fan-out | skips | known |
| --- | --- | --- |
| tracks | `'no-dataset'`, `'genome-mismatch'` | before the load |
| primary map | none — `skipped` is always empty | — |
| control map | `'no-primary'` | before the load |
| | `'control-incompatible'` | **after** the read |

A primary broadcast skips nothing. Both track skips exist because a track has no
genome of its own; a map has one, so a panel on another genome is just a panel
whose genome is about to change, and an empty panel is the best target there is.
The `skipped` key stays so a host can read every summary with one code path.

A control broadcast skips a panel with no primary map, because a control is
the "B" of a panel's "A". It also skips a panel whose primary cannot pair with
the control map. That can only be asked of the downloaded control dataset, so it
is the first **post-flight** skip in the design: the read happens, and the
result is still reported as `skipped`, not `failed`. It is identified by the
`code` that `loadHicControlFileOrThrow` puts on what it throws (#679), never by
matching the message. The reasoning follows ADR-0015 decision 5 by analogy — a
mismatch is a placement the panel declines, not an error — but decision 5
measures against the originating browser before the load, and this measures
against the target's own primary after it.

The four reasons are as much contract as the summary's field names, and each is
pinned by `test/testTargetGroup.js`.

**5. A fan-out is named for the browser door it multiplies.** The registry
methods are `loadTracksIntoTargets`, `loadHicFileIntoTargets` and
`loadHicControlFileIntoTargets`: each is the `HICBrowser` method it multiplies
with `IntoTargets` appended. Something like `broadcastMap` might read better,
but the rule tells a host which single-panel call each one corresponds to, and
the config each one takes is the config that call already documents.

**6. The lifecycle does not change.** Not one row of ADR-0015 decision 6 is
different. The target set does not care what it carries: deleting a browser still
drops it, a new browser still does not join, `reset()` still leaves the set in
place, a restore still clears it, and an aim of one still lapses.

What a broadcast *does* change is every target's dataset. That recomputes sync
membership and can move isolation marks. This is existing `loadHicFile`
behaviour firing N times rather than new lifecycle, and it is why the loads are
serial (decision 2).

**7. The summary gains one key, and raises no alert.** Both map broadcasts
return `{loaded, failed, skipped, genomeChanged}`, where `genomeChanged` lists
`{browser, from, to}` for each panel whose map moved it from one genome to
another. That is the one fact a host cannot work out afterwards. It is read off
`genome`, not `dataset`, because a panel whose last load failed has no dataset
but still has the old genome and its tracks. It is empty in practice for a
control broadcast. As with tracks (ADR-0015 decision 7), the fan-out raises no
modal — not for an incompatible control map and not for a bot challenge — and the
caller reports once per gesture.

Display mode does not travel. ADR-0014 counts both a control map and the
A/B/ratio display mode as dataset choices, but this gesture carries a map, not a
display mode, and a broadcast changes each panel's display mode exactly as much
as the single-panel load does.

> **Amended 2026-09-23 (#682).** `genomeChanged` is removed; the summary is
> `{loaded, failed, skipped}`. It existed to name the panels drawing stale tracks,
> and ADR-0019 clears those tracks at the genome change. It had not shipped. A
> host that wants to know which panels changed genome has `onGenomeChange`.

## Consequences

**Four broadcast panels land in one sync group.** They hold the same map, so
ADR-0016's pairing rule puts them together: each adopts a peer's state on load
and they pan together afterwards. This is correct for "swap the map under four
panels I have already set up", and it makes "the same map at four loci"
impossible to get by broadcasting alone. The escape hatch is the one the sync
group already has, `synchable: false` per panel. **No third membership mechanism
is added to avoid it.** ADR-0015 exists to keep that from happening, and this is
the case most likely to tempt someone into one. Expect it to be filed as a bug.

**A target's tracks survive the swap, even across a genome change.** Nothing in
the library clears a panel's tracks when its map is replaced, so a panel moved
from hg38 to mm10 keeps its hg38 tracks, drawn at meaningless coordinates. The
broadcast reports these panels in `genomeChanged` and does not fix them. Whether
to clear the tracks, warn about them or leave them is #682's question. It is the
same behaviour as a single-panel load, and a broadcast just makes it more
likely. Expect this to be filed as a bug too.

> **Amended 2026-09-23 (#682).** No longer true. ADR-0019: a genome change clears
> the panel's track pairs, pending tracks and 2D annotations, in a single-panel
> load and in every broadcast target alike. A broadcast that moves four panels to
> mm10 leaves four panels with no tracks.

**Live contact maps are not broadcast.** Spacewalk drives them programmatically
into one panel. There is no user gesture involved and nothing that would call a
fan-out.

**Tests.** Per ADR-0013, the gesture is exercised by hand in
`dev/multi-browser-targeting.html`, which carries map and control buttons over
panels with mixed genomes and primaries so that both control skips are visible.
The rules — order, copies, both skip reasons, `genomeChanged` — are covered from
node in `test/testTargetGroup.js`, and the registry doors in
`test/testBrowserTargeting.js`.
