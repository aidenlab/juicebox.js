/**
 * `All` is a zoom rung, not a chromosome -- #236, ADR-0010.
 *
 * The five claims the ADR's test plan names, driven end to end through a real
 * browser and a real `loadHicFile`: the pulldown omits `All`, a saved session
 * naming `chr 0` lands on the scaffold, the sentinel rung frames the whole
 * scaffold, the sentinel round-trips through save as the whole-genome view, and
 * -- the regression that matters -- a multi-chromosome dataset is provably
 * unchanged. Everything here is gated on a predicate that must stay false for
 * every real genome, so the last one is not a formality.
 *
 * Two datasets, told apart by URL, so the changed and unchanged cases run on the
 * same harness and the same stubs. Both come from
 * `test/utils/restoreDataset.js`, whose single-chromosome variant is faithful
 * about the one thing this ticket's arithmetic turns on: the `All` entry's size
 * is in kb and `wholeGenomeResolution` is that same bin in bp.
 *
 * The viewport is `restoreFixture`'s stated 800x800 -- JSDOM does no layout, so
 * a measured one is {0, 0} and every framing claim below would be vacuous.
 */
import {describe, expect, test, vi} from 'vitest'
import State from '../js/hicState.js'
import {SENTINEL_ZOOM} from '../js/sentinelZoom.js'
import {restoreFixture, VIEWPORT} from './utils/restoreFixture.js'

vi.mock('../js/hicDataset.js', async () => {
    const {restoreDataset, singleChromosomeDataset, datasetModule} = await import('./utils/restoreDataset.js')
    return datasetModule(config =>
        String(config.url).includes('single') ? singleChromosomeDataset(config) : restoreDataset(config))
})

const {default: HICBrowser} = await import('../js/hicBrowser.js')

const SINGLE_URL = 'https://example.org/single-chromosome.hic'
const MULTI_URL = 'https://example.org/multi-chromosome.hic'

/** The sole scaffold's index in the single-chromosome table, and its size. */
const SCAFFOLD = 1
const SCAFFOLD_SIZE = 2400000000

/** Five hundred bins across the scaffold -- `wholeGenomeResolution` by construction. */
const WHOLE_GENOME_BINS = 500

/** The whole-genome view as every saved session and pasted URL spells it. */
const wholeGenomeState = () => State.fromJSON({chr1: 0, chr2: 0, zoom: 0, x: 0, y: 0, pixelSize: 1})

const {embed} = restoreFixture(HICBrowser, {suite: 'single-chromosome', url: SINGLE_URL})

/** One embed, one load. `state` is optional -- omitted, the default view is taken. */
async function load(url, state) {
    const browser = embed()
    await browser.loadHicFile(state ? {url, state} : {url}, true)
    return browser
}

const optionValues = select => Array.from(select.options).map(option => option.value)

describe('a single-chromosome assembly', () => {

    test('drops All from the chromosome pulldown', async () => {
        const browser = await load(SINGLE_URL)
        const {xAxisSelector, yAxisSelector} = browser.coordinator.widgets.chromosomeSelector

        expect(Array.from(xAxisSelector.options).map(o => o.textContent)).toEqual(['scaffold_1'])
        expect(optionValues(xAxisSelector)).toEqual([String(SCAFFOLD)])
        expect(optionValues(yAxisSelector)).toEqual([String(SCAFFOLD)])
    })

    test('offers the whole-genome resolution as the coarsest rung', async () => {
        const browser = await load(SINGLE_URL)
        const resolutions = browser.getResolutions()

        // Coarsest first, and the coarsest is the synthetic one. Sorted by bin
        // size rather than by position, which is what keeps the direction guards
        // in `interactionHandler` reading the right ends.
        expect(resolutions[0]).toEqual({index: SENTINEL_ZOOM, binSize: browser.dataset.wholeGenomeResolution})
        expect(resolutions.map(r => r.binSize)).toEqual([...resolutions.map(r => r.binSize)].sort((a, b) => b - a))
        expect(resolutions.filter(r => r.index === SENTINEL_ZOOM)).toHaveLength(1)
    })

    test('lands a session naming chr 0 on the scaffold, at the sentinel rung', async () => {
        const browser = await load(SINGLE_URL, wholeGenomeState())

        expect(browser.state.chr1).toBe(SCAFFOLD)
        expect(browser.state.chr2).toBe(SCAFFOLD)
        expect(browser.state.zoom).toBe(SENTINEL_ZOOM)
        expect(browser.isWholeGenome()).toBe(false)
    })

    test('frames the whole scaffold at the sentinel rung', async () => {
        const browser = await load(SINGLE_URL, wholeGenomeState())
        const {x, y, pixelSize} = browser.state

        // The scaffold is 500 sentinel bins wide, and the view is 800px, so one
        // bin is 1.6px and the whole thing is on screen from the origin. At the
        // coarsest *declared* bin -- 2.5mb -- it would need 3mb/px and could not
        // be framed at all, which is fact 3 of the ADR and the whole reason the
        // rung exists.
        expect(x).toBe(0)
        expect(y).toBe(0)
        expect(pixelSize).toBeCloseTo(VIEWPORT.width / WHOLE_GENOME_BINS, 10)
        expect(pixelSize * WHOLE_GENOME_BINS).toBeCloseTo(VIEWPORT.width, 10)

        const locus = browser.state.getLocus(browser.dataset, VIEWPORT)
        expect(locus.x).toEqual({chr: 'scaffold_1', start: 0, end: SCAFFOLD_SIZE})
    })

    test('falls through to the sentinel when no declared bin can frame the scaffold', async () => {
        const browser = await load(SINGLE_URL)
        expect(await browser.minZoom(SCAFFOLD, SCAFFOLD)).toBe(SENTINEL_ZOOM)
    })

    test('redirects the locus box typing "All" to the scaffold', async () => {
        // Fact 2 of the ADR: filtering the pulldown alone would leave `All`
        // reachable by three other paths, of which the locus box is one. The
        // redirect is at the state layer for exactly this reason.
        const browser = await load(SINGLE_URL)
        await browser.parseGotoInput('All')

        expect(browser.state.chr1).toBe(SCAFFOLD)
        expect(browser.state.chr2).toBe(SCAFFOLD)
        expect(browser.state.zoom).toBe(SENTINEL_ZOOM)

        // And the locus box shows a real range back, not the word "All":
        // the vocabulary follows the state (decision 4).
        browser.coordinator.widgets.locusGoto.updateForState(browser.state)
        expect(browser.coordinator.widgets.locusGoto.resolutionSelectorElement.value)
            .toMatch(/^scaffold_1:/)
    })

    test('writes the sentinel out as the whole-genome view, and reads it back', async () => {
        const browser = await load(SINGLE_URL, wholeGenomeState())
        expect(browser.state.zoom).toBe(SENTINEL_ZOOM)

        // Decision 6: the sentinel never crosses the process boundary. What is
        // saved is a wire value every existing consumer already renders -- and
        // for this genome it is pixel-for-pixel the same picture.
        const saved = browser.state.toJSON()
        expect(saved).toMatchObject({chr1: 0, chr2: 0, zoom: 0})

        const reopened = await load(SINGLE_URL, State.fromJSON(saved))
        expect(reopened.state.chr1).toBe(SCAFFOLD)
        expect(reopened.state.zoom).toBe(SENTINEL_ZOOM)
        expect(reopened.state.pixelSize).toBeCloseTo(browser.state.pixelSize, 10)
    })

    test('leaves a declared rung serialized as itself', async () => {
        const browser = await load(SINGLE_URL, State.fromJSON({chr1: 1, chr2: 1, zoom: 4, x: 10, y: 20, pixelSize: 2}))
        expect(browser.state.zoom).toBe(4)
        expect(browser.state.toJSON()).toMatchObject({chr1: 1, chr2: 1, zoom: 4})
    })
})

describe('a multi-chromosome assembly is unchanged', () => {

    test('keeps All in the chromosome pulldown', async () => {
        const browser = await load(MULTI_URL)
        const {xAxisSelector} = browser.coordinator.widgets.chromosomeSelector

        expect(Array.from(xAxisSelector.options).map(o => o.textContent)[0]).toBe('All')
        expect(xAxisSelector.options).toHaveLength(browser.dataset.chromosomes.length)
    })

    test('offers only the declared resolutions, still coarsest first', async () => {
        const browser = await load(MULTI_URL)
        expect(browser.getResolutions()).toEqual(
            browser.dataset.bpResolutions.map((binSize, index) => ({index, binSize})))
    })

    test('keeps a session naming chr 0 in the whole-genome view', async () => {
        const browser = await load(MULTI_URL, wholeGenomeState())

        expect(browser.state.chr1).toBe(0)
        expect(browser.state.chr2).toBe(0)
        expect(browser.state.zoom).toBe(0)
        expect(browser.isWholeGenome()).toBe(true)
    })

    test('never answers the sentinel from minZoom', async () => {
        const browser = await load(MULTI_URL)
        // chr1, hg19 -- 249mb over an 800px viewport wants 311kb bins, and the
        // declared ladder has 500kb. Nothing falls through.
        expect(await browser.minZoom(1, 1)).toBeGreaterThanOrEqual(0)
    })
})

describe('an A/B map', () => {

    test('falls through to the sentinel on the coarsest rung the two maps share', async () => {
        // Sized so the two answers differ. Over a 2400px viewport the scaffold
        // wants 1mb bins: the primary map's own coarsest is 2.5mb and would say
        // "coarse enough", but 2.5mb is not a rung this browser can render at
        // all once the control map's ladder starts at 500kb. Asking the raw
        // ladder floors the fit at a bin no pass will ever use.
        const browser = await load(SINGLE_URL)
        vi.spyOn(browser.contactMatrixView, 'getViewDimensions').mockReturnValue({width: 2400, height: 2400})

        expect(await browser.minZoom(SCAFFOLD, SCAFFOLD)).toBeGreaterThanOrEqual(0)

        browser.controlDataset = {bpResolutions: browser.dataset.bpResolutions.slice(2)}
        expect(browser.getResolutions().filter(r => r.index !== SENTINEL_ZOOM)[0].binSize).toBe(500000)
        expect(await browser.minZoom(SCAFFOLD, SCAFFOLD)).toBe(SENTINEL_ZOOM)
    })
})

describe('cross-browser sync', () => {

    test('is unchanged for a browser with no control map', async () => {
        // `State.sync` now matches against `getResolutions()` rather than the
        // raw ladder, so that a peer sitting at the sentinel is a rung this
        // browser can follow it to. For a single-map browser the two lists carry
        // the same bin sizes, so the rung chosen is the rung it always was.
        const browser = await load(MULTI_URL, State.fromJSON({chr1: 1, chr2: 1, zoom: 3, x: 0, y: 0, pixelSize: 2}))
        const offered = browser.getResolutions().map(r => r.binSize)

        expect(offered).toEqual(browser.dataset.bpResolutions)
        expect(browser.getResolutions().every(r => r.index === offered.indexOf(r.binSize))).toBe(true)
    })

    test('hands a peer the sentinel bin size, and takes it back', async () => {
        const browser = await load(SINGLE_URL, wholeGenomeState())
        const sync = browser.state.getSyncState(browser.dataset)

        // Named by the scaffold, sized by the sentinel bin -- so a peer over the
        // same assembly resolves it back to the sentinel rather than to the
        // coarsest declared one.
        expect(sync.chr1Name).toBe('scaffold_1')
        expect(sync.binSize).toBe(browser.dataset.wholeGenomeResolution)

        const peer = await load(SINGLE_URL)
        await peer.state.sync(sync, peer, peer.genome, peer.dataset)
        expect(peer.state.zoom).toBe(SENTINEL_ZOOM)
        expect(peer.state.chr1).toBe(SCAFFOLD)
    })
})

describe('rung lookup by index rather than by array position', () => {

    test('answers the sentinel when nothing declared is coarse enough', async () => {
        const browser = await load(SINGLE_URL)
        const resolutions = browser.getResolutions()

        // A target coarser than every rung falls back to the coarsest, which is
        // the first entry. Reading its *position* rather than its index -- what
        // the fallback used to do -- would answer 0, the 2.5mb declared rung.
        expect(browser.findMatchingZoomIndex(Number.MAX_SAFE_INTEGER, resolutions)).toBe(SENTINEL_ZOOM)
        expect(resolutions[0].index).toBe(SENTINEL_ZOOM)
    })

    test('selects the sentinel option in the resolution pulldown', async () => {
        const browser = await load(SINGLE_URL, wholeGenomeState())
        const {resolutionSelectorElement} = browser.coordinator.widgets.resolutionSelector

        browser.coordinator.widgets.resolutionSelector.setSelectedResolution(SENTINEL_ZOOM)
        const selected = Array.from(resolutionSelectorElement.options).filter(o => o.selected)

        // The sentinel's option sits at position 0 and carries value "-1".
        // Selecting by position would have needed index -1 to be a position.
        expect(selected.map(o => o.value)).toEqual([String(SENTINEL_ZOOM)])
    })
})
