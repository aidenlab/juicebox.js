/**
 * The back door beside the ladder is closed. #559, candidate 6, ADR-0009
 * decision 1.
 *
 * `setActiveDataset(dataset, state)` assigned the incoming state straight onto
 * `activeState` with no validation, from five `dataLoader` call sites, and it
 * carried no warning comment while running on every load. It is *not* the
 * bypass the review card names -- `browser.state = x` and
 * `browser.activeState = x` carry the comment and have zero production callers
 * (ADR-0009 fact 2). This one was live.
 *
 * #558 routed `setState` through the chokepoint, which incidentally fixed the
 * three rungs that assign and then immediately call it: the unvalidated state
 * was overwritten a line later. The two rungs it did not reach are the ones
 * this file is about -- `config.locus` goes on to `parseGotoInput` and
 * `config.synchState` to a sync, and on both the raw state used to stand.
 *
 * `testRestoreGolden.js` (#557) counts `setActiveDataset(state)` per door and
 * that count is now zero everywhere, which says the parameter stopped being
 * *passed*. It cannot say the parameter is gone, nor that nothing else writes
 * `activeState` on the way past. That is what the three claims here are:
 *
 * 1. The parameter does not exist, and a caller who passes one anyway installs
 *    no state. A count of zero would survive the door being left ajar.
 * 2. On the `config.locus` door, every state that reaches `activeState` came
 *    out of the chokepoint. Asserted by trapping the field itself rather than
 *    by counting calls, so a write from anywhere -- this ladder, a helper it
 *    calls, a path added later -- is seen.
 * 3. The same trap on the `config.synchState` door. **That rung is unreachable
 *    in production today** (#566): `loadHicFile` opens with `clearDataset()`,
 *    four lines above a guard that returns false without an `activeDataset`,
 *    so a config carrying a `synchState` silently takes the fallback rung. Both
 *    halves are pinned -- that it is unreachable, and that its code is correct
 *    for when #566 makes it reachable -- because a ticket that left the branch
 *    untested until then would be leaving it untested at exactly the moment it
 *    starts running.
 *
 * The third acceptance criterion of #559 is narrowed for that reason: there is
 * no production restore via `synchState` to validate, and this file says so
 * with a test rather than with a comment that could quietly go stale.
 *
 * The dataset, the viewport and the stubs are `testRestoreClamp.js`'s, for the
 * reason it gives: a stated 800x800, because JSDOM does no layout (ADR-0009
 * fact 5).
 */
import {beforeEach, afterEach, describe, expect, test, vi} from 'vitest'
import {igvxhr} from 'igv-utils'
import ContactMatrixView from '../js/contactMatrixView.js'
import StateManager from '../js/stateManager.js'
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
const HIC_URL = 'https://example.org/restore-back-door.hic'

/** chr1 x chr1 at 250kb bins — the zoom `testRestoreClamp.js` drives. */
const CHR1 = 1
const ZOOM = 3

/**
 * Watch `activeState` itself, and record for each write whether the chokepoint
 * was on the stack.
 *
 * The field is trapped on the instance rather than the calls counted on the
 * prototype: the claim is "no state reaches `activeState` except through
 * `setState`", and a call count can only speak about the callers it was told
 * to watch. Writes of `undefined` are recorded too but are not states --
 * `clearState()` makes one at the top of every load.
 */
function trapActiveStateWrites(stateManager) {

    const writes = []
    let depth = 0

    const chokepoint = StateManager.prototype.setState
    vi.spyOn(StateManager.prototype, 'setState').mockImplementation(async function (...args) {
        depth += 1
        try {
            return await chokepoint.apply(this, args)
        } finally {
            depth -= 1
        }
    })

    let held = stateManager.activeState
    Object.defineProperty(stateManager, 'activeState', {
        configurable: true,
        get() {
            return held
        },
        set(value) {
            writes.push({state: value, throughChokepoint: depth > 0})
            held = value
        },
    })

    return writes
}

/** The states installed by a load — the writes that were not a clear. */
function installed(writes) {
    return writes.filter(write => write.state !== undefined)
}

describe('the state parameter is gone from setActiveDataset (#559)', () => {

    const dom = withContainers()

    beforeEach(() => {
        vi.spyOn(ContactMatrixView.prototype, 'update').mockImplementation(async () => undefined)
        vi.spyOn(HICBrowser.prototype, 'update').mockImplementation(async () => undefined)
        vi.spyOn(igvxhr, 'loadString').mockImplementation(async () => {
            throw new Error('unexpected network access from the restore back-door suite')
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

    test('setActiveDataset takes a dataset and nothing else', async () => {

        const browser = embed()
        await browser.loadHicFile({url: HIC_URL}, true)

        const before = browser.state
        expect(before).toBeDefined()

        // Declared arity, and behaviour: a caller written against the old
        // two-argument form installs a dataset and no state.
        expect(StateManager.prototype.setActiveDataset.length).toBe(1)

        const smuggled = new State(CHR1, CHR1, ZOOM, 999_999, 999_999, 1e9, 'NONE')
        browser.setActiveDataset(browser.dataset, smuggled)

        expect(browser.state).toBe(before)
        expect(browser.state).not.toBe(smuggled)
    })

    test('the config.locus door installs no state the chokepoint did not produce', async () => {

        const browser = embed()
        const writes = trapActiveStateWrites(browser.stateManager)

        await browser.loadHicFile({url: HIC_URL, locus: 'chr1:1000000-2000000'}, true)

        // The door ran: a state is installed and the locus was applied to it.
        expect(installed(writes).length).toBeGreaterThan(0)
        expect(browser.state.chr1).toBe(CHR1)

        for (const write of installed(writes)) {
            expect(write.throughChokepoint).toBe(true)
        }

        // `parseGotoInput` mutates the state in place rather than installing a
        // new one, so the state left standing is the chokepoint's own clone.
        expect(browser.state).toBe(installed(writes).at(-1).state)
    })

    test('the config.synchState rung is unreachable, so no restore takes it (#566)', async () => {

        const browser = embed()
        await browser.loadHicFile({url: HIC_URL}, true)

        const synchState = browser.getSyncState()
        expect(synchState).toBeDefined()

        const sync = vi.spyOn(HICBrowser.prototype, 'syncState')

        // Primed — a dataset is already loaded — and the rung is still not
        // taken: `clearDataset()` runs first and `canBeSynched` returns false
        // without an `activeDataset`.
        await browser.loadHicFile({url: HIC_URL, synchState}, true)

        expect(sync).not.toHaveBeenCalled()
    })

    test('when the rung is reachable, it installs the dataset and then goes through the chokepoint', async () => {

        const browser = embed()
        await browser.loadHicFile({url: HIC_URL, state: new State(CHR1, CHR1, ZOOM, 40, 40, 2, 'NONE')}, true)

        const synchState = browser.getSyncState()

        // #566, and only #566: the guard four lines below it is what makes the
        // rung dead, so neutralising the clear is what a fix would amount to.
        // Nothing else about the door is stubbed.
        vi.spyOn(HICBrowser.prototype, 'clearDataset').mockImplementation(() => undefined)

        const writes = trapActiveStateWrites(browser.stateManager)
        const sync = vi.spyOn(HICBrowser.prototype, 'syncState')

        await browser.loadHicFile({url: HIC_URL, synchState}, true)

        expect(sync).toHaveBeenCalled()

        // The sibling's view arrives through `State.sync`, which is itself a
        // `setView` call, and the freshly installed dataset is then re-clamped
        // against by `setState`. Either way, nothing lands on `activeState`
        // that a chokepoint did not shape.
        expect(installed(writes).length).toBeGreaterThan(0)
        for (const write of installed(writes)) {
            expect(write.throughChokepoint).toBe(true)
        }
    })
})
