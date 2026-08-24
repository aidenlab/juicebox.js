/**
 * The harness the restore suites share: a mocked dataset, a stated viewport,
 * and a browser you can embed and load without touching the network.
 *
 * `testRestoreClamp.js` (#558), `testRestoreBackDoor.js` (#559),
 * `testRestoreResolutionChanged.js` (#560) and `testRestoreNormalization.js`
 * (#561) all drive the same seam -- `loadHicFile` with a saved state, running
 * for real from the ladder down through `setState` -- and each opened with the
 * same forty lines. On copy four that stopped being a borrow and became a
 * fixture (#571). What each suite keeps is what is its own: its zooms, its
 * saved states, and its claims.
 *
 * One line cannot move here, and it is the `vi.mock('../js/hicDataset.js')`
 * call. Vitest hoists a `vi.mock` to the top of the file it is *written* in and
 * registers it against that file's module graph, so a call made from this
 * module would register nothing for the suite importing it. What moves instead
 * is the module shape the factory has to return -- `datasetModule()`, which
 * lives in `restoreDataset.js` rather than here because a factory that reached
 * into this module would pull `hicBrowser.js` back in behind it and deadlock
 * the load it is part of.
 */

import {beforeEach, afterEach, vi} from 'vitest'
import {igvxhr} from 'igv-utils'
import ContactMatrixView from '../../js/contactMatrixView.js'
import {withContainers} from './browserFixture.js'

/**
 * The viewport every restore suite states.
 *
 * Stated, not measured, for the reason ADR-0009 fact 5 gives: JSDOM does no
 * layout, `getViewDimensions()` answers `{0, 0}`, and a clamp read against zero
 * is a clamp against the whole chromosome. `testState.js` states 800x800 and so
 * does the gate's first column; the suites here state the same, which is what
 * makes a bound computed in one of them and a bound recorded in the #557 gate
 * the same bound.
 */
export const VIEWPORT = {width: 800, height: 800}

/**
 * A JSDOM, the three stubs, and an embed -- around each test in the calling
 * describe.
 *
 * `HICBrowser` is passed in rather than imported here because the suites reach
 * it through the deferred `await import('../js/hicBrowser.js')` their own
 * `vi.mock` forces, and the class this fixture spies on has to be the one the
 * suite drives. `suite` names the file in the network-access error, so a stray
 * read says which suite made it.
 *
 * Returns the `withContainers` holder alongside `embed` and `restore`; the
 * holder's fields do not exist until `beforeEach` runs, which is why this hands
 * back an object rather than the elements.
 */
export function restoreFixture(HICBrowser, {suite}) {

    const dom = withContainers()

    beforeEach(() => {
        vi.spyOn(ContactMatrixView.prototype, 'update').mockImplementation(async () => undefined)
        vi.spyOn(HICBrowser.prototype, 'update').mockImplementation(async () => undefined)
        vi.spyOn(igvxhr, 'loadString').mockImplementation(async () => {
            throw new Error(`unexpected network access from the ${suite} suite`)
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    /** One embed, one stated viewport. Returns the live browser, unloaded. */
    function embed() {
        const browser = new HICBrowser(dom.another(), {})
        vi.spyOn(browser.contactMatrixView, 'getViewDimensions').mockReturnValue({...VIEWPORT})
        return browser
    }

    /** One embed, one load of `url` carrying `state`. Returns the live browser. */
    async function restore(url, state) {
        const browser = embed()
        await browser.loadHicFile({url, state}, true)
        return browser
    }

    return {dom, embed, restore}
}
