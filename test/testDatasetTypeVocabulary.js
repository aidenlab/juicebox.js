import {describe, it, expect} from 'vitest'
import Dataset, {HiCDataset} from '../js/hicDataset.js'

/**
 * The `datasetType` a `Dataset` *carries* -- see CONTEXT.md under "Dataset" for
 * the vocabulary and #471 for why it was wrong.
 *
 * What the coordinator publishes from it is a separate contract, pinned in
 * `test/testMapLoadedPayload.js`. Keep the two apart: this file cannot see a
 * literal at a call site, which is exactly how the live loader got away with a
 * fourth spelling for as long as it did.
 *
 * These are characterization tests. Nothing asserted on the value before, which
 * is why a JSDoc could contradict it for eight months without failing anything.
 */

describe('datasetType vocabulary', () => {

    /**
     * `HiCDataset` decides the value in its constructor, from `liveContactMap`
     * alone. Constructing one builds a Straw but touches no network, so both
     * arms are reachable without a fixture.
     */
    it('reads hic for a dataset backed by a .hic file', () => {
        const dataset = new HiCDataset({url: 'https://example.org/test.hic'})
        expect(dataset.datasetType).toBe('hic')
    })

    it('reads live for a live contact map', () => {
        const dataset = new HiCDataset({liveContactMap: {}})
        expect(dataset.datasetType).toBe('live')
    })

    it('tracks isLive, which is the field hosts branch on today', () => {
        // Spacewalk reads `dataset.isLive` rather than `datasetType`, so the
        // two must not be able to disagree.
        for (const config of [{url: 'https://example.org/test.hic'}, {liveContactMap: {}}]) {
            const dataset = new HiCDataset(config)
            expect(dataset.datasetType).toBe(dataset.isLive ? 'live' : 'hic')
        }
    })

    /**
     * The base-class default is reachable, not dead: any `Dataset` subclass
     * that does not set the field leaves it here, and the value escapes to
     * hosts unchanged.
     */
    it('reads unknown for a Dataset subclass that names no type', () => {
        class UnnamedDataset extends Dataset {}
        expect(new UnnamedDataset({}).datasetType).toBe('unknown')
    })

    it('lets a config name the type for a subclass that passes one through', () => {
        class NamedDataset extends Dataset {}
        expect(new NamedDataset({datasetType: 'hic'}).datasetType).toBe('hic')
    })

})
