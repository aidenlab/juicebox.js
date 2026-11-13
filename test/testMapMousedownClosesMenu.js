import {describe, it, expect, vi, beforeEach} from 'vitest'
import {withBrowser} from './utils/browserFixture.js'

/**
 * A press on the contact map closes the panel's ☰ menu if it is open, and the
 * press still reaches the map. #751.
 *
 * JSDOM does no layout, so the coordinates are viewport pixels whichever of
 * `offsetX`, `pageX` or `clientX` the handler reads.
 */

function mouse(target, type, {x = 0, y = 0} = {}) {
    target.dispatchEvent(new window.MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y}))
}

describe('a mouse-down on the contact map', () => {

    const context = withBrowser()

    let browser
    let viewport
    let shiftPixels

    beforeEach(() => {
        browser = context.browser
        viewport = browser.contactMatrixView.viewportElement
        shiftPixels = vi.spyOn(browser.interactions, 'shiftPixels').mockResolvedValue(undefined)
        browser.contactMatrixView.receiveEvent({type: 'MapLoad'})
    })

    it('closes the menu when it is open, and still starts a pan', () => {
        browser.showMenu()

        mouse(viewport, 'mousedown', {x: 100, y: 100})
        mouse(viewport, 'mousemove', {x: 110, y: 100})

        expect(browser.menuElement.style.display).toBe('none')
        expect(shiftPixels.mock.calls).toEqual([[-10, 0]])
    })

    it('leaves a closed menu alone, and still starts a pan', () => {
        const hideMenu = vi.spyOn(browser, 'hideMenu')

        mouse(viewport, 'mousedown', {x: 100, y: 100})
        mouse(viewport, 'mousemove', {x: 110, y: 100})

        expect(hideMenu).not.toHaveBeenCalled()
        expect(shiftPixels.mock.calls).toEqual([[-10, 0]])
    })
})
