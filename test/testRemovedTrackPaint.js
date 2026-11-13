import { describe, test, expect, vi } from 'vitest'
import TrackPair from '../js/trackPair.js'
import HICBrowser from '../js/hicBrowser.js'
import { registryForContainer } from '../js/browserRegistry.js'
import { withContainers } from './utils/browserFixture.js'
import { withStubbedLoads } from './utils/stubbedLoads.js'

/**
 * A paint that settles after its track pair was removed is dropped (#775,
 * ADR-0022 decision 5). **Remove track** in the gear menu is the escape hatch
 * from a pair whose paint is stuck: a fetch cannot be cancelled, so its late
 * result is discarded instead -- it draws nothing and does not start the retry
 * coalesced into it. ADR-0017 decision 8 is the same rule for loads.
 */

const VIEWPORT = 800
const TRACK_HEIGHT = 100

const LOADED = {
    url: 'https://example.com/a.hic',
    state: { chr1: 1, chr2: 1, zoom: 5, x: 0, y: 0, pixelSize: 1, normalization: 'NONE' }
}

const FEATURES = [ { chr: 'chr1', start: 0, end: 100, value: 1 } ]

/** A row as the layout reads it: an element carrying the reorder arrows. */
function row() {
    const element = document.createElement('div')
    element.innerHTML = '<i class="fa fa-arrow-up"></i><i class="fa fa-arrow-down"></i>'
    return element
}

function renderer(axis, drawn) {
    return {
        axis,
        canvasElement: { width: VIEWPORT, height: TRACK_HEIGHT },
        viewportElement: row(),
        syncCanvas: () => {},
        drawTile: tile => drawn.push({ axis, tile }),
        showSpinner: () => {},
        dispose: () => {}
    }
}

function track(getFeatures) {
    return {
        visibilityWindow: 0,
        dataRange: { min: 0, max: 1 },
        autoscale: false,
        getFeatures,
        draw: () => {}
    }
}

/** A fetch that settles only when the test answers it, and counts its calls. */
function heldFetch() {
    const answers = []
    const getFeatures = vi.fn(() => new Promise(resolve => answers.push(resolve)))
    return { getFeatures, answer: () => answers.shift()(FEATURES) }
}

/** Long enough for every pair that can paint to have painted. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('a paint that settles after its track pair was removed', () => {

    const dom = withContainers()
    withStubbedLoads()

    async function loaded(container) {
        const registry = registryForContainer(container)
        const browser = new HICBrowser(container, {})
        registry.add(browser)
        await browser.loadHicFile(LOADED)
        vi.mocked(HICBrowser.prototype.update).mockRestore()
        return browser
    }

    function pairOn(browser, getFeatures = async () => FEATURES) {
        const drawn = []
        const pair = new TrackPair(browser, track(getFeatures))
        pair.x = renderer('x', drawn)
        pair.y = renderer('y', drawn)
        browser.trackPairs.push(pair)
        return { pair, drawn }
    }

    test('draws nothing', async () => {
        const browser = await loaded(dom.container)
        const { getFeatures, answer } = heldFetch()
        const { pair, drawn } = pairOn(browser, getFeatures)

        await browser.update()
        browser.layoutController.removeTrackXYPair(pair)

        answer()
        await settle()

        expect(drawn).toEqual([])
        expect(getFeatures).toHaveBeenCalledTimes(1)
    })

    test('does not start the retry coalesced into it', async () => {
        const browser = await loaded(dom.container)
        const { getFeatures, answer } = heldFetch()
        const { pair, drawn } = pairOn(browser, getFeatures)

        // The second update arrives while the first paint is in flight and
        // becomes its retry.
        await browser.update()
        await browser.update()
        browser.layoutController.removeTrackXYPair(pair)

        answer()
        await settle()

        expect(getFeatures).toHaveBeenCalledTimes(1)
        expect(drawn).toEqual([])
    })

    test('removing a stuck track leaves the map and the other tracks painting', async () => {
        const browser = await loaded(dom.container)
        const { pair: stuck } = pairOn(browser, () => new Promise(() => {}))
        const { drawn } = pairOn(browser)

        await browser.update()
        browser.layoutController.removeTrackXYPair(stuck)
        await settle()

        // The matrix's paint is the prototype's stub, shared with the updates above.
        const matrix = vi.mocked(browser.contactMatrixView.update)
        matrix.mockClear()
        drawn.length = 0

        await browser.update()
        await settle()

        expect(matrix).toHaveBeenCalledTimes(1)
        expect(drawn.map(d => d.axis)).toEqual(['x', 'y'])
    })
})
