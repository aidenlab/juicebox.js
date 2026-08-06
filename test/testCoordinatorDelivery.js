import {describe, it, expect, vi} from 'vitest'
import {withBrowser} from './utils/browserFixture.js'

/**
 * The coordinator is the internal notification route -- see #414.
 *
 * Until now there were two routes for the same logical event: the coordinator
 * calls the collaborator directly, and the collaborator *also* held an
 * `eventBus.subscribe` for the same event name. The subscriptions were dead --
 * nothing has posted those names since the coordinator migration -- but dead in
 * a way only a grep could tell you, and a re-added post would have delivered
 * twice.
 *
 * These are characterization tests, written before the subscriptions were
 * removed so they pin the surviving behaviour rather than describing it
 * afterwards: each notification reaches its collaborator, and reaches it
 * exactly once.
 */

describe('coordinator delivery', () => {

    const context = withBrowser()

    /**
     * Watch the contact matrix view one level below `receiveEvent`, so the
     * assertion is about the effect arriving rather than about the call the
     * coordinator obviously makes. `clearImageCaches` runs ahead of the
     * update and, unlike `update`, is not gated by `disableUpdates`.
     */
    function watchImageCaches(browser) {
        return vi.spyOn(browser.contactMatrixView, 'clearImageCaches').mockImplementation(() => {})
    }

    it('delivers a normalization change to the contact matrix view, once', () => {
        const cleared = watchImageCaches(context.browser)
        context.browser.coordinator.onNormalizationChange('KR')
        expect(cleared).toHaveBeenCalledTimes(1)
    })

    it('delivers a 2D track load to the contact matrix view, once', () => {
        const cleared = watchImageCaches(context.browser)
        context.browser.coordinator.onTrackLoad2D([])
        expect(cleared).toHaveBeenCalledTimes(1)
    })

    it('delivers a 2D track state change to the contact matrix view, once', () => {
        const cleared = watchImageCaches(context.browser)
        context.browser.coordinator.onTrackState2D({})
        expect(cleared).toHaveBeenCalledTimes(1)
    })

    it('delivers a colour change to the contact matrix view, once', () => {
        const cleared = watchImageCaches(context.browser)
        context.browser.coordinator.onColorChange()
        expect(cleared).toHaveBeenCalledTimes(1)
    })

    it('delivers a mouse position to both rulers', () => {
        // The ruler only does highlighting work once it has bboxes from a
        // whole-genome layout, so stand in for that.
        const rulers = [context.browser.layoutController.xAxisRuler, context.browser.layoutController.yAxisRuler]
        const unhighlights = rulers.map(ruler => {
            ruler.bboxes = []
            return vi.spyOn(ruler, 'unhighlightWholeChromosome').mockImplementation(() => {})
        })

        context.browser.coordinator.onUpdateContactMapMousePosition({x: 10, y: 20})

        for (const unhighlight of unhighlights) {
            expect(unhighlight).toHaveBeenCalledTimes(1)
        }
    })

    it('delivers normalization widget updates without the widget subscribing', () => {
        const widget = context.browser.coordinator.widgets.normalizationWidget
        const stopNotReady = vi.spyOn(widget, 'stopNotReady').mockImplementation(() => {})
        const updateOptions = vi.spyOn(widget, 'updateOptions').mockImplementation(() => {})

        context.browser.coordinator.onNormVectorIndexLoad({})

        expect(updateOptions).toHaveBeenCalledTimes(1)
        expect(stopNotReady).toHaveBeenCalledTimes(1)
    })
})
