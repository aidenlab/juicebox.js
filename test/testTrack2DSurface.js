import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import EventBus from '../js/eventBus.js'
import Track2D from '../js/track2D.js'
import {BROWSER_SURFACE, EVENTS_POSTED, EVENT_PAYLOAD_SHAPES} from '../js/publicApi.js'
import {withBrowser} from './utils/browserFixture.js'

/**
 * A 2D track -- loops, domains -- can be taken off a panel, recoloured and
 * renamed through the browser, and each of those, and each load, posts a
 * global event, as a track pair's do. Before this a host could only splice
 * `tracks2D` and reach undeclared contact-matrix members to repaint, and could
 * hear none of it.
 */

const EVENTS = ['Track2DLoad', 'Track2DRemoval', 'Track2DChange']

const DECLARED_PROPERTIES = EVENT_PAYLOAD_SHAPES.find(entry => 'Track2DChange' === entry.event).values.property

const track2D = name => new Track2D({name, url: `https://example.org/${name}.bedpe`}, [])

describe('2D track surface', () => {

    const context = withBrowser()

    const seen = []
    const subscriber = event => seen.push({type: event.type, data: event.data})

    beforeEach(() => {
        seen.length = 0
        for (const type of EVENTS) {
            EventBus.globalBus.subscribe(type, subscriber)
        }
    })

    afterEach(() => {
        for (const type of EVENTS) {
            EventBus.globalBus.unsubscribe(type, subscriber)
        }
        vi.restoreAllMocks()
    })

    it('declares its members and events', () => {
        for (const name of ['removeTrack2D', 'setTrack2DColor', 'setTrack2DName']) {
            expect(BROWSER_SURFACE).toContain(name)
        }
        for (const name of EVENTS) {
            expect(EVENTS_POSTED).toContainEqual({name, bus: 'global'})
        }
    })

    function expectOneChange(track, property, value) {
        expect(seen).toEqual([{type: 'Track2DChange', data: {track2D: track, property, value}}])
        expect(DECLARED_PROPERTIES, `"${property}" is posted but not declared in the manifest`).toContain(property)
    }

    describe('removeTrack2D', () => {

        it('takes the track off the panel and posts Track2DRemoval with it', () => {
            const [loops, domains] = [track2D('loops'), track2D('domains')]
            context.browser.tracks2D = [loops, domains]
            const repaint = vi.spyOn(context.browser.coordinator, 'onTrackState2D')

            context.browser.removeTrack2D(loops)

            expect(context.browser.tracks2D).toEqual([domains])
            expect(seen).toEqual([{type: 'Track2DRemoval', data: loops}])
            expect(repaint).toHaveBeenCalledOnce()
        })

        it('leaves a track the panel does not hold alone, and posts nothing', () => {
            const loops = track2D('loops')
            context.browser.tracks2D = [loops]

            context.browser.removeTrack2D(track2D('domains'))

            expect(context.browser.tracks2D).toEqual([loops])
            expect(seen).toEqual([])
        })
    })

    describe('setTrack2DColor', () => {

        it('recolours the track and posts the new colour', () => {
            const loops = track2D('loops')
            context.browser.tracks2D = [loops]
            const repaint = vi.spyOn(context.browser.coordinator, 'onTrackState2D')

            context.browser.setTrack2DColor(loops, 'rgb(1,2,3)')

            expect(loops.color).toBe('rgb(1,2,3)')
            expect(loops.getColor()).toBe('rgb(1,2,3)')
            expectOneChange(loops, 'color', 'rgb(1,2,3)')
            expect(repaint).toHaveBeenCalledOnce()
        })

        it('gives the features their own colours back when unset', () => {
            const loops = track2D('loops')
            loops.color = 'red'

            context.browser.setTrack2DColor(loops, undefined)

            expect(loops.color).toBeUndefined()
            expect(loops.toJSON()).not.toHaveProperty('color')
            expectOneChange(loops, 'color', undefined)
        })
    })

    describe('setTrack2DName', () => {

        it('renames the track, in the session too, and posts the new name', () => {
            const loops = track2D('loops')

            context.browser.setTrack2DName(loops, 'CTCF loops')

            expect(loops.name).toBe('CTCF loops')
            expect(loops.toJSON().name).toBe('CTCF loops')
            expectOneChange(loops, 'name', 'CTCF loops')
        })
    })

    describe('Track2DLoad', () => {

        it('is posted with the track once it is on the panel', async () => {
            const loops = track2D('loops')
            vi.spyOn(Track2D, 'loadTrack2D').mockResolvedValue(loops)
            let heldWhenPosted
            const onLoad = () => heldWhenPosted = [...context.browser.tracks2D]
            EventBus.globalBus.subscribe('Track2DLoad', onLoad)

            try {
                await context.browser.loadTracks([{name: 'loops', url: 'https://example.org/loops.bedpe'}])
            } finally {
                EventBus.globalBus.unsubscribe('Track2DLoad', onLoad)
            }

            expect(seen).toEqual([{type: 'Track2DLoad', data: loops}])
            expect(heldWhenPosted).toEqual([loops])
        })
    })

    describe('the annotation panel', () => {

        // The panel's own controls reach the same members, so a user's edit is
        // heard the way a host's call is.

        function openPanel(browser) {
            browser.menuElement.querySelector('.hic-annotation-presentation-button-container button').click()
            return browser.rootElement.querySelector('.hic-annotation-panel-container')
        }

        it('shows the track\'s current name', () => {
            const loops = track2D('loops')
            context.browser.tracks2D = [loops]
            context.browser.setTrack2DName(loops, 'CTCF loops')

            const panel = openPanel(context.browser)

            expect(panel.querySelector('.hic-annotation-modal-row').firstChild.textContent).toBe('CTCF loops')
        })

        it('deletes through removeTrack2D', () => {
            const [loops, domains] = [track2D('loops'), track2D('domains')]
            context.browser.tracks2D = [loops, domains]
            const remove = vi.spyOn(context.browser, 'removeTrack2D')

            const panel = openPanel(context.browser)
            // Rows are listed last track first.
            panel.querySelectorAll('.fa-trash-o')[1].click()

            expect(remove).toHaveBeenCalledWith(loops)
            expect(seen).toEqual([{type: 'Track2DRemoval', data: loops}])
            expect(panel.querySelectorAll('.hic-annotation-modal-row')).toHaveLength(1)
        })

        it('recolours through setTrack2DColor', () => {
            const loops = track2D('loops')
            context.browser.tracks2D = [loops]
            const recolour = vi.spyOn(context.browser, 'setTrack2DColor')

            const panel = openPanel(context.browser)
            const swatch = panel.querySelector('.hic-color-swatch-container .igv-ui-color-swatch')
            swatch.click()

            expect(recolour).toHaveBeenCalledOnce()
            expect(recolour.mock.calls[0][0]).toBe(loops)
            expectOneChange(loops, 'color', recolour.mock.calls[0][1])
        })
    })
})
