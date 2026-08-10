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
 * Nothing has moved *across* the seam here. What this module does is exactly
 * what the two unexported functions inside `createBrowser.js` did, in the same
 * order: default the three chrome-visibility flags, with the `figureMode`
 * special case, and coerce the two members a session can carry as strings.
 * `fixDefaults`, the `selectedGene` reconciliation and the second copy of the
 * URL-shortcut expansion are still on the decoder's side; #533 and #534 move
 * them.
 *
 * ## Session-shaped, not browser-shaped
 *
 * A single-browser config is a session with its one browser inlined -- the same
 * shape convention {@link expandSessionUrlShortcuts} already uses, and the shape
 * `createBrowserList` has always read. Walking `session.browsers || [session]`
 * is what lets both browser-creation entry points delegate to one call rather
 * than one call per browser.
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
 * Resolve a session document in place, and return it.
 *
 * @param {Object} session - a session naming `browsers`, or a single browser
 *                           config, which is the same thing with its one
 *                           browser inlined
 * @returns {Object} the same object, resolved
 */
export function normalizeSession(session) {

    for (const config of session.browsers || [session]) {
        normalizeBrowserConfig(config)
    }

    return session
}

function normalizeBrowserConfig(config) {

    setChromeDefaults(config)

    if (StringUtils.isString(config.colorScale)) {
        config.colorScale = parseColorScale(config.colorScale)
    }
    if (StringUtils.isString(config.backgroundColor)) {
        config.backgroundColor = ContactMatrixView.parseBackgroundColor(config.backgroundColor)
    }
}

/**
 * The three flags that decide whether a browser draws its chrome.
 *
 * `figureMode` forces all three off rather than defaulting them, which is why
 * this is not three `??`s: a host asking for `figureMode` *and* a locus box gets
 * figure mode. Note that `HICBrowser` reads `miniMode` as a figure mode too and
 * this stage does not -- a live disagreement, pinned in the golden file, and
 * candidate 9's to close later rather than here.
 */
function setChromeDefaults(config) {

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

export default normalizeSession
