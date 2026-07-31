import {describe, it, expect} from 'vitest'
import {displayModeOptions} from '../js/controlMapWidget.js'

describe('displayModeOptions', () => {

    it('offers every display mode the renderer supports', () => {
        expect(Object.keys(displayModeOptions).sort())
            .toEqual(['A', 'AMB', 'AOB', 'B', 'BOA'])
    })

    it('keys each option by its own value', () => {
        for (const [mode, option] of Object.entries(displayModeOptions)) {
            expect(option.value).toBe(mode)
        }
    })

    // toggleDisplayMode() reads `other`, and doToggle() re-arms itself every
    // 2500ms. A mode whose `other` is itself would repaint forever without
    // ever changing what is on screen.
    it('never toggles a mode to itself, which would cycle forever in place', () => {
        for (const [mode, option] of Object.entries(displayModeOptions)) {
            expect(option.other).not.toBe(mode)
        }
    })

    it('only toggles to modes it can toggle back out of', () => {
        for (const option of Object.values(displayModeOptions)) {
            expect(displayModeOptions[option.other]).toBeDefined()
        }
    })
})
