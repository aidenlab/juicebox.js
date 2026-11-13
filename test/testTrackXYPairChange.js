import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {JSDOM} from 'jsdom'

// igv-ui builds its DOMPurify at import against the global window, and the
// data-range dialog sanitizes its initial values with it. The node mock window
// leaves DOMPurify without `sanitize`, so igv-ui is imported against a real one.
// Unlike testTrackLabels, the dialog is what is under test here, so it is not
// mocked away.
const nodeWindow = globalThis.window
globalThis.window = new JSDOM('').window
let igv, EventBus, TrackPair, MenuUtils, EVENT_PAYLOAD_SHAPES, withContainers
try {
    ({default: igv} = await import('igv'));
    ({default: EventBus} = await import('../js/eventBus.js'));
    ({default: TrackPair} = await import('../js/trackPair.js'));
    ({default: MenuUtils} = await import('../js/trackMenuUtils.js'));
    ({EVENT_PAYLOAD_SHAPES} = await import('../js/publicApi.js'));
    ({withContainers} = await import('./utils/browserFixture.js'));
} finally {
    globalThis.window = nodeWindow
}

/**
 * A track pair's colour, data range, label name, autoscale and log scale are
 * the one kind of mutation a host could not observe: every other change to
 * what a browser shows reaches the coordinator or a bus, and these reached
 * nothing. A host that wanted them had to patch the setters.
 *
 * `TrackXYPairChange` closes that. One global event, posted from the setters
 * themselves, so the gear menu, the colour picker, the data-range dialog and a
 * host calling a setter directly all announce the change the same way.
 */

const DECLARED_PROPERTIES = EVENT_PAYLOAD_SHAPES.find(entry => 'TrackXYPairChange' === entry.event).values.property

/**
 * A pair with no browser state behind it, so a repaint stands down at its
 * guard and the setter's only observable effect is the event and the field.
 */
const renderer = () => {
    const labelElement = {}
    return {labelElement, setLabelText(text) { labelElement.textContent = text; labelElement.title = text }}
}

function pair(track = {}) {
    const trackPair = new TrackPair({state: undefined}, {dataRange: {min: 0, max: 1}, ...track})
    trackPair.x = renderer()
    trackPair.y = renderer()
    return trackPair
}

describe('TrackXYPairChange', () => {

    withContainers()

    const seen = []
    const subscriber = event => seen.push(event)

    beforeEach(() => {
        seen.length = 0
        EventBus.globalBus.subscribe('TrackXYPairChange', subscriber)
    })

    afterEach(() => {
        EventBus.globalBus.unsubscribe('TrackXYPairChange', subscriber)
    })

    function expectOneChange(trackPair, property, value) {
        expect(seen.length).toBe(1)
        expect(seen[0].type).toBe('TrackXYPairChange')
        expect(seen[0].data.trackPair).toBe(trackPair)
        expect(seen[0].data.property).toBe(property)
        expect(seen[0].data.value).toEqual(value)
        expect(DECLARED_PROPERTIES, `"${property}" is posted but not declared in the manifest`).toContain(property)
    }

    it('carries every field the manifest declares, the pair\'s panel among them', () => {
        // juicebox-remote names the panel a change came from by it. #730.
        const trackPair = pair()
        trackPair.setColor('rgb(1,2,3)')
        const {readsInto} = EVENT_PAYLOAD_SHAPES.find(entry => 'TrackXYPairChange' === entry.event)
        expect(readsInto).toContain('trackPair.browser')
        for (const field of readsInto) expect(seen[0].data, `payload lacks "${field}"`).toHaveProperty(field)
    })

    it('setColor posts the new colour', () => {
        const trackPair = pair()
        trackPair.setColor('rgb(1,2,3)')
        expect(trackPair.track.color).toBe('rgb(1,2,3)')
        expectOneChange(trackPair, 'color', 'rgb(1,2,3)')
    })

    it('setDataRange posts the resulting range', () => {
        // Either bound may be omitted, so the value is the range that results,
        // not the arguments.
        const trackPair = pair({config: {}})
        trackPair.setDataRange(undefined, 50)
        expect(trackPair.track.autoscale).toBe(false)
        expectOneChange(trackPair, 'dataRange', {min: 0, max: 50})
    })

    it('setTrackLabelName posts the new name', () => {
        const trackPair = pair()
        trackPair.setTrackLabelName('CTCF')
        expect(trackPair.x.labelElement.textContent).toBe('CTCF')
        expectOneChange(trackPair, 'name', 'CTCF')
    })

    it('assigning track.name through igv\'s setter posts the new name once', () => {
        // The gear menu renames by assigning `track.name`; igv's setter stores
        // it and calls back into `trackView.setTrackLabelName`, so the one
        // event comes from there and the track already holds the name.
        const track = {
            dataRange: {min: 0, max: 1},
            get name() { return this._name },
            set name(name) { this._name = name; this.trackView.setTrackLabelName(name) }
        }
        // Built by hand: the fixture spreads its track, which flattens an accessor.
        const trackPair = new TrackPair({state: undefined}, track)
        trackPair.x = renderer()
        trackPair.y = renderer()
        track.trackView = trackPair
        track.name = 'CTCF'
        expect(trackPair.track.name).toBe('CTCF')
        expectOneChange(trackPair, 'name', 'CTCF')
    })

    it('setAutoscale posts the new flag', () => {
        const trackPair = pair({autoscale: false})
        trackPair.setAutoscale(true)
        expect(trackPair.track.autoscale).toBe(true)
        expectOneChange(trackPair, 'autoscale', true)
    })

    it('setLogScale posts the new flag', () => {
        const trackPair = pair({logScale: false})
        trackPair.setLogScale(true)
        expect(trackPair.track.logScale).toBe(true)
        expectOneChange(trackPair, 'logScale', true)
    })

    describe('gear menu', () => {

        // The menu items are what a user reaches the setters through. Each is
        // found by its label so a reordering of the menu is not a failure.
        function item(items, label) {
            return items.find(entry => entry.element && entry.element.textContent === label)
        }

        it('log-scale toggle posts the toggled flag', () => {
            const trackPair = pair({type: 'wig', logScale: false, autoscale: false})
            item(MenuUtils.numericDataMenuItems(trackPair), 'Log scale').click()
            expect(trackPair.track.logScale).toBe(true)
            expectOneChange(trackPair, 'logScale', true)
        })

        it('autoscale toggle posts the toggled flag', () => {
            const trackPair = pair({type: 'wig', logScale: false, autoscale: true})
            item(MenuUtils.numericDataMenuItems(trackPair), 'Autoscale').click()
            expect(trackPair.track.autoscale).toBe(false)
            expectOneChange(trackPair, 'autoscale', false)
        })

        it('rename posts the trimmed name once, through igv\'s name setter', () => {
            // A real igv track, so the setter is igv's own: the menu assigns
            // `track.name`, and the one event comes from the callback into
            // `setTrackLabelName`. Calling that as well would post twice.
            const track = new igv.TrackBase({name: 'old'}, {})
            const browser = {state: undefined, inputDialog: {present: ({callback}) => callback(' CTCF ')}}
            const trackPair = new TrackPair(browser, track)
            trackPair.x = renderer()
            trackPair.y = renderer()
            track.trackView = trackPair
            item(MenuUtils.trackMenuItemList(trackPair), 'Set track name').click({})
            expect(track.name).toBe('CTCF')
            expect(trackPair.x.labelElement.textContent).toBe('CTCF')
            expectOneChange(trackPair, 'name', 'CTCF')
        })

        /**
         * A pair built by `init()`, so its colour picker and data-range dialog
         * are igv-ui's own, wired as the browser wires them. The x renderer
         * gains the two elements `init()` hangs them from.
         */
        function initialisedPair(track) {
            const trackPair = pair(track)
            trackPair.x.viewportElement = document.createElement('div')
            trackPair.x.trackReorderHandleElement = document.createElement('div')
            trackPair.init()
            return trackPair
        }

        it('choosing a colour in the colour picker posts the chosen colour', () => {
            const trackPair = initialisedPair({type: 'wig'})
            item(MenuUtils.trackMenuItemList(trackPair), 'Set color').click()
            // igv-ui's palette hands the handler its hex string; the swatch's
            // style reads it back as rgb(), so the swatch is found by that.
            const swatch = [...trackPair.colorPicker.container.querySelectorAll('.igv-ui-color-swatch')]
                .find(element => 'rgb(137, 17, 0)' === element.style.backgroundColor)
            expect(swatch, 'igv-ui\'s palette no longer offers #891100').toBeDefined()
            swatch.dispatchEvent(new window.MouseEvent('click', {bubbles: true}))
            expectOneChange(trackPair, 'color', '#891100')
            expect(trackPair.track.color).toBe('#891100')
        })

        it('submitting the data-range dialog posts the resulting range', () => {
            const trackPair = initialisedPair({type: 'wig', autoscale: true, config: {}})
            item(MenuUtils.numericDataMenuItems(trackPair), 'Set data range').click()
            const {minbox, maxbox, dialog} = trackPair.dataRangeDialog
            minbox.value = '-5'
            maxbox.value = '50'
            dialog.ok.dispatchEvent(new window.MouseEvent('click', {bubbles: true}))
            expectOneChange(trackPair, 'dataRange', {min: -5, max: 50})
            expect(trackPair.track.dataRange).toEqual({min: -5, max: 50})
            expect(trackPair.track.autoscale).toBe(false)
        })

        it('unset colour posts an undefined colour', () => {
            const trackPair = pair({color: 'red'})
            item(MenuUtils.trackMenuItemList(trackPair), 'Unset color').click()
            expect(trackPair.track.color).toBeUndefined()
            expectOneChange(trackPair, 'color', undefined)
        })
    })
})
