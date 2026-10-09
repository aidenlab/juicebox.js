import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import igv from 'igv'
import EventBus from '../js/eventBus.js'
import TrackPair from '../js/trackPair.js'
import MenuUtils from '../js/trackMenuUtils.js'
import {EVENT_PAYLOAD_SHAPES} from '../js/publicApi.js'
import {withContainers} from './utils/browserFixture.js'

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

        it('unset colour posts an undefined colour', () => {
            const trackPair = pair({color: 'red'})
            item(MenuUtils.trackMenuItemList(trackPair), 'Unset color').click()
            expect(trackPair.track.color).toBeUndefined()
            expectOneChange(trackPair, 'color', undefined)
        })
    })
})
