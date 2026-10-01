import {describe, it, expect, vi} from 'vitest'
import {withContainers} from './utils/browserFixture.js'
import {panel, syncGroup, mouse, key} from './utils/crosshairsPanel.js'

/**
 * What a host hears about the crosshairs: `onCrosshairsMove` and
 * `onCrosshairsHide` on the coordinator, once per pointer move, from the source
 * only -- and the old handler and bus events, kept as shims over those two.
 * #709, ADR-0020 decisions 5-6.
 *
 * Synthetic DOM events go in at a viewport and at `document`; what comes out is
 * read off the callbacks a host registers. Where the guides are drawn is
 * `testCrosshairsEcho.js`'s claim.
 */

/** Every crosshairs callback this panel's host receives, in order. */
function host(browser) {
    const heard = []
    browser.coordinator.addCallback('onCrosshairsMove', payload => heard.push(['move', payload]))
    browser.coordinator.addCallback('onCrosshairsHide', (...args) => heard.push(['hide', ...args]))
    return heard
}

/** The old surface: the custom handler and the two bus events, in order. */
function legacyHost(browser) {
    const heard = []
    browser.setCustomCrosshairsHandler(payload => heard.push(['handler', payload]))
    for (const type of ['DidShowCrosshairs', 'DidHideCrosshairs']) {
        browser.eventBus.subscribe(type, event => heard.push([event.type]))
    }
    return heard
}

// The default panel: 500 bp per pixel, 800 x 600 px from chr1:100 kb, chr2:200 kb.
const EXTENTS = {startXBP: 100000, endXBP: 500000, startYBP: 200000, endYBP: 500000}

describe('crosshairs host callbacks', () => {

    const dom = withContainers()

    it('tells the host the locus under the pointer, and the visible extents, on each move', () => {
        const a = panel(dom.container)
        const heard = host(a)

        mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
        mouse(a, 'mousemove', {x: 50, y: 80, shiftKey: true})

        expect(heard).toEqual([
            ['move', {chr1: 'chr1', xBP: 120000, chr2: 'chr2', yBP: 230000, extents: EXTENTS}],
            ['move', {chr1: 'chr1', xBP: 125000, chr2: 'chr2', yBP: 240000, extents: EXTENTS}],
        ])
    })

    it('says nothing until shift is held', () => {
        const a = panel(dom.container)
        const heard = host(a)

        mouse(a, 'mouseover', {x: 40, y: 60})
        mouse(a, 'mousemove', {x: 50, y: 80})

        expect(heard).toEqual([])
    })

    it('names a real chromosome in the whole-genome view, never All', () => {
        // 500 kb per bin and 1 px per bin, from the genome's start.
        const a = panel(dom.container, {state: {chr1: 0, chr2: 0, x: 0, y: 0, zoom: 0, pixelSize: 1}})
        const heard = host(a)

        // x: 105 Mb is 5 Mb into chr2, which lies after chr1's 100 Mb.
        mouse(a, 'mouseover', {x: 210, y: 20, shiftKey: true})

        expect(heard).toHaveLength(1)
        expect(heard[0][1]).toMatchObject({chr1: 'chr2', xBP: 5000000, chr2: 'chr1', yBP: 10000000})
    })

    it('tells the host the crosshairs are hidden when shift is released', () => {
        const a = panel(dom.container)
        const heard = host(a)

        mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
        key('keyup', {key: 'Shift'})

        expect(heard.map(([name]) => name)).toEqual(['move', 'hide'])
        expect(heard[1]).toEqual(['hide'])
    })

    it('tells the host the crosshairs are hidden when the pointer leaves the viewport', () => {
        const a = panel(dom.container)
        const heard = host(a)

        mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
        mouse(a, 'mouseleave', {x: 900, y: 60, shiftKey: true})

        expect(heard.map(([name]) => name)).toEqual(['move', 'hide'])
    })

    it('says nothing of a hide to a panel that was showing no crosshairs of its own', () => {
        const a = panel(dom.container)
        const heard = host(a)

        // A key release reaches every panel on the page.
        key('keyup', {key: 'a'})

        expect(heard).toEqual([])
    })

    it('never tells the host from an echo', () => {
        const a = panel(dom.container)
        const b = panel(dom.another())
        syncGroup(a, b)
        const heard = host(b)

        mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
        mouse(a, 'mousemove', {x: 50, y: 80, shiftKey: true})
        key('keyup', {key: 'Shift'})

        expect(heard).toEqual([])
    })

    it('tells each panel\'s host in turn as the pointer crosses from one to the other', () => {
        const a = panel(dom.container)
        const b = panel(dom.another())
        syncGroup(a, b)
        const heard = []
        for (const [name, browser] of [['a', a], ['b', b]]) {
            browser.coordinator.addCallback('onCrosshairsMove', () => heard.push(`${name} move`))
            browser.coordinator.addCallback('onCrosshairsHide', () => heard.push(`${name} hide`))
        }

        mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
        mouse(a, 'mouseleave', {x: 900, y: 60, shiftKey: true})
        mouse(b, 'mouseover', {x: 10, y: 20, shiftKey: true})

        expect(heard).toEqual(['a move', 'a hide', 'b move'])
    })

    describe('a view change under a still pointer', () => {

        it('tells the source\'s host the new locus and extents', async () => {
            const a = panel(dom.container)
            const heard = host(a)

            mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})

            // A wheel-zoom lands as a state change and an update: from bin 80
            // at 4 px per bin, a pixel is 250 bp.
            a.state.x = 80
            a.state.pixelSize = 4
            await a.update()

            expect(heard).toHaveLength(2)
            expect(heard[1]).toEqual(['move', {
                chr1: 'chr1', xBP: 90000, chr2: 'chr2', yBP: 215000,
                extents: {startXBP: 80000, endXBP: 280000, startYBP: 200000, endYBP: 350000},
            }])
        })

        it('says nothing more when a repaint leaves the view where it was', async () => {
            const a = panel(dom.container)
            const heard = host(a)

            mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
            await a.update()

            expect(heard).toHaveLength(1)
        })

        it('tells an echoing panel\'s host nothing when its own view changes', async () => {
            const a = panel(dom.container)
            const b = panel(dom.another())
            syncGroup(a, b)
            const heard = host(b)

            mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
            b.state.x = 90
            await b.update(false)

            expect(heard).toEqual([])
        })

        it('tells the host nothing once the crosshairs are hidden', async () => {
            const a = panel(dom.container)
            const heard = host(a)

            mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
            key('keyup', {key: 'Shift'})
            await a.update()

            expect(heard.map(([name]) => name)).toEqual(['move', 'hide'])
        })
    })

    it('finishes the move and the hide when a host\'s callback throws', () => {
        const a = panel(dom.container)
        const b = panel(dom.another())
        syncGroup(a, b)
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        a.coordinator.addCallback('onCrosshairsMove', () => { throw new Error('host') })
        a.coordinator.addCallback('onCrosshairsHide', () => { throw new Error('host') })
        const heard = host(a)
        const legacy = legacyHost(a)

        mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
        key('keyup', {key: 'Shift'})

        expect(heard.map(([name]) => name)).toEqual(['move', 'hide'])
        expect(legacy.map(([name]) => name)).toEqual(['DidShowCrosshairs', 'handler', 'DidHideCrosshairs'])
        expect(b.contactMatrixView.xGuideElement.style.display).toBe('none')
        expect(error).toHaveBeenCalledTimes(2)
        error.mockRestore()
    })

    it('stops telling a host that has unsubscribed', () => {
        const a = panel(dom.container)
        const moved = vi.fn()
        const unsubscribe = a.coordinator.addCallback('onCrosshairsMove', moved)

        unsubscribe()
        mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})

        expect(moved).not.toHaveBeenCalled()
    })

    /**
     * Deprecated, and kept through 4.x: each fires where a new callback does,
     * so each is source-only too. ADR-0020 decision 6.
     */
    describe('the old surface, as shims over the callbacks', () => {

        it('calls the old handler with its old payload on each move, show first and hide last', () => {
            const a = panel(dom.container)
            const heard = legacyHost(a)

            mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
            mouse(a, 'mousemove', {x: 80, y: 120, shiftKey: true})
            key('keyup', {key: 'Shift'})

            expect(heard).toEqual([
                ['DidShowCrosshairs'],
                ['handler', {xBP: 120000, yBP: 230000, ...EXTENTS, interpolantX: 0.05, interpolantY: 0.1}],
                ['handler', {xBP: 140000, yBP: 260000, ...EXTENTS, interpolantX: 0.1, interpolantY: 0.2}],
                ['DidHideCrosshairs'],
            ])
        })

        it('posts DidShowCrosshairs again once the crosshairs have been hidden and come back', () => {
            const a = panel(dom.container)
            const heard = legacyHost(a)

            mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
            mouse(a, 'mouseleave', {x: 900, y: 60, shiftKey: true})
            mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})

            expect(heard.map(([name]) => name))
                .toEqual(['DidShowCrosshairs', 'handler', 'DidHideCrosshairs', 'DidShowCrosshairs', 'handler'])
        })

        it('reaches neither the old handler nor the bus of a panel showing an echo', () => {
            const a = panel(dom.container)
            const b = panel(dom.another())
            syncGroup(a, b)
            const heard = legacyHost(b)

            mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
            mouse(a, 'mousemove', {x: 50, y: 80, shiftKey: true})
            key('keyup', {key: 'Shift'})

            expect(heard).toEqual([])
        })

        it('calls the old handler when the view changes under a still pointer', async () => {
            const a = panel(dom.container)
            const heard = legacyHost(a)

            mouse(a, 'mouseover', {x: 40, y: 60, shiftKey: true})
            a.state.x = 80
            await a.update()

            expect(heard.map(([name]) => name)).toEqual(['DidShowCrosshairs', 'handler', 'handler'])
            expect(heard[2][1]).toMatchObject({xBP: 100000, startXBP: 80000, interpolantX: 0.05})
        })

        it('warns once that setCustomCrosshairsHandler is deprecated', () => {
            const a = panel(dom.container)
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

            a.setCustomCrosshairsHandler(() => {})
            a.setCustomCrosshairsHandler(() => {})

            expect(warn).toHaveBeenCalledTimes(1)
            expect(warn.mock.calls[0][0]).toMatch(/setCustomCrosshairsHandler is deprecated.*onCrosshairsMove/)
            warn.mockRestore()
        })
    })
})
