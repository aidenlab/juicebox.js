import {describe, it, expect} from 'vitest'
import {registryForContainer} from '../js/browserRegistry.js'
import {withContainers} from './utils/browserFixture.js'
import {withStubbedLoads} from './utils/stubbedLoads.js'
import {restoreDataset} from './utils/restoreDataset.js'
import Genome from '../js/genome.js'
import State from '../js/hicState.js'

/**
 * #716 -- two synced panels, one goes from a chromosome back to `All`, and the
 * other followed it to a blurred, magnified whole-genome view. A single panel
 * was fine: typing `All` goes through `setChromosomesView`, sync through
 * `State.sync`, and only the second got two things wrong.
 *
 * - It floored the follower's pixelSize against the chromosome it was *leaving*.
 *   Leaving chr1 at 2.5 mb, that floor is ~5x the one `All` needs.
 * - It re-derived a rung from the publisher's `binSize`, which at `All` is the
 *   coarsest chromosome rung rather than the whole-genome bin. Two maps whose
 *   ladders differ landed on a zoom the `All` matrix does not carry.
 *
 * The hg19 stand-in's `All` entry is not faithful to the format, and both bugs
 * live in the units, so the dataset here corrects it: size in kb,
 * `wholeGenomeResolution` in bp (`size * 2`), and a whole-genome matrix that
 * carries one resolution stated in the kb its coordinates are in -- the shape
 * `singleChromosomeDataset` already gives its own `All`.
 */

const STANDARD = [2500000, 1000000, 500000, 250000, 100000, 50000, 25000, 10000, 5000]

function wholeGenomeFaithful(dataset, ladder = STANDARD) {
    const total = dataset.chromosomes.slice(1).reduce((sum, c) => sum + c.size, 0)
    const all = {...dataset.chromosomes[0], size: Math.round(total / 1000)}
    const chromosomes = [all, ...dataset.chromosomes.slice(1)]
    return {
        ...dataset,
        chromosomes,
        bpResolutions: ladder,
        wholeGenomeChromosome: all,
        wholeGenomeResolution: all.size * 2,
        binSizeForZoom(zoom) {
            return -1 === zoom ? this.wholeGenomeResolution : ladder[zoom]
        },
        async getMatrix(chr1, chr2) {
            if (0 === chr1 && 0 === chr2) {
                return {
                    getZoomDataByIndex: (index, unit) => 0 === index
                        ? {zoom: {index, unit: unit || 'BP', binSize: all.size * 2 / 1000}, chr1: all, chr2: all}
                        : undefined,
                    findZoomForResolution: () => 0,
                }
            }
            return {
                getZoomDataByIndex: (index, unit) => undefined === ladder[index]
                    ? undefined
                    : {zoom: {index, unit, binSize: ladder[index]}},
                findZoomForResolution(binSize) {
                    for (let z = ladder.length - 1; z > 0; z--) {
                        if (ladder[z] >= binSize) return z
                    }
                    return 0
                },
            }
        },
    }
}

/** Two synced browsers over the faithful dataset, both on chr1, 900px square. */
async function twoSyncedBrowsers(container, {ladderA = STANDARD, ladderB = STANDARD} = {}) {
    const registry = registryForContainer(container)
    await registry.restoreSession({browsers: [{url: 'https://example.com/a.hic'}, {url: 'https://example.com/b.hic'}]})
    const [a, b] = registry.browsers
    for (const [browser, ladder] of [[a, ladderA], [b, ladderB]]) {
        browser.setActiveDataset(wholeGenomeFaithful(restoreDataset({url: browser.dataset.url}), ladder))
        browser.genome = new Genome(browser.dataset.genomeId, browser.dataset.chromosomes)
        browser.contactMatrixView.getViewDimensions = () => ({width: 900, height: 900})
        await browser.setState(new State(1, 1, 4, 0, 0, 1.5, 'NONE'))
    }
    a.synchedBrowsers.add(b)
    b.synchedBrowsers.add(a)
    return [a, b]
}

/** The user's steps: A goes to chr1 and B follows, then A goes to `All` and B follows. */
async function chr1ThenAll(a, b) {
    await a.parseGotoInput('chr1')
    await b.syncState(a.getSyncState())
    await a.parseGotoInput('All')
    await b.syncState(a.getSyncState())
}

const view = ({chr1, chr2, zoom, x, y, pixelSize}) => ({chr1, chr2, zoom, x, y, pixelSize})

describe('#716: a synced peer follows a panel from a chromosome back to All', () => {

    const dom = withContainers()
    withStubbedLoads()

    it('lands on the whole-genome view the publisher is on', async () => {
        const [a, b] = await twoSyncedBrowsers(dom.container)
        await chr1ThenAll(a, b)
        expect(a.state.chr1).toBe(0)
        expect(view(b.state)).toEqual(view(a.state))
    })

    it('lands on the All matrix\'s only zoom when the two maps\' ladders differ', async () => {
        const finer = STANDARD.slice(1)
        const coarser = [10000000, ...STANDARD]
        for (const [ladderA, ladderB] of [[finer, STANDARD], [STANDARD, finer], [coarser, STANDARD], [STANDARD, coarser]]) {
            const [a, b] = await twoSyncedBrowsers(dom.container, {ladderA, ladderB})
            await chr1ThenAll(a, b)
            expect(view(b.state)).toEqual(view(a.state))
        }
    })

    // Not "stays locked": the move off the held rung voids the lock group-wide
    // (ADR-0014 decision 3), as it does when `All` is typed into a locked panel.
    it('a locked receiver goes to zoom 0 at All, as typing All does', async () => {
        const [a, b] = await twoSyncedBrowsers(dom.container)
        await a.parseGotoInput('chr1')
        await b.syncState(a.getSyncState())
        b.setResolutionLocked(true)
        await a.parseGotoInput('All')
        await b.syncState(a.getSyncState())
        expect(view(b.state)).toEqual(view(a.state))
    })

    it('a receiver crossing to a smaller chromosome is floored against it, not the one it left', async () => {
        const [a, b] = await twoSyncedBrowsers(dom.container)
        await a.parseGotoInput('chr1')
        await b.syncState(a.getSyncState())
        await a.parseGotoInput('chr21')
        await b.syncState(a.getSyncState())
        expect(view(b.state)).toEqual(view(a.state))
    })

    // The second half of #716, and not a sync bug: typing `All` kept the scale
    // of the view being left whenever it was above the fit. chr1 at 500 kb sits
    // near the fit, which hid it; chr21 does not, nor does any view zoomed past
    // its own fit -- the blurred, magnified whole genome #716 was reported with.
    const leaving = {
        'chr21': a => a.parseGotoInput('chr21'),
        'chr21 zoomed to 6 px/bin': a => a.setState(new State(21, 21, 2, 10, 10, 6, 'NONE')),
    }
    for (const [from, go] of Object.entries(leaving)) {
        it(`typing All from ${from} lands on the fit the whole-genome ruler is drawn for`, async () => {
            const [a, b] = await twoSyncedBrowsers(dom.container)
            await go(a)
            // Above the fit, or the old `max(this.pixelSize, fit)` passes too.
            expect(a.state.pixelSize).toBeGreaterThan(await a.minPixelSize(0, 0, 0))
            await a.parseGotoInput('All')
            expect(a.state.pixelSize).toBe(Math.max(1, await a.minPixelSize(0, 0, 0)))
            await b.syncState(a.getSyncState())
            expect(view(b.state)).toEqual(view(a.state))
        })
    }

    it('a receiver leaving All for a chromosome lands where the publisher does', async () => {
        const [a, b] = await twoSyncedBrowsers(dom.container)
        await chr1ThenAll(a, b)
        await a.parseGotoInput('chr2')
        await b.syncState(a.getSyncState())
        expect(view(b.state)).toEqual(view(a.state))
    })
})
