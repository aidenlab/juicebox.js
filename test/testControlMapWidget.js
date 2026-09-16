import {describe, it, expect} from 'vitest'
import {withDOM} from './utils/browserFixture.js'
import ControlMapWidget, {displayModeOptions} from '../js/controlMapWidget.js'

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

describe('ControlMapWidget icons', () => {

    // test/setup.js mocks a global `document` that cannot parse markup.
    function makeWidget() {
        const {window, restore} = withDOM()
        try {
            const navbar = window.document.createElement('div')
            const widgetContainer = window.document.createElement('div')
            widgetContainer.id = 'test-lower-hic-nav-bar-widget-container'
            navbar.appendChild(widgetContainer)
            return new ControlMapWidget({}, navbar)
        } finally {
            restore()
        }
    }

    // An unsized <svg> is 300x150 by default -- an invisible A/B click target (#673).
    it('sizes every icon, so no icon becomes a 300x150 click target', () => {
        const svgs = [...makeWidget().container.querySelectorAll('svg')]
        expect(svgs).toHaveLength(4)
        for (const svg of svgs) {
            expect(svg.getAttribute('width')).toBe('34px')
            expect(svg.getAttribute('height')).toBe('34px')
            expect(svg.getAttribute('viewBox')).toBe('0 0 34 34')
        }
    })

    it('draws artwork in every icon', () => {
        for (const svg of makeWidget().container.querySelectorAll('svg')) {
            expect(svg.querySelector('path')).not.toBeNull()
        }
    })
})
