/**
 * The normalize stage: a session document in, the same document resolved out.
 *
 * ## Where this sits
 *
 * ADR-0006 decision 8 names two stages, decode and normalize, and candidate 5
 * deliberately stopped at the line between them. This module is the normalize
 * side, given a name and a module of its own so that the question "what does a
 * config resolve to?" can be asked without building a browser (#532).
 *
 * #532 gave the stage its module without moving anything across the seam. #533
 * is the ticket that moves: **track-default fixing** (`fixDefaults`, which ran
 * inside `decodeSession` and so reached the URL path only), the session-shaped
 * half of the **`selectedGene` reconciliation** (#481), and the **`syncDatasets`
 * resolution** that `createBrowserList` did and `createBrowser` did not. All
 * three ran on one entry path and were skipped on another; they run here now, so
 * every door agrees. #534 finished the job with the **URL-shortcut expansion**,
 * which was written twice — once in the decoder, once in
 * `BrowserRegistry.restoreSession` — and is written once, here, now.
 *
 * ## Session-level and browser-level, in that order
 *
 * Two of the three moved rules are *session*-level: they read a member of the
 * document and write to the browsers under it. They run first, so a browser-level
 * rule never has to know whether the session has been consulted yet.
 *
 * ## Session-shaped, not browser-shaped
 *
 * A single-browser config is a session with its one browser inlined -- the shape
 * `createBrowserList` has always read, and the one the deleted
 * `expandSessionUrlShortcuts` walked too. Walking
 * `session.browsers || [session]` is what lets both browser-creation entry
 * points delegate to one call rather than one call per browser.
 *
 * The convention is a *reading* of a document, not a test any object passes: a
 * caller that already knows it holds exactly one browser config -- `createBrowser`
 * does -- says so explicitly, `normalizeSession({...config, browsers: [config]})`,
 * and does not have to hope the config carries no member spelled `browsers`. Note
 * what that spread buys since #533: the config's own members are the *session's*
 * members, so a session-level rule reaches a one-browser document handed in at
 * that door exactly as it reaches a document naming `browsers`.
 *
 * ## Where it is called, and how often
 *
 * Once per session, at the entry, which is #535. There are two doors and they do
 * not nest: `BrowserRegistry.restoreSession` for a session -- every
 * session-shaped path arrives there, `hic.init`, the query path and
 * `hic.restoreSession` alike -- and `createBrowser` for a single browser config.
 * Browser creation below them normalizes nothing. `test/testNormalizeOnceAtTheEntry.js`
 * counts the calls, because a second one is invisible in the result.
 *
 * ## Running it twice is the identity
 *
 * Invisible because every rule here is idempotent, which
 * `test/testNormalizeSession.js` asserts. That property was load-bearing until
 * #535 -- the restore normalized and then `createBrowserList` normalized the
 * same document again -- and it is kept deliberately now that nothing in this
 * repo depends on it: a host is free to hand the same object to `init` twice, or
 * to `createBrowser` after `restoreSession`, and the mutation is in place, so a
 * stage that drifted on a second pass would rewrite an object the host still
 * holds.
 *
 * ## "Pure" here means free of the world, not free of mutation
 *
 * No DOM, no network, no globals, no browser instance: the stage can be driven
 * from object literals, which is what `test/testNormalizeSession.js` does.
 *
 * It does mutate, and returns the document it was handed. That is deliberate and
 * is the behaviour #531 pinned: every normalizer in this codebase rewrites the
 * host's own object, so `browser.config === theObjectTheHostPassed` holds today
 * and juicebox-web reads `browser.config` back off the live instance (ADR-0003).
 * Returning a normalized *copy* would be a consumer-visible change, and it is
 * not this ticket's to make -- `sameObjectAsInput` is snapshotted in the golden
 * file precisely so that such a change has to arrive deliberately.
 *
 * ## It defaults and coerces; it never rejects
 *
 * The config object is the most-used public surface juicebox has. A normalize
 * stage that tightened validation would reject configs that work today, so no
 * ticket in candidate 9 adds validation here. `test/testNormalizeSession.js`
 * drives the inputs a validating stage would be most tempted by.
 *
 * @see docs/adr/0006-session-wire-format-and-one-decoder.md -- decision 8
 * @see test/testConfigGolden.js -- the characterization gate this must not move
 */

import {StringUtils} from 'igv-utils'
import {parseColorScale} from './colorScaleParser.js'
import ContactMatrixView from './contactMatrixView.js'

/**
 * The annotation colour juicebox itself writes, and so the one a session
 * carrying it is not really asking for.
 *
 * It lives here rather than in `js/sessionCodec.js` because it is a *track
 * default*, not a wire format: `applyTrackDefaults` below and
 * `DataLoader.loadTracks` are its two readers, and neither is a decoder. It sat
 * in the codec only because the pass that reads it did (#533).
 */
export const DEFAULT_ANNOTATION_COLOR = "rgb(22, 129, 198)"

/**
 * Resolve a session document in place, and return it.
 *
 * @param {Object} session - a session naming `browsers`, or a single browser
 *                           config, which is the same thing with its one
 *                           browser inlined
 * @returns {Object} the same object, resolved
 */
export function normalizeSession(session) {

    const configs = session.browsers || [session]

    resolveSyncDatasets(session, configs)
    reconcileSelectedGene(session, configs)

    for (const config of configs) {
        normalizeBrowserConfig(config)
    }

    return session
}

function normalizeBrowserConfig(config) {

    setWidgetVisibilityDefaults(config)
    expandUrlShortcuts(config)
    applyTrackDefaults(config)

    if (StringUtils.isString(config.colorScale)) {
        config.colorScale = parseColorScale(config.colorScale)
    }
    if (StringUtils.isString(config.backgroundColor)) {
        config.backgroundColor = ContactMatrixView.parseBackgroundColor(config.backgroundColor)
    }
}

/**
 * The sync opt-out, resolved once for the whole document.
 *
 * `syncDatasets` is a *session* member and `synchable` is the *browser* member
 * `HICBrowser` actually reads (`hicBrowser.js`, `this.synchable = config.synchable
 * !== false`). Translating one into the other was `createBrowserList`'s, so the
 * same session opted out of the sync group when it created several browsers and
 * was ignored when it created one -- one of the three divergences #533 closes.
 *
 * **The behaviour kept is the one that honours the opt-out**, in both directions
 * of the disagreement: a document saying `syncDatasets: false` means it wherever
 * it is handed in. The alternative -- honouring it only in the multi-browser
 * shape -- would have made the field mean "sometimes", and it is a field a host
 * sets to keep two embeds from dragging each other about. It overwrites a
 * per-browser `synchable` rather than deferring to it, which is what
 * `createBrowserList` did and is the reading that makes the session-level member
 * worth having.
 *
 * Only a literal `false` opts out, matching the `false !== session.syncDatasets`
 * test `BrowserRegistry.restoreSession` makes about the same field. Absent or
 * true writes nothing, so a browser that opted out on its own is left alone.
 */
function resolveSyncDatasets(session, configs) {

    if (false !== session.syncDatasets) {
        return
    }

    for (const config of configs) {
        config.synchable = false
    }
}

/**
 * Hoist a selected gene named inside a browser up to the session that holds it.
 *
 * A selected gene belongs to the *embed*, not to a browser: one registry keeps
 * one, and `registry.toJSON()` writes it at the top level. The legacy
 * `juicebox={…},{…}` form spells it per browser, and a hand-written session may
 * too, so a document naming one only down there has to be read for it -- which
 * is what this does. The last browser to name one wins, which is the order the
 * successive writes to the old page-scoped global produced (#481).
 *
 * **Only the session-shaped half is here.** The other half -- reading a
 * `?selectedGene=` query parameter -- is format knowledge and stays in
 * `js/sessionCodec.js`, where it runs before this and so still wins over a
 * browser's. Format knowledge never crosses into normalize.
 */
function reconcileSelectedGene(session, configs) {

    if (undefined !== session.selectedGene) {
        return
    }

    const fromBrowsers = configs.map(config => config.selectedGene).filter(Boolean).pop()

    if (fromBrowsers) {
        session.selectedGene = fromBrowsers
    }
}

/**
 * The URL abbreviations juicebox has always accepted in place of a full URL, and
 * the prefixes they stand for.
 *
 * Moved here from `js/sessionCodec.js` by #534, unchanged. They were in the codec
 * because the decoder expanded, and the decoder expanded because the query form
 * is where a hand-typed `*s3/` is most often seen -- but a shortcut is not a wire
 * format. It is a spelling of a *URL*, and it is legal in every place a session
 * document can carry one, including a config a host writes in code and hands to
 * `hic.createBrowser`, which never goes near a query string. So the rule belongs
 * to the stage every entry path meets, and this is that stage.
 */
const urlShortcuts = {
    "*s3e/": "https://hicfiles.s3.amazonaws.com/external/",
    "*s3/": "https://hicfiles.s3.amazonaws.com/",
    "*s3e_/": "http://hicfiles.s3.amazonaws.com/external/",
    "*s3_/": "http://hicfiles.s3.amazonaws.com/",
    "*enc/": "https://www.encodeproject.org/files/"
}

/**
 * Expand a shortcut prefix, if the URL opens with one.
 *
 * Non-strings pass through untouched: a config naming a local `File` carries one
 * as its `url`, and a stage that rejects nothing cannot start there.
 */
function expandUrlShortcut(url) {

    if (!url || typeof url !== 'string') {
        return url
    }

    for (const [shortcut, expansion] of Object.entries(urlShortcuts)) {
        if (url.startsWith(shortcut)) {
            return url.replace(shortcut, expansion)
        }
    }

    return url
}

/**
 * Expand the shortcuts everywhere a browser config can carry a URL: the map, the
 * control map, and each track.
 *
 * ## Why there is one of these and there used to be two
 *
 * The expansion was written twice: once three call sites deep inside
 * `decodeQuery`, once as `expandSessionUrlShortcuts` reached by
 * `BrowserRegistry.restoreSession`. The second existed because of the first --
 * a session handed straight to the restore never passes through the decoder, so
 * without it a saved document spelling `*s3/` reached the loaders unexpanded.
 * ADR-0006 fact 6 recorded the duplication and decision 8 named the condition
 * for ending it: once a normalize stage exists that *both* entry paths pass
 * through, one copy is deletable. #533 met that condition and #534 deleted both,
 * leaving this.
 *
 * ## What moved, and what did not
 *
 * The set of fields is the union of what the two copies covered, which is the
 * same set: `url`, `controlUrl`, and every track's `url`. So both entry paths
 * expand exactly what they expanded before.
 *
 * What *did* move is when, and both golden files record it. `testDecoderGolden`
 * now shows a `*s3/` URL leaving the decoder unexpanded, since expansion is one
 * stage downstream of it. `testConfigGolden` (#531) -- the file that pins what
 * actually reaches a browser -- moved in exactly two columns: `createBrowser`
 * and `createBrowserList` reached directly, the two doors that never expanded at
 * all, because the copy that did lived in `restoreSession`. That is a divergence
 * closing rather than a behaviour change, and it is the reason a *deletion*
 * moves a snapshot: collapsing a duplicated rule into a shared stage necessarily
 * widens it to every caller of that stage. The probe fixture that runs the same
 * shortcut through a URL and through a config did not move, which is the claim
 * worth having -- one copy of the code produces what two produced.
 */
function expandUrlShortcuts(config) {

    for (const key of ['url', 'controlUrl']) {
        if (config[key]) {
            config[key] = expandUrlShortcut(config[key])
        }
    }

    // `Array.isArray` rather than the deleted copy's `config.tracks || []`, for
    // the reason `applyTrackDefaults` gives below: a hand-written
    // `tracks: 'a.bed'` is a string, and iterating it walks characters. It
    // expanded nothing either way -- a character has no `url` -- so this is the
    // same behaviour said out loud.
    if (!Array.isArray(config.tracks)) {
        return
    }

    for (const track of config.tracks) {
        if (track.url) {
            track.url = expandUrlShortcut(track.url)
        }
    }
}

/**
 * The defaults a track carries in a session, applied on the way in.
 *
 * Moved here from `decodeSession` by #533. It ran inside the decoder, so it
 * reached a session that arrived as a URL and skipped one handed straight to
 * `restoreSession` -- the documented public API. The rules are unchanged: the
 * default annotation colour is dropped so the renderer's own default applies,
 * `NaN` data-range bounds (which is what a v0 track string with an empty range
 * decodes to) are dropped rather than reaching a renderer, and display mode is
 * collapsed.
 *
 * ## Which stage owns which default
 *
 * `DataLoader.loadTracks` defaults per track too, and three of its rules look
 * like these. They are not duplicates to be collapsed -- the two stages own
 * different questions, and the split is where the answer comes from:
 *
 * - **This stage owns what the *document* says.** It sees a track config exactly
 *   as a session spells it, before anything has been fetched, and it is reached
 *   by every entry path -- including a config a host passes to `init` in code,
 *   which never goes near a wire format.
 * - **`loadTracks` owns what the *load* discovers**: the filename behind the URL,
 *   and so the track's `type`, which is why its colour and display-mode rules are
 *   conditioned on `type === 'annotation'` and these are not. It also applies
 *   `height` from the live layout and `autoscale` from a missing `max`, neither
 *   of which a document can answer. And it is the only stage a track added at
 *   runtime through the published `browser.loadTracks(configs)` meets, since such
 *   a track was never part of a session.
 *
 * So a session-borne annotation track meets both, and agrees with itself: this
 * stage has already done what `loadTracks` would do for it. A runtime-added one
 * meets only the loader. Neither rule is safe to delete in favour of the other.
 *
 * ## The display mode is an override, not a default, and it is kept as one
 *
 * The last line writes `COLLAPSED` unconditionally, so a track that *asked* for
 * `EXPANDED` does not get it. That is not defaulting, and this stage is
 * supposed to default -- but it is what the decoder did, verbatim, and #533 is a
 * move rather than a redecision. Two consequences, both deliberate:
 *
 * - The override is now **wider**: it used to reach only tracks that arrived
 *   through a URL, and it reaches every entry path now. #533 asks for exactly
 *   that -- "a session handed straight to `restoreSession` gets the same track
 *   defaults a URL-borne one gets ... display mode collapsed" -- because the
 *   alternative is the two doors disagreeing about the same document, which is
 *   the defect being closed.
 * - Whether to override *at all* is **#525**, open and unanswered. Nothing
 *   juicebox writes carries a track `displayMode` and no accepted wire format
 *   encodes one, so no saved link loses information today; what changed here is
 *   that the question is now about one stage rather than about which door you
 *   came in by. Softening this to `??=` is that ticket's call, and it would move
 *   the query path's snapshot too.
 */
function applyTrackDefaults(config) {

    // `Array.isArray` rather than a truthiness test: the decoder's copy walked
    // whatever it found, so a hand-written `tracks: 'a.bed'` reached it as a
    // string and threw on the first character. A stage that never rejects cannot
    // do that, and there is nothing here to default a string into.
    if (!Array.isArray(config.tracks)) {
        return
    }

    for (const track of config.tracks) {
        if (track.color === DEFAULT_ANNOTATION_COLOR) {
            delete track.color
        }
        if (track.min !== undefined && Number.isNaN(track.min)) {
            delete track.min
        }
        if (track.max !== undefined && Number.isNaN(track.max)) {
            delete track.max
        }
        track.displayMode = "COLLAPSED"
    }
}

/**
 * The three flags that decide whether a browser draws the widgets around its
 * contact map -- the locus box, the map label and the chromosome selector.
 *
 * `figureMode` forces all three off rather than defaulting them, which is why
 * this is not three `??`s: a host asking for `figureMode` *and* a locus box gets
 * figure mode. Note that `HICBrowser` reads `miniMode` as a figure mode too and
 * this stage does not -- a live disagreement, pinned in the golden file, and
 * candidate 9's to close later rather than here.
 */
function setWidgetVisibilityDefaults(config) {

    if (config.figureMode === true) {
        config.showLocusGoto = false
        config.showHicContactMapLabel = false
        config.showChromosomeSelector = false
    } else {
        config.showLocusGoto = config.showLocusGoto ?? true
        config.showHicContactMapLabel = config.showHicContactMapLabel ?? true
        config.showChromosomeSelector = config.showChromosomeSelector ?? true
    }
}
