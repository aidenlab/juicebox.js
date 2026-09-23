# ADR-0019 — A genome change clears the panel's tracks

**Status:** Accepted — decided in the #682 grilling; not yet implemented.

**Date:** 2026-09-23
**Related:** #682 (the question), #680 (the map broadcast, which surfaced it),
#588 (pending tracks), ADR-0018 (whose "tracks survive the swap" consequence this
reverses, and whose `genomeChanged` key this removes), ADR-0015 decision 5 (the
`'genome-mismatch'` skip, the mirror-image rule), ADR-0017 (pending tracks),
ADR-0016 decisions 7–8 (the isolation mark, the rejected precedent), `CONTEXT.md`
(*Genome change*, *Pending track*), `js/dataLoader.js`, `js/layoutController.js`

## Context

Load an hg38 map into a panel, add tracks, then load an mm10 map into the same
panel. `browser.genome` is rebuilt from the new file and the tracks stay, drawn
at coordinates that mean nothing. Nothing clears them: `clearDataset()` drops the
datasets and the state, `onGenomeChange` only notifies, and
`removeAllTrackXYPairs` had no production caller.

#682 put three candidates: leave it, clear the tracks, or keep them and mark the
panel the way the isolation mark does. The objection to clearing was that it
destroys work silently.

It does not destroy work. A track has no genome of its own — the panel's genome
is its genome declaration (ADR-0015 decision 5) — so a track left behind by a
genome change is not the user's work, it is wrong data. And the user caused it,
by loading the other genome's map; there is no surprise to announce. juicebox-web
already believed the library did this: its `GenomeChange` listener says the
tracks "are gone and said nothing."

## Decision

**1. A genome change clears the panel's tracks, without asking.** A *genome
change* is a successful map load — file or live — into a panel whose genome id
differs from its previous map's. No confirmation, no mark, no console note.

**2. The id, not the assembly.** hg38 to GRCh38 is a genome change and clears
tracks that were still valid. `Dataset.isCompatible` would spare them, but then
"genome change" would mean one thing here and another to `onGenomeChange` and to
the `'genome-mismatch'` skip. One definition is worth the rare cleared panel. If
it ever matters, all three move to the assembly test together, not this one
alone.

**3. Everything that belongs to the genome goes.** Track pairs, pending tracks,
and 2D annotations. A pending track is dismissed at the clear and its late result
discarded — otherwise it lands on the new map and is the same bug through the back
door. Clearing the 2D annotations is also #682's answer on them: nothing is left
that would need a mark.

**4. Before the notification.** The clear runs in the genome-change branch of
both map-load paths, before `onGenomeChange` and the `GenomeChange` event fire, so
a host reacting to the change sees an empty panel rather than one about to be
emptied. Not in the coordinator's `onGenomeChange`: that is a notifier, and
should stay one.

**5. Each loaded track pair posts `TrackXYPairRemoval`.** A bulk removal that
posts nothing is what forced juicebox-web into wiping every panel's toggle index
on any `GenomeChange`. With the per-track event, its existing per-panel
bookkeeping stays right on its own. A pending track posts nothing, as when it is
dismissed — no track was loaded. 2D annotations have no removal event and do not
gain one here.

**6. A failed load clears nothing.** It leaves the old genome, so the tracks
still match it.

## Consequences

**The broadcast summary loses `genomeChanged`.** ADR-0018 decision 7 added it so
a host could find the panels drawing stale tracks. There are none now. It had not
shipped, so it is removed rather than redefined; a host that wants to know which
panels changed genome has `onGenomeChange`.

**A user switching between two assemblies loses their tracks each way.** That is
the cost #682 named, accepted: reloading tracks for the new genome is the
correct act anyway, since the old ones do not apply.

**juicebox-web's `GenomeChange` toggle wipe becomes redundant.** It is also wrong
once genome change is per panel, since it unchecks toggles for panels whose tracks
survive. It is removed on the juicebox-web side once that host moves to a release
carrying this.
