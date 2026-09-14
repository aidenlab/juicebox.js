import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {withBrowser} from './utils/browserFixture.js'

/**
 * Characterization of the viewport's gestures, as they are today -- quirks
 * included. #651.
 *
 * The gesture state machines are about to move out of `ContactMatrixView`
 * (#580, #652). These tests are the gate for that move: synthetic DOM events go
 * in at the viewport and at `document`, and what comes out is read at the
 * seams a host or the move's destination can see -- the calls arriving on
 * `browser.interactions`, the events on the browser's bus, the coordinator's
 * mouse position, and the host's crosshairs handler. None of them is a field
 * inside the view.
 *
 * Nothing here is a fix. Where today's behaviour is wrong it is pinned as it
 * is and the test names the bug filed against it, because a test that bakes in
 * a fix cannot prove the move changed nothing.
 *
 * JSDOM does no layout, so every bounding rect is at the origin and a mouse
 * event's `offsetX`, `pageX` and `clientX` all read the same number. The
 * coordinates below are therefore viewport pixels, whichever of the three the
 * handler happens to read.
 */

/**
 * The calls every gesture path converges on. Spied on the instance so the
 * stand-in holds whether a gesture arrives through `HICBrowser`'s forwarding
 * methods, as today, or directly, as it may after the move.
 */
function watchInteractions(browser) {
    const {interactions} = browser
    return {
        shiftPixels: vi.spyOn(interactions, 'shiftPixels').mockResolvedValue(undefined),
        zoomAndCenter: vi.spyOn(interactions, 'zoomAndCenter').mockResolvedValue(undefined),
        pinchZoom: vi.spyOn(interactions, 'pinchZoom').mockResolvedValue(undefined),
        handleWheelZoom: vi.spyOn(interactions, 'handleWheelZoom').mockResolvedValue(undefined),
    }
}

/** Every event type posted on the browser's bus, in order. */
function watchPosts(browser, types) {
    const posted = []
    for (const type of types) {
        browser.eventBus.subscribe(type, event => posted.push(event.type))
    }
    return posted
}

/**
 * Install the handlers the way a map load does: the view holds off until it
 * has a dataset, and reads the mobile flag at that moment.
 */
function loadMap(browser, {mobile}) {
    browser.isMobile = mobile
    browser.contactMatrixView.receiveEvent({type: 'MapLoad'})
}

/**
 * A map to gesture over, for the paths that read one: the sweep converts its
 * rectangle to base pairs, and the crosshairs handler reports a locus.
 *
 * `state` is defined over the getter rather than set, as
 * `testCoordinatorDelivery.js` does, because its one writer wants a real
 * dataset these claims are not about. The viewport is stated, not measured
 * (ADR-0009 fact 5).
 *
 * Bin 100 by bin 200 at 1 kb and 2 px per bin, 800 x 600 px: so a viewport
 * pixel is 500 bp, the x axis starts at 100 kb and the y axis at 200 kb.
 */
function standInMap(browser) {
    Object.defineProperty(browser, 'state', {
        value: {chr1: 1, chr2: 2, x: 100, y: 200, zoom: 0, pixelSize: 2},
        configurable: true,
        writable: true,
    })
    browser.dataset = {
        chromosomes: [{index: 0, name: 'All'}, {index: 1, name: 'chr1'}, {index: 2, name: 'chr2'}],
        binSizeForZoom: () => 1000,
    }
    vi.spyOn(browser.contactMatrixView, 'getViewDimensions').mockReturnValue({width: 800, height: 600})
    // The mouse-move handler measures the rect rather than asking the view.
    vi.spyOn(browser.contactMatrixView.viewportElement, 'getBoundingClientRect')
        .mockReturnValue({top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0})
}

function mouse(target, type, init = {}) {
    const {x = 0, y = 0, ...rest} = init
    target.dispatchEvent(new window.MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, ...rest}))
}

/**
 * A touch event carrying one touch per `[x, y]` point.
 *
 * JSDOM has `TouchEvent` but no `Touch`, so the event is a plain one with
 * `targetTouches` defined on it -- which is all the handlers read. `timeStamp`
 * is defined the same way when a test needs to control it.
 */
function touch(target, type, points, {timeStamp} = {}) {
    const event = new window.Event(type, {bubbles: true, cancelable: true})
    Object.defineProperty(event, 'targetTouches', {value: points.map(([pageX, pageY]) => ({pageX, pageY}))})
    if (undefined !== timeStamp) {
        Object.defineProperty(event, 'timeStamp', {value: timeStamp})
    }
    target.dispatchEvent(event)
}

function key(type, init = {}) {
    document.dispatchEvent(new window.KeyboardEvent(type, {bubbles: true, ...init}))
}

describe('viewport gestures', () => {

    const context = withBrowser()

    let browser
    let viewport
    let interactions

    beforeEach(() => {
        browser = context.browser
        viewport = browser.contactMatrixView.viewportElement
        interactions = watchInteractions(browser)
    })

    describe('mouse, mobile flag off', () => {

        beforeEach(() => loadMap(browser, {mobile: false}))

        it('pans by the pixels moved since the last mouse-move once a drag passes the threshold', () => {
            mouse(viewport, 'mousedown', {x: 100, y: 100})
            mouse(viewport, 'mousemove', {x: 110, y: 104})
            mouse(viewport, 'mousemove', {x: 115, y: 110})

            expect(interactions.shiftPixels.mock.calls).toEqual([[-10, -4], [-5, -6]])
        })

        it('posts DragStopped when a drag ends in a mouse-up', () => {
            const posted = watchPosts(browser, ['DragStopped'])

            mouse(viewport, 'mousedown', {x: 100, y: 100})
            mouse(viewport, 'mousemove', {x: 110, y: 100})
            mouse(viewport, 'mouseup', {x: 110, y: 100})

            expect(posted).toEqual(['DragStopped'])
        })

        it('posts DragStopped when a drag leaves the viewport', () => {
            const posted = watchPosts(browser, ['DragStopped'])

            mouse(viewport, 'mousedown', {x: 100, y: 100})
            mouse(viewport, 'mousemove', {x: 110, y: 100})
            mouse(viewport, 'mouseleave', {x: 110, y: 100})

            expect(posted).toEqual(['DragStopped'])
        })

        it('zooms in and centres on the point double-clicked', () => {
            mouse(viewport, 'dblclick', {x: 120, y: 80})

            expect(interactions.zoomAndCenter.mock.calls).toEqual([[1, 120, 80]])
        })

        it('zooms in about the pointer on a wheel scrolled up, and out on one scrolled down', () => {
            viewport.dispatchEvent(new window.WheelEvent('wheel', {bubbles: true, cancelable: true, clientX: 30, clientY: 40, deltaY: -5}))
            viewport.dispatchEvent(new window.WheelEvent('wheel', {bubbles: true, cancelable: true, clientX: 50, clientY: 60, deltaY: 5}))

            expect(interactions.handleWheelZoom.mock.calls).toEqual([[30, 40, 1.008], [50, 60, 0.992]])
        })

        it('commits an alt-drag sweep as a goto for the swept rectangle, whichever way it was swept', () => {
            standInMap(browser)
            const goto = vi.spyOn(browser, 'goto').mockResolvedValue(undefined)

            // Swept from bottom-right to top-left: 40 x 60 px at (10, 20).
            mouse(viewport, 'mousedown', {x: 50, y: 80, altKey: true})
            mouse(viewport, 'mousemove', {x: 10, y: 20, altKey: true})
            mouse(document, 'mouseup', {x: 10, y: 20})

            expect(goto.mock.calls).toEqual([['chr1', 105000, 125000, 'chr2', 210000, 240000]])
        })

        it('does not pan while sweeping', () => {
            standInMap(browser)
            vi.spyOn(browser, 'goto').mockResolvedValue(undefined)

            mouse(viewport, 'mousedown', {x: 50, y: 80, altKey: true})
            mouse(viewport, 'mousemove', {x: 10, y: 20, altKey: true})

            expect(interactions.shiftPixels).not.toHaveBeenCalled()
        })

        describe('quirks, pinned as they are', () => {

            it('commits an alt-click that never moves against the previous sweep\'s end point (#653)', () => {
                standInMap(browser)
                const goto = vi.spyOn(browser, 'goto').mockResolvedValue(undefined)

                mouse(viewport, 'mousedown', {x: 50, y: 80, altKey: true})
                mouse(viewport, 'mousemove', {x: 10, y: 20, altKey: true})
                mouse(document, 'mouseup', {x: 10, y: 20})
                goto.mockClear()

                // Clicked at (200, 300) and released there, yet the rectangle
                // runs back to (10, 20), where the last sweep ended.
                mouse(viewport, 'mousedown', {x: 200, y: 300, altKey: true})
                mouse(document, 'mouseup', {x: 200, y: 300})

                expect(goto.mock.calls).toEqual([['chr1', 105000, 200000, 'chr2', 210000, 350000]])
            })

            it('does not start a drag on vertical movement alone (#654)', () => {
                mouse(viewport, 'mousedown', {x: 100, y: 100})
                mouse(viewport, 'mousemove', {x: 100, y: 150})

                expect(interactions.shiftPixels).not.toHaveBeenCalled()
            })

            it('does not start a drag from a mouse-down at x = 0 (#654)', () => {
                mouse(viewport, 'mousedown', {x: 0, y: 100})
                mouse(viewport, 'mousemove', {x: 50, y: 100})

                expect(interactions.shiftPixels).not.toHaveBeenCalled()
            })
        })
    })

    /**
     * A browser flagged mobile installs no mouse handlers at all, so a
     * touchscreen laptop that trips the flag loses every mouse gesture --
     * crosshairs included. Pinned as it is: #655.
     */
    /**
     * Both crosshair paths Spacewalk depends on: the `DidShowCrosshairs` /
     * `DidHideCrosshairs` pair on the bus, and the handler a host registers
     * with `setCustomCrosshairsHandler` (Spacewalk's `juiceboxPanel.js`).
     */
    describe('crosshairs and mouse position, mobile flag off', () => {

        beforeEach(() => {
            loadMap(browser, {mobile: false})
            standInMap(browser)
        })

        it('reports the mouse position within the contact map to the coordinator', () => {
            const reported = vi.spyOn(browser.coordinator, 'onUpdateContactMapMousePosition').mockImplementation(() => {})

            mouse(viewport, 'mousemove', {x: 40, y: 60})

            expect(reported.mock.calls).toEqual([[{x: 40, y: 60, xNormalized: 0.05, yNormalized: 0.1}]])
        })

        it('posts DidShowCrosshairs when shift goes down over the viewport', () => {
            const posted = watchPosts(browser, ['DidShowCrosshairs'])

            mouse(viewport, 'mouseover')
            key('keydown', {key: 'Shift', shiftKey: true})

            expect(posted).toEqual(['DidShowCrosshairs'])
        })

        it('does not post DidShowCrosshairs for shift pressed away from the viewport', () => {
            const posted = watchPosts(browser, ['DidShowCrosshairs'])

            mouse(viewport, 'mouseover')
            mouse(viewport, 'mouseout')
            key('keydown', {key: 'Shift', shiftKey: true})

            expect(posted).toEqual([])
        })

        it('calls the host\'s crosshairs handler with the full payload on each mouse-move once shift is held', () => {
            const handler = vi.fn()
            browser.setCustomCrosshairsHandler(handler)

            mouse(viewport, 'mousemove', {x: 10, y: 10})
            mouse(viewport, 'mouseover')
            key('keydown', {key: 'Shift', shiftKey: true})
            mouse(viewport, 'mousemove', {x: 40, y: 60})

            // 500 bp per pixel, axes starting at 100 kb and 200 kb, 800 x 600 px.
            expect(handler.mock.calls).toEqual([[{
                xBP: 120000,
                yBP: 230000,
                startXBP: 100000,
                startYBP: 200000,
                endXBP: 500000,
                endYBP: 500000,
                interpolantX: 0.05,
                interpolantY: 0.1,
            }]])
        })

        it('posts DidHideCrosshairs and stops calling the host\'s handler on keyup', () => {
            const handler = vi.fn()
            browser.setCustomCrosshairsHandler(handler)
            const posted = watchPosts(browser, ['DidShowCrosshairs', 'DidHideCrosshairs'])

            mouse(viewport, 'mouseover')
            key('keydown', {key: 'Shift', shiftKey: true})
            key('keyup', {key: 'Shift'})
            mouse(viewport, 'mousemove', {x: 40, y: 30})

            expect(posted).toEqual(['DidShowCrosshairs', 'DidHideCrosshairs'])
            expect(handler).not.toHaveBeenCalled()
        })

        /**
         * Not a bug, and deliberately not filed as one: Spacewalk listens for
         * `DidHideCrosshairs` and may rely on it arriving for any key release,
         * shown or not. Change this only with Spacewalk in view.
         */
        it('posts DidHideCrosshairs on any document keyup, even when crosshairs were never shown', () => {
            const posted = watchPosts(browser, ['DidHideCrosshairs'])

            key('keyup', {key: 'a'})

            expect(posted).toEqual(['DidHideCrosshairs'])
        })
    })

    describe('mouse, mobile flag on', () => {

        beforeEach(() => {
            loadMap(browser, {mobile: true})
            standInMap(browser)
        })

        it('does not pan on a drag', () => {
            mouse(viewport, 'mousedown', {x: 100, y: 100})
            mouse(viewport, 'mousemove', {x: 110, y: 104})

            expect(interactions.shiftPixels).not.toHaveBeenCalled()
        })

        it('does not post DragStopped on mouse-up or mouse-leave', () => {
            const posted = watchPosts(browser, ['DragStopped'])

            mouse(viewport, 'mousedown', {x: 100, y: 100})
            mouse(viewport, 'mousemove', {x: 110, y: 100})
            mouse(viewport, 'mouseup', {x: 110, y: 100})
            mouse(viewport, 'mousedown', {x: 100, y: 100})
            mouse(viewport, 'mousemove', {x: 110, y: 100})
            mouse(viewport, 'mouseleave', {x: 110, y: 100})

            expect(posted).toEqual([])
        })

        it('does not zoom on a double-click', () => {
            mouse(viewport, 'dblclick', {x: 120, y: 80})

            expect(interactions.zoomAndCenter).not.toHaveBeenCalled()
        })

        it('does not zoom on a wheel', () => {
            viewport.dispatchEvent(new window.WheelEvent('wheel', {bubbles: true, cancelable: true, clientX: 30, clientY: 40, deltaY: -5}))

            expect(interactions.handleWheelZoom).not.toHaveBeenCalled()
        })

        it('does not commit an alt-drag sweep', () => {
            const goto = vi.spyOn(browser, 'goto').mockResolvedValue(undefined)

            mouse(viewport, 'mousedown', {x: 50, y: 80, altKey: true})
            mouse(viewport, 'mousemove', {x: 10, y: 20, altKey: true})
            mouse(document, 'mouseup', {x: 10, y: 20})

            expect(goto).not.toHaveBeenCalled()
        })

        it('does not report the mouse position to the coordinator', () => {
            const reported = vi.spyOn(browser.coordinator, 'onUpdateContactMapMousePosition').mockImplementation(() => {})

            mouse(viewport, 'mousemove', {x: 40, y: 30})

            expect(reported).not.toHaveBeenCalled()
        })

        it('posts neither crosshairs event, and never calls the host\'s crosshairs handler', () => {
            const handler = vi.fn()
            browser.setCustomCrosshairsHandler(handler)
            const posted = watchPosts(browser, ['DidShowCrosshairs', 'DidHideCrosshairs'])

            mouse(viewport, 'mouseover')
            key('keydown', {key: 'Shift', shiftKey: true})
            mouse(viewport, 'mousemove', {x: 40, y: 30})
            key('keyup', {key: 'Shift'})

            expect(posted).toEqual([])
            expect(handler).not.toHaveBeenCalled()
        })
    })

    /**
     * Touch handlers are installed whatever the mobile flag says, so every
     * touch gesture is run both ways.
     *
     * Touch-move is throttled to one call per 50 ms. A test that needs two
     * moves to land fakes the clock and steps past the throttle between them;
     * a double tap needs no clock because the view reads `timeStamp` off the
     * event.
     */
    describe.each([false, true])('touch, mobile flag %s', mobile => {

        beforeEach(() => loadMap(browser, {mobile}))

        afterEach(() => vi.useRealTimers())

        it('pans a one-finger move by the pixels moved since the touch before', () => {
            touch(viewport, 'touchstart', [[100, 100]])
            touch(viewport, 'touchmove', [[110, 105]])

            expect(interactions.shiftPixels.mock.calls).toEqual([[-10, -5]])
        })

        it('posts DragStopped when a one-finger drag lifts', () => {
            const posted = watchPosts(browser, ['DragStopped'])

            touch(viewport, 'touchstart', [[100, 100]])
            touch(viewport, 'touchmove', [[110, 105]])
            touch(viewport, 'touchend', [])

            expect(posted).toEqual(['DragStopped'])
        })

        it('zooms in and centres on a one-finger double tap', () => {
            touch(viewport, 'touchstart', [[100, 100]], {timeStamp: 1000})
            touch(viewport, 'touchend', [], {timeStamp: 1050})
            touch(viewport, 'touchstart', [[105, 100]], {timeStamp: 1100})

            expect(interactions.zoomAndCenter.mock.calls).toEqual([[1, 105, 100]])
        })

        it('zooms out and centres between the fingers on a two-finger double tap', () => {
            touch(viewport, 'touchstart', [[90, 100], [110, 100]], {timeStamp: 1000})
            touch(viewport, 'touchend', [], {timeStamp: 1050})
            touch(viewport, 'touchstart', [[90, 100], [110, 100]], {timeStamp: 1100})

            expect(interactions.zoomAndCenter.mock.calls).toEqual([[-1, 100, 100]])
        })

        it('zooms about the pinch\'s starting midpoint when a pinch passes the scale threshold', () => {
            vi.useFakeTimers({toFake: ['Date', 'setTimeout', 'clearTimeout']})

            touch(viewport, 'touchmove', [[100, 100], [200, 100]])
            vi.advanceTimersByTime(100)
            touch(viewport, 'touchmove', [[50, 100], [250, 100]])
            touch(viewport, 'touchend', [])

            expect(interactions.pinchZoom.mock.calls).toEqual([[150, 100, 2]])
        })

        it('does nothing on a pinch inside the scale threshold', () => {
            vi.useFakeTimers({toFake: ['Date', 'setTimeout', 'clearTimeout']})

            touch(viewport, 'touchmove', [[100, 100], [200, 100]])
            vi.advanceTimersByTime(100)
            touch(viewport, 'touchmove', [[95, 100], [205, 100]])
            touch(viewport, 'touchend', [])

            expect(interactions.pinchZoom).not.toHaveBeenCalled()
            expect(interactions.zoomAndCenter).not.toHaveBeenCalled()
            expect(interactions.shiftPixels).not.toHaveBeenCalled()
        })
    })
})
