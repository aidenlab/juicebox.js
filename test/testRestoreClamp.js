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
 * 3. `updateLayout` no longer clamps, and a restored session carrying a track
 *    ends up in the same place as the same session without one. Before #558
 *    `clampXY` had two reachable callers, and `updateLayout` runs only when
 *    tracks change — so the track-carrying session was clamped incidentally and
 *    the bare one was not, and the same saved session opened two ways
 *    (ADR-0009 fact 6).
 *
 *    The comparison is driven, not argued: the same saved state is restored
 *    twice, one browser is given a track pair and taken through the layout pass
 *    a track change triggers, and the two origins are asserted equal. The track
 *    pair is a stub (`stubTrackPair`) rather than a loaded track, because what
 *    reaches `State` from a track is `updateLayout` and nothing else — the igv
 *    parsing and the renderer behind a real track never touch the canonical
 *    six. Every caller of `updateLayout` is a track add, remove or reorder:
 *    `dataLoader.js:433`, `layoutController.js:168` and `:187`,
 *    `annotationWidget.js:233` and `:247`.
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
import {describe, expect, test, vi} from 'vitest'
import State from '../js/hicState.js'
import {MAX_PIXEL_SIZE} from '../js/hicBrowser.js'
import {restoreFixture, VIEWPORT} from './utils/restoreFixture.js'

vi.mock('../js/hicDataset.js', async () => {
    const {restoreDataset, datasetModule} = await import('./utils/restoreDataset.js')
    return datasetModule(restoreDataset)
})

const {default: HICBrowser} = await import('../js/hicBrowser.js')

const HIC_URL = 'https://example.org/restore-clamp.hic'

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

/**
 * The least a `trackPair` can be and still survive `updateLayout`: two elements
 * whose `style.order` it writes and whose reorder arrows
 * `setTrackReorderArrowColors` colours, and a `syncCanvas` it calls. Real
 * elements, so `querySelector` answers as it does in a page.
 */
function stubTrackPair(window) {

    const side = () => {
        const viewportElement = window.document.createElement('div')
        viewportElement.innerHTML = '<i class="fa-arrow-up"></i><i class="fa-arrow-down"></i>'
        return {viewportElement, syncCanvas: () => undefined}
    }

    return {x: side(), y: side()}
}

describe('restore routes through the chokepoint (#558)', () => {

    const {dom, restore: restoreFrom} = restoreFixture(HICBrowser, {suite: 'restore clamp'})

    /** One embed, one load of the fixture file. Returns the live browser. */
    const restore = state => restoreFrom(HIC_URL, state)

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

    test('the session that carries a track lands where the bare one does, and updateLayout does not clamp', async () => {

        const saved = new State(CHR1, CHR1, ZOOM, 999_999, 999_999, 2, 'NONE')

        const bare = await restore(saved.clone())
        const {x, y, pixelSize} = bare.state

        const withTrack = await restore(saved.clone())
        withTrack.trackPairs = [stubTrackPair(dom.window)]

        // The layout pass a track add, remove or reorder triggers — the whole of
        // what a track brings to this seam.
        const clamp = vi.spyOn(State.prototype, 'clampXY')
        await withTrack.updateLayout()

        // The second enforcer is gone: the only clamp a restored session gets is
        // the one `setView` applied, and a track no longer adds another.
        expect(clamp).not.toHaveBeenCalled()
        expect(withTrack.state.x).toBe(x)
        expect(withTrack.state.y).toBe(y)
        expect(withTrack.state.pixelSize).toBe(pixelSize)

        // Both sides of the equality are inside the chromosome, so it is not two
        // browsers agreeing on an unclamped origin.
        expect(x).toBeLessThan(999_999)
    })
})
