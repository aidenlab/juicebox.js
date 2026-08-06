import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import juicebox from '../js/index.js'
import HICBrowser from '../js/hicBrowser.js'
import {withDOM} from './utils/browserFixture.js'
import {HiCDataset} from '../js/hicDataset.js'
import EventBus from '../js/eventBus.js'
import {NAMESPACE_SURFACE, BROWSER_SURFACE, POST_LOAD_SURFACE, SUB_SURFACES, COORDINATOR_CALLBACKS, EVENTS_POSTED, EVENT_PAYLOAD_SHAPES} from '../js/publicApi.js'

/**
 * Contract tests for the declared public surface.
 *
 * These assert what a *host application* can observe: that a name a host writes
 * is reachable on the object the host was handed. They deliberately say nothing
 * about how a member is implemented, whether it delegates, or where it is
 * declared -- a test that broke when a member moved from the prototype to the
 * constructor would be testing implementation, and would be wrong.
 *
 * The check runs one way: every declared name must exist. A new undeclared
 * member does not fail the build. See issue #470.
 */

/**
 * Stand up a fresh browser around each test in the calling describe, and tear
 * the DOM back down afterwards. Returns a holder rather than the browser itself
 * because the instance does not exist until beforeEach runs.
 */
function withBrowser() {

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

describe('namespace surface', () => {

    it('exports every declared name', () => {
        for (const name of NAMESPACE_SURFACE) {
            expect(juicebox, `js/index.js no longer exports "${name}"`).toHaveProperty(name)
        }
    })

    it('exports nothing beyond the declared names', () => {
        // js/index.js is an explicit export block that is already declared and
        // already healthy, so the reverse check costs nothing here -- unlike the
        // browser instance, where it would mean classifying every member.
        expect(Object.keys(juicebox).sort()).toEqual([...NAMESPACE_SURFACE].sort())
    })
})

describe('browser instance surface', () => {

    const context = withBrowser()

    it('constructs a browser', () => {
        expect(context.browser.id).toMatch(/^browser_/)
    })

    it('exposes every declared member', () => {
        for (const name of BROWSER_SURFACE) {
            // `in` rather than a truthiness check: `dataset` and `activeDataset`
            // are accessors that exist from construction and stay undefined
            // until a map loads. Presence is the contract, not the value.
            expect(name in context.browser, `browser no longer exposes "${name}"`).toBe(true)
        }
    })
})

describe('post-load surface', () => {

    it('declares where each member is populated', () => {
        for (const entry of POST_LOAD_SURFACE) {
            expect(entry.path).toBeTruthy()
            expect(entry.populatedBy, `${entry.path} does not say what populates it`).toBeTruthy()
        }
    })

    it('keeps genome out of the construction-time surface', () => {
        // The split is deliberate. genome is assigned by the data loader, so
        // folding it into BROWSER_SURFACE would fail against a bare instance --
        // and the tempting fix, dropping it, would make real contract invisible.
        expect(BROWSER_SURFACE).not.toContain('genome')
        expect(POST_LOAD_SURFACE.map(entry => entry.path)).toContain('browser.genome')
    })

    it('exposes isLive on a dataset', () => {
        // Spacewalk reads this to tell a live contact map from a static .hic.
        // A dataset constructs without a browser, so unlike genome this one can
        // be checked rather than only declared.
        const dataset = new HiCDataset({url: 'https://example.com/nonexistent.hic'})
        expect('isLive' in dataset).toBe(true)
    })
})

describe('sub-surfaces', () => {

    const context = withBrowser()

    it('exposes every declared member on its owner', () => {
        for (const {owner, member} of SUB_SURFACES) {
            expect(context.browser[owner], `browser no longer exposes "${owner}"`).toBeDefined()
            expect(member in context.browser[owner], `browser.${owner} no longer exposes "${member}"`).toBe(true)
        }
    })

    it('declares owners that are themselves declared surface', () => {
        // A sub-surface reached through an undeclared member would be a promise
        // resting on nothing.
        for (const {owner} of SUB_SURFACES) {
            expect(BROWSER_SURFACE, `"${owner}" is a sub-surface owner but is not declared surface`).toContain(owner)
        }
    })
})

describe('coordinator callbacks', () => {

    const context = withBrowser()

    // Exercised rather than reflected on: addCallback validates its argument and
    // throws, so these assertions test behaviour a host can actually observe.

    it('accepts every declared callback name', () => {
        for (const name of COORDINATOR_CALLBACKS) {
            expect(
                () => context.browser.coordinator.addCallback(name, () => {}),
                `coordinator no longer accepts "${name}"`
            ).not.toThrow()
        }
    })

    it('rejects an undeclared callback name', () => {
        expect(() => context.browser.coordinator.addCallback('onSomethingUndeclared', () => {})).toThrow()
    })

    it('returns an unsubscribe function', () => {
        // Hosts hold this to detach on teardown; dropping it would leak the
        // callback and outlive the host's own lifecycle.
        const unsubscribe = context.browser.coordinator.addCallback('onMapLoaded', () => {})
        expect(typeof unsubscribe).toBe('function')
    })
})

describe('event bus', () => {

    const context = withBrowser()

    // These check the plumbing declared events travel over. Whether each event
    // is still *posted* is not checked -- see EVENTS_POSTED and #438.

    it('exposes a per-browser bus that a host can subscribe to', () => {
        expect(typeof context.browser.eventBus.subscribe).toBe('function')
        expect(typeof context.browser.eventBus.post).toBe('function')
    })

    it('exposes a global bus', () => {
        expect(EventBus.globalBus).toBeDefined()
        expect(typeof EventBus.globalBus.subscribe).toBe('function')
    })

    it('reaches a subscriber on whichever bus an event declares', () => {
        // Deliberately not a check that juicebox still posts these -- this test
        // does the posting, so it could only ever pass. It checks the weaker
        // thing that is still worth knowing: that the bus each declared event
        // names is real and reachable from what a host holds.
        for (const {name, bus} of EVENTS_POSTED) {
            expect(['global', 'browser'], `"${name}" declares an unknown bus`).toContain(bus)
            const target = 'global' === bus ? EventBus.globalBus : context.browser.eventBus
            expect(typeof target.subscribe, `the ${bus} bus is not subscribable`).toBe('function')
        }
    })

    it('declares a payload shape only for events it also posts', () => {
        const posted = EVENTS_POSTED.map(entry => entry.name)
        for (const {event} of EVENT_PAYLOAD_SHAPES) {
            expect(posted, `"${event}" has a declared payload but is not a declared event`).toContain(event)
        }
    })
})
