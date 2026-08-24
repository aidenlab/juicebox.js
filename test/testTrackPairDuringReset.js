import { describe, test, expect } from 'vitest'
import TrackPair from '../js/trackPair.js'
import HICBrowser from '../js/hicBrowser.js'
import { registryForContainer } from '../js/browserRegistry.js'
import { withContainers } from './utils/browserFixture.js'
import { withStubbedLoads } from './utils/stubbedLoads.js'

/**
 * A track pair's render pass has the same shape as the contact matrix repaint
 * #469 fixed: it reads canonical state *after* an await, so a `reset()` landing
 * mid-pass leaves it dereferencing a dataset and a state that are gone (#473).
 *
 * Both halves are pinned here, as they are for the matrix view: a pass in
 * flight across a reset abandons itself rather than throwing, and a pass in
 * flight across an ordinary pan -- which mutates through the chokepoint and so
 * keeps the same State object -- still completes.
 */

const VIEWPORT = 800
const TRACK_HEIGHT = 100
const VIEW_DIMENSIONS = { width: VIEWPORT, height: VIEWPORT }

/**
 * A stand-in for a TrackRenderer: the axis it draws, the canvas the tile is
 * sized against, and a recorder in place of the pixels. Rendering has its own
 * tests; what is under test here is which state the pass places against.
 */
function renderer(axis, drawn) {
    return {
        axis,
        canvasElement: { width: VIEWPORT, height: TRACK_HEIGHT },
        drawTile: (tile, genomicState) => drawn.push({ axis, tile, genomicState }),
        dispose: () => {}
    }
}

/**
 * A track whose `draw` is the suspension point a test drives from. `draw` runs
 * inside `createImageTile`, once per tile, with the await that follows it
 * standing in for the window a real feature fetch occupies.
 */
function track(onDraw) {
    let drawCount = 0
    return {
        visibilityWindow: 0,
        dataRange: { min: 0, max: 1 },
        autoscale: false,
        getFeatures: async () => [ { chr: 'chr1', start: 0, end: 100, value: 1 } ],
        draw: () => {
            drawCount += 1
            if (onDraw) onDraw(drawCount)
        }
    }
}

describe('track pair renders across a real reset()', () => {

    const dom = withContainers()
    withStubbedLoads()

    // zoom 5 is the stub dataset's finest resolution, so chr1 is thousands of
    // bins wide and a pan of 50 bins survives clampXY. Same reason as the
    // contact matrix suite.
    const LOADED = {
        url: 'https://example.com/a.hic',
        state: { chr1: 1, chr2: 1, zoom: 5, x: 0, y: 0, pixelSize: 1, normalization: 'NONE' }
    }

    /** A registered, current browser with a dataset and a State object on it. */
    async function loaded(container) {
        const registry = registryForContainer(container)
        const browser = new HICBrowser(container, {})
        registry.add(browser)
        await browser.loadHicFile(LOADED)
        return browser
    }

    /**
     * A TrackPair on a real browser, with the renderers and the track standing
     * in. It is pushed onto `browser.trackPairs` because that is where a real
     * pair lives and what `reset()` clears out from under an in-flight pass.
     */
    function pairOn(browser, onDraw) {
        const drawn = []
        const pair = new TrackPair(browser, track(onDraw))
        pair.x = renderer('x', drawn)
        pair.y = renderer('y', drawn)
        browser.trackPairs.push(pair)
        return { pair, drawn }
    }

    test('updateViews in flight across a reset() abandons itself', async () => {
        const browser = await loaded(dom.container)
        // The first tile is the x tile; resetting from inside its draw puts the
        // reset in the window before the pass reads state again for y.
        const { pair, drawn } = pairOn(browser, count => {
            if (1 === count) browser.reset()
        })

        await expect(pair.updateViews()).resolves.toBeUndefined()

        expect(browser.state).toBeUndefined()
        expect(drawn).toEqual([])
    })

    test('updateViews in flight across a reset() and a reload abandons itself', async () => {
        // reset() then loadHicFile() leaves browser.state truthy again, which is
        // the case a null check would miss and identity catches.
        const browser = await loaded(dom.container)
        let reloaded
        const { pair, drawn } = pairOn(browser, count => {
            if (1 === count) {
                browser.reset()
                reloaded = browser.loadHicFile(LOADED)
            }
        })

        await expect(pair.updateViews()).resolves.toBeUndefined()
        await reloaded

        expect(browser.state).toBeDefined()
        expect(drawn).toEqual([])
    })

    test('repaintViews in flight across a reset() abandons itself', async () => {
        const browser = await loaded(dom.container)
        const { pair, drawn } = pairOn(browser)

        // repaintViews only touches an axis that already has a tile, so the
        // pass has to have run once before.
        await pair.updateViews()
        expect(drawn.length).toBe(2)
        drawn.length = 0

        pair.track.draw = () => browser.reset()

        const tileBefore = pair.tileX

        await expect(pair.repaintViews()).resolves.toBeUndefined()

        expect(browser.state).toBeUndefined()
        expect(drawn).toEqual([])
        // A pass that stands down leaves nothing of itself behind: the tile it
        // built against the replaced state is not kept.
        expect(pair.tileX).toBe(tileBefore)
    })

    test('a menu repaint arriving after a reset() draws nothing', async () => {
        // The gear menu's handlers call `repaintViews()` unawaited
        // (`trackMenuUtils.js`), so a pass that starts after the browser is
        // gone throws into nothing. Entering the pass is guarded, not just
        // resuming it.
        const browser = await loaded(dom.container)
        const { pair, drawn } = pairOn(browser)

        await pair.updateViews()
        drawn.length = 0

        browser.reset()

        await expect(pair.repaintViews()).resolves.toBeUndefined()

        expect(drawn).toEqual([])
    })

    test('a pass in flight across an ordinary pan still completes', async () => {
        // The other half: the check must not be so aggressive that a pan --
        // which mutates through the chokepoint and keeps the object -- stands a
        // pass down.
        const browser = await loaded(dom.container)
        const state = browser.state
        let panned
        const { pair, drawn } = pairOn(browser, count => {
            if (1 === count) {
                panned = state.panShift(50, 0, browser, browser.dataset, VIEW_DIMENSIONS)
            }
        })

        await pair.updateViews()
        await panned

        expect(browser.state).toBe(state)
        expect(state.x).toBe(50)
        expect(drawn.map(({ axis }) => axis)).toEqual([ 'x', 'y' ])
    })

    test('a pass coalesced into an abandoned one stands itself down too', async () => {
        // A second call arriving mid-pass sets `pending`, and the `finally`
        // starts it -- unawaited, so a throw there is exactly the unhandled
        // rejection #469 surfaced as a pageerror. The retry is watched rather
        // than assumed: it has to meet the guard at the top of the pass.
        const browser = await loaded(dom.container)
        const { pair, drawn } = pairOn(browser, count => {
            if (1 === count) {
                pair.updateViews()   // coalesces: sets `pending`
                browser.reset()
            }
        })

        const passes = []
        const updateViews = pair.updateViews.bind(pair)
        pair.updateViews = () => {
            const pass = updateViews()
            passes.push(pass)
            return pass
        }

        await pair.updateViews()
        await expect(Promise.all(passes)).resolves.toBeDefined()

        expect(pair.pending).toBe(false)
        expect(drawn).toEqual([])
    })

    test('a pass with no reset draws both axes', async () => {
        const browser = await loaded(dom.container)
        const { pair, drawn } = pairOn(browser)

        await pair.updateViews()

        expect(drawn.map(({ axis }) => axis)).toEqual([ 'x', 'y' ])
    })
})
