/**
 * The spellings `parseGotoInput` accepts, driven end to end through a real
 * `loadHicFile` and the chokepoint, on the hg19 stand-in
 * `test/utils/restoreDataset.js` carries.
 *
 * The locus box has always taken `chr:start-end`, a bare chromosome name, two
 * of either separated by a space, `All` and a gene symbol. A host driving the
 * browser from outside its widgets spells the same places more loosely --
 * `chr1 10mb-20mb`, `chromosome 1`, `1:1000-2000`, a `kb`/`mb` suffix, or a
 * `{chr, start, end}` object it already holds -- and each of those is asserted
 * here to land exactly where its strict spelling lands. Extracting a locus from
 * a sentence is not a spelling and stays out.
 *
 * Every claim is an equivalence against the strict form, plus one absolute
 * check that the strict form itself lands where it says, so the equivalences
 * cannot pass vacuously. The viewport is `restoreFixture`'s stated 800x800:
 * JSDOM does no layout (ADR-0009 fact 5).
 */
import {describe, expect, test, vi} from 'vitest'
import {restoreFixture, VIEWPORT} from './utils/restoreFixture.js'

vi.mock('../js/hicDataset.js', async () => {
    const {restoreDataset, datasetModule} = await import('./utils/restoreDataset.js')
    return datasetModule(restoreDataset)
})

const {default: HICBrowser} = await import('../js/hicBrowser.js')

const HIC_URL = 'https://example.org/spellings.hic'

const {embed} = restoreFixture(HICBrowser, {suite: 'locus-spellings', url: HIC_URL})

/** One embed, one load, one goto. Returns the canonical state left standing. */
async function landOn(input) {
    const browser = embed()
    await browser.loadHicFile({url: HIC_URL}, true)
    await browser.parseGotoInput(input)
    return browser.state.toJSON()
}

describe('the strict spellings, unchanged', () => {

    test('chr:start-end frames exactly that range', async () => {
        const browser = embed()
        await browser.loadHicFile({url: HIC_URL}, true)
        await browser.parseGotoInput('chr1:10000001-20000000')

        // 1-based on the way in, 0-based inside: the string's start is one past
        // the locus it lands on.
        const locus = browser.state.getLocus(browser.dataset, VIEWPORT)
        expect(locus.x).toEqual({chr: 'chr1', start: 10000000, end: 20000000})
        expect(locus.y).toEqual({chr: 'chr1', start: 10000000, end: 20000000})
    })

    test('a bare chromosome name frames the whole chromosome', async () => {
        const state = await landOn('chr2')
        expect(state.chr1).toBe(2)
        expect(state.chr2).toBe(2)
        expect(state).not.toEqual(await landOn('chr1'))
    })

    test('two loci name the two axes', async () => {
        const state = await landOn('chr1:1000001-2000000 chr2:1000001-2000000')
        expect(state.chr1).toBe(1)
        expect(state.chr2).toBe(2)
    })

    test('commas in a number are ignored', async () => {
        expect(await landOn('chr1:10,000,001-20,000,000')).toEqual(await landOn('chr1:10000001-20000000'))
    })

    test('All is the whole-genome view', async () => {
        const state = await landOn('All')
        expect(state.chr1).toBe(0)
        expect(state.chr2).toBe(0)
    })

    test('a gene symbol resolves through the feature table', async () => {
        const browser = embed()
        await browser.loadHicFile({url: HIC_URL}, true)
        // The table holds 0-based loci, as `lookupFeatureOrGene` expects.
        browser.genome.featureDB.set('MYC', {chr: 'chr8', start: 128748314, end: 128753680})

        await browser.parseGotoInput('MYC')

        expect(browser.state.toJSON()).toEqual(await landOn('chr8:128748315-128753680'))
    })

    test('a gene symbol followed by a stray range still means the gene', async () => {
        // Today the second token fails to parse as a locus and the first one
        // stands for both axes. A range is joined only to a chromosome name, so
        // that is still what happens.
        const browser = embed()
        await browser.loadHicFile({url: HIC_URL}, true)
        browser.genome.featureDB.set('MYC', {chr: 'chr8', start: 128748314, end: 128753680})

        await browser.parseGotoInput('MYC 1000-2000')

        expect(browser.state.toJSON()).toEqual(await landOn('chr8:128748315-128753680'))
    })
})

describe('the looser spellings', () => {

    test('a space stands in for the colon', async () => {
        expect(await landOn('chr1 10000001-20000000')).toEqual(await landOn('chr1:10000001-20000000'))
    })

    test('mb and kb scale a number', async () => {
        expect(await landOn('chr1:10mb-20mb')).toEqual(await landOn('chr1:10000000-20000000'))
        expect(await landOn('chr1:500kb-1500kb')).toEqual(await landOn('chr1:500000-1500000'))
        expect(await landOn('chr1:500kb-1.5mb')).toEqual(await landOn('chr1:500000-1500000'))
        expect(await landOn('chr1:10MB-20MB')).toEqual(await landOn('chr1:10000000-20000000'))
    })

    test('a space and a suffix together', async () => {
        expect(await landOn('chr1 10mb-20mb')).toEqual(await landOn('chr1:10000000-20000000'))
    })

    test('the word chromosome introduces a name', async () => {
        expect(await landOn('chromosome 1')).toEqual(await landOn('chr1'))
        expect(await landOn('chromosome 1 10mb-20mb')).toEqual(await landOn('chr1:10000000-20000000'))
    })

    test('a bare number is a chromosome', async () => {
        expect(await landOn('1:1000-2000')).toEqual(await landOn('chr1:1000-2000'))
    })

    test('two loose loci still name the two axes', async () => {
        expect(await landOn('chr1 10mb-20mb chr2 10mb-20mb')).toEqual(await landOn('chr1:10000000-20000000 chr2:10000000-20000000'))
    })

    test('a {chr, start, end} object navigates like the string form', async () => {
        expect(await landOn({chr: 'chr1', start: 10000001, end: 20000000})).toEqual(await landOn('chr1:10000001-20000000'))
    })

    test('a {chr} object frames the whole chromosome', async () => {
        expect(await landOn({chr: 'chr2'})).toEqual(await landOn('chr2'))
    })
})

describe('invalid input', () => {

    // One strict form and one loose form: neither names a chromosome or a gene,
    // so both fall through to the alert, as the strict one always has.
    test.each(['nosuchplace:1000-2000', 'nosuchplace 10mb-20mb'])('%s is still rejected with an alert and no navigation', async input => {
        const alert = vi.fn()
        vi.stubGlobal('alert', alert)
        vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const browser = embed()
            await browser.loadHicFile({url: HIC_URL}, true)
            const before = browser.state.toJSON()

            await browser.parseGotoInput(input)

            expect(alert).toHaveBeenCalledTimes(1)
            expect(browser.state.toJSON()).toEqual(before)
        } finally {
            vi.unstubAllGlobals()
        }
    })
})
