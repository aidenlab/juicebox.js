/**
 * The config fixtures — one input per thing an entry path is known, or
 * suspected, to treat differently. #531, the gate for candidate 9.
 *
 * Candidate 9 is "give the config schema one reader". There is not yet one
 * reader: `normalizeSession` (`js/normalizeSession.js`, #532, #533, #534)
 * applies most defaults, and `HICBrowser` itself still reads raw fields and
 * defaults them inline. Which of those a config meets still depends on which
 * door it came in through — less than it did, since #533 moved the last of the
 * decoder's normalization behind the shared stage and #534 collapsed the two
 * copies of the URL-shortcut expansion into it.
 *
 * **These fixtures carry inputs, not expected outputs** — the same rule as
 * `wireFormatCorpus.js`, and for the same reason (ADR-0006, "How we know the
 * decoder did not change"). A hand-written expectation here would encode one
 * reader's understanding of four scattered normalizers, which is precisely the
 * understanding candidate 9 exists because nobody has. The consuming test,
 * `test/testConfigGolden.js`, snapshots what each entry path actually produces.
 *
 * Every fixture is a *single browser config*, deliberately, because all four
 * columns accept that shape: the session-shaped ones read `session.browsers ||
 * [session]`, so a bare config is a one-browser session. That is what lets one
 * snapshot hold all four paths side by side and makes a divergence a visible
 * difference between columns rather than a claim in a comment. Fixtures that are
 * only meaningful as a multi-browser session are in `sessionFixtures` below and
 * run through the session-shaped paths only.
 *
 * **Every fixture here is synthesized, and that is a real limitation.**
 * `wireFormatCorpus.js` marks each fixture `harvested` or `synthesized` because
 * a synthesized-only corpus is circular: it encodes what its author thinks the
 * code accepts, and so reproduces a misreading faithfully. There is no
 * equivalent harvest available for configs — a config is an argument a host
 * passes in code, not a string a user pastes into a tracker, so there is no
 * inbound population to sample. What exists instead is the two known host apps,
 * and `host-shaped-full-config` and `empty-config` are shaped after
 * juicebox-web's call and Spacewalk's respectively (ADR-0003 measures both
 * surfaces). The non-circular half of this gate is the query suite, which drives
 * the genuinely harvested `wireFormatCorpus` inputs through the same machinery.
 *
 * `divergence` records what the fixture was written to expose. It is a note
 * about *why this input is here*, not an assertion — read the snapshot for what
 * actually happens. Where a note names a ticket, that ticket is the one expected
 * to move the snapshot.
 *
 * @see test/testConfigGolden.js — the consuming golden file
 * @see test/data/wireFormatCorpus.js — the same discipline, for the wire format
 */

/**
 * The default annotation colour, as a literal.
 *
 * Deliberately not imported from `js/sessionCodec.js`: a characterization
 * fixture that derives its input from the code under test moves when that code
 * moves, which is the one thing a gate must not do.
 */
export const DEFAULT_ANNOTATION_COLOR_LITERAL = 'rgb(22, 129, 198)'

export const configFixtures = [

    {
        id: 'host-shaped-full-config',
        note: 'The juicebox-web shape: a map, a control map, tracks, and the display flags a host sets explicitly. The baseline every other fixture is a variation on.',
        divergence: 'None expected — this is the control.',
        config: {
            url: 'https://example.com/a.hic',
            name: 'A',
            controlUrl: 'https://example.com/control.hic',
            controlName: 'Control',
            nvi: '2851728310,36479',
            state: {chr1: 1, chr2: 1, zoom: 4, x: 0, y: 0, pixelSize: 1, normalization: 'NONE'},
            tracks: [{url: 'https://example.com/genes.bed', name: 'genes'}],
        },
    },

    {
        id: 'track-carrying-the-defaults-fixDefaults-strips',
        note: 'A track with the default annotation colour, NaN data limits, and no displayMode — exactly what `normalizeSession.applyTrackDefaults` exists to clean up.',
        divergence: '**Closed by #533.** The pass was `fixDefaults` inside `decodeSession`, so none of the four config-shaped doors met it: all four kept the default colour, kept the NaN limits, and got no `displayMode`, while the query path stripped all three. It is `normalizeSession.applyTrackDefaults` now and every door meets it, which is the snapshot movement logged in `testConfigGolden.js`. The fixture stays, and its id keeps the old function\'s name on purpose: it is what keeps the closure from reopening.',
        config: {
            url: 'https://example.com/a.hic',
            tracks: [{
                url: 'https://example.com/annotations.bed',
                name: 'annotations',
                color: DEFAULT_ANNOTATION_COLOR_LITERAL,
                min: NaN,
                max: NaN,
            }],
        },
    },

    {
        id: 'url-shortcuts-in-map-control-and-track',
        note: 'The `*s3/` and `*enc/` shortcuts, in all three places a session can carry one.',
        divergence: '**Closed by #534.** Expansion happened in `BrowserRegistry.restoreSession`, so the two paths that go through a registry restore expanded and the two browser-creation paths reached directly did not — a host calling `hic.createBrowser` with a shortcut URL handed an unexpanded `*s3/…` straight to the loader. Both copies of the expansion are gone and `normalizeSession` is the survivor, so all four doors expand; the two that did not are the snapshot movement logged in `testConfigGolden.js`. #535 then moved the normalize call itself to the entry, without moving this fixture: `createBrowserList` is below the seam now and its driver resolves the session the way its one production caller does.',
        config: {
            url: '*s3/hiseq/gm12878/in-situ/HIC009.hic',
            controlUrl: '*s3e_/wapl_hic/WT.hic',
            tracks: [{url: '*enc/ENCFF000ABC.bigWig', name: 'encode track'}],
        },
    },

    {
        id: 'figure-mode',
        note: '`figureMode: true`, which `normalizeSession` turns into three explicit `false` flags.',
        divergence: 'None expected: both browser-creation paths call `normalizeSession`, and the two entry paths above them end in one of those two.',
        config: {url: 'https://example.com/a.hic', figureMode: true},
    },

    {
        id: 'mini-mode-the-legacy-spelling-of-figure-mode',
        note: '`miniMode: true`, the backward-compatible spelling `HICBrowser` still reads at hicBrowser.js:103.',
        divergence: '**Known divergence, and not between paths — between readers.** `normalizeSession` tests `config.figureMode === true` only, so `miniMode` leaves the three display flags defaulted to `true` while `browser.figureMode` is `true`. Every path agrees, and every path is inconsistent with itself. The snapshot pins the resolved flags; `browser.figureMode` is snapshotted beside the config because that disagreement is invisible in the config alone. #536 is where the schema says which spelling wins.',
        config: {url: 'https://example.com/a.hic', miniMode: true},
    },

    {
        id: 'display-flags-set-explicitly-false',
        note: 'A host that turns the three chrome elements off by hand rather than through `figureMode`.',
        divergence: 'None expected — `??` leaves an explicit `false` alone. Here to pin that, since a defaulting rewritten as `||` would silently flip all three.',
        config: {
            url: 'https://example.com/a.hic',
            showLocusGoto: false,
            showHicContactMapLabel: false,
            showChromosomeSelector: false,
        },
    },

    {
        id: 'color-scale-as-a-string',
        note: 'The colour scale in its wire spelling. `normalizeSession` parses a string into a scale object in place, so the *host\'s own object* comes back holding a class instance where it put a string.',
        divergence: 'None expected between paths. Pinned because the in-place rewrite is observable to a host that reuses its config object, and because `browser.config.colorScale` is a class instance in the snapshot rather than the string the host wrote.',
        config: {url: 'https://example.com/a.hic', colorScale: '100,255,0,0'},
    },

    {
        id: 'background-color-as-a-string',
        note: 'The other in-place string→object rewrite in `normalizeSession`.',
        divergence: 'None expected between paths. Same reason as the colour scale.',
        config: {url: 'https://example.com/a.hic', backgroundColor: '255,255,255'},
    },

    {
        id: 'synchable-false-on-the-browser-config',
        note: '`synchable` set per browser, which is where `HICBrowser` reads it (hicBrowser.js:127).',
        divergence: 'None expected — this is the field the *session-level* `syncDatasets` is translated into, and it is the half that behaves the same everywhere.',
        config: {url: 'https://example.com/a.hic', synchable: false},
    },

    {
        id: 'unknown-field-a-host-invented',
        note: 'A field no reader in juicebox knows about.',
        divergence: 'None expected — every path carries it through untouched, and the schema #536 writes down must keep doing so. "Normalize defaults and coerces, never rejects" (#466) is only checkable if something unrecognized is in the corpus.',
        config: {url: 'https://example.com/a.hic', hostPrivateField: {anything: [1, 2, 3]}},
    },

    {
        id: 'syncDatasets-false-on-a-single-browser-config',
        note: 'The session-level sync opt-out, on a config that is also a one-browser session — which is what every one of these four paths accepts.',
        divergence: '**Closed by #533.** `createBrowserList` read `syncDatasets` and wrote `synchable: false` onto each browser config; `createBrowser` never looked at it, so the same input produced a synchable browser through one creation path and an unsynchable one through the other. The resolution is `normalizeSession`\'s now, at session level, and it honours the opt-out at every door — `createBrowser` hands its config over as the session it is, rather than as an anonymous browser inside an empty one.',
        config: {url: 'https://example.com/a.hic', syncDatasets: false},
    },

    {
        id: 'empty-config',
        note: 'The degenerate input: no map at all. Spacewalk passes `{}` to `init` and drives everything through `restoreSession` afterwards, so this is a shape that runs in production.',
        divergence: 'None expected. Pinned because "what a config contains" has to include the empty one, and because the defaults are the whole of the answer here.',
        config: {},
    },
]

/**
 * Pairs: the *same map, the same track, the same locus*, expressed once as a URL
 * and once as a host config.
 *
 * The divergences the four columns above cannot show are the ones between the
 * query path and the config paths, because those two take different input types
 * and so cannot be columns of the same table. A pair is how they become
 * comparable: whatever differs between `viaQuery` and `viaHostConfig` for inputs
 * that mean the same thing is a divergence, and there is nowhere else for it to
 * have come from.
 *
 * `url` is a whole href, as `init()` reads it from `window.location.href`.
 */
export const divergenceProbes = [

    {
        id: 'the-same-track-through-a-URL-and-through-a-config',
        note: 'One map, one BED track, the default annotation colour, no data range.',
        divergence: '**The `fixDefaults` divergence, closed by #533 — and this is the pair that shows it.** The query side used to lose `color` for being the default and gain `displayMode: "COLLAPSED"`, while the config side kept what the host wrote: same track, two answers. Both sides now read the same, because the pass moved to a stage they share. If this pair ever disagrees again, a default has crept back upstream of the seam.',
        url: 'http://localhost/juicebox/?hicUrl=https://example.com/a.hic&name=A&tracks=https://example.com/annotations.bed|annotations||rgb(22, 129, 198)',
        config: {
            url: 'https://example.com/a.hic',
            name: 'A',
            tracks: [{
                url: 'https://example.com/annotations.bed',
                name: 'annotations',
                color: DEFAULT_ANNOTATION_COLOR_LITERAL,
            }],
        },
    },

    {
        id: 'the-same-locus-through-a-URL-and-through-a-config',
        note: 'One map at one locus, the state written once as the `state=` token string and once as the JSON object a host or a saved session carries.',
        divergence: '**A type divergence.** The query path hands `HICBrowser` a `State` *instance*; a host config carries a plain object, which `DataLoader` passes to `State.fromJSON` later. Both work today because everything downstream reads fields rather than methods — which is exactly the kind of accident a schema with one reader is meant to remove. Pinned so that a normalize stage which starts coercing (in either direction) does it visibly.',
        url: 'http://localhost/juicebox/?hicUrl=https://example.com/a.hic&state=1,1,4,0,0,1,NONE',
        config: {
            url: 'https://example.com/a.hic',
            state: {chr1: 1, chr2: 1, zoom: 4, x: 0, y: 0, pixelSize: 1, normalization: 'NONE'},
        },
    },

    {
        id: 'the-same-shortcut-URL-through-a-URL-and-through-a-config',
        note: 'The `*s3/` shortcut, in the two forms it can arrive in.',
        divergence: 'None expected, before or after #534, and that is the point of the probe: the pair agreed when two separate copies of the expansion produced it — one in `decodeQuery`, one in `BrowserRegistry.restoreSession` (ADR-0006 decision 8) — and it agrees now that one copy in `normalizeSession` produces both sides. The snapshot did not move, which is the strongest single statement that the deletion changed nothing a browser sees.',
        url: 'http://localhost/juicebox/?hicUrl=*s3/hiseq/gm12878/in-situ/HIC009.hic',
        config: {url: '*s3/hiseq/gm12878/in-situ/HIC009.hic'},
    },
]

/**
 * Fixtures that only mean anything as a multi-browser session, and so run
 * through the two session-shaped entry paths rather than all four.
 */
export const sessionFixtures = [

    {
        id: 'two-browser-session',
        note: 'What juicebox writes and what a share link restores: two browsers, a selected gene, a caption.',
        divergence: '`selectedGene` and `caption` are session-level and never reach a browser config — the registry keeps the first, the exported `restoreSession` writes the second to a page element. Pinned so that a normalize stage which starts copying session fields down into browser configs is visible as a snapshot movement.',
        session: {
            browsers: [
                {url: 'https://example.com/a.hic', name: 'A'},
                {url: 'https://example.com/b.hic', name: 'B'},
            ],
            selectedGene: 'MYC',
            caption: 'Figure 1',
        },
    },

    {
        id: 'session-with-syncDatasets-false',
        note: 'The session-level opt-out of the sync group.',
        divergence: '**Closed by #533**, and the snapshot did not move here: this fixture only reaches the session-shaped doors, which honoured the opt-out already. Its single-browser twin above is where the closure is visible. Kept because the multi-browser shape is the one the field was written for, and it has to keep agreeing with the other.',
        session: {
            syncDatasets: false,
            browsers: [
                {url: 'https://example.com/a.hic', name: 'A'},
                {url: 'https://example.com/b.hic', name: 'B'},
            ],
        },
    },

    {
        id: 'session-with-per-browser-divergent-flags',
        note: 'Two browsers whose configs disagree about the display flags — one in figure mode, one not.',
        divergence: 'None expected: `normalizeSession` normalizes per browser, not per session. Pinned because a normalize stage lifted to the session level could quietly make one browser\'s flags win over the other\'s.',
        session: {
            browsers: [
                {url: 'https://example.com/a.hic', figureMode: true},
                {url: 'https://example.com/b.hic', showLocusGoto: false},
            ],
        },
    },

    {
        id: 'session-with-url-shortcuts-in-both-browsers',
        note: 'The shortcut expansion, in the multi-browser shape it was written for.',
        divergence: '**Closed by #534**, same as the single-browser shortcut fixture: the registry restore expanded and `createBrowserList` reached directly did not. One copy of the expansion is left, in `normalizeSession`, and both doors meet it.',
        session: {
            browsers: [
                {url: '*s3/hiseq/gm12878/in-situ/HIC009.hic'},
                {url: '*s3e/wapl_hic/WT.hic', tracks: [{url: '*enc/ENCFF000ABC.bigWig'}]},
            ],
        },
    },
]
