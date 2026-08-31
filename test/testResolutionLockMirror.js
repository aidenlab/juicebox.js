import {describe, it, expect} from 'vitest'
import {registryForContainer} from '../js/browserRegistry.js'
import {withContainers} from './utils/browserFixture.js'
import {withStubbedLoads} from './utils/stubbedLoads.js'
import Genome from '../js/genome.js'
import State from '../js/hicState.js'

/**
 * The resolution lock mirrors across a sync group, on every transition.
 *
 * ADR-0014 draws the line between what *syncs* (canonical state, on every
 * update) and what *mirrors* (a view preference, on any transition), and the
 * resolution lock is the first preference on the mirror side. Whatever voids the
 * lock on one browser voids it on all of them -- the padlock clicked open, a
 * resolution change, a map load -- because parity is the point of the feature
 * and a lock that survived on one panel would be a padlock the group has stopped
 * agreeing with.
 *
 * What makes that affordable is the no-op guard, and that is the claim here most
 * likely to rot: drop it and the suite still passes on behaviour while every
 * resolution change in a never-locked session broadcasts to say nothing
 * happened. It gets its own test for that reason.
 *
 * Two embeds throughout, per the house rule in `testDeleteAllUnsync.js` -- a
 * mirror that reached the whole page rather than the sync group would pass every
 * single-embed assertion.
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

    it('unlocks the peers too when a resolution change voids the lock', async () => {
        // The auto-clear on the sync hot path. A peer that kept its lock here is
        // the rung-mismatch divergence ADR-0014 decision 3 exists to close.
        const mine = registryForContainer(dom.container)
        await mine.restoreSession(session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const [a, b] = mine.browsers
        a.setResolutionLocked(true, {mirror: true})

        a.coordinator.onLocusChange({state: a.state, resolutionChanged: true, chrChanged: false})

        expect([a.resolutionLocked, b.resolutionLocked]).toEqual([false, false])
    })

    it('unlocks the peers when a map is loaded into one panel', async () => {
        // Decision 3b. Driven through the coordinator rather than through
        // `loadHicFile`, which the fixture stubs wholesale -- the stub stands in
        // for the network read and so never reaches `onMapLoaded` at all.
        const mine = registryForContainer(dom.container)
        await mine.restoreSession(session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const [a, b] = mine.browsers
        a.setResolutionLocked(true, {mirror: true})
        expect(b.resolutionLocked).toBe(true)

        a.coordinator.onMapLoaded(a.dataset, a.state, a.dataset.datasetType)

        expect([a.resolutionLocked, b.resolutionLocked]).toEqual([false, false])
    })

    it('still holds its peers after clearDataset, which is what lets a map load reach them', async () => {
        // The mechanical precondition the test above rests on, and the one that
        // could be taken away by a change that looks like tidying. Every map
        // load opens with `clearDataset()`, which strips this browser from its
        // peers' sets but deliberately leaves its own standing (#492) -- so the
        // load can still address the group on its way past. Make that symmetric
        // and decision 3b stops working, silently.
        const mine = registryForContainer(dom.container)
        await mine.restoreSession(session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const [a, b] = mine.browsers

        a.clearDataset()

        expect([...a.synchedBrowsers]).toEqual([b])
        expect([...b.synchedBrowsers]).toEqual([])
    })

    it('holds its rung against a locked peer, and keeps both locks', async () => {
        // #608, and the case that made the whole feature look broken: a locked
        // zoom in one panel unlocked both. `State.sync` re-derived a rung from
        // the publisher's bpPerPixel without consulting the receiver's lock, the
        // receiver moved off the rung it was pinned to, its lock auto-cleared
        // for having moved, and the mirror sent that clear back to the origin.
        //
        // Locked, the receiver follows the *scale* and holds the rung: same
        // zoom, same pixelSize, no `zoomChanged`, no clear, nothing to mirror.
        const mine = registryForContainer(dom.container)
        await mine.restoreSession(session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const [a, b] = mine.browsers
        for (const browser of [a, b]) {
            browser.genome = new Genome(browser.dataset.genomeId, browser.dataset.chromosomes)
            await browser.setState(new State(1, 1, 4, 0, 0, 1.5, 'NONE'))
        }
        a.setResolutionLocked(true, {mirror: true})

        // The locked wheel zoom: rung frozen, pixelSize past the rung ratio, so
        // an unlocked receiver would drop to the 50kb rung and take both locks
        // down with it.
        a.state.pixelSize = 2.6
        await b.syncState(a.getSyncState())

        expect(b.state.zoom).toBe(4)
        expect(b.state.pixelSize).toBeCloseTo(2.6, 6)
        expect([a.resolutionLocked, b.resolutionLocked]).toEqual([true, true])
    })

    it('still re-derives the peer\'s rung when nothing is locked', async () => {
        // The other side of the same branch: unlocked, sync keeps its old
        // behaviour and follows the publisher onto whatever rung its scale
        // implies. The fix above is a branch, not a replacement.
        const mine = registryForContainer(dom.container)
        await mine.restoreSession(session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const [a, b] = mine.browsers
        for (const browser of [a, b]) {
            browser.genome = new Genome(browser.dataset.genomeId, browser.dataset.chromosomes)
            await browser.setState(new State(1, 1, 4, 0, 0, 1.5, 'NONE'))
        }

        a.state.pixelSize = 2.6
        await b.syncState(a.getSyncState())

        expect(b.state.zoom).toBe(5)
    })

    it('does not fan out when the value already holds', async () => {
        // The guard, asserted on the fan-out rather than on the field -- the
        // field would read `false` either way. A never-locked session takes this
        // path on every resolution change, which is why it must cost nothing.
        const mine = registryForContainer(dom.container)
        await mine.restoreSession(session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const [a, b] = mine.browsers
        expect([a.resolutionLocked, b.resolutionLocked]).toEqual([false, false])

        let reached = 0
        const spied = b.setResolutionLocked.bind(b)
        b.setResolutionLocked = (...args) => { reached += 1; return spied(...args) }

        a.setResolutionLocked(false, {mirror: true})

        expect(reached).toBe(0)
    })
})
