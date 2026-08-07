/**
 * Build a real HICBrowser instance for contract tests.
 *
 * Most of the public surface is not on `HICBrowser.prototype` -- seven of the
 * members hosts use are assigned in the constructor -- so checking the contract
 * means constructing an instance, not reflecting on a class.
 *
 * Two obstacles, both handled here:
 *
 * 1. `test/setup.js` installs a hand-rolled `document` mock for the node-based
 *    tests. Rather than fight it with a per-file vitest environment, this helper
 *    stands up its own JSDOM and swaps the globals for the duration of the test,
 *    restoring them afterwards. The existing suite is untouched either way.
 *
 * 2. The constructor reaches a canvas immediately: `createWidgets()` builds a
 *    ContactMatrixView whose constructor calls `getContext('2d')`, as do the
 *    ruler and the track renderer. JSDOM returns null there unless the native
 *    `canvas` package is installed. These tests need construction to succeed,
 *    not pixels to be correct, so the 2D context is stubbed with an inert
 *    object instead of pulling in a native build.
 */

import {JSDOM} from 'jsdom'
import {beforeEach, afterEach} from 'vitest'
import HICBrowser from '../../js/hicBrowser.js'

/**
 * An inert 2D context. Every method is a no-op and every property is writable,
 * which is all the constructors need -- nothing here is asserted against.
 */
function stubContext2D() {
    const noop = () => {}
    return new Proxy({
        canvas: undefined,
        fillStyle: '#000000',
        strokeStyle: '#000000',
        lineWidth: 1,
        font: '10px sans-serif',
        globalAlpha: 1,
        measureText: () => ({width: 0}),
        getImageData: () => ({data: new Uint8ClampedArray(4), width: 1, height: 1}),
        createImageData: () => ({data: new Uint8ClampedArray(4), width: 1, height: 1})
    }, {
        get: (target, prop) => prop in target ? target[prop] : noop,
        set: (target, prop, value) => {
            target[prop] = value
            return true
        }
    })
}

const SWAPPED_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLCanvasElement', 'Node', 'Element', 'Image', 'getComputedStyle', 'devicePixelRatio']

/**
 * Install a JSDOM window over the current globals and return a restore function
 * plus a container element ready to hand to the HICBrowser constructor.
 */
export function withDOM() {

    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true})
    const {window} = dom

    window.HTMLCanvasElement.prototype.getContext = function () {
        const ctx = stubContext2D()
        ctx.canvas = this
        return ctx
    }

    const saved = new Map()
    for (const key of SWAPPED_GLOBALS) {
        saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
        Object.defineProperty(globalThis, key, {
            value: key === 'window' ? window : window[key],
            writable: true,
            configurable: true
        })
    }

    const container = window.document.createElement('div')
    window.document.body.appendChild(container)

    const restore = () => {
        for (const key of SWAPPED_GLOBALS) {
            const descriptor = saved.get(key)
            if (descriptor) {
                Object.defineProperty(globalThis, key, descriptor)
            } else {
                delete globalThis[key]
            }
        }
        window.close()
    }

    return {window, container, restore}
}

/**
 * Stand up a fresh browser around each test in the calling describe, and tear
 * the DOM back down afterwards. Returns a holder rather than the browser itself
 * because the instance does not exist until beforeEach runs.
 */
export function withBrowser() {

    const context = {browser: undefined}
    let fixture

    beforeEach(() => {
        fixture = withDOM()
        context.browser = new HICBrowser(fixture.container, {})
    })

    afterEach(() => {
        fixture.restore()
        context.browser = undefined
    })

    return context
}

/**
 * A JSDOM around each test in the calling describe, exposing the container the
 * fixture makes and `another()` for making more of them.
 *
 * Every claim about which embed something belongs to needs two containers -- a
 * single-embed assertion would pass against the page-scoped code the registries
 * replace -- so this is what the registry suites open with. Returns a holder
 * rather than the elements, which do not exist until `beforeEach` runs.
 */
export function withContainers() {

    const context = {}
    let fixture

    beforeEach(() => {
        fixture = withDOM()
        context.window = fixture.window
        context.container = fixture.container
        context.another = () => {
            const element = fixture.window.document.createElement('div')
            fixture.window.document.body.appendChild(element)
            return element
        }
    })

    afterEach(() => {
        fixture.restore()
    })

    return context
}
