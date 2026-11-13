import { describe, test, expect, vi } from 'vitest'
import TrackPair from '../js/trackPair.js'
import HICBrowser from '../js/hicBrowser.js'
import { registryForContainer } from '../js/browserRegistry.js'
import { withContainers } from './utils/browserFixture.js'
import { withStubbedLoads } from './utils/stubbedLoads.js'

/**
 * A track pair shows its own spinner while a paint fetches (#776). A repaint no
 * longer waits on track pairs (ADR-0022), so the map spinner covers only the
 * contact matrix; without this a slow track would sit blank with nothing to say
 * it is working. The spinner goes up on both the x and y track only when the
 * pass misses the pair's tile cache, and comes down when the pass ends.
 *
 * What is pinned here is when the pair asks its renderers to show the spinner.
 * That the spinner then shows is DOM, checked by hand (ADR-0013).
 */

const VIEWPORT = 800
const TRACK_HEIGHT = 100

const LOADED = {
    url: 'https://example.com/a.hic',
    state: { chr1: 1, chr2: 1, zoom: 5, x: 0, y: 0, pixelSize: 1, normalization: 'NONE' }
}

const FEATURES = [ { chr: 'chr1', start: 0, end: 100, value: 1 } ]

function row() {
    const element = document.createElement('div')
    element.innerHTML = '<i class="fa fa-arrow-up"></i><i class="fa fa-arrow-down"></i>'
    return element
}

/** A renderer that remembers whether it was last asked to show its spinner. */
function renderer(axis) {
    return {
        axis,
        spinning: false,
        asked: [],
        canvasElement: { width: VIEWPORT, height: TRACK_HEIGHT },
        viewportElement: row(),
        syncCanvas: () => {},
        drawTile: () => {},
        showSpinner(show) { this.spinning = show; this.asked.push(show) },
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

/** A fetch that settles only when the test answers it. */
function heldFetch() {
    const answers = []
    const getFeatures = vi.fn(() => new Promise((resolve, reject) => answers.push({ resolve, reject })))
    return {
        getFeatures,
        answer: () => answers.shift().resolve(FEATURES),
        fail: () => answers.shift().reject(new Error('host went away'))
    }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('a track pair shows its own spinner while it fetches', () => {

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

    function pairOn(browser, getFeatures) {
        const pair = new TrackPair(browser, track(getFeatures))
        pair.x = renderer('x')
        pair.y = renderer('y')
        browser.trackPairs.push(pair)
        return pair
    }

    const spinning = pair => [pair.x.spinning, pair.y.spinning]

    test('is up on both tracks while the paint fetches, and down once it paints', async () => {
        const browser = await loaded(dom.container)
        const { getFeatures, answer } = heldFetch()
        const pair = pairOn(browser, getFeatures)

        await browser.update()
        expect(spinning(pair)).toEqual([true, true])

        answer()
        await settle()
        answer()
        await settle()

        expect(spinning(pair)).toEqual([false, false])
    })

    test('does not go up for a pan the cached tile still covers', async () => {
        const browser = await loaded(dom.container)
        const pair = pairOn(browser, async () => FEATURES)

        await browser.update()
        await settle()
        pair.x.asked.length = 0
        pair.y.asked.length = 0

        // A drag of a few pixels: the tile spans three viewports, so it still covers.
        browser.state.x += 2
        browser.state.y += 2
        await browser.update()
        await settle()

        expect(pair.x.asked).toEqual([])
        expect(pair.y.asked).toEqual([])
    })

    test('comes down when the paint fails', async () => {
        const browser = await loaded(dom.container)
        const { getFeatures, fail } = heldFetch()
        const pair = pairOn(browser, getFeatures)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await browser.update()
        expect(spinning(pair)).toEqual([true, true])

        fail()
        await settle()

        expect(spinning(pair)).toEqual([false, false])
        expect(warn).toHaveBeenCalledTimes(1)
        warn.mockRestore()
    })

    test('comes down when the pass is abandoned because its pair was removed', async () => {
        const browser = await loaded(dom.container)
        const { getFeatures, answer } = heldFetch()
        const pair = pairOn(browser, getFeatures)

        await browser.update()
        browser.layoutController.removeTrackXYPair(pair)

        answer()
        await settle()

        expect(spinning(pair)).toEqual([false, false])
    })
})
