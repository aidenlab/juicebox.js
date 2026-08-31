import {describe, it, expect} from 'vitest'
import {registryForContainer} from '../js/browserRegistry.js'
import {withContainers} from './utils/browserFixture.js'
import {withStubbedLoads} from './utils/stubbedLoads.js'

/**
 * The resolution lock mirrors across a sync group; its auto-clears do not.
 *
 * ADR-0014 draws the line between what *syncs* (canonical state, on every
 * update) and what *mirrors* (a view preference, on the user's action only),
 * and the resolution lock is the first preference on the mirror side. Both
 * halves need pinning, and the second is the one that would rot silently: a
 * later refactor routing the coordinator's auto-clears through the same call
 * with `mirror: true` would put a fan-out on the sync hot path, and nothing
 * about the feature would look broken.
 *
 * Two embeds throughout, per the house rule in `testDeleteAllUnsync.js` -- a
 * mirror that reached the whole page rather than the sync group would pass
 * every single-embed assertion.
 */

const session = (...urls) => ({browsers: urls.map(url => ({url}))})

describe('mirroring the resolution lock across a sync group', () => {

    const dom = withContainers()
    withStubbedLoads()

    it('closes the padlock on every peer when the user closes one', async () => {
        const mine = registryForContainer(dom.container)
        await mine.restoreSession(session(
            'https://example.com/a.hic',
            'https://example.com/b.hic',
            'https://example.com/c.hic',
        ))
        const [a, b, c] = mine.browsers
        expect([...a.synchedBrowsers]).toEqual(expect.arrayContaining([b, c]))

        a.setResolutionLocked(true, {mirror: true})

        expect([a, b, c].map(browser => browser.resolutionLocked)).toEqual([true, true, true])
    })

    it('repaints each peer\'s padlock, not just its field', async () => {
        // The half that used to be a separate call every writer had to
        // remember. A mirrored browser whose field moved but whose icon did not
        // is exactly the lying padlock the setter exists to prevent.
        const mine = registryForContainer(dom.container)
        await mine.restoreSession(session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const [a, b] = mine.browsers

        a.setResolutionLocked(true, {mirror: true})

        const icon = browser => browser.coordinator.widgets.resolutionSelector.resolutionLockElement
        for (const browser of [a, b]) {
            expect(icon(browser).classList.contains('fa-lock')).toBe(true)
            expect(icon(browser).classList.contains('fa-unlock')).toBe(false)
        }
    })

    it('opens every peer again when the user re-opens one', async () => {
        const mine = registryForContainer(dom.container)
        await mine.restoreSession(session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const [a, b] = mine.browsers

        a.setResolutionLocked(true, {mirror: true})
        b.setResolutionLocked(false, {mirror: true})

        expect([a.resolutionLocked, b.resolutionLocked]).toEqual([false, false])
    })

    it('does not reach the other embed', async () => {
        // Membership is the sync group, not the page. ADR-0014 decision 5.
        const mine = registryForContainer(dom.container)
        const theirs = registryForContainer(dom.another())
        await mine.restoreSession(session('https://example.com/a.hic'))
        await theirs.restoreSession(session('https://example.com/c.hic'))
        const [a] = mine.browsers
        const [c] = theirs.browsers

        a.setResolutionLocked(true, {mirror: true})

        expect(a.resolutionLocked).toBe(true)
        expect(c.resolutionLocked).toBe(false)
    })

    it('does not mirror without being asked', async () => {
        // The default. Every caller but the widget's click takes this path, so
        // the default being `false` is what keeps the auto-clears local.
        const mine = registryForContainer(dom.container)
        await mine.restoreSession(session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const [a, b] = mine.browsers

        a.setResolutionLocked(true)

        expect([a.resolutionLocked, b.resolutionLocked]).toEqual([true, false])
    })

    it('leaves peers alone when the coordinator auto-clears the lock', async () => {
        // The claim that would rot silently. Both browsers are locked; only the
        // one whose resolution actually changed comes back unlocked.
        const mine = registryForContainer(dom.container)
        await mine.restoreSession(session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const [a, b] = mine.browsers
        a.setResolutionLocked(true, {mirror: true})

        a.coordinator.onLocusChange({state: a.state, resolutionChanged: true, chrChanged: false})

        expect([a.resolutionLocked, b.resolutionLocked]).toEqual([false, true])
    })
})
