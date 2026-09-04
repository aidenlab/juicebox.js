import {describe, it, expect, vi} from 'vitest'
import {registryForContainer} from '../js/browserRegistry.js'
import {withContainers} from './utils/browserFixture.js'
import {withStubbedLoads} from './utils/stubbedLoads.js'
import Genome from '../js/genome.js'
import State from '../js/hicState.js'

/**
 * A sync state naming a chromosome the receiver cannot resolve is skipped.
 *
 * `Dataset.isCompatible` short-circuits to `true` on a known genome-id pair
 * without comparing chromosomes at all, so a whole-genome hg19 map and a subset
 * hg19 map pair happily. The peer then publishes `chr17` to a browser whose map
 * stops at `chr1`, and `State.sync` dereferences `genome.getChromosome(...)`
 * for its `.index` -- a TypeError on an async path, unhandled. #605.
 *
 * The guard is asked of the **genome**, not of the dataset. `canBeSynched` --
 * deleted at #566 with the unreachable `config.synchState` rung it guarded --
 * asked `dataset.getChrIndexFromName`, an exact case-sensitive scan, which is
 * stricter than the `genome.getChromosome` lookup `State.sync` actually
 * consumes: it aliases `1` to `chr1` and matches case-insensitively. Restoring
 * that expression verbatim would refuse peer states that sync correctly today,
 * which is what the aliasing case below pins.
 *
 * The rule itself is `canResolveSyncState` in `syncGroup.js`, unit-tested in
 * `testSyncGroup.js`. What is here is the behaviour through two real browsers:
 * that the gate is actually on the path a peer reaches, and that a refusal is a
 * silent no-op rather than a throw.
 */

const session = (...urls) => ({browsers: urls.map(url => ({url}))})

/** Two browsers on the same genome, each at a state of its own, ready to sync. */
async function twoBrowsers(container) {
    const registry = registryForContainer(container)
    await registry.restoreSession(session('https://example.com/a.hic', 'https://example.com/b.hic'))
    const [a, b] = registry.browsers
    for (const browser of [a, b]) {
        browser.genome = new Genome(browser.dataset.genomeId, browser.dataset.chromosomes)
        await browser.setState(new State(1, 1, 4, 0, 0, 1.5, 'NONE'))
    }
    return [a, b]
}

/**
 * Cut a browser's map down to `All` plus `chr1`, the subset `.hic` labelled with
 * the whole genome's id -- an ordinary artifact, and the reachable case. The
 * genome is rebuilt from the same shortened list, which is how a real load
 * builds it (`dataLoader.js`).
 */
function shrinkToChr1(browser) {
    const subset = {...browser.dataset, chromosomes: browser.dataset.chromosomes.slice(0, 2)}
    browser.setActiveDataset(subset)
    browser.genome = new Genome(subset.genomeId, subset.chromosomes)
}

describe('syncing a state naming a chromosome the receiver does not have', () => {

    const dom = withContainers()
    withStubbedLoads()

    it('skips the sync rather than throwing', async () => {
        const [a, b] = await twoBrowsers(dom.container)
        shrinkToChr1(b)
        const before = b.state.clone()

        await expect(b.syncState({
            chr1Name: 'chr17', chr2Name: 'chr17', binSize: 50000, binX: 3, binY: 4, pixelSize: 2
        })).resolves.toBeUndefined()

        expect(b.state).toEqual(before)
        expect(a.state.chr1).toBe(1)
    })

    it('leaves the coordinator unnotified, as the other guard failures do', async () => {
        // The skip is silent by decision: it matches `syncState`'s existing
        // early returns and introduces no new vocabulary for the host.
        const [, b] = await twoBrowsers(dom.container)
        shrinkToChr1(b)
        const onLocusChange = vi.spyOn(b.coordinator, 'onLocusChange')

        await b.syncState({chr1Name: 'chr17', chr2Name: 'chr17', binSize: 50000, binX: 3, binY: 4, pixelSize: 2})

        expect(onLocusChange).not.toHaveBeenCalled()
    })

    it('skips on the second chromosome too', async () => {
        // Both names are checked. An intra-chromosomal view resolves chr1 and
        // fails on chr2, and a guard reading only the first would sail past it.
        const [, b] = await twoBrowsers(dom.container)
        shrinkToChr1(b)
        const before = b.state.clone()

        await b.syncState({chr1Name: 'chr1', chr2Name: 'chr17', binSize: 50000, binX: 3, binY: 4, pixelSize: 2})

        expect(b.state).toEqual(before)
    })

    it('still syncs a name that resolves only through the genome\'s aliasing', async () => {
        // The regression the deleted `dataset.getChrIndexFromName` check would
        // have caused: a peer publishing `1` against a receiver whose
        // chromosome is named `chr1`. `getChrIndexFromName('1')` is undefined;
        // `genome.getChromosome('1')` is the chromosome, and `State.sync`
        // handles it. The guard must admit exactly what sync can consume.
        const [, b] = await twoBrowsers(dom.container)
        shrinkToChr1(b)

        // A bin size and pixel size that name the receiver's own rung, so the
        // origin arrives unrescaled and the sync is legible as a bare `did it
        // happen`. Rung re-derivation has its own tests.
        await b.syncState({chr1Name: '1', chr2Name: '1', binSize: 50000, binX: 3, binY: 4, pixelSize: 1})

        expect(b.state.chr1).toBe(1)
        expect(b.state.chr2).toBe(1)
        expect(b.state.x).toBe(3)
        expect(b.state.y).toBe(4)
    })

    it('leaves an ordinary sync between two full maps alone', async () => {
        const [a, b] = await twoBrowsers(dom.container)

        await a.setState(new State(2, 2, 5, 7, 9, 1, 'NONE'))
        await b.syncState(a.getSyncState())

        expect(b.state.chr1).toBe(2)
        expect(b.state.chr2).toBe(2)
        expect(b.state.x).toBe(7)
        expect(b.state.y).toBe(9)
    })
})
