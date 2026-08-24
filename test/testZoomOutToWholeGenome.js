/**
 * Zooming out past the minimum zoom lands on the whole-genome view -- #589.
 *
 * `pinchZoom` and `_performWheelZoom` are two gestures onto one behaviour, and
 * the pinch copy had drifted: it asked for chromosome `1` instead of the
 * whole-genome locus, and passed `{ xLocus }` -- an object whose only key is
 * `xLocus` -- where a locus was wanted. The claims below are made against both
 * entry points from the same starting state, so the two cannot drift again
 * without a red test.
 */
import {describe, expect, test, vi} from 'vitest'
import InteractionHandler from '../js/interactionHandler.js'
import {createInteractionBrowser} from './utils/interactionBrowser.js'

/** The two gestures, named by the method that drives them. */
const gestures = [
    ['pinchZoom', (handler, scaleFactor) => handler.pinchZoom(400, 400, scaleFactor)],
    ['_performWheelZoom', (handler, scaleFactor) => handler._performWheelZoom(400, 400, scaleFactor)],
]

/** Small enough that the matched zoom index falls below `minZoom`. */
const ZOOM_OUT = 0.1

describe.each(gestures)('%s zoomed out past the minimum zoom', (name, gesture) => {

    test('navigates to the whole-genome view on both axes', async () => {
        const browser = createInteractionBrowser()
        const handler = new InteractionHandler(browser)
        const setChromosomes = vi.spyOn(handler, 'setChromosomes').mockResolvedValue(undefined)

        await gesture(handler, ZOOM_OUT)

        expect(setChromosomes).toHaveBeenCalledTimes(1)
        const [xLocus, yLocus] = setChromosomes.mock.calls[0]

        // The whole-genome chromosome, not chromosome 1.
        expect(xLocus.chr).toBe('all')
        // A locus, not a `{ xLocus: ... }` wrapper: same keys, same values.
        expect(Object.keys(yLocus).sort()).toEqual(Object.keys(xLocus).sort())
        expect(yLocus).toEqual(xLocus)
        expect(yLocus.chr).toBe('all')
    })

    test('stays put when the resolution is locked', async () => {
        const browser = createInteractionBrowser({resolutionLocked: true})
        const handler = new InteractionHandler(browser)
        const setChromosomes = vi.spyOn(handler, 'setChromosomes').mockResolvedValue(undefined)

        await gesture(handler, ZOOM_OUT)

        expect(setChromosomes).not.toHaveBeenCalled()
    })

    test('stays put when zooming in', async () => {
        const browser = createInteractionBrowser()
        const handler = new InteractionHandler(browser)
        const setChromosomes = vi.spyOn(handler, 'setChromosomes').mockResolvedValue(undefined)

        await gesture(handler, 2)

        expect(setChromosomes).not.toHaveBeenCalled()
    })

    test('stays put on a single-chromosome assembly, whose All is a zoom rung', async () => {
        const browser = createInteractionBrowser({isSingleChromosome: true})
        const handler = new InteractionHandler(browser)
        const setChromosomes = vi.spyOn(handler, 'setChromosomes').mockResolvedValue(undefined)

        await gesture(handler, ZOOM_OUT)

        expect(setChromosomes).not.toHaveBeenCalled()
    })
})
