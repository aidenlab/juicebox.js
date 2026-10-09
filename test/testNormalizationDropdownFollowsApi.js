/**
 * The navbar Norm dropdown follows `browser.setNormalization()`.
 *
 * A host calling the public method (juicebox-mcp's remote does) used to repaint
 * the map while the dropdown kept the old selection, because
 * `onNormalizationChange` assumed the change came from the dropdown. The claim
 * is on the coordinator seam: a real browser, a real widget, a real selector.
 */
import {describe, test, expect, vi, beforeEach} from 'vitest'
import State from '../js/hicState.js'
import {withBrowser} from './utils/browserFixture.js'

describe('the Norm dropdown follows browser.setNormalization()', () => {

    const context = withBrowser()

    // `setNormalization` reports the state's value onward, so a state is needed.
    beforeEach(async () => {
        const {browser} = context
        browser.dataset = {
            chromosomes: [{size: 1e6}, {size: 1e6}],
            binSizeForZoom: () => 250000,
            isSingleChromosome: () => false,
            getNormalizationOptions: async () => ['NONE', 'KR'],
        }
        vi.spyOn(browser, 'update').mockResolvedValue()
        vi.spyOn(browser.contactMatrixView, 'receiveEvent').mockImplementation(() => {})
        vi.spyOn(browser.coordinator, 'onLocusChange').mockImplementation(() => {})
        vi.spyOn(browser, 'minPixelSize').mockResolvedValue(1)
        await browser.setState(new State(1, 1, 3, 10, 10, 1, 'NONE'))
    })

    /** A real widget with a selector offering `values`, the first selected. */
    function widgetOffering(values) {
        const widget = context.browser.coordinator.widgets.normalizationWidget
        for (const value of values) {
            const option = document.createElement('option')
            option.value = value
            widget.normalizationSelector.appendChild(option)
        }
        return widget
    }

    test('the selector shows the new value and setNormalization is not re-entered', () => {
        const {browser} = context
        const widget = widgetOffering(['NONE', 'KR'])
        const spy = vi.spyOn(browser, 'setNormalization')

        browser.setNormalization('KR')

        expect(widget.normalizationSelector.value).toBe('KR')
        expect(spy).toHaveBeenCalledTimes(1)
    })

    test('a standing substitution is still cleared, not announced', () => {
        const widget = widgetOffering(['NONE', 'KR'])
        const clear = vi.spyOn(widget, 'clearSubstitution')
        const announce = vi.spyOn(widget, 'announceSubstitution')

        context.browser.setNormalization('KR')

        expect(clear).toHaveBeenCalled()
        expect(announce).not.toHaveBeenCalled()
    })
})
