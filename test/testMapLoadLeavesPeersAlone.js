import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import ContactMatrixView from '../js/contactMatrixView.js'
import HICBrowser from '../js/hicBrowser.js'
import DataLoader from '../js/dataLoader.js'
import {createBrowser} from '../js/createBrowser.js'
import {withContainers} from './utils/browserFixture.js'
import State from '../js/hicState.js'
import {WHOLE_HG19, serveMaps} from './utils/servedMaps.js'

/**
 * A map loading into one panel of a sync group must not move the others.
 *
 * Every map load installs `State.default()` -- the whole-genome view -- as the
 * place it starts from, and only afterwards adopts a peer's view. The question
 * is whether that intermediate default ever leaves the loading panel.
 *
 * `test/testSyncOnLoad.js` cannot see it: it stubs `HICBrowser.prototype.update`
 * whole, and `update` is where a browser pushes its state to its sync group.
 * Here only the *repaint* is stubbed, so the push runs for real.
 */

/** chr2 vs chr2, zoom 5, origin (7, 9) -- an unmistakably non-default view. */
const MOVED = () => new State(2, 2, 5, 7, 9, 1, 'NONE')

/** `syncToOtherBrowsers` does not await the peers it pushes to. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

const view = browser => ({chr1: browser.state.chr1, chr2: browser.state.chr2, zoom: browser.state.zoom})

describe('a map load and the panels it is synced with', () => {

    const dom = withContainers()

    beforeEach(() => {
        vi.spyOn(ContactMatrixView.prototype, 'update').mockImplementation(async () => undefined)
        vi.spyOn(HICBrowser.prototype, 'repaint').mockImplementation(async () => undefined)
        vi.spyOn(DataLoader.prototype, 'loadTracks').mockImplementation(async () => undefined)
    })

    afterEach(() => vi.restoreAllMocks())

    async function panelsAtOneLocus(container, count) {
        serveMaps(Array.from({length: count + 1}, () => WHOLE_HG19))
        const browsers = []
        for (let i = 0; i < count; i++) {
            browsers.push(await createBrowser(container, {url: `https://example.com/${i}.hic`}))
        }
        await browsers[0].setState(MOVED())
        await settle()
        return browsers
    }

    it('starts from a group that is all at one locus', async () => {
        const browsers = await panelsAtOneLocus(dom.container, 3)
        for (const browser of browsers) {
            expect(view(browser)).toEqual({chr1: 2, chr2: 2, zoom: 5})
        }
    })

    it('leaves a synced bystander where it was', async () => {
        const [a, , c] = await panelsAtOneLocus(dom.container, 3)

        await a.loadHicFile({url: 'https://example.com/new.hic'})
        await settle()

        expect(view(c)).toEqual({chr1: 2, chr2: 2, zoom: 5})
    })

    it('brings the loading panel to the group, not the group to the loading panel', async () => {
        const [a, b] = await panelsAtOneLocus(dom.container, 2)

        await a.loadHicFile({url: 'https://example.com/new.hic'})
        await settle()

        expect(view(b)).toEqual({chr1: 2, chr2: 2, zoom: 5})
        expect(view(a)).toEqual({chr1: 2, chr2: 2, zoom: 5})
    })

    it('never pushes the whole-genome default to a peer during the load', async () => {
        const [a, b] = await panelsAtOneLocus(dom.container, 2)

        const pushed = []
        const original = b.syncState.bind(b)
        b.syncState = async target => { pushed.push({chr1Name: target.chr1Name, chr2Name: target.chr2Name}); return original(target) }

        await a.loadHicFile({url: 'https://example.com/new.hic'})
        await settle()

        expect(pushed.filter(({chr1Name}) => 'all' === String(chr1Name).toLowerCase())).toEqual([])
    })
})
