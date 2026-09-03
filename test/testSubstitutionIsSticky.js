/**
 * A substitution is sticky: state is rewritten to name what is drawn.
 * ADR-0012 decision 3, #600.
 *
 * `browser.substituteNormalization` is where that rule lives, and it has two
 * mid-render callers -- `imageTileSource`, via the observer wired in
 * `createWidgets`, and hic-straw's `alert` hook, via `dataLoader`. Both used to
 * write the triple out themselves and only one of them wrote the state half, so
 * the widget read `NONE` while canonical state still read `KR` and the next
 * render pass re-asked for a vector the file had already refused. That is #600,
 * restated by decision 4.
 *
 * Driven against a real browser rather than a stub, because the claim is about
 * canonical state and about the announcement reaching the coordinator -- a stub
 * that implemented either would be asserting its own behaviour. The loaders'
 * own seam, "both loads install the hook and report the right request", is in
 * `testStrawSubstitution.js`.
 *
 * The write is direct rather than through `setNormalization`, and that is not
 * an oversight to be tidied later: both callers are inside a render pass, and
 * `setNormalization` repaints. It is the exception documented at
 * `docs/state-manipulation.md`. The last test here is what would notice if
 * someone routed it through the chokepoint.
 */
import {describe, expect, test, vi} from 'vitest'
import State from '../js/hicState.js'
import {restoreFixture} from './utils/restoreFixture.js'

vi.mock('../js/hicDataset.js', async () => {
    const {restoreDataset, datasetModule} = await import('./utils/restoreDataset.js')
    return datasetModule(config => {
        const dataset = restoreDataset(config)
        dataset.getNormalizationOptions = async () => ['NONE', 'VC', 'KR']
        return dataset
    })
})

const {default: HICBrowser} = await import('../js/hicBrowser.js')

const HIC_URL = 'https://example.org/sticky-substitution.hic'

/** chr1 x chr1 at 250kb bins, at an origin well inside the chromosome. */
const savedWith = normalization => new State(1, 1, 3, 10, 10, 2, normalization)

describe('a substitution is sticky (#600, ADR-0012 decision 3)', () => {

    const {restore} = restoreFixture(HICBrowser, {suite: 'sticky substitution', url: HIC_URL})

    /** A browser drawing KR, and a record of everything its coordinator is told. */
    async function drawingKR() {
        const browser = await restore(savedWith('KR'))
        const announced = []
        vi.spyOn(browser.coordinator, 'onNormalizationSubstituted')
            .mockImplementation((normalization, reason) => announced.push({normalization, reason}))
        return {browser, announced}
    }

    test('state is rewritten to name what is drawn', async () => {

        const {browser} = await drawingKR()

        browser.substituteNormalization('KR', 'NONE')

        expect(browser.state.normalization).toBe('NONE')
    })

    test('the widget is told, with the reason that names this view', async () => {

        const {browser, announced} = await drawingKR()

        browser.substituteNormalization('KR', 'NONE')

        expect(announced).toHaveLength(1)
        expect(announced[0].normalization).toBe('NONE')
        // The remedy for this reason, and the one that separates it from the
        // other two: the vector exists, just not here.
        expect(announced[0].reason).toContain('KR')
        expect(announced[0].reason).toMatch(/zoom/i)
    })

    test('it stays substituted -- a second pass has nothing left to substitute', async () => {

        // Stickiness is the point. Once state names NONE the next render pass
        // asks for NONE, gets it, and says nothing; the alternative is keeping
        // the request in state and re-attempting every pass, which is the lie
        // ADR-0009 removed.
        const {browser, announced} = await drawingKR()

        browser.substituteNormalization('KR', 'NONE')
        browser.substituteNormalization(browser.state.normalization, 'NONE')

        expect(browser.state.normalization).toBe('NONE')
        expect(announced).toHaveLength(1)
    })

    test('nothing was substituted when the request is what is drawn', async () => {

        const {browser, announced} = await drawingKR()

        browser.substituteNormalization('KR', 'KR')

        expect(browser.state.normalization).toBe('KR')
        expect(announced).toHaveLength(0)
    })

    test('a caller that asked for nothing is not a substitution', async () => {

        // The hic-straw hook reports whatever state held at the moment the
        // vector was refused, and that can be nothing at all -- a refusal
        // arriving before a state exists. Guarded here, once, rather than at
        // each caller.
        const {browser, announced} = await drawingKR()

        browser.substituteNormalization(undefined, 'NONE')

        expect(browser.state.normalization).toBe('KR')
        expect(announced).toHaveLength(0)
    })

    test('it does not repaint, because both callers are inside a render pass', async () => {

        // `setNormalization` is the user answering the question and repaints on
        // the way out. Routing a substitution through it would repaint from
        // inside the render pass that discovered the substitution.
        const {browser} = await drawingKR()
        const changed = vi.spyOn(browser.coordinator, 'onNormalizationChange')
            .mockImplementation(() => undefined)

        browser.substituteNormalization('KR', 'NONE')

        expect(changed).not.toHaveBeenCalled()
    })
})
