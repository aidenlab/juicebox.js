/**
 * The back door beside the ladder is closed. #559, candidate 6, ADR-0009
 * decision 1.
 *
 * `setActiveDataset(dataset, state)` assigned the incoming state straight onto
 * `activeState` with no validation, from five `dataLoader` call sites, and it
 * carried no warning comment while running on every load. It is *not* the
 * bypass the review card names -- `browser.state = x` and
 * `browser.activeState = x` carry the comment and have zero production callers
 * (ADR-0009 fact 2). This one was live. Those two setters are gone as of #563;
 * this one had to be closed by hand.
 *
 * #558 routed `setState` through the chokepoint, which incidentally fixed the
 * three rungs that assign and then immediately call it: the unvalidated state
 * was overwritten a line later. The rung it did not reach is the one this file
 * is about -- `config.locus` goes on to `parseGotoInput`, and there the raw
 * state used to stand.
 *
 * A `config.synchState` rung used to be the second such rung, and #559's third
 * acceptance criterion was about it. That rung is gone: it was unreachable
 * (`clearDataset()` ran above a guard needing a dataset) and superseded in 2017
 * by the sync step at the end of `loadHicFile`, so #566 deleted it rather than
 * repairing it. The two tests that pinned it -- unreachable today, correct if
 * lifted -- went with it.
 *
 * `testRestoreGolden.js` (#557) counts `setActiveDataset(state)` per door and
 * that count is now zero everywhere, which says the parameter stopped being
 * *passed*. It cannot say the parameter is gone, nor that nothing else writes
 * `activeState` on the way past. That is what the two claims here are:
 *
 * 1. The parameter does not exist, and a caller who passes one anyway installs
 *    no state. A count of zero would survive the door being left ajar.
 * 2. On the `config.locus` door, every state that reaches the state field came
 *    out of the chokepoint. This was asserted by trapping the field itself, so
 *    that a write from anywhere -- this ladder, a helper it calls, a path added
 *    later -- would be seen. Since #563 the field is `HICBrowser`'s private
 *    `#state` and there is nowhere else to write it from, so what is asserted
 *    here is that the state left standing is one the chokepoint produced.
 *
 * A third claim is here because closing the door moved what a *host* sees. The
 * chokepoint installs a clone (#558), so the state a rung hands it stops being
 * the state in force the moment it is accepted -- and once the `config.locus`
 * rung goes through the chokepoint, the object it handed over is a whole-genome
 * default while the browser sits at the requested locus. `onMapLoaded` publishes
 * that object, and `COORDINATOR_PAYLOAD_SHAPES` in `js/publicApi.js` declares
 * the payload as contract, so it is now read back off the browser. The gate
 * cannot see this: it records `browser.state`, never the callback's argument.
 *
 * The dataset, the viewport and the stubs are `test/utils/restoreFixture.js`'s,
 * for the reason it gives: a stated 800x800, because JSDOM does no layout
 * (ADR-0009 fact 5).
 */
import {describe, expect, test, vi} from 'vitest'
import State from '../js/hicState.js'
import {restoreFixture} from './utils/restoreFixture.js'

vi.mock('../js/hicDataset.js', async () => {
    const {restoreDataset, datasetModule} = await import('./utils/restoreDataset.js')
    return datasetModule(restoreDataset)
})

const {default: HICBrowser} = await import('../js/hicBrowser.js')

const HIC_URL = 'https://example.org/restore-back-door.hic'

/** chr1 x chr1 at 250kb bins — the zoom `testRestoreClamp.js` drives. */
const CHR1 = 1
const ZOOM = 3

/**
 * Record every state the chokepoint installs.
 *
 * This used to trap the `activeState` field itself, because the claim is "no
 * state reaches the state field except through `setState`" and a call count can
 * only speak about the callers it was told to watch. #563 makes that claim
 * structural instead: the field is `HICBrowser`'s private `#state`, written on
 * one line of one method, and unreachable from a test or a host at all -- so
 * there is no longer a write to trap, and the language enforces what the trap
 * used to assert. `testAccessorVocabulary.js` pins the other half, that the
 * setters are gone rather than merely unused.
 *
 * What is left to watch is which states the chokepoint *produced*, so a door
 * can still be asked whether the state it left standing is one of them. The
 * installed state is read back off the browser after each call rather than
 * taken from the argument: `setState` installs a clone, and the clone is the
 * thing that has to be in force. An `undefined` is recorded like any other
 * answer but is not a state -- a load clears before it restores.
 */
function trapStateInstalls(browser) {

    const installs = []

    const chokepoint = HICBrowser.prototype.setState
    vi.spyOn(HICBrowser.prototype, 'setState').mockImplementation(async function (...args) {
        const result = await chokepoint.apply(this, args)
        // After the call, not in a `finally`: a `setState` that threw installed
        // nothing, and recording it would make a failed restore look like a
        // successful one.
        installs.push(this.state)
        return result
    })

    return installs
}

/** The states a load left standing — the installs that were not a clear. */
function installed(installs) {
    return installs.filter(state => state !== undefined)
}

describe('the state parameter is gone from setActiveDataset (#559)', () => {

    const {embed} = restoreFixture(HICBrowser, {suite: 'restore back-door', url: HIC_URL})

    test('setActiveDataset takes a dataset and nothing else', async () => {

        const browser = embed()
        await browser.loadHicFile({url: HIC_URL}, true)

        const before = browser.state
        expect(before).toBeDefined()

        // Declared arity, and behaviour: a caller written against the old
        // two-argument form installs a dataset and no state.
        expect(HICBrowser.prototype.setActiveDataset.length).toBe(1)

        const smuggled = new State(CHR1, CHR1, ZOOM, 999_999, 999_999, 1e9, 'NONE')
        browser.setActiveDataset(browser.dataset, smuggled)

        expect(browser.state).toBe(before)
        expect(browser.state).not.toBe(smuggled)
    })

    test('the config.locus door installs no state the chokepoint did not produce', async () => {

        const browser = embed()
        const installs = trapStateInstalls(browser)

        await browser.loadHicFile({url: HIC_URL, locus: 'chr1:1000000-2000000'}, true)

        // The door ran: a state is installed and the locus was applied to it.
        expect(installed(installs).length).toBeGreaterThan(0)
        expect(browser.state.chr1).toBe(CHR1)

        // `parseGotoInput` mutates the state in place rather than installing a
        // new one, so the state left standing is the chokepoint's own clone.
        expect(browser.state).toBe(installed(installs).at(-1))
    })

    test('onMapLoaded publishes the state in force, not the one handed to the chokepoint', async () => {

        const browser = embed()
        const published = []
        vi.spyOn(browser.coordinator, 'onMapLoaded').mockImplementation((dataset, state) => {
            published.push(state)
        })

        await browser.loadHicFile({url: HIC_URL, locus: 'chr1:1000000-2000000'}, true)

        expect(published).toHaveLength(1)

        // The identity, and then the view: a host that reads the payload sees
        // where the browser actually is, not the default it started from.
        expect(published[0]).toBe(browser.state)
        expect(published[0].chr1).toBe(CHR1)
        expect(published[0].chr2).toBe(CHR1)
    })
})
