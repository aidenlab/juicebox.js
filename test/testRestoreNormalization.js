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
 * 6. **The user is told.** #372's notification half, added by ADR-0012 once the
 *    design question the validation half deferred had an answer. A coercion
 *    that nobody sees is the original report with the symptom moved: the map
 *    still comes up on `NONE` and still says nothing. The surface itself --
 *    marker, title, and the three things that clear it -- is driven at the
 *    widget's own seam in `testNormalizationSubstitution.js`; what is claimed
 *    here is that a real restore reaches it, and that a restore with nothing to
 *    report stays quiet.
 *
 * The dataset is `test/utils/restoreDataset.js`, the fixture the gate and
 * `testRestoreClamp.js` both drive, wrapped here to answer
 * `getNormalizationOptions` -- the one thing this suite asks of its dataset that
 * the shared harness (`test/utils/restoreFixture.js`) does not provide. A
 * wrapper rather than a change to the fixture: the fixture's silence on
 * normalization is itself a case this file drives (a dataset that cannot answer
 * at all), and the browser's own fallback for that silence -- `['NONE']` -- is
 * what the last test pins.
 *
 * The viewport is stated, not measured, for the reason ADR-0009 fact 5 gives.
 * Nothing here depends on its size; it is stated so the load behaves the way it
 * does in the neighbouring suites.
 */
import {beforeEach, describe, expect, test, vi} from 'vitest'
import State from '../js/hicState.js'
import {restoreFixture} from './utils/restoreFixture.js'

/**
 * What the next loaded dataset offers, or `undefined` for a dataset that does
 * not answer the question at all. Set per test, read by the mock below.
 */
let offered

vi.mock('../js/hicDataset.js', async () => {
    const {restoreDataset, datasetModule} = await import('./utils/restoreDataset.js')
    return datasetModule(config => {
        const dataset = restoreDataset(config)
        if (offered !== undefined) {
            const options = offered
            dataset.getNormalizationOptions = async () => options
        }
        return dataset
    })
})

const {default: HICBrowser} = await import('../js/hicBrowser.js')

const HIC_URL = 'https://example.org/restore-normalization.hic'

/** chr1 x chr1 at 250kb bins, at an origin well inside the chromosome. */
const CHR1 = 1
const ZOOM = 3

/** A state that differs from its neighbours only in its normalization. */
const savedWith = normalization => new State(CHR1, CHR1, ZOOM, 10, 10, 2, normalization)

describe('normalization is validated against the loaded dataset at restore (#561)', () => {

    const {embed, restore} = restoreFixture(HICBrowser, {suite: 'restore normalization', url: HIC_URL})

    beforeEach(() => {
        offered = undefined
    })


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

        const browser = embed()
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
        //
        // Asserted on the answer rather than by spying the enforcer, which is
        // private as of #563 -- and a set with **no NONE in it** is what makes
        // the answer discriminating. The duplicate `init` used to carry fell
        // back to a literal `NONE`; the enforcer reads its fallback out of the
        // offered set, so only one of the two can produce `VC` here. This is
        // claim 4's rule, asked at the other door.
        offered = ['VC']

        const browser = embed()

        await browser.init({url: HIC_URL, state: savedWith('NONE'), normalization: 'KR'})

        expect(browser.state.normalization).toBe('VC')
    })

    test('a top-level config.normalization the dataset offers survives init', async () => {

        offered = ['NONE', 'VC', 'KR']

        const browser = embed()

        await browser.init({url: HIC_URL, state: savedWith('NONE'), normalization: 'KR'})

        expect(browser.state.normalization).toBe('KR')
    })

    /** The standing announcement on a browser's normalization widget, if any. */
    const announcement = browser => {
        const widget = browser.coordinator.widgets.normalizationWidget
        return 'none' === widget.substitutionMarker.style.display ? undefined : widget.container.title
    }

    test('a coerced restore announces the substitution in the widget', async () => {

        offered = ['NONE', 'VC']

        const browser = await restore(savedWith('KR'))

        // Named rather than merely flagged: "a normalization was substituted"
        // does not tell the user which one they asked for or what they are
        // looking at instead.
        expect(announcement(browser)).toContain('KR')
        expect(announcement(browser)).toContain('NONE')
    })

    test('the announcement survives the load that raised it', async () => {

        // The coercion happens inside `setState`, which goes on to repaint and
        // then to fire `onLocusChange` with both change flags set -- so an
        // announcement cleared on a flag would be gone before the load
        // returned, and #372 would still be open with a marker in it.
        offered = ['NONE', 'VC']

        const browser = await restore(savedWith('KR'))

        expect(announcement(browser)).toBeDefined()
    })

    test('a restore with nothing to report stays quiet', async () => {

        offered = ['NONE', 'VC', 'KR']

        const browser = await restore(savedWith('KR'))

        expect(browser.state.normalization).toBe('KR')
        expect(announcement(browser)).toBeUndefined()
    })

    test('NONE, settled without asking, is not a substitution', async () => {

        // Nothing was taken away from the user here: they asked for no
        // normalization and got none.
        offered = ['NONE', 'KR']

        const browser = await restore(savedWith('NONE'))

        expect(announcement(browser)).toBeUndefined()
    })

    test('the control map is named as the remedy only when it is the remedy', async () => {

        // With a control map loaded the offered set is an *intersection*, and a
        // normalization missing from an intersection is missing for one of two
        // causes with different remedies. Here the primary file *has* KR and the
        // control map does not, so unloading the control map brings it back --
        // and that is the only case in which the user should be told to.
        offered = ['NONE', 'KR']

        const browser = await restore(savedWith('KR'))
        expect(browser.state.normalization).toBe('KR')

        browser.controlDataset = {getNormalizationOptions: async () => ['NONE']}
        await browser.setState(savedWith('KR'))

        expect(browser.state.normalization).toBe('NONE')
        expect(announcement(browser)).toMatch(/control map/i)
    })

    test('a control map present but innocent is not named as the remedy', async () => {

        // Same intersection, other cause: the primary file never carried KR, so
        // unloading the control map changes nothing. Telling this user to unload
        // it is a remedy that cannot work, which is worse than the silence #372
        // is about -- so the reason chosen must be asked of the primary file
        // rather than of the control map's mere presence.
        offered = ['NONE']

        const browser = await restore(savedWith('NONE'))

        browser.controlDataset = {getNormalizationOptions: async () => ['NONE']}
        await browser.setState(savedWith('KR'))

        expect(browser.state.normalization).toBe('NONE')
        expect(announcement(browser)).toBeDefined()
        expect(announcement(browser)).not.toMatch(/control map/i)
    })

    test('a coerced top-level config.normalization announces it too', async () => {

        // The second of `#resolveNormalization`'s two doors. It is the same
        // question against the same set (claim 5), so it is the same
        // announcement -- one notification path, as one enforcer.
        offered = ['VC']

        const browser = embed()

        await browser.init({url: HIC_URL, state: savedWith('NONE'), normalization: 'KR'})

        expect(announcement(browser)).toContain('KR')
        expect(announcement(browser)).toContain('VC')
    })
})
