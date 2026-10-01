import {describe, it, expect, vi} from 'vitest'
import {withContainers} from './utils/browserFixture.js'
import HICBrowser from '../js/hicBrowser.js'
import Genome from '../js/genome.js'

/**
 * Crosshairs in the source panel are echoed into the rest of its sync group,
 * at the same genomic position. #708, ADR-0020 decisions 2-5.
 *
 * Synthetic DOM events go in at the source's viewport and at `document`; what
 * comes out is read off the peers' guide elements, the peers' buses and the
 * host's handler. The arithmetic of a locus is `testCrosshairsLocus.js`'s; what
 * is claimed here is who gets told, and when.
 *
 * Membership is stated, not derived: `registry.sync()` is what fills
 * `synchedBrowsers` and has its own suites.
 *
 * JSDOM does no layout, so a mouse event's coordinates are viewport pixels.
 */

const MB = 1000000

/** chr1 by chr2 at 1 kb per bin; `All` is index 0. */
const CHROMOSOMES = ['chr1', 'chr2']
const SIZES = {chr1: 100 * MB, chr2: 80 * MB}

/**
 * A browser with a stated map and viewport, its mouse handlers installed. The
 * default is bin 100 by bin 200 at 2 px per bin, 800 x 600 px: a pixel is
 * 500 bp, x starts at 100 kb of chr1 and y at 200 kb of chr2.
 */
function panel(container, {
    state = {chr1: 1, chr2: 2, x: 100, y: 200, zoom: 0, pixelSize: 2},
    viewDimensions = {width: 800, height: 600},
    names = CHROMOSOMES,
} = {}) {
    const browser = new HICBrowser(container, {})
    const chromosomes = [
        {index: 0, name: 'All', size: 180000},
        ...names.map((name, i) => ({index: i + 1, name, size: SIZES[name]})),
    ]

    Object.defineProperty(browser, 'state', {value: state, configurable: true, writable: true})
    browser.dataset = {
        chromosomes,
        wholeGenomeResolution: 500000,
        binSizeForZoom: () => 1000,
        isWholeGenome: index => 0 === index,
    }
    browser.genome = new Genome('stand-in', chromosomes)
    vi.spyOn(browser.contactMatrixView, 'getViewDimensions').mockReturnValue(viewDimensions)
    vi.spyOn(browser.contactMatrixView.viewportElement, 'getBoundingClientRect')
        .mockReturnValue({top: 0, left: 0, width: viewDimensions.width, height: viewDimensions.height})
    // A view change is stated by writing `state`; painting it is not the
    // claim, and nor is sync -- the peers are told the locus, not the view.
    vi.spyOn(browser, 'repaint').mockResolvedValue(undefined)
    vi.spyOn(browser, 'syncToOtherBrowsers').mockImplementation(() => {})

    browser.isMobile = false
    browser.contactMatrixView.receiveEvent({type: 'MapLoad'})
    return browser
}

function syncGroup(...browsers) {
    for (const browser of browsers) {
        for (const peer of browsers) {
            if (peer !== browser) browser.synchedBrowsers.add(peer)
        }
    }
}

function mouse(browser, type, {x = 0, y = 0, ...rest} = {}) {
    browser.contactMatrixView.viewportElement.dispatchEvent(
        new window.MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, ...rest}))
}

function key(type, init = {}) {
    document.dispatchEvent(new window.KeyboardEvent(type, {bubbles: true, ...init}))
}

/**
 * The guides as drawn. `x` is where the vertical guide stands and `y` where
 * the horizontal one lies, `null` for a guide that is not shown -- on the
 * contact map and, checked to agree, over the tracks.
 */
function guides(browser) {
    const {xGuideElement, yGuideElement} = browser.contactMatrixView
    const {xTrackGuideElement, yTrackGuideElement} = browser.layoutController

    expect(xTrackGuideElement.style.display).toBe(xGuideElement.style.display)
    expect(yTrackGuideElement.style.display).toBe(yGuideElement.style.display)

    return {
        x: 'block' === yGuideElement.style.display ? parseFloat(yGuideElement.style.left) : null,
        y: 'block' === xGuideElement.style.display ? parseFloat(xGuideElement.style.top) : null,
    }
}

const HIDDEN = {x: null, y: null}

describe('crosshairs echo across the sync group', () => {

    const dom = withContainers()

    it('shows the source\'s crosshairs at the same locus in a synced peer, and hides them together', () => {
        const a = panel(dom.container)
        const b = panel(dom.another())
        syncGroup(a, b)

        mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
        expect(guides(a)).toEqual({x: 40, y: 60})
        expect(guides(b)).toEqual({x: 40, y: 60})

        mouse(a, 'mousemove', {x: 50, y: 80, shiftKey: true})
        expect(guides(b)).toEqual({x: 50, y: 80})

        key('keyup', {key: 'Shift'})
        expect(guides(a)).toEqual(HIDDEN)
        expect(guides(b)).toEqual(HIDDEN)
    })

    it('marks the same locus in a peer with a different viewport size and scale', () => {
        const a = panel(dom.container)
        // From the chromosomes' starts at 1 px per bin: a pixel is 1 kb.
        const b = panel(dom.another(), {
            state: {chr1: 1, chr2: 2, x: 0, y: 0, zoom: 0, pixelSize: 1},
            viewDimensions: {width: 400, height: 300},
        })
        syncGroup(a, b)

        // chr1:120,000 by chr2:230,000 in the source.
        mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})

        expect(guides(b)).toEqual({x: 120, y: 230})
    })

    it('shows no echo in a panel outside the source\'s sync group', () => {
        const a = panel(dom.container)
        const b = panel(dom.another())
        const isolated = panel(dom.another())
        syncGroup(a, b)

        mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})

        expect(guides(b)).toEqual({x: 40, y: 60})
        expect(guides(isolated)).toEqual(HIDDEN)
    })

    it('shows no echo in a panel that has opted out since the group was derived', () => {
        const a = panel(dom.container)
        const b = panel(dom.another())
        syncGroup(a, b)
        b.synchable = false

        mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})

        expect(guides(b)).toEqual(HIDDEN)
    })

    it('shows no guide on an axis whose position is out of the peer\'s view', () => {
        const a = panel(dom.container)
        // x starts at 200 kb of chr1, past the source's 120 kb.
        const b = panel(dom.another(), {state: {chr1: 1, chr2: 2, x: 200, y: 200, zoom: 0, pixelSize: 2}})
        syncGroup(a, b)

        mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
        expect(guides(b)).toEqual({x: null, y: 60})

        // Back in view on x, out of it on y: each axis answers for itself.
        b.state.x = 100
        b.state.y = 500
        mouse(a, 'mousemove', {x: 40, y: 60, shiftKey: true})
        expect(guides(b)).toEqual({x: 40, y: null})
    })

    it('hides the echoes when the pointer leaves the source with shift held', () => {
        const a = panel(dom.container)
        const b = panel(dom.another())
        syncGroup(a, b)

        mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
        mouse(a, 'mouseleave', {x: 900, y: 60, shiftKey: true})

        expect(guides(a)).toEqual(HIDDEN)
        expect(guides(b)).toEqual(HIDDEN)
    })

    it('hides the echoes when the source is disposed with its crosshairs showing', () => {
        const a = panel(dom.container)
        const b = panel(dom.another())
        syncGroup(a, b)

        mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
        a.dispose()

        expect(guides(b)).toEqual(HIDDEN)
    })

    it('hands the source over to the panel the pointer moves into', () => {
        const a = panel(dom.container)
        const b = panel(dom.another())
        syncGroup(a, b)

        mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
        mouse(a, 'mouseleave', {x: 900, y: 60, shiftKey: true})
        mouse(b, 'mouseover', {x: 10, y: 20, shiftKey: true})

        expect(guides(b)).toEqual({x: 10, y: 20})
        expect(guides(a)).toEqual({x: 10, y: 20})

        // The old source is an echo now: a view change of its own re-places
        // the locus it was handed, and publishes nothing back.
        a.state.x = 90
        return a.update(false).then(() => {
            expect(guides(a)).toEqual({x: 30, y: 20})
            expect(guides(b)).toEqual({x: 10, y: 20})
        })
    })

    describe('a view change under a still pointer', () => {

        it('moves the echoes to the new locus under the pointer', async () => {
            const a = panel(dom.container)
            const b = panel(dom.another())
            syncGroup(a, b)

            mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})

            // A wheel-zoom lands as a state change and an update. Pixel 40 was
            // chr1:120,000; from bin 80 at 4 px per bin it is chr1:90,000,
            // which the peer -- 500 bp per pixel from 100 kb -- cannot show.
            a.state.x = 80
            a.state.pixelSize = 4
            await a.update()
            expect(guides(a)).toEqual({x: 40, y: 60})
            // y: bin 200 + 60/4 = chr2:215,000, 30 px into the peer.
            expect(guides(b)).toEqual({x: null, y: 30})
        })

        it('re-places an echo when the peer\'s own view changes', async () => {
            const a = panel(dom.container)
            const b = panel(dom.another())
            syncGroup(a, b)

            mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})

            b.state.x = 90
            await b.update(false)

            // chr1:120,000 is 30 bins, 60 px, past bin 90.
            expect(guides(b)).toEqual({x: 60, y: 60})
        })

        it('re-places nothing once the crosshairs are hidden', async () => {
            const a = panel(dom.container)
            const b = panel(dom.another())
            syncGroup(a, b)

            mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
            key('keyup', {key: 'Shift'})
            await a.update()
            await b.update(false)

            expect(guides(a)).toEqual(HIDDEN)
            expect(guides(b)).toEqual(HIDDEN)
        })
    })

    it('lands on the same chromosome and bp in a whole-genome peer that orders its chromosomes differently', () => {
        // 500 kb per bin and 1 px per bin, from the genome's start.
        const wholeGenome = {chr1: 0, chr2: 0, x: 0, y: 0, zoom: 0, pixelSize: 1}
        const a = panel(dom.container, {state: {...wholeGenome}, names: ['chr1', 'chr2']})
        const b = panel(dom.another(), {state: {...wholeGenome}, names: ['chr2', 'chr1']})
        syncGroup(a, b)

        // x: 105 Mb is 5 Mb into chr2, which the source lays after chr1's
        // 100 Mb. y: 10 Mb into chr1.
        mouse(a, 'mouseover', {x: 210, y: 20, shiftKey: true})

        // The peer lays chr2 first: chr2:5 Mb is bin 10, and chr1:10 Mb is
        // 90 Mb along, bin 180.
        expect(guides(b)).toEqual({x: 10, y: 180})
    })

    it('never notifies the host from an echo', () => {
        const a = panel(dom.container)
        const b = panel(dom.another())
        syncGroup(a, b)

        const handler = vi.fn()
        b.setCustomCrosshairsHandler(handler)
        const posted = []
        for (const type of ['DidShowCrosshairs', 'DidHideCrosshairs']) {
            b.eventBus.subscribe(type, event => posted.push(event.type))
        }

        mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
        mouse(a, 'mousemove', {x: 50, y: 80, shiftKey: true})
        mouse(a, 'mouseleave', {x: 900, y: 60, shiftKey: true})

        expect(handler).not.toHaveBeenCalled()
        expect(posted).toEqual([])
    })
})
