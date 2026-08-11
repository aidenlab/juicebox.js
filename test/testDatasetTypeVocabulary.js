import {describe, it, expect} from 'vitest'
import Dataset, {HiCDataset} from '../js/hicDataset.js'

/**
 * `datasetType` is published: it rides out to hosts as a field of the
 * `onMapLoaded` callback payload, which is the coordinator's host extension
 * point (CONTEXT.md, "Coordinator"). Its JSDoc claimed the values were
 * `"main"` / `"control"` for eight months while the code only ever produced
 * `'live'` / `'hic'` / `'unknown'` -- see #471.
 *
 * The two vocabularies collided because the main/control distinction went
 * vestigial when `onControlMapLoaded` was split out (which map loaded is now
 * expressed by *which method is called*), and the live-map work then reused the
 * parameter for a different question without noticing the old meaning was still
 * documented.
 *
 * Nothing could tell the two readings apart, because nothing asserted on the
 * value. These are characterization tests: they pin the vocabulary the code
 * actually speaks, so a future divergence between doc and value is a failing
 * test rather than a host branch that silently never fires -- this repo's
 * characteristic failure mode (ADR-0003).
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
     * hosts unchanged. #471 settled this as a legitimate value hosts must
     * handle rather than a bug to be thrown on.
     */
    it('reads unknown for a Dataset subclass that names no type', () => {
        class UnnamedDataset extends Dataset {}
        expect(new UnnamedDataset({}).datasetType).toBe('unknown')
    })

    it('lets a config name the type for a subclass that passes one through', () => {
        class NamedDataset extends Dataset {}
        expect(new NamedDataset({datasetType: 'hic'}).datasetType).toBe('hic')
    })

    /**
     * The negative half of the contract, and the one that would have caught
     * #471: a host reading the old JSDoc would have branched on these.
     */
    it('never speaks the vestigial main/control vocabulary', () => {
        const produced = [
            new HiCDataset({url: 'https://example.org/test.hic'}).datasetType,
            new HiCDataset({liveContactMap: {}}).datasetType,
            new (class extends Dataset {})({}).datasetType
        ]
        expect(new Set(produced)).toEqual(new Set(['hic', 'live', 'unknown']))
        for (const value of produced) {
            expect(value).not.toBe('main')
            expect(value).not.toBe('control')
        }
    })
})
