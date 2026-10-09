import {describe, it, expect, vi} from 'vitest'
import BrowserCoordinator from '../js/browserCoordinator.js'
import InteractionHandler from '../js/interactionHandler.js'
import {COORDINATOR_PAYLOAD_SHAPES} from '../js/publicApi.js'
import {withBrowser} from './utils/browserFixture.js'

/**
 * The host-facing half of the coordinator, for the four notifications that
 * used to stop at the widgets: colour scale, normalization, substitution and
 * display mode. Each already reached its widget through a coordinator method;
 * what was missing was the fan-out to `addCallback` subscribers, so a host
 * mirroring a panel had to monkey-patch the methods to hear about them. Also
 * `onLocusChange`'s `dragging`, which the interaction handler knew and the
 * payload dropped.
 *
 * Every payload is asserted against `COORDINATOR_PAYLOAD_SHAPES`, so the
 * manifest and the delivery cannot drift apart -- the #471 lesson. The widgets
 * are fakes: the claim is about what the subscriber receives, not what the
 * widget does with it, and `test/testCoordinatorDelivery.js` already covers
 * the widget-facing arm.
 */

function shapeOf(callback) {
    return COORDINATOR_PAYLOAD_SHAPES.find(entry => callback === entry.callback)
}

function expectDeclaredFields(callback, received) {
    for (const field of shapeOf(callback).payload) {
        expect(field in received, `${callback} no longer delivers "${field}"`).toBe(true)
    }
}

/** A coordinator over a fake browser, with fake widgets adopted. */
function fakeCoordinator() {
    const browser = {
        layoutController: {xAxisRuler: undefined, yAxisRuler: undefined},
        state: {chr1: 1, chr2: 1, zoom: 0, pixelSize: 1, x: 0, y: 0, normalization: 'KR'},
        contactMatrixView: {getColorScale: () => ({threshold: 7})}
    }
    const widgets = {
        contactMatrixView: {receiveEvent: vi.fn()},
        colorScaleWidget: {updateForColorScale: vi.fn()},
        controlMapWidget: {updateDisplayMode: vi.fn()},
        normalizationWidget: {
            clearSubstitution: vi.fn(),
            clearSubstitutionIfStale: vi.fn(),
            setNormalizationProgrammatically: vi.fn(),
            announceSubstitution: vi.fn()
        }
    }
    const coordinator = new BrowserCoordinator(browser)
    coordinator.adoptWidgets(widgets)
    return {browser, widgets, coordinator}
}

function subscribe(coordinator, name) {
    const received = []
    coordinator.addCallback(name, payload => received.push(payload))
    return received
}

describe('coordinator callbacks a host can subscribe to', () => {

    it('delivers onColorScaleChange from the widget-facing colour scale notification', () => {
        const {browser, widgets, coordinator} = fakeCoordinator()
        const received = subscribe(coordinator, 'onColorScaleChange')
        const colorScale = {threshold: 42}

        coordinator.onColorScale(colorScale)

        expect(received).toHaveLength(1)
        expectDeclaredFields('onColorScaleChange', received[0])
        expect(received[0].colorScale).toBe(colorScale)
        expect(received[0].browser).toBe(browser)
        // The widget arm still runs, once.
        expect(widgets.colorScaleWidget.updateForColorScale).toHaveBeenCalledTimes(1)
    })

    it('delivers onNormalizationChange with the normalization set', () => {
        const {browser, coordinator} = fakeCoordinator()
        const received = subscribe(coordinator, 'onNormalizationChange')

        coordinator.onNormalizationChange('VC')

        expect(received).toHaveLength(1)
        expectDeclaredFields('onNormalizationChange', received[0])
        expect(received[0].normalization).toBe('VC')
        expect(received[0].browser).toBe(browser)
    })

    it('delivers onNormalizationSubstituted with what was asked, what is drawn, and why', () => {
        const {browser, widgets, coordinator} = fakeCoordinator()
        const received = subscribe(coordinator, 'onNormalizationSubstituted')

        coordinator.onNormalizationSubstituted({requested: 'KR', effective: 'NONE', reason: 'not here'})

        expect(received).toHaveLength(1)
        expectDeclaredFields('onNormalizationSubstituted', received[0])
        expect(received[0]).toMatchObject({requested: 'KR', effective: 'NONE', reason: 'not here'})
        expect(received[0].browser).toBe(browser)
        // The widget still learns the effective value and the reason.
        expect(widgets.normalizationWidget.setNormalizationProgrammatically).toHaveBeenCalledWith('NONE')
        expect(widgets.normalizationWidget.announceSubstitution).toHaveBeenCalledWith('not here', browser.state)
    })

    it('delivers onDisplayModeChange with the mode', () => {
        const {browser, coordinator} = fakeCoordinator()
        const received = subscribe(coordinator, 'onDisplayModeChange')

        coordinator.onDisplayMode('AOB')

        expect(received).toHaveLength(1)
        expectDeclaredFields('onDisplayModeChange', received[0])
        expect(received[0].mode).toBe('AOB')
        expect(shapeOf('onDisplayModeChange').values.mode).toContain(received[0].mode)
        expect(received[0].browser).toBe(browser)
    })

    it('delivers onForegroundColorChange with the component the edit touched', () => {
        const {browser, coordinator} = fakeCoordinator()
        const received = subscribe(coordinator, 'onForegroundColorChange')
        const rgb = {r: 1, g: 2, b: 3}

        coordinator.onForegroundColorChange(rgb, '-')

        expect(received).toHaveLength(1)
        expectDeclaredFields('onForegroundColorChange', received[0])
        expect(received[0].rgb).toBe(rgb)
        expect(received[0].type).toBe('-')
        expect(shapeOf('onForegroundColorChange').values.type).toContain(received[0].type)
        expect(received[0].browser).toBe(browser)
    })

    it('delivers onLocusChange with dragging true while a drag pans and false for a discrete move', async () => {
        // A host that cannot tell a drag from a jump has to debounce every
        // locus change. The interaction handler already knows which it is.
        const {browser, coordinator} = fakeCoordinator()
        Object.assign(browser, {coordinator, dataset: {}, update: async () => {}})
        browser.state.panShift = async () => {}
        browser.state.updateWithLoci = async () => ({chrChanged: false, resolutionChanged: false})
        browser.contactMatrixView.getViewDimensions = () => ({width: 100, height: 100})
        browser.contactMatrixView.clearImageCaches = () => {}
        const interactions = new InteractionHandler(browser)
        const received = subscribe(coordinator, 'onLocusChange')

        await interactions.shiftPixels(-10, -4)
        await interactions.shiftPixels(-5, -6)
        await interactions.goto(1, 0, 100, 1, 0, 100)

        expect(received.map(payload => payload.dragging)).toEqual([true, true, false])
        for (const payload of received) {
            expectDeclaredFields('onLocusChange', payload)
            expect(payload.browser).toBe(browser)
        }
    })

    it('delivers onLocusChange with dragging false from a caller that does not say', () => {
        // Restore and sync pass no flag; the fields a subscriber already reads
        // are what they were.
        const {browser, coordinator} = fakeCoordinator()
        const received = subscribe(coordinator, 'onLocusChange')

        coordinator.onLocusChange({state: browser.state, resolutionChanged: true, chrChanged: false})

        expect(received).toHaveLength(1)
        expectDeclaredFields('onLocusChange', received[0])
        expect(received[0]).toEqual({
            state: browser.state,
            changes: {resolutionChanged: true, chrChanged: false},
            dragging: false,
            browser
        })
    })
})

describe('the browser feeds the new callbacks', () => {

    const context = withBrowser()

    it('fires onColorScaleChange from setColorScaleThreshold', () => {
        // The user's threshold edit was the one colour-scale change nothing
        // announced: the auto-threshold path notifies, this path did not.
        const {browser} = context
        const received = subscribe(browser.coordinator, 'onColorScaleChange')

        browser.setColorScaleThreshold(1234)

        expect(received).toHaveLength(1)
        expect(received[0].colorScale.threshold).toBe(1234)
        expect(received[0].browser).toBe(browser)
    })

    it('fires onDisplayModeChange from setDisplayMode', async () => {
        const {browser} = context
        const received = subscribe(browser.coordinator, 'onDisplayModeChange')

        await browser.setDisplayMode('B')

        expect(received).toHaveLength(1)
        expect(received[0].mode).toBe('B')
    })
})
