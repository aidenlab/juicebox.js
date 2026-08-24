/**
 * Zooming out past the minimum zoom lands on the whole-genome view -- #589.
 *
 * `pinchZoom` and `_performWheelZoom` are two gestures onto one behaviour, and
 * the pinch copy had drifted: it asked for chromosome `1` instead of the
 * whole-genome locus, and passed `{ xLocus }` -- an object whose only key is
 * `xLocus` -- where a locus was wanted. The claims below are made against both
 * entry points from the same starting state, so the two cannot drift again
 * without a red test.
 *
 * The gesture runs into a real `State` through the real `setChromosomes`, so
 * what is pinned is the view arrived at, not the arguments handed onward. The
 * one spy is on `setChromosomes` itself, in the test that has to look at the
 * loci it receives -- the malformed `yLocus` was invisible downstream.
 */
import {describe, expect, test, vi} from 'vitest'
import InteractionHandler from '../js/interactionHandler.js'
import {createGestureBrowser, START_PIXEL_SIZE, START_ZOOM} from './utils/gestureBrowser.js'

/** The two gestures, named by the method that drives them. */
const gestures = [
    ['pinchZoom', (handler, scaleFactor) => handler.pinchZoom(400, 400, scaleFactor)],
    ['_performWheelZoom', (handler, scaleFactor) => handler._performWheelZoom(400, 400, scaleFactor)],
]

/** Small enough that the matched zoom index falls below `minZoom`. */
const ZOOM_OUT = 0.1

/** The whole-genome view, as `hicState` spells it. */
const WHOLE_GENOME_CHR = 0

describe.each(gestures)('%s zoomed out past the minimum zoom', (name, gesture) => {

    test('lands on the whole-genome view', async () => {
        const browser = createGestureBrowser()
        const handler = new InteractionHandler(browser)

        await gesture(handler, ZOOM_OUT)

        expect(browser.state.chr1).toBe(WHOLE_GENOME_CHR)
        expect(browser.state.chr2).toBe(WHOLE_GENOME_CHR)
    })

    test('asks setChromosomes for the whole genome on both axes', async () => {
        const browser = createGestureBrowser()
        const handler = new InteractionHandler(browser)
        const setChromosomes = vi.spyOn(handler, 'setChromosomes')

        await gesture(handler, ZOOM_OUT)

        expect(setChromosomes).toHaveBeenCalledTimes(1)
        const [xLocus, yLocus] = setChromosomes.mock.calls[0]

        // The whole-genome chromosome, not chromosome 1.
        expect(xLocus.chr).toBe('All')
        // A locus, not a `{ xLocus: ... }` wrapper: same keys, same values.
        expect(Object.keys(yLocus).sort()).toEqual(Object.keys(xLocus).sort())
        expect(yLocus).toEqual(xLocus)
    })

    test('both gestures reach the identical state from the identical start', async () => {
        const pinchBrowser = createGestureBrowser()
        const wheelBrowser = createGestureBrowser()

        await new InteractionHandler(pinchBrowser).pinchZoom(400, 400, ZOOM_OUT)
        await new InteractionHandler(wheelBrowser)._performWheelZoom(400, 400, ZOOM_OUT)

        expect({...pinchBrowser.state}).toEqual({...wheelBrowser.state})
    })

    test('stays on the current chromosome pair when the resolution is locked', async () => {
        const browser = createGestureBrowser({resolutionLocked: true})
        const handler = new InteractionHandler(browser)

        await gesture(handler, ZOOM_OUT)

        expect(browser.state.chr1).toBe(1)
        expect(browser.state.chr2).toBe(1)
        // The locked path zooms by pixel size instead of by rung.
        expect(browser.state.zoom).toBe(START_ZOOM)
        expect(browser.state.pixelSize).toBeLessThan(START_PIXEL_SIZE)
    })

    test.each([1, 2])('stays on the current chromosome pair at scaleFactor %d', async scaleFactor => {
        const browser = createGestureBrowser()
        const handler = new InteractionHandler(browser)

        await gesture(handler, scaleFactor)

        expect(browser.state.chr1).toBe(1)
        expect(browser.state.chr2).toBe(1)
    })

    test('stays put on a single-chromosome assembly, whose All is a zoom rung', async () => {
        const browser = createGestureBrowser({isSingleChromosome: true})
        const handler = new InteractionHandler(browser)

        await gesture(handler, ZOOM_OUT)

        expect(browser.state.chr1).toBe(1)
        expect(browser.state.chr2).toBe(1)
    })
})
