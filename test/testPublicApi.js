import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import juicebox from '../js/index.js'
import HICBrowser from '../js/hicBrowser.js'
import {withDOM} from './utils/browserFixture.js'
import {NAMESPACE_SURFACE, BROWSER_SURFACE} from '../js/publicApi.js'

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
