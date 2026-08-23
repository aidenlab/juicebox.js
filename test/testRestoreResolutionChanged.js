/**
 * `resolutionChanged` tells the truth on restore. #560, candidate 6, ADR-0009
 * decision 3.
 *
 * Restore used to return `resolutionChanged: true` unconditionally, so every
 * restore announced a resolution change whether or not the resolution moved.
 * The flag is not decoration: `browserCoordinator.onLocusChange` releases the
 * resolution lock when it is set, and hands the flag on to external
 * `onLocusChange` callbacks as declared payload. A restore that lands on the
 * current zoom now leaves a locked resolution locked. The repaint is not at
 * stake — `setState` calls `update()` on every restore, flag or no
 * — so the lock is the observable half, and claim 4 is where this file earns
 * its keep.
 *
 * This is deliberately a ticket — and a file — of its own. The change belongs
 * to the invisible-failure-mode class: nothing throws and nothing logs when a
 * notification that used to fire stops firing, so bundled with #558's clamp a moved
 * snapshot would have had two possible causes and could have been attributed to
 * neither. #536's lesson inverted.
 *
 * The honest answer is computed the same way `chrChanged` beside it is: against
 * the **outgoing** state. `setView`'s own `resolutionChanged` cannot
 * serve, and the reason is worth stating because the ticket assumed otherwise.
 * The chokepoint runs on a clone of the *incoming* state (#558), and that clone
 * already carries the incoming zoom, so `_detectResolutionChange` compares the
 * incoming zoom against itself and answers `false` on every restore. It is a
 * clone deliberately — `_adjustPixelSize` must see the incoming chr1/chr2 — so
 * the comparison that means anything is the one made before the clone is
 * installed.
 *
 * Four claims:
 *
 * 1. A restore onto the same zoom reports `false`.
 * 2. A restore onto a different zoom reports `true`.
 * 3. The first restore of a load, with no state yet in force, reports `true`.
 *    There is nothing to have been unchanged from, and `clearDataset()` nulls
 *    the state at the top of every load, so every load lands there.
 * 4. The flag survives the trip to the coordinator, and a same-zoom restore no
 *    longer releases the resolution lock. Claims 1 to 3 read the flag off the
 *    `onLocusChange` payload; this one reads the widget-visible consequence of
 *    it, which is where the behaviour change actually shows.
 *
 * All four read the payload because #563 folded `StateManager` into the browser
 * and there is no longer an inner `setState` whose return value a test can
 * take. That is the better instrument anyway: the payload is what
 * `js/publicApi.js` declares as contract, and the return value never was.
 *
 * The dataset, the viewport and the stubs are `testRestoreClamp.js`'s, for the
 * reason it gives: a stated 800x800, because JSDOM does no layout (ADR-0009
 * fact 5).
 */
import {beforeEach, afterEach, describe, expect, test, vi} from 'vitest'
import {igvxhr} from 'igv-utils'
import ContactMatrixView from '../js/contactMatrixView.js'
import State from '../js/hicState.js'
import {withContainers} from './utils/browserFixture.js'
import {restoreDataset} from './utils/restoreDataset.js'

vi.mock('../js/hicDataset.js', async () => {
    const {restoreDataset} = await import('./utils/restoreDataset.js')
    return {
        default: {loadDataset: async config => restoreDataset(config)},
        HiCDataset: class {
            constructor(config) {
                Object.assign(this, restoreDataset(config))
            }
            async init() {}
        },
    }
})

const {default: HICBrowser} = await import('../js/hicBrowser.js')

const VIEWPORT = {width: 800, height: 800}
const HIC_URL = 'https://example.org/restore-resolution-changed.hic'

/** chr1 x chr1, and two zooms off the same ladder `testRestoreClamp.js` drives. */
const CHR1 = 1
const ZOOM = 3
const OTHER_ZOOM = 5

const savedView = (zoom, x = 0, y = 0) => new State(CHR1, CHR1, zoom, x, y, 2, 'NONE')

describe('resolutionChanged tells the truth on restore (#560)', () => {

    const dom = withContainers()

    beforeEach(() => {
        vi.spyOn(ContactMatrixView.prototype, 'update').mockImplementation(async () => undefined)
        vi.spyOn(HICBrowser.prototype, 'update').mockImplementation(async () => undefined)
        vi.spyOn(igvxhr, 'loadString').mockImplementation(async () => {
            throw new Error('unexpected network access from the restore resolution suite')
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    function embed() {
        const browser = new HICBrowser(dom.another(), {})
        vi.spyOn(browser.contactMatrixView, 'getViewDimensions').mockReturnValue({...VIEWPORT})
        return browser
    }

    /**
     * The `resolutionChanged` flag of every locus change the browser publishes,
     * in order. `onLocusChange` is left to run: the lock claim below reads what
     * it does, and a test that stubbed it out would be reading its own mock.
     */
    function flagsPublishedBy(browser) {

        const flags = []
        const onLocusChange = browser.coordinator.onLocusChange.bind(browser.coordinator)
        vi.spyOn(browser.coordinator, 'onLocusChange').mockImplementation(eventData => {
            flags.push(eventData.resolutionChanged)
            return onLocusChange(eventData)
        })

        return flags
    }

    /** A loaded browser sitting at ZOOM, ready to be restored onto. */
    async function loaded() {
        const browser = embed()
        await browser.loadHicFile({url: HIC_URL, state: savedView(ZOOM)}, true)
        expect(browser.state.zoom).toBe(ZOOM)
        return browser
    }

    test('a restore onto the same zoom reports resolutionChanged false', async () => {

        const browser = await loaded()

        const flags = flagsPublishedBy(browser)

        // A different origin, so the restore is a real move — just not a
        // resolution one.
        await browser.setState(savedView(ZOOM, 40, 40))

        expect(flags).toEqual([false])
        expect(browser.state.zoom).toBe(ZOOM)
    })

    test('a restore onto a different zoom reports resolutionChanged true', async () => {

        const browser = await loaded()

        const flags = flagsPublishedBy(browser)

        await browser.setState(savedView(OTHER_ZOOM))

        expect(flags).toEqual([true])
        expect(browser.state.zoom).toBe(OTHER_ZOOM)
    })

    test('the first restore of a load, with no state in force, reports true', async () => {

        const browser = embed()
        const flags = flagsPublishedBy(browser)

        await browser.loadHicFile({url: HIC_URL, state: savedView(ZOOM)}, true)

        expect(flags.length).toBeGreaterThan(0)
        expect(flags[0]).toBe(true)
    })

    test('the flag reaches the coordinator, and a same-zoom restore leaves the resolution lock alone', async () => {

        const browser = await loaded()

        const seen = flagsPublishedBy(browser)

        // The lock is the widget-visible consequence: `onLocusChange` releases it
        // whenever the flag is set, which is what every restore used to do.
        browser.resolutionLocked = true
        await browser.setState(savedView(ZOOM, 40, 40))

        expect(seen).toEqual([false])
        expect(browser.resolutionLocked).toBe(true)

        await browser.setState(savedView(OTHER_ZOOM))

        expect(seen).toEqual([false, true])
        expect(browser.resolutionLocked).toBe(false)
    })
})
