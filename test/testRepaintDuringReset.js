import { describe, test, expect } from 'vitest'
import ContactMatrixView from '../js/contactMatrixView.js'
import HICBrowser from '../js/hicBrowser.js'
import { registryForContainer } from '../js/browserRegistry.js'
import { withContainers } from './utils/browserFixture.js'
import { withStubbedLoads } from './utils/stubbedLoads.js'

/**
 * A repaint pass can outlive the state it started from (#469). Placement is read
 * live -- deliberately, so tiles that resolve late during a pan land where the
 * view is now. These cover the two halves of that: the pass must abandon itself
 * once its State object is gone or replaced, and must still follow that object
 * while it is the one in place.
 *
 * The second suite runs the same two claims through the real `reset()` (#495).
 * The abandonment check is identity-based, so a reconstruction that reused the
 * existing `State` object would leave every in-flight pass painting into a
 * browser being rebuilt -- silently, and only under load latency. Decision 2 of
 * ADR-0005, named there as the review gate on candidate 8.
 */

const VIEWPORT = 800
const BLOCK_BIN_COUNT = 100

/** The same viewport, in the shape the translators and clampXY read it in. */
const VIEW_DIMENSIONS = { width: VIEWPORT, height: VIEWPORT }

function createView({ tiles }) {

    const view = Object.create(ContactMatrixView.prototype)

    view.backgroundRGBString = 'rgb(255,255,255)'
    view.displayMode = 'A'

    // The stand-in browser reads its state through a getter, as the real one
    // does since #563 -- a fixture whose `state` is a writable field is a
    // fixture shaped unlike the thing it stands in for, which is the blindness
    // `stubbedLoads` was rewritten to remove. `install` is this fixture's
    // chokepoint: the tests below drive it from a tile's suspension point.
    const held = { state: { chr1: 1, chr2: 1, x: 0, y: 0, zoom: 0, pixelSize: 1, normalization: 'NONE' } }

    view.browser = {
        dataset: {},
        controlDataset: undefined,
        get state() { return held.state }
    }

    const install = state => { held.state = state }

    return { view, install, drawnImages: instrument(view, tiles) }
}

/**
 * A tile source that hands over one tile at a time with a suspension point in
 * front of each. Each tile's `beforeYield` runs in the window a real tile fetch
 * would occupy, so a test can pan, clear or reset mid-pass.
 */
function tileSource(tiles) {
    return {
        async* tilesFor() {
            for (const tile of tiles) {
                await Promise.resolve()
                if (tile.beforeYield) tile.beforeYield()
                yield tile
            }
        }
    }
}

/**
 * Point a ContactMatrixView's drawing surface at a recorder, and its tile
 * source at `tiles`. Everything the identity check reads -- `browser.state`,
 * and the browser it hangs off -- is left alone, because that is the thing
 * under test, which is what lets this serve both a hand-built view and a real
 * one taken off a browser.
 */
function instrument(view, tiles) {

    const drawnImages = []

    view.viewportElement = { offsetWidth: VIEWPORT, offsetHeight: VIEWPORT }
    view.canvasElement = { width: VIEWPORT, height: VIEWPORT, setAttribute: () => {} }
    view.ctx = {
        clearRect: () => {},
        fillRect: () => {},
        drawImage: (image, x, y) => drawnImages.push({ image, x, y }),
        fillStyle: '#000000'
    }
    view.imageTileSource = tileSource(tiles)

    return drawnImages
}

function tile(column, beforeYield) {
    return {
        image: { width: BLOCK_BIN_COUNT, height: BLOCK_BIN_COUNT },
        row: 0,
        column,
        blockBinCount: BLOCK_BIN_COUNT,
        binSize: 1000,
        beforeYield
    }
}

describe('repaint against a state that is replaced mid-pass', () => {

    test('a pass whose state is cleared between tiles stops rather than throwing', async () => {
        const fixture = {}
        const reset = () => fixture.install(undefined)
        Object.assign(fixture, createView({ tiles: [ tile(0), tile(1, reset), tile(2) ] }))

        await expect(fixture.view.repaint()).resolves.toBeUndefined()
        expect(fixture.drawnImages.length).toBe(1)
    })

    test('a pass whose state is cleared before the first tile paints nothing', async () => {
        const fixture = {}
        const reset = () => fixture.install(undefined)
        Object.assign(fixture, createView({ tiles: [ tile(0, reset), tile(1) ] }))

        await expect(fixture.view.repaint()).resolves.toBeUndefined()
        expect(fixture.drawnImages).toEqual([])
    })

    test('a pass stops when a new map installs a different State object', async () => {
        // reset() then loadHicFile() leaves browser.state truthy again. Painting
        // the old map's tiles against the new map's state is the same hazard.
        const fixture = {}
        const load = () => {
            fixture.install({ chr1: 5, chr2: 5, x: 0, y: 0, zoom: 0, pixelSize: 1, normalization: 'NONE' })
        }
        Object.assign(fixture, createView({ tiles: [ tile(0), tile(1, load), tile(2) ] }))

        await fixture.view.repaint()

        expect(fixture.drawnImages.length).toBe(1)
    })

    test('placement still follows the live state while the state is there', async () => {
        const fixture = {}
        const pan = () => { fixture.view.browser.state.x = 50 }
        Object.assign(fixture, createView({ tiles: [ tile(0), tile(1, pan) ] }))

        await fixture.view.repaint()

        // offsetX = (blockBinCount * column - x) * pixelSize
        expect(fixture.drawnImages.map(({ x }) => x)).toEqual([ 0, 50 ])
    })
})

describe('repaint across a real reset()', () => {

    const dom = withContainers()
    withStubbedLoads()

    // zoom 5 is the stub dataset's finest resolution, so chr1 is thousands of
    // bins wide and clampXY leaves a pan of 50 bins where it lands. At a
    // coarser zoom the whole chromosome is narrower than the viewport, maxX is
    // 0, and every pan clamps back to the origin.
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

    test('neither half of the juicebox-web sequence hands back the old State', async () => {
        // reset(), then load. The reset itself leaves no state at all -- it
        // reconstructs, and a browser with no dataset has none -- which
        // testBrowserReset.js pins as an identity claim. What matters here is
        // that the object is gone by the time the load puts one back, because
        // that load is where a browser is live again and repainting.
        const browser = await loaded(dom.container)
        const before = browser.state

        browser.reset()
        expect(browser.state).toBeUndefined()

        await browser.loadHicFile(LOADED)
        expect(browser.state).toBeDefined()
        expect(browser.state).not.toBe(before)
    })

    test('a pass in flight across a reset() abandons itself', async () => {
        const browser = await loaded(dom.container)
        const view = browser.contactMatrixView
        const drawnImages = instrument(view, [ tile(0), tile(1, () => browser.reset()), tile(2) ])

        await expect(view.repaint()).resolves.toBeUndefined()

        expect(drawnImages.length).toBe(1)
    })

    test('a pass in flight across a reset() and a reload abandons itself', async () => {
        // reset() then loadHicFile() leaves browser.state truthy again, which is
        // the case a null check would miss and identity catches.
        const browser = await loaded(dom.container)
        const view = browser.contactMatrixView
        let reloaded
        const reload = () => {
            browser.reset()
            reloaded = browser.loadHicFile(LOADED)
        }
        const drawnImages = instrument(view, [ tile(0), tile(1, reload), tile(2) ])

        await view.repaint()
        await reloaded

        expect(browser.state).toBeDefined()
        expect(drawnImages.length).toBe(1)
    })

    test('a pass in flight across an ordinary pan still completes', async () => {
        // The other half: the check must not be so aggressive that a pan -- which
        // mutates through the chokepoint and keeps the object -- stands a pass down.
        const browser = await loaded(dom.container)
        const view = browser.contactMatrixView
        const state = browser.state
        let panned
        const pan = () => {
            panned = state.panShift(50, 0, browser, browser.dataset, VIEW_DIMENSIONS)
        }
        const drawnImages = instrument(view, [ tile(0), tile(1, pan) ])

        await view.repaint()
        await panned

        expect(browser.state).toBe(state)
        expect(state.x).toBe(50)
        // offsetX = (blockBinCount * column - x) * pixelSize, read live
        expect(drawnImages.map(({ x }) => x)).toEqual([ 0, 50 ])
    })
})
