import { describe, test, expect, vi } from 'vitest'
import TrackPair from '../js/trackPair.js'
import HICBrowser from '../js/hicBrowser.js'
import { registryForContainer } from '../js/browserRegistry.js'
import { withContainers } from './utils/browserFixture.js'
import { withStubbedLoads } from './utils/stubbedLoads.js'

/**
 * A repaint does not await track pairs (#774, ADR-0022). An update resolves once
 * the contact matrix has painted, the crosshairs are refreshed and the peers are
 * synced; each track pair paints on its own, so one whose feature fetch never
 * settles paints late -- or never -- without holding up the map, its peers or
 * the other pairs. A paint that fails is that pair's warning, not the update's.
 */

const VIEWPORT = 800
const TRACK_HEIGHT = 100

const LOADED = {
    url: 'https://example.com/a.hic',
    state: { chr1: 1, chr2: 1, zoom: 5, x: 0, y: 0, pixelSize: 1, normalization: 'NONE' }
}

function renderer(axis, drawn) {
    return {
        axis,
        canvasElement: { width: VIEWPORT, height: TRACK_HEIGHT },
        drawTile: tile => drawn.push({ axis, tile }),
        showSpinner: () => {},
        dispose: () => {}
    }
}

/** A track whose feature fetch is `getFeatures` -- by default, one that answers. */
function track(getFeatures = async () => [ { chr: 'chr1', start: 0, end: 100, value: 1 } ]) {
    return {
        visibilityWindow: 0,
        dataRange: { min: 0, max: 1 },
        autoscale: false,
        getFeatures,
        draw: () => {}
    }
}

const NEVER = () => new Promise(() => {})

/** Long enough for every pair that can paint to have painted. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('a repaint does not await track pairs', () => {

    const dom = withContainers()
    withStubbedLoads()

    async function loaded(container) {
        const registry = registryForContainer(container)
        const browser = new HICBrowser(container, {})
        registry.add(browser)
        await browser.loadHicFile(LOADED)
        // `withStubbedLoads` stubs the update path, and it is this suite's
        // subject. The contact matrix's own paint stays stubbed: it is observed,
        // not exercised.
        vi.mocked(HICBrowser.prototype.update).mockRestore()
        return browser
    }

    function pairOn(browser, getFeatures) {
        const drawn = []
        const pair = new TrackPair(browser, track(getFeatures))
        pair.x = renderer('x', drawn)
        pair.y = renderer('y', drawn)
        browser.trackPairs.push(pair)
        return { pair, drawn }
    }

    test('with a track pair that never settles, a second update still repaints the matrix and syncs its peers', async () => {
        const browser = await loaded(dom.container)
        pairOn(browser, NEVER)

        const matrix = vi.spyOn(browser.contactMatrixView, 'update')
        const sync = vi.spyOn(browser, 'syncToOtherBrowsers')

        await browser.update()
        await browser.update()

        expect(matrix).toHaveBeenCalledTimes(2)
        expect(sync).toHaveBeenCalledTimes(2)
    })

    test('with one track pair stuck, the other track pairs keep painting on later updates', async () => {
        const browser = await loaded(dom.container)
        pairOn(browser, NEVER)
        const { drawn } = pairOn(browser)

        await browser.update()
        await settle()
        expect(drawn.map(d => d.axis)).toEqual(['x', 'y'])

        drawn.length = 0
        await browser.update()
        await settle()
        expect(drawn.map(d => d.axis)).toEqual(['x', 'y'])
    })

    test('a slow track paints late, at the view current when its fetch settles', async () => {
        const browser = await loaded(dom.container)
        let answer
        const features = [ { chr: 'chr1', start: 0, end: 100, value: 1 } ]
        const { drawn } = pairOn(browser, () => new Promise(resolve => { answer = resolve }))

        await browser.update()
        await browser.update()
        expect(drawn).toEqual([])

        // The first pass is answered, then the retry the second update
        // coalesced into, which finds the x tile cached and fetches only y.
        answer(features)
        await settle()
        answer(features)
        await settle()

        expect(drawn.map(d => d.axis)).toEqual(['x', 'y', 'x', 'y'])
    })

    test('a rejected track paint logs a warning, and the update still resolves', async () => {
        const browser = await loaded(dom.container)
        const failure = new Error('fetch failed')
        pairOn(browser, async () => { throw failure })

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const matrix = vi.spyOn(browser.contactMatrixView, 'update')

        await expect(browser.update()).resolves.toBeUndefined()
        await settle()

        expect(matrix).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledWith(expect.anything(), failure)
    })

    test('a paint that fails after calls coalesced into it warns for each pass, unhandled by none', async () => {
        const browser = await loaded(dom.container)
        const failure = new Error('fetch failed')
        const { pair } = pairOn(browser, async () => { throw failure })

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        // The second call arrives while the first is in flight and becomes its retry.
        await Promise.all([ pair.updateViews(), pair.updateViews() ])
        await settle()

        expect(warn).toHaveBeenCalledTimes(2)
    })
})
