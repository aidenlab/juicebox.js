/**
 * The normalization dropdown shows the *resolved* normalization after `init`.
 * #603.
 *
 * `updateOptions` reads `browser.state.normalization` to decide which `<option>`
 * is selected, and on the `init` path it is called from *inside* the
 * norm-vector-file load:
 *
 *     config.normVectorFiles
 *       -> dataLoader.loadNormalizationFile
 *       -> coordinator.onNormVectorIndexLoad
 *       -> normalizationWidget.updateOptions()
 *
 * That happens in `init`'s `Promise.all`, above the validated write of
 * `config.normalization`. So the list is built against whatever `loadHicFile`
 * left behind -- `config.state`'s normalization, or `NONE` -- and never against
 * the resolved answer.
 *
 * No ordering fixes it. `loadNormalizationFile` pushes new types into
 * `dataset.normalizationTypes`, and the enforcer reads exactly that set through
 * `getNormalizationOptions`, so resolving any earlier would substitute away a
 * normalization one of these files is about to supply. The fix is a re-sync
 * after the validated write, which is what this file drives.
 *
 * Not #372. That ticket and ADR-0012 own *announcing* a substitution; the
 * announcement is only borrowed here, to pin the fact the fix depends on --
 * `updateOptions` does not call `clearSubstitution`, so a re-sync placed after
 * `#announceSubstitution` does not silence the marker.
 *
 * The harness is `restoreFixture`, as in `testRestoreNormalization.js`, plus
 * the one thing the norm-vector path asks of a dataset that the shared fixture
 * does not carry: a `hicFile` that can answer `readNormalizationVectorFile`.
 * The viewport is stated, not measured, for the reason ADR-0009 fact 5 gives.
 */
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import State from '../js/hicState.js'
import {restoreFixture} from './utils/restoreFixture.js'
import {withDOM} from './utils/browserFixture.js'
import NormalizationWidget, {substitutionReason} from '../js/normalizationWidget.js'

/** What the loaded dataset offers. Set per test, read by the mock below. */
let offered

/** The types the `normVectorFiles` entry supplies when it is read. */
let supplied

vi.mock('../js/hicDataset.js', async () => {
    const {restoreDataset, datasetModule} = await import('./utils/restoreDataset.js')
    return datasetModule(config => {
        const dataset = restoreDataset(config)
        dataset.getNormalizationOptions = async () => offered
        // The one field `loadNormalizationFile` guards on, plus the read it
        // makes through it. Its `types` are what get pushed into
        // `dataset.normalizationTypes` -- the set the enforcer would be asked
        // about too early, if the resolution were hoisted.
        dataset.hicFile = {
            readNormalizationVectorFile: async () => ({types: supplied})
        }
        return dataset
    })
})

const {default: HICBrowser} = await import('../js/hicBrowser.js')

const HIC_URL = 'https://example.org/init-normalization-selector.hic'
const NORM_VECTOR_FILE = 'https://example.org/init-normalization-selector.norm'

/** chr1 x chr1 at 250kb bins. Only the normalization varies between tests. */
const savedWith = normalization => new State(1, 1, 3, 10, 10, 2, normalization)

describe("init's normalization dropdown shows the resolved normalization (#603)", () => {

    const {embed} = restoreFixture(HICBrowser, {suite: 'init normalization selector', url: HIC_URL})

    beforeEach(() => {
        offered = ['NONE']
        supplied = []
    })

    /** What the selector is actually showing. */
    const selected = browser => browser.coordinator.widgets.normalizationWidget.normalizationSelector.value

    /** The standing announcement, if any. */
    const announcement = browser => {
        const widget = browser.coordinator.widgets.normalizationWidget
        return 'none' === widget.substitutionMarker.style.display ? undefined : widget.container.title
    }

    /** One embed, one `init` carrying a norm-vector file. Returns the live browser. */
    const init = async config => {
        const browser = embed()
        await browser.init({
            url: HIC_URL,
            state: savedWith('NONE'),
            normalizationFiles: undefined,
            normVectorFiles: [NORM_VECTOR_FILE],
            ...config
        })
        return browser
    }

    test('a config.normalization the dataset offers ends up selected', async () => {

        // The defect in one line: the list is built while `state.normalization`
        // is still `NONE`, so `NONE` is the entry marked selected, and nothing
        // re-reads the state after the enforcer writes `KR` into it.
        offered = ['NONE', 'VC', 'KR']
        supplied = ['VC', 'KR']

        const browser = await init({normalization: 'KR'})

        expect(browser.state.normalization).toBe('KR')
        expect(selected(browser)).toBe('KR')
    })

    test('a normalization supplied by the norm-vector file itself ends up selected', async () => {

        // Why the resolution cannot simply be hoisted above the `Promise.all`:
        // `KR` is on offer only because the file that was just read pushed it
        // there. Asked any earlier, the enforcer would substitute it away.
        offered = ['NONE', 'KR']
        supplied = ['KR']

        const browser = await init({normalization: 'KR'})

        expect(browser.state.normalization).toBe('KR')
        expect(selected(browser)).toBe('KR')
    })

    test('a substituted normalization ends up selected, not the one asked for', async () => {

        offered = ['NONE', 'VC']
        supplied = ['VC']

        const browser = await init({normalization: 'KR'})

        expect(browser.state.normalization).toBe('NONE')
        expect(selected(browser)).toBe('NONE')
    })

    test('a coerced init still announces, with the re-selection in the path', async () => {

        // The announcement reaching the widget through a real `init` that also
        // re-selects. What it cannot claim is that the re-selection *moved*
        // anything: `#announceSubstitution` puts the effective value on the
        // selector itself, so by the time the re-selection runs the selector is
        // already where it belongs and it returns early. The fact the fix leans
        // on -- that a re-selection which does move the entry leaves the marker
        // standing -- is driven at the widget's own seam below, where the
        // moment can be staged.
        offered = ['NONE', 'VC']
        supplied = ['VC']

        const browser = await init({normalization: 'KR'})

        expect(announcement(browser)).toContain('KR')
        expect(announcement(browser)).toContain('NONE')
    })

    test('an init with no config.normalization leaves the selector where the load left it', async () => {

        offered = ['NONE', 'VC']
        supplied = ['VC']

        const browser = await init({state: savedWith('VC')})

        expect(browser.state.normalization).toBe('VC')
        expect(selected(browser)).toBe('VC')
    })
})

/**
 * The re-selection's own seam.
 *
 * Two of the three claims the fix rests on cannot be staged through `init`:
 * a re-selection that *moves* the entry while an announcement is standing
 * (through `init`, the announcement has already moved it), and the price the
 * settle-point in #603 is about -- that a re-selection does not go back to
 * `getNormalizationOptions()`, which on a real `.hic` file is a read of the
 * normalization vector index off the wire.
 *
 * A widget and a browser stub, as in `testNormalizationSubstitution.js`: what
 * is being asked here is what the widget does with a value, not how the value
 * was arrived at.
 */
describe('a re-selection moves the entry and costs nothing else (#603)', () => {

    const VIEW = {chr1: 1, chr2: 1, zoom: 3, x: 10, y: 10}

    let fixture
    let widget
    let asked

    /** Build a widget over a browser stub offering `options`, sitting on `normalization`. */
    const build = async (options, normalization) => {
        fixture = withDOM()
        const {document} = fixture.window

        const navbar = document.createElement('div')
        const lower = document.createElement('div')
        lower.id = 'reselect-lower-hic-nav-bar-widget-container'
        navbar.appendChild(lower)
        document.body.appendChild(navbar)

        asked = 0
        widget = new NormalizationWidget({
            state: {...VIEW, normalization},
            setNormalization: () => undefined,
            getNormalizationOptions: async () => {
                asked++
                return options
            }
        }, navbar)

        await widget.updateOptions()
        return widget
    }

    const markerShowing = () => 'none' !== widget.substitutionMarker.style.display

    afterEach(() => {
        fixture.restore()
    })

    test('the selection moves without asking for the list again', async () => {

        // The whole reason this is a re-selection rather than a second
        // `updateOptions`. `asked` counts the list build; the re-selection must
        // not add to it.
        await build(['NONE', 'VC', 'KR'], 'NONE')
        expect(widget.normalizationSelector.value).toBe('NONE')
        const built = asked

        await widget.reselect('KR')

        expect(widget.normalizationSelector.value).toBe('KR')
        expect(asked).toBe(built)
    })

    test('a standing announcement survives a re-selection that moves the entry', async () => {

        // The fact the placement depends on: the re-selection runs *after*
        // `#announceSubstitution`, and neither it nor `updateOptions` calls
        // `clearSubstitution` -- only the change handler and
        // `onNormalizationChange` do, because only a user answering the
        // question makes the reason false (#372, ADR-0012).
        await build(['NONE', 'VC', 'KR'], 'VC')
        widget.announceSubstitution(substitutionReason.notInFile('KR', 'NONE'), VIEW)

        await widget.reselect('NONE')

        expect(widget.normalizationSelector.value).toBe('NONE')
        expect(markerShowing()).toBe(true)
        expect(widget.container.title).toContain('KR')
    })

    test('a value with no entry rebuilds the list rather than deselecting everything', async () => {

        // The one case a re-selection cannot serve. Reached here by moving the
        // offered set out from under a list already built -- a shape
        // `#resolveNormalization` should not produce, since it picks out of the
        // same set the list is built from, which is exactly why the branch
        // needs staging to be driven at all. A bare programmatic set would
        // leave the selector on nothing.
        await build(['NONE', 'VC'], 'NONE')
        widget.browser.getNormalizationOptions = async () => {
            asked++
            return ['NONE', 'VC', 'KR']
        }
        widget.browser.state.normalization = 'KR'

        await widget.reselect('KR')

        expect(widget.normalizationSelector.value).toBe('KR')
    })

    test('the rebuilding branch leaves a standing announcement alone too', async () => {

        await build(['NONE', 'VC'], 'NONE')
        widget.announceSubstitution(substitutionReason.notInFile('KR', 'NONE'), VIEW)

        widget.browser.getNormalizationOptions = async () => ['NONE', 'VC', 'KR']
        widget.browser.state.normalization = 'KR'

        await widget.reselect('KR')

        expect(markerShowing()).toBe(true)
        expect(widget.container.title).toContain('KR')
    })

    test('a failed list build does not reach the re-selection', async () => {

        // `onNormVectorIndexLoad` calls `updateOptions` without awaiting it, so
        // a failed option read was nobody's rejection. The re-selection waits
        // on that same build -- and must not turn it into a failed `init`,
        // which is the opposite of the load path's coerce-never-reject rule
        // (ADR-0009 decision 2).
        await build(['NONE', 'VC'], 'NONE')

        widget.browser.getNormalizationOptions = async () => {
            throw new Error('normalization vector index unreadable')
        }
        widget.updateOptions().catch(() => undefined)

        await expect(widget.reselect('VC')).resolves.toBeUndefined()
    })
})
