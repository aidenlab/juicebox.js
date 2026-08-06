import { describe, test, expect } from 'vitest'
import ContactMatrixView from '../js/contactMatrixView.js'

/**
 * A repaint pass can outlive the state it started from (#469). Placement is read
 * live -- deliberately, so tiles that resolve late during a pan land where the
 * view is now. These cover the two halves of that: the pass must abandon itself
 * once its State object is gone or replaced, and must still follow that object
 * while it is the one in place.
 */

const VIEWPORT = 800
const BLOCK_BIN_COUNT = 100

function createView({ tiles }) {

    const drawnImages = []

    const view = Object.create(ContactMatrixView.prototype)

    view.viewportElement = { offsetWidth: VIEWPORT, offsetHeight: VIEWPORT }
    view.canvasElement = { width: VIEWPORT, height: VIEWPORT, setAttribute: () => {} }
    view.ctx = {
        clearRect: () => {},
        fillRect: () => {},
        drawImage: (image, x, y) => drawnImages.push({ image, x, y }),
        fillStyle: '#000000'
    }
    view.backgroundRGBString = 'rgb(255,255,255)'
    view.displayMode = 'A'

    const state = { chr1: 1, chr2: 1, x: 0, y: 0, zoom: 0, pixelSize: 1, normalization: 'NONE' }

    view.browser = { dataset: {}, controlDataset: undefined, state }

    // Each tile's `beforeYield` runs in the window a real tile fetch would
    // occupy, so a test can mutate or clear browser.state mid-pass.
    view.imageTileSource = {
        async* tilesFor() {
            for (const tile of tiles) {
                await Promise.resolve()
                if (tile.beforeYield) tile.beforeYield()
                yield tile
            }
        }
    }

    return { view, drawnImages }
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
        const reset = () => { fixture.view.browser.state = undefined }
        Object.assign(fixture, createView({ tiles: [ tile(0), tile(1, reset), tile(2) ] }))

        await expect(fixture.view.repaint()).resolves.toBeUndefined()
        expect(fixture.drawnImages.length).toBe(1)
    })

    test('a pass whose state is cleared before the first tile paints nothing', async () => {
        const fixture = {}
        const reset = () => { fixture.view.browser.state = undefined }
        Object.assign(fixture, createView({ tiles: [ tile(0, reset), tile(1) ] }))

        await expect(fixture.view.repaint()).resolves.toBeUndefined()
        expect(fixture.drawnImages).toEqual([])
    })

    test('a pass stops when a new map installs a different State object', async () => {
        // reset() then loadHicFile() leaves browser.state truthy again. Painting
        // the old map's tiles against the new map's state is the same hazard.
        const fixture = {}
        const load = () => {
            fixture.view.browser.state = { chr1: 5, chr2: 5, x: 0, y: 0, zoom: 0, pixelSize: 1, normalization: 'NONE' }
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
