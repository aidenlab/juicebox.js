/**
 * Decides which gesture raw input on the viewport is, and names the intent.
 * See CONTEXT.md, **Gesture recognizer**. #652.
 *
 * A pure state machine: each method takes plain input for one kind of event
 * and returns the intents it recognizes, in the order they should be carried
 * out -- usually none or one. It holds the in-progress gesture and nothing
 * else: no DOM, no timers. Timestamps arrive as data.
 *
 * Coordinates are viewport pixels, already converted by the caller. An event
 * that reads two coordinate sources passes both: `x`/`y` for the drag, and
 * `sweepX`/`sweepY` for the sweep rectangle. The recognizer never reconciles
 * them.
 *
 * Intents:
 *
 *   {type: 'pan', dx, dy}
 *   {type: 'dragStopped'}
 *   {type: 'zoomAndCenter', direction, x, y}
 *   {type: 'wheelZoom', x, y, scaleFactor}
 *   {type: 'pinchZoom', x, y, scale}
 *   {type: 'sweepStart', x, y}
 *   {type: 'sweepUpdate', left, top, width, height}
 *   {type: 'sweepCommit', rect: {xPixel, yPixel, width, height}}
 *   {type: 'showCrosshairs'}
 *   {type: 'moveCrosshairs', pointer}
 *   {type: 'hideCrosshairs'}
 *
 * Quirks are kept as they were in the view this came out of, and are pinned by
 * `test/testViewportGestures.js`: #653 (a sweep's end point outlives it) and
 * #654 (the drag threshold is horizontal only, and never passed from x = 0).
 */

const DRAG_THRESHOLD = 2
const DOUBLE_TAP_DIST_THRESHOLD = 20
const DOUBLE_TAP_TIME_THRESHOLD = 300
const WHEEL_ZOOM_FACTOR = 0.008

class GestureRecognizer {

    constructor() {
        // Shared by mouse and touch: either kind of drag is stopped by either
        // kind of release.
        this.dragging = false

        this.mouseDownAt = undefined
        this.mouseLast = undefined
        this.sweeping = false
        this.sweepStartAt = {x: 0, y: 0}
        this.sweepEndAt = {x: 0, y: 0}

        this.mouseOverViewport = false
        this.crosshairsShown = false

        this.lastTouch = undefined
        this.pinch = undefined
    }

    /** @param {{x, y, sweepX, sweepY, altKey}} input */
    mouseDown({x, y, sweepX, sweepY, altKey}) {
        this.mouseLast = {x, y}
        this.mouseDownAt = {x, y}

        if (altKey) {
            this.sweeping = true
            this.sweepStartAt = {x: sweepX, y: sweepY}
            return [{type: 'sweepStart', x: sweepX, y: sweepY}]
        }
        return []
    }

    /**
     * @param {{x, y, sweepX, sweepY, pointer}} input `pointer` is the position
     *        the crosshairs follow, handed back untouched.
     */
    mouseMove({x, y, sweepX, sweepY, pointer}) {
        const intents = []

        if (this.crosshairsShown) {
            intents.push({type: 'moveCrosshairs', pointer})
        }

        if (this.mouseDownAt) {
            if (this.sweeping) {
                this.sweepEndAt = {x: sweepX, y: sweepY}
                intents.push({type: 'sweepUpdate', ...this.sweepRectangle()})
            } else if (this.mouseDownAt.x && Math.abs(x - this.mouseDownAt.x) > DRAG_THRESHOLD) {
                this.dragging = true
                intents.push({type: 'pan', dx: this.mouseLast.x - x, dy: this.mouseLast.y - y})
            }
            this.mouseLast = {x, y}
        }

        return intents
    }

    /** A mouse-up inside the viewport. */
    mouseUp() {
        return this.releaseMouse()
    }

    mouseLeave() {
        return this.releaseMouse()
    }

    /**
     * A mouse-up anywhere in the document, which is where a sweep ends: it may
     * have been dragged out of the viewport.
     */
    documentMouseUp() {
        if (!this.sweeping) return []

        this.sweeping = false
        const {left, top, width, height} = this.sweepRectangle()
        return [{type: 'sweepCommit', rect: {xPixel: left, yPixel: top, width, height}}]
    }

    /** @param {{x, y}} input */
    doubleClick({x, y}) {
        return [{type: 'zoomAndCenter', direction: 1, x, y}]
    }

    /** @param {{x, y, deltaY}} input a positive `deltaY` scrolls down, and zooms out. */
    wheel({x, y, deltaY}) {
        const scaleFactor = deltaY > 0 ? 1 - WHEEL_ZOOM_FACTOR : 1 + WHEEL_ZOOM_FACTOR
        return [{type: 'wheelZoom', x, y, scaleFactor}]
    }

    mouseOver() {
        this.mouseOverViewport = true
        return []
    }

    mouseOut() {
        this.mouseOverViewport = false
        return []
    }

    /** @param {{shiftKey}} input */
    keyDown({shiftKey}) {
        if (!this.crosshairsShown && this.mouseOverViewport && shiftKey) {
            this.crosshairsShown = true
            return [{type: 'showCrosshairs'}]
        }
        return []
    }

    /**
     * Any key released hides the crosshairs, shown or not. Spacewalk listens
     * for the resulting `DidHideCrosshairs` and may rely on that.
     */
    keyUp() {
        this.crosshairsShown = false
        return [{type: 'hideCrosshairs'}]
    }

    /** @param {{touches: {x, y}[], timeStamp}} input */
    touchStart({touches, timeStamp}) {
        const count = touches.length
        let {x, y} = touches[0]
        if (count === 2) {
            x = (x + touches[1].x) / 2
            y = (y + touches[1].y) / 2
        }

        const last = this.lastTouch
        const recent = last && (timeStamp - last.timeStamp < DOUBLE_TAP_TIME_THRESHOLD)

        // A second finger joining the first is the start of a pinch, not a tap.
        if (recent && count > 1 && last.count === 1) {
            this.lastTouch = {x, y, timeStamp, count}
            return []
        }

        if (recent && Math.hypot(last.x - x, last.y - y) < DOUBLE_TAP_DIST_THRESHOLD) {
            this.lastTouch = undefined
            const direction = (last.count === 2 || count === 2) ? -1 : 1
            return [{type: 'zoomAndCenter', direction, x, y}]
        }

        this.lastTouch = {x, y, timeStamp, count}
        return []
    }

    /** @param {{touches: {x, y}[], timeStamp}} input */
    touchMove({touches, timeStamp}) {
        if (touches.length === 2) {
            const t = {x1: touches[0].x, y1: touches[0].y, x2: touches[1].x, y2: touches[1].y}
            this.pinch ? (this.pinch.end = t) : (this.pinch = {start: t})
            return []
        }

        const {x, y} = touches[0]
        const intents = []

        if (this.lastTouch) {
            const dx = this.lastTouch.x - x
            const dy = this.lastTouch.y - y
            if (!isNaN(dx) && !isNaN(dy)) {
                this.dragging = true
                intents.push({type: 'pan', dx, dy})
            }
        }

        this.lastTouch = {x, y, timeStamp, count: touches.length}
        return intents
    }

    touchEnd() {
        const intents = []

        if (this.pinch && this.pinch.end) {
            const {start, end} = this.pinch
            const scale = Math.hypot(end.x2 - end.x1, end.y2 - end.y1) / Math.hypot(start.x2 - start.x1, start.y2 - start.y1)

            if (scale < 0.8 || scale > 1.2) {
                this.lastTouch = undefined
                intents.push({type: 'pinchZoom', x: (start.x1 + start.x2) / 2, y: (start.y1 + start.y2) / 2, scale})
            }
        } else if (this.dragging) {
            this.dragging = false
            intents.push({type: 'dragStopped'})
        }

        this.pinch = undefined
        return intents
    }

    releaseMouse() {
        const intents = []
        if (this.dragging) {
            this.dragging = false
            intents.push({type: 'dragStopped'})
        }
        this.mouseDownAt = this.mouseLast = undefined
        return intents
    }

    sweepRectangle() {
        const {sweepStartAt: start, sweepEndAt: end} = this
        return {
            left: Math.min(start.x, end.x),
            top: Math.min(start.y, end.y),
            width: Math.abs(end.x - start.x),
            height: Math.abs(end.y - start.y)
        }
    }
}

export default GestureRecognizer
