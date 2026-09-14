import {describe, it, expect, beforeEach} from 'vitest'
import GestureRecognizer from '../js/gestureRecognizer.js'

/**
 * The gesture recognizer on its own: plain input in, named intents out. No
 * DOM, no timers -- timestamps arrive as data. #652.
 *
 * `testViewportGestures.js` pins the same gestures end to end through a real
 * viewport. These pin the decisions, including the edges a DOM test would
 * need layout or a clock to reach.
 */

const types = intents => intents.map(({type}) => type)

describe('GestureRecognizer', () => {

    let recognizer

    beforeEach(() => {
        recognizer = new GestureRecognizer()
    })

    describe('mouse drag', () => {

        it('pans by the pixels moved since the last mouse-move once past the threshold', () => {
            recognizer.mouseDown({x: 100, y: 100})

            expect(recognizer.mouseMove({x: 102, y: 100})).toEqual([])
            expect(recognizer.mouseMove({x: 110, y: 104})).toEqual([{type: 'pan', dx: -8, dy: -4}])
            expect(recognizer.mouseMove({x: 115, y: 110})).toEqual([{type: 'pan', dx: -5, dy: -6}])
        })

        it('does not pan on a mouse-move with no button down', () => {
            expect(recognizer.mouseMove({x: 110, y: 104})).toEqual([])
        })

        it('does not start a drag on vertical movement alone (#654)', () => {
            recognizer.mouseDown({x: 100, y: 100})

            expect(recognizer.mouseMove({x: 100, y: 150})).toEqual([])
        })

        it('does not start a drag from a mouse-down at x = 0 (#654)', () => {
            recognizer.mouseDown({x: 0, y: 100})

            expect(recognizer.mouseMove({x: 50, y: 100})).toEqual([])
        })

        it('stops a drag on mouse-up, and says so only if one was under way', () => {
            recognizer.mouseDown({x: 100, y: 100})
            expect(recognizer.mouseUp()).toEqual([])

            recognizer.mouseDown({x: 100, y: 100})
            recognizer.mouseMove({x: 110, y: 100})
            expect(recognizer.mouseUp()).toEqual([{type: 'dragStopped'}])
            expect(recognizer.mouseMove({x: 120, y: 100})).toEqual([])
        })

        it('stops a drag when the mouse leaves the viewport', () => {
            recognizer.mouseDown({x: 100, y: 100})
            recognizer.mouseMove({x: 110, y: 100})

            expect(recognizer.mouseLeave()).toEqual([{type: 'dragStopped'}])
            expect(recognizer.mouseMove({x: 120, y: 100})).toEqual([])
        })
    })

    describe('double-click and wheel', () => {

        it('zooms in and centres on the point double-clicked', () => {
            expect(recognizer.doubleClick({x: 120, y: 80})).toEqual([{type: 'zoomAndCenter', direction: 1, x: 120, y: 80}])
        })

        it('zooms in about the pointer on a wheel scrolled up, and out on one scrolled down', () => {
            expect(recognizer.wheel({x: 30, y: 40, deltaY: -5})).toEqual([{type: 'wheelZoom', x: 30, y: 40, scaleFactor: 1.008}])
            expect(recognizer.wheel({x: 50, y: 60, deltaY: 5})).toEqual([{type: 'wheelZoom', x: 50, y: 60, scaleFactor: 0.992}])
        })
    })

    describe('sweep', () => {

        it('starts a sweep at the sweep coordinates on an alt mouse-down', () => {
            expect(recognizer.mouseDown({x: 1, y: 2, sweepX: 50, sweepY: 80, altKey: true}))
                .toEqual([{type: 'sweepStart', x: 50, y: 80}])
        })

        it('stretches the rectangle on each move, whichever way it is swept, without panning', () => {
            recognizer.mouseDown({x: 50, y: 80, sweepX: 50, sweepY: 80, altKey: true})

            expect(recognizer.mouseMove({x: 10, y: 20, sweepX: 10, sweepY: 20}))
                .toEqual([{type: 'sweepUpdate', left: 10, top: 20, width: 40, height: 60}])
        })

        it('commits the swept rectangle on the document mouse-up, once', () => {
            recognizer.mouseDown({x: 50, y: 80, sweepX: 50, sweepY: 80, altKey: true})
            recognizer.mouseMove({x: 10, y: 20, sweepX: 10, sweepY: 20})

            expect(recognizer.documentMouseUp())
                .toEqual([{type: 'sweepCommit', rect: {xPixel: 10, yPixel: 20, width: 40, height: 60}}])
            expect(recognizer.documentMouseUp()).toEqual([])
        })

        it('commits nothing on a document mouse-up with no sweep', () => {
            recognizer.mouseDown({x: 50, y: 80, sweepX: 50, sweepY: 80})

            expect(recognizer.documentMouseUp()).toEqual([])
        })

        it('commits an alt-click that never moves against the previous sweep\'s end point (#653)', () => {
            recognizer.mouseDown({sweepX: 50, sweepY: 80, altKey: true})
            recognizer.mouseMove({sweepX: 10, sweepY: 20})
            recognizer.documentMouseUp()

            recognizer.mouseDown({sweepX: 200, sweepY: 300, altKey: true})

            expect(recognizer.documentMouseUp())
                .toEqual([{type: 'sweepCommit', rect: {xPixel: 10, yPixel: 20, width: 190, height: 280}}])
        })
    })

    describe('crosshairs', () => {

        const pointer = {x: 40, y: 60, xNormalized: 0.05, yNormalized: 0.1}

        it('shows crosshairs when shift goes down over the viewport, once', () => {
            recognizer.mouseOver()

            expect(recognizer.keyDown({shiftKey: true})).toEqual([{type: 'showCrosshairs'}])
            expect(recognizer.keyDown({shiftKey: true})).toEqual([])
        })

        it('does not show crosshairs for a key other than shift', () => {
            recognizer.mouseOver()

            expect(recognizer.keyDown({shiftKey: false})).toEqual([])
        })

        it('does not show crosshairs for shift pressed away from the viewport', () => {
            expect(recognizer.keyDown({shiftKey: true})).toEqual([])

            recognizer.mouseOver()
            recognizer.mouseOut()
            expect(recognizer.keyDown({shiftKey: true})).toEqual([])
        })

        it('moves the crosshairs to the pointer while they are shown, ahead of any pan', () => {
            expect(recognizer.mouseMove({x: 40, y: 60, pointer})).toEqual([])

            recognizer.mouseOver()
            recognizer.keyDown({shiftKey: true})
            recognizer.mouseDown({x: 100, y: 100})

            expect(recognizer.mouseMove({x: 110, y: 100, pointer}))
                .toEqual([{type: 'moveCrosshairs', pointer}, {type: 'pan', dx: -10, dy: 0}])
        })

        it('hides crosshairs on any keyup, shown or not, and stops moving them', () => {
            expect(recognizer.keyUp()).toEqual([{type: 'hideCrosshairs'}])

            recognizer.mouseOver()
            recognizer.keyDown({shiftKey: true})
            expect(recognizer.keyUp()).toEqual([{type: 'hideCrosshairs'}])
            expect(recognizer.mouseMove({x: 40, y: 60, pointer})).toEqual([])
            expect(recognizer.keyDown({shiftKey: true})).toEqual([{type: 'showCrosshairs'}])
        })
    })

    describe('touch drag', () => {

        it('pans a one-finger move by the pixels moved since the touch before', () => {
            recognizer.touchStart({touches: [{x: 100, y: 100}], timeStamp: 1000})

            expect(recognizer.touchMove({touches: [{x: 110, y: 105}], timeStamp: 1060})).toEqual([{type: 'pan', dx: -10, dy: -5}])
            expect(recognizer.touchMove({touches: [{x: 112, y: 100}], timeStamp: 1120})).toEqual([{type: 'pan', dx: -2, dy: 5}])
        })

        it('does not pan a move with no touch before it', () => {
            expect(recognizer.touchMove({touches: [{x: 110, y: 105}], timeStamp: 1000})).toEqual([])
        })

        it('does not pan on a coordinate that is not a number', () => {
            recognizer.touchStart({touches: [{x: 100, y: 100}], timeStamp: 1000})

            expect(recognizer.touchMove({touches: [{x: NaN, y: 105}], timeStamp: 1060})).toEqual([])
            expect(recognizer.touchEnd()).toEqual([])
        })

        it('stops a drag when the finger lifts, and says so only if one was under way', () => {
            recognizer.touchStart({touches: [{x: 100, y: 100}], timeStamp: 1000})
            expect(recognizer.touchEnd()).toEqual([])

            recognizer.touchMove({touches: [{x: 110, y: 105}], timeStamp: 1060})
            expect(recognizer.touchEnd()).toEqual([{type: 'dragStopped'}])
            expect(recognizer.touchEnd()).toEqual([])
        })
    })

    describe('double tap', () => {

        it('zooms in and centres on a one-finger double tap', () => {
            expect(recognizer.touchStart({touches: [{x: 100, y: 100}], timeStamp: 1000})).toEqual([])

            expect(recognizer.touchStart({touches: [{x: 105, y: 100}], timeStamp: 1100}))
                .toEqual([{type: 'zoomAndCenter', direction: 1, x: 105, y: 100}])
        })

        it('zooms out and centres between the fingers on a two-finger double tap', () => {
            recognizer.touchStart({touches: [{x: 90, y: 96}, {x: 110, y: 104}], timeStamp: 1000})

            expect(recognizer.touchStart({touches: [{x: 90, y: 100}, {x: 110, y: 108}], timeStamp: 1100}))
                .toEqual([{type: 'zoomAndCenter', direction: -1, x: 100, y: 104}])
        })

        it('does not zoom on taps too far apart', () => {
            recognizer.touchStart({touches: [{x: 100, y: 100}], timeStamp: 1000})

            expect(recognizer.touchStart({touches: [{x: 120, y: 100}], timeStamp: 1100})).toEqual([])
        })

        it('does not zoom on taps too far apart in time', () => {
            recognizer.touchStart({touches: [{x: 100, y: 100}], timeStamp: 1000})

            expect(recognizer.touchStart({touches: [{x: 100, y: 100}], timeStamp: 1300})).toEqual([])
        })

        it('does not zoom when a second finger joins a first', () => {
            recognizer.touchStart({touches: [{x: 100, y: 100}], timeStamp: 1000})

            expect(recognizer.touchStart({touches: [{x: 100, y: 100}, {x: 100, y: 100}], timeStamp: 1050})).toEqual([])
        })

        it('does not count the tap that completed a double tap towards another', () => {
            recognizer.touchStart({touches: [{x: 100, y: 100}], timeStamp: 1000})
            recognizer.touchStart({touches: [{x: 100, y: 100}], timeStamp: 1100})

            expect(recognizer.touchStart({touches: [{x: 100, y: 100}], timeStamp: 1200})).toEqual([])
        })
    })

    describe('pinch', () => {

        const pinch = (from, to) => {
            recognizer.touchMove({touches: from, timeStamp: 1000})
            recognizer.touchMove({touches: to, timeStamp: 1100})
            return recognizer.touchEnd()
        }

        it('zooms about the pinch\'s starting midpoint, not its end, when it passes the scale threshold', () => {
            expect(pinch([{x: 100, y: 100}, {x: 200, y: 100}], [{x: 100, y: 120}, {x: 300, y: 120}]))
                .toEqual([{type: 'pinchZoom', x: 150, y: 100, scale: 2}])
        })

        it('zooms out on a pinch closing past the threshold', () => {
            expect(pinch([{x: 100, y: 100}, {x: 200, y: 100}], [{x: 125, y: 100}, {x: 175, y: 100}]))
                .toEqual([{type: 'pinchZoom', x: 150, y: 100, scale: 0.5}])
        })

        it('does nothing on a pinch inside the scale threshold', () => {
            expect(pinch([{x: 100, y: 100}, {x: 200, y: 100}], [{x: 95, y: 100}, {x: 205, y: 100}])).toEqual([])
        })

        it('does nothing on a two-finger touch that never moved twice', () => {
            recognizer.touchMove({touches: [{x: 100, y: 100}, {x: 200, y: 100}], timeStamp: 1000})

            expect(recognizer.touchEnd()).toEqual([])
            expect(recognizer.touchMove({touches: [{x: 50, y: 100}, {x: 250, y: 100}], timeStamp: 1100})).toEqual([])
            expect(recognizer.touchEnd()).toEqual([])
        })

        it('forgets the last tap after a pinch zooms, so the next tap is not a double tap', () => {
            recognizer.touchStart({touches: [{x: 150, y: 100}], timeStamp: 1000})
            pinch([{x: 100, y: 100}, {x: 200, y: 100}], [{x: 50, y: 100}, {x: 250, y: 100}])

            expect(recognizer.touchStart({touches: [{x: 150, y: 100}], timeStamp: 1100})).toEqual([])
        })
    })
})
