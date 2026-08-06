import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import juicebox from '../js/index.js'
import HICBrowser from '../js/hicBrowser.js'
import {withDOM} from './utils/browserFixture.js'
import {HiCDataset} from '../js/hicDataset.js'
import {NAMESPACE_SURFACE, BROWSER_SURFACE, POST_LOAD_SURFACE, SUB_SURFACES, COORDINATOR_CALLBACKS} from '../js/publicApi.js'

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

    let fixture
    let browser

    beforeEach(() => {
        fixture = withDOM()
        browser = new HICBrowser(fixture.container, {})
    })

    afterEach(() => {
        fixture.restore()
    })

    it('constructs a browser', () => {
        expect(browser.id).toMatch(/^browser_/)
    })

    it('exposes every declared member', () => {
        for (const name of BROWSER_SURFACE) {
            // `in` rather than a truthiness check: `dataset` and `activeDataset`
            // are accessors that exist from construction and stay undefined
            // until a map loads. Presence is the contract, not the value.
            expect(name in browser, `browser no longer exposes "${name}"`).toBe(true)
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

    let fixture
    let browser

    beforeEach(() => {
        fixture = withDOM()
        browser = new HICBrowser(fixture.container, {})
    })

    afterEach(() => {
        fixture.restore()
    })

    it('exposes every declared member on its owner', () => {
        for (const {owner, member} of SUB_SURFACES) {
            expect(browser[owner], `browser no longer exposes "${owner}"`).toBeDefined()
            expect(member in browser[owner], `browser.${owner} no longer exposes "${member}"`).toBe(true)
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

    let fixture
    let browser

    beforeEach(() => {
        fixture = withDOM()
        browser = new HICBrowser(fixture.container, {})
    })

    afterEach(() => {
        fixture.restore()
    })

    // Exercised rather than reflected on: addCallback validates its argument and
    // throws, so these assertions test behaviour a host can actually observe.

    it('accepts every declared callback name', () => {
        for (const name of COORDINATOR_CALLBACKS) {
            expect(
                () => browser.coordinator.addCallback(name, () => {}),
                `coordinator no longer accepts "${name}"`
            ).not.toThrow()
        }
    })

    it('rejects an undeclared callback name', () => {
        expect(() => browser.coordinator.addCallback('onSomethingUndeclared', () => {})).toThrow()
    })

    it('returns an unsubscribe function', () => {
        // Hosts hold this to detach on teardown; dropping it would leak the
        // callback and outlive the host's own lifecycle.
        const unsubscribe = browser.coordinator.addCallback('onMapLoaded', () => {})
        expect(typeof unsubscribe).toBe('function')
    })
})
