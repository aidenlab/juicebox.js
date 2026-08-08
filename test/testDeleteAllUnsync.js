import {describe, it, expect} from 'vitest'
import {registryForContainer} from '../js/browserRegistry.js'
import {withContainers} from './utils/browserFixture.js'
import {withStubbedLoads} from './utils/stubbedLoads.js'

/**
 * A deleted browser leaves nobody's sync group behind -- #492, fact 4 of
 * ADR-0005.
 *
 * The fact as filed was that `delete()` unsynced and `deleteAll()` did not, so
 * a restore -- which opens with `deleteAll()` -- could leave a live browser
 * panning against one that is no longer on the page. #493 closed that half by
 * routing both delete paths through `dispose()`; nothing had ever asserted it,
 * and these are the assertions. The other half is new here: a disposed browser
 * also gives up the peers *it* holds.
 *
 * These drive the *restore* path rather than `deleteAll()` directly, because
 * the restore is how both hosts reach the delete, and it is the only path where
 * a fresh sync group is built immediately afterwards -- which is where a stale
 * reference would hide. And there are two embeds throughout: what makes a
 * reference stale is that its target is gone from the page, so an assertion has
 * to be able to name every browser still on it.
 */

const session = (...urls) => ({browsers: urls.map(url => ({url}))})

describe('a session restore and the sync groups it leaves behind', () => {

    const dom = withContainers()
    withStubbedLoads()

    it('leaves no browser on the page holding a reference to a deleted one', async () => {
        const mine = registryForContainer(dom.container)
        const theirs = registryForContainer(dom.another())

        await mine.restoreSession(session('https://example.com/a.hic', 'https://example.com/b.hic'))
        await theirs.restoreSession(session('https://example.com/c.hic', 'https://example.com/d.hic'))

        const deleted = [...mine.browsers]
        await mine.restoreSession(session('https://example.com/e.hic', 'https://example.com/f.hic'))

        // Every browser on the page, across both embeds: what a sync group is
        // allowed to contain, and nothing else.
        const live = [...mine.browsers, ...theirs.browsers]
        expect(live.length).toBe(4)
        for (const browser of live) {
            expect([...browser.synchedBrowsers].filter(peer => deleted.includes(peer))).toEqual([])
            expect([...browser.synchedBrowsers].every(peer => live.includes(peer))).toBe(true)
        }
    })

    it('leaves the other embed\'s sync group whole', async () => {
        // The restore reaches only its own registry, so the untouched embed
        // keeps the group it had -- the counterpart to the claim above, which
        // an over-eager unsync would break.
        const mine = registryForContainer(dom.container)
        const theirs = registryForContainer(dom.another())

        await mine.restoreSession(session('https://example.com/a.hic'))
        await theirs.restoreSession(session('https://example.com/c.hic', 'https://example.com/d.hic'))
        const [c, d] = theirs.browsers

        await mine.restoreSession(session('https://example.com/e.hic'))

        expect([...c.synchedBrowsers]).toEqual([d])
        expect([...d.synchedBrowsers]).toEqual([c])
    })

    it('leaves the deleted browsers holding nobody', async () => {
        // The other direction of the same edge. A host holds its browser across
        // call sites -- juicebox-web keeps one from `getCurrentBrowser()` -- so
        // a zombie that kept its group would pin every live browser's object
        // graph for as long as the host held it.
        const mine = registryForContainer(dom.container)
        registryForContainer(dom.another())

        await mine.restoreSession(session('https://example.com/a.hic', 'https://example.com/b.hic'))
        const deleted = [...mine.browsers]
        expect(deleted.some(browser => browser.synchedBrowsers.size > 0)).toBe(true)

        await mine.restoreSession(session('https://example.com/e.hic'))

        for (const browser of deleted) {
            expect([...browser.synchedBrowsers]).toEqual([])
        }
    })

    it('unsyncs on a direct deleteAll() too, not only through a restore', async () => {
        // The exported `deleteAllBrowsers` reaches this without a restore.
        const mine = registryForContainer(dom.container)
        const theirs = registryForContainer(dom.another())

        await mine.restoreSession(session('https://example.com/a.hic', 'https://example.com/b.hic'))
        await theirs.restoreSession(session('https://example.com/c.hic', 'https://example.com/d.hic'))
        const deleted = [...mine.browsers]

        mine.deleteAll()

        for (const survivor of theirs.browsers) {
            expect([...survivor.synchedBrowsers].filter(peer => deleted.includes(peer))).toEqual([])
        }
    })
})
