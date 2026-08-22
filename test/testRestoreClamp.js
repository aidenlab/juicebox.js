/**
 * Restore is a translator, and the clamp has one enforcer. #558, candidate 6,
 * ADR-0009 decisions 2 and 4.
 *
 * `testRestoreGolden.js` (#557) is the gate — it snapshots the resolved state
 * every restore door produces, and it will move when this behaviour moves. A
 * golden says *what* changed; it does not say what the rule is. This file
 * states the rule, in three claims that a snapshot diff cannot make on its own:
 *
 * 1. A restored `pixelSize` above `MAX_PIXEL_SIZE` is capped. The cap lives in
 *    `State._adjustPixelSize`, which restore reaches only by going through
 *    `setView` — so this is the assertion that pins the routing rather than the
 *    arithmetic.
 * 2. A restored origin past the end of the chromosome is pulled back inside it,
 *    and **the load still succeeds**. Coerced, never rejected: the same rule
 *    ADR-0006 and #466 fixed for the normalize stage one seam over.
 * 3. `updateLayout` no longer clamps, and a session that carries a track lands
 *    in the same place as the same session without one. Before #558 `clampXY`
 *    had two reachable callers and `updateLayout` ran only when tracks changed,
 *    so the same saved session opened two ways depending on whether it had a
 *    track (ADR-0009 fact 6).
 *
 * The dataset behind the load is `test/utils/restoreDataset.js` — the same hg19
 * chromosome table and juicer resolution ladder the gate reads its numbers off,
 * so a bound computed here and a bound recorded there are the same bound.
 *
 * The viewport is stated, not measured, for the reason ADR-0009 fact 5 gives:
 * JSDOM does no layout, `getViewDimensions()` answers `{0, 0}`, and a clamp read
 * against zero is a clamp against the whole chromosome. `testState.js` states
 * 800x800 and so does the gate's first column; this file states the same.
 */
import {beforeEach, afterEach, describe, expect, test, vi} from 'vitest'
import {igvxhr} from 'igv-utils'
import ContactMatrixView from '../js/contactMatrixView.js'
import State from '../js/hicState.js'
import {MAX_PIXEL_SIZE} from '../js/hicBrowser.js'
import {withContainers} from './utils/browserFixture.js'
import {restoreDataset} from './utils/restoreDataset.js'

vi.mock('../js/hicDataset.js', async () => {
    const {restoreDataset} = await import('./utils/restoreDataset.js')
    return {
        default: {loadDataset: async config => restoreDataset(config)},
        HiCDataset: class {
            constructor(config) {
                Object.assign(this, restoreDataset(config))
            }
            async init() {}
        },
    }
})

const {default: HICBrowser} = await import('../js/hicBrowser.js')

const VIEWPORT = {width: 800, height: 800}
const URL = 'https://example.org/restore-clamp.hic'

/** chr1 x chr1 at 250kb bins — a zoom the corpus's harvested states also use. */
const CHR1 = 1
const ZOOM = 3

/**
 * The bound `clampXY` enforces, recomputed here off the dataset rather than
 * copied from it: a literal would go stale the moment `restoreDataset` changed,
 * and silently, because the wrong bound and no bound at all look alike once the
 * input is far enough outside.
 */
function maxOrigin(dataset, chr, extent, pixelSize) {
    const binSize = dataset.bpResolutions[ZOOM]
    return Math.max(0, dataset.chromosomes[chr].size / binSize - extent / pixelSize)
}

describe('restore routes through the chokepoint (#558)', () => {

    const dom = withContainers()

    beforeEach(() => {
        vi.spyOn(ContactMatrixView.prototype, 'update').mockImplementation(async () => undefined)
        vi.spyOn(HICBrowser.prototype, 'update').mockImplementation(async () => undefined)
        vi.spyOn(igvxhr, 'loadString').mockImplementation(async () => {
            throw new Error('unexpected network access from the restore clamp suite')
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    /** One embed, one load, one stated viewport. Returns the live browser. */
    async function restore(state) {
        const browser = new HICBrowser(dom.another(), {})
        vi.spyOn(browser.contactMatrixView, 'getViewDimensions').mockReturnValue({...VIEWPORT})
        await browser.loadHicFile({url: URL, state}, true)
        return browser
    }

    test('a saved pixelSize above the cap opens at the cap', async () => {

        const browser = await restore(new State(CHR1, CHR1, ZOOM, 0, 0, 1e9, 'NONE'))

        expect(browser.state.pixelSize).toBe(MAX_PIXEL_SIZE)
    })

    test('a saved origin past the end of the chromosome is coerced, not rejected', async () => {

        const browser = await restore(new State(CHR1, CHR1, ZOOM, 999_999, 999_999, 2, 'NONE'))
        const dataset = browser.dataset

        // The load completed and left a state behind: coerced, never rejected.
        expect(browser.state).toBeDefined()

        const {pixelSize} = browser.state
        expect(browser.state.x).toBe(maxOrigin(dataset, CHR1, VIEWPORT.width, pixelSize))
        expect(browser.state.y).toBe(maxOrigin(dataset, CHR1, VIEWPORT.height, pixelSize))
    })

    test('a negative saved origin is pulled back to zero', async () => {

        const browser = await restore(new State(CHR1, CHR1, ZOOM, -50, -50, 2, 'NONE'))

        expect(browser.state.x).toBe(0)
        expect(browser.state.y).toBe(0)
    })

    test('updateLayout does not clamp, and the track-carrying session lands where the bare one does', async () => {

        const saved = new State(CHR1, CHR1, ZOOM, 999_999, 999_999, 2, 'NONE')

        const bare = await restore(saved.clone())
        const {x, y, pixelSize} = bare.state

        const withTrack = await restore(saved.clone())
        const clamp = vi.spyOn(State.prototype, 'clampXY')
        await withTrack.updateLayout()

        // The second enforcer is gone: the only clamp a restored session gets is
        // the one `setView` applied, and a track no longer adds another.
        expect(clamp).not.toHaveBeenCalled()
        expect(withTrack.state.x).toBe(x)
        expect(withTrack.state.y).toBe(y)
        expect(withTrack.state.pixelSize).toBe(pixelSize)
    })
})
