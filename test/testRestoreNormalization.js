/**
 * Normalization is validated against the loaded dataset, at restore. #561,
 * candidate 6, ADR-0009 decision 5.
 *
 * It is the same invariant as the clamp, at the same moment, and for the same
 * reason: restore is the first point at which the question can be asked. The
 * set of valid normalizations does not exist until a dataset is loaded, which
 * is why candidate 9 could not resolve `config.normalization` in the normalize
 * stage and left it as one of exactly three fields that stage provably cannot
 * settle. So the check has a natural home here and nowhere earlier.
 *
 * Three claims, none of which the golden (`testRestoreGolden.js`) can make on
 * its own -- it will show the coerced values moving, but a snapshot diff cannot
 * say what the rule was:
 *
 * 1. A normalization the dataset **does** offer survives restore untouched.
 *    Without this the coercion could be "always NONE" and the golden would look
 *    the same, because `test/utils/restoreDataset.js` offers only NONE.
 * 2. A normalization the dataset does **not** offer is coerced to one it does,
 *    and the load still succeeds. Coerced, never rejected -- the same rule as
 *    the clamp (ADR-0009 decision 2) and as the normalize stage one seam over
 *    (ADR-0006, #466).
 * 3. `NONE` is settled without asking the dataset. Every `.hic` file offers it,
 *    and `getNormalizationOptions` reads the normalization vector index off the
 *    file -- so asking would put a network read on every restore to buy an
 *    answer that is already known.
 * 4. The fallback is read out of the offered set rather than assumed. With a
 *    control map loaded the set is an intersection of two files' lists, and an
 *    intersection is an expression rather than a guarantee.
 * 5. A top-level `config.normalization` is resolved by the **same** enforcer.
 *    `hicBrowser.init` used to answer the same question in its own words, with
 *    its own `Set` and its own fallback, and it ran *after* restore -- so of the
 *    two enforcers the duplicate was the one that won. Candidate 6's premise is
 *    that an invariant has one enforcer or none.
 *
 * **No error surface is asserted here, because none is added here.** #372 is
 * "a normalization that is not available renders without one and the user is
 * not told"; its validation half is this file, its notification half stays #372
 * and is a different question with a different reviewer.
 *
 * The dataset is `test/utils/restoreDataset.js`, the fixture the gate and
 * `testRestoreClamp.js` both drive, wrapped here to answer
 * `getNormalizationOptions`. A wrapper rather than a change to the fixture: the
 * fixture's silence on normalization is itself a case this file drives (a
 * dataset that cannot answer at all), and the browser's own fallback for that
 * silence -- `['NONE']` -- is what the last test pins.
 *
 * The viewport is stated, not measured, for the reason ADR-0009 fact 5 gives.
 * Nothing here depends on its size; it is stated so the load behaves the way it
 * does in the neighbouring suites.
 */
import {beforeEach, afterEach, describe, expect, test, vi} from 'vitest'
import {igvxhr} from 'igv-utils'
import ContactMatrixView from '../js/contactMatrixView.js'
import State from '../js/hicState.js'
import {withContainers} from './utils/browserFixture.js'

/**
 * What the next loaded dataset offers, or `undefined` for a dataset that does
 * not answer the question at all. Set per test, read by the mock below.
 */
let offered

vi.mock('../js/hicDataset.js', async () => {
    const {restoreDataset} = await import('./utils/restoreDataset.js')
    const build = config => {
        const dataset = restoreDataset(config)
        if (offered !== undefined) {
            const options = offered
            dataset.getNormalizationOptions = async () => options
        }
        return dataset
    }
    return {
        default: {loadDataset: async config => build(config)},
        HiCDataset: class {
            constructor(config) {
                Object.assign(this, build(config))
            }
            async init() {}
        },
    }
})

const {default: HICBrowser} = await import('../js/hicBrowser.js')

const VIEWPORT = {width: 800, height: 800}
const HIC_URL = 'https://example.org/restore-normalization.hic'

/** chr1 x chr1 at 250kb bins, at an origin well inside the chromosome. */
const CHR1 = 1
const ZOOM = 3

/** A state that differs from its neighbours only in its normalization. */
const savedWith = normalization => new State(CHR1, CHR1, ZOOM, 10, 10, 2, normalization)

describe('normalization is validated against the loaded dataset at restore (#561)', () => {

    const dom = withContainers()

    beforeEach(() => {
        offered = undefined
        vi.spyOn(ContactMatrixView.prototype, 'update').mockImplementation(async () => undefined)
        vi.spyOn(HICBrowser.prototype, 'update').mockImplementation(async () => undefined)
        vi.spyOn(igvxhr, 'loadString').mockImplementation(async () => {
            throw new Error('unexpected network access from the restore normalization suite')
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    /** One embed, one load, one stated viewport. Returns the live browser. */
    async function restore(state) {
        const browser = new HICBrowser(dom.another(), {})
        vi.spyOn(browser.contactMatrixView, 'getViewDimensions').mockReturnValue({...VIEWPORT})
        await browser.loadHicFile({url: HIC_URL, state}, true)
        return browser
    }

    test('a saved normalization the dataset offers is preserved exactly', async () => {

        offered = ['NONE', 'VC', 'VC_SQRT', 'KR']

        const browser = await restore(savedWith('KR'))

        expect(browser.state.normalization).toBe('KR')
    })

    test('a saved normalization the dataset does not offer is coerced, and the restore still succeeds', async () => {

        offered = ['NONE', 'VC']

        const browser = await restore(savedWith('KR'))

        // Coerced, never rejected: the load completed and left a state behind.
        expect(browser.state).toBeDefined()
        expect(browser.state.normalization).not.toBe('KR')

        // And the resolved state names something the dataset actually has --
        // the claim is "coerced to one it does offer", not "set to a constant".
        expect(offered).toContain(browser.state.normalization)
    })

    test('the rest of the restored view is untouched by the coercion', async () => {

        offered = ['NONE', 'VC']

        const saved = savedWith('KR')
        const browser = await restore(saved.clone())

        expect(browser.state.chr1).toBe(saved.chr1)
        expect(browser.state.chr2).toBe(saved.chr2)
        expect(browser.state.zoom).toBe(saved.zoom)
        expect(browser.state.x).toBe(saved.x)
        expect(browser.state.y).toBe(saved.y)
    })

    test('the incoming state is left alone; the coercion lands on the clone', async () => {

        offered = ['NONE', 'VC']

        // `dataLoader` hands the same instance on to `coordinator.onMapLoaded`,
        // so a coercion written back through the argument would be visible to a
        // host holding the state it passed in.
        const saved = savedWith('KR')
        const browser = await restore(saved)

        expect(saved.normalization).toBe('KR')
        expect(browser.state.normalization).toBe('NONE')
    })

    test('a dataset that cannot answer offers NONE, and a saved normalization coerces to it', async () => {

        // `offered` stays undefined: the fixture has no `getNormalizationOptions`
        // at all, which is `browser.getNormalizationOptions`'s fallback branch.
        const browser = await restore(savedWith('KR'))

        expect(browser.state.normalization).toBe('NONE')
    })

    test('the fallback is read out of the offered set, not assumed to be NONE', async () => {

        // With a control map loaded the offered set is an *intersection* of two
        // files' lists, and an intersection is an expression rather than a
        // guarantee -- so the coercion cannot name `NONE` on faith.
        offered = ['VC', 'VC_SQRT']

        const browser = await restore(savedWith('KR'))

        expect(offered).toContain(browser.state.normalization)
    })

    test('NONE is settled without reading the dataset', async () => {

        offered = ['NONE', 'KR']
        const asked = vi.fn(async () => offered)

        const browser = new HICBrowser(dom.another(), {})
        vi.spyOn(browser.contactMatrixView, 'getViewDimensions').mockReturnValue({...VIEWPORT})
        vi.spyOn(browser, 'getNormalizationOptions').mockImplementation(asked)

        await browser.loadHicFile({url: HIC_URL, state: savedWith('NONE')}, true)

        expect(browser.state.normalization).toBe('NONE')
        expect(asked).not.toHaveBeenCalled()
    })

    test('a top-level config.normalization is resolved by the same enforcer', async () => {

        // `config.normalization` is not part of any saved state -- it is a field
        // a host sets alongside a map -- so it cannot arrive through `setState`.
        // It is the same question against the same set, though, and `init` used
        // to answer it a second time in its own words, *after* restore, so the
        // duplicate was the copy that won. Driving it here is what says the two
        // now agree by construction rather than by coincidence.
        offered = ['NONE', 'VC']

        const browser = new HICBrowser(dom.another(), {})
        vi.spyOn(browser.contactMatrixView, 'getViewDimensions').mockReturnValue({...VIEWPORT})
        const resolve = vi.spyOn(browser, 'resolveNormalization')

        await browser.init({url: HIC_URL, state: savedWith('NONE'), normalization: 'KR'})

        expect(resolve).toHaveBeenCalledWith('KR')
        expect(browser.state.normalization).toBe('NONE')
    })

    test('a top-level config.normalization the dataset offers survives init', async () => {

        offered = ['NONE', 'VC', 'KR']

        const browser = new HICBrowser(dom.another(), {})
        vi.spyOn(browser.contactMatrixView, 'getViewDimensions').mockReturnValue({...VIEWPORT})

        await browser.init({url: HIC_URL, state: savedWith('NONE'), normalization: 'KR'})

        expect(browser.state.normalization).toBe('KR')
    })
})
