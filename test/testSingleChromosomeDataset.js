/**
 * The predicate and the two accessors ADR-0010 rests on, asserted against the
 * real `Dataset` rather than a stand-in.
 *
 * Everything else in the ticket is gated on `isSingleChromosome()`, so what
 * matters most here is the negative: it must stay false for every real genome.
 * A predicate that creeps true is not a bug that shows up as a broken
 * single-scaffold view -- it shows up as hg19 losing its whole-genome
 * chromosome, which is why the "dominates" reading was rejected outright.
 */
import {describe, expect, test} from 'vitest'
import Dataset from '../js/hicDataset.js'
import {SENTINEL_ZOOM} from '../js/sentinelZoom.js'

/**
 * A `Dataset` carrying the four fields `init()` reads off the file, and nothing
 * else. Subclassed rather than faked so the methods under test are the shipped
 * ones.
 */
class StandIn extends Dataset {
    constructor(chromosomes, {bpResolutions = [2500000, 500000], wholeGenomeResolution} = {}) {
        super({name: 'stand-in'})
        this.chromosomes = chromosomes
        this.bpResolutions = bpResolutions
        this.wholeGenomeChromosome = chromosomes.find(chr => 'All' === chr.name)
        this.wholeGenomeResolution = wholeGenomeResolution
    }
}

const all = {index: 0, name: 'All', size: 2400000}
const scaffold = {index: 1, name: 'scaffold_1', size: 2400000000}

/** `All` plus one real scaffold -- the assembly #236 is about. */
const single = () => new StandIn([all, scaffold], {wholeGenomeResolution: 4800000})

/** `All` plus three, standing for every real genome. */
const multi = () => new StandIn([
    all,
    {index: 1, name: 'chr1', size: 249250621},
    {index: 2, name: 'chr2', size: 243199373},
    {index: 3, name: 'chr3', size: 198022430},
], {wholeGenomeResolution: 6000000})

describe('isSingleChromosome', () => {

    test('is true for the All entry plus exactly one real chromosome', () => {
        expect(single().isSingleChromosome()).toBe(true)
    })

    test('is false for a multi-chromosome genome', () => {
        expect(multi().isSingleChromosome()).toBe(false)
    })

    test('is false for a two-entry table with no whole-genome chromosome', () => {
        // Two entries is the arithmetic; `All` being one of them is the claim.
        // A file declaring two real scaffolds and no `All` is not this case, and
        // has no whole-genome matrix to synthesise a rung from.
        const noAll = new StandIn([
            {index: 0, name: 'scaffold_1', size: 1000},
            {index: 1, name: 'scaffold_2', size: 2000},
        ])
        expect(noAll.isSingleChromosome()).toBe(false)
    })

    test('identifies All by whole-genome identity, not by name', () => {
        // A scaffold that happens to be named "all" is still a scaffold. The
        // name test `genome.js` and `ruler.js` use would take this one.
        const named = new StandIn([
            {index: 0, name: 'all', size: 1000},
            {index: 1, name: 'chr1', size: 2000},
        ])
        expect(named.isSingleChromosome()).toBe(false)
    })
})

describe('soleChromosome', () => {

    test('is the one entry that is not the whole-genome chromosome', () => {
        expect(single().soleChromosome()).toBe(scaffold)
    })

    test('is undefined for a multi-chromosome genome', () => {
        expect(multi().soleChromosome()).toBeUndefined()
    })
})

describe('binSizeForZoom', () => {

    test('reads the declared ladder at a declared rung', () => {
        expect(single().binSizeForZoom(1)).toBe(500000)
    })

    test('answers the whole-genome resolution at the sentinel', () => {
        // In bp, not in the kb the whole-genome matrix states its own
        // coordinates in -- ADR-0010 fact 4, and the reason the sentinel bin
        // divides the scaffold's bp exactly.
        expect(single().binSizeForZoom(SENTINEL_ZOOM)).toBe(4800000)
        expect(scaffold.size / single().binSizeForZoom(SENTINEL_ZOOM)).toBe(500)
    })
})

describe('matrixViewForZoom', () => {

    test('is the identity at a declared rung', () => {
        expect(single().matrixViewForZoom(1, 1, 3)).toEqual({chr1: 1, chr2: 1, zoomIndex: 3})
    })

    test('answers the whole-genome matrix at its only resolution at the sentinel', () => {
        expect(single().matrixViewForZoom(1, 1, SENTINEL_ZOOM))
            .toEqual({chr1: 0, chr2: 0, zoomIndex: 0})
    })

    test('the two whole-genome tests diverge at the sentinel, by design', () => {
        // ADR-0010 decisions 3 and 4. The data test -- what the tile source
        // reads as `0 === zd.chr1.index` -- is true, because the rung is served
        // from the whole-genome matrix. The vocabulary test, which reads the
        // state's chromosome, is false. Reconciling them is the "fix" the ADR
        // exists to warn off.
        const dataset = single()
        expect(dataset.matrixViewForZoom(1, 1, SENTINEL_ZOOM).chr1).toBe(0)
        expect(dataset.isWholeGenome(1)).toBe(false)
    })
})
