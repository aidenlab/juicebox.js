import {describe, it, expect} from 'vitest'
import {pairSynchable} from '../js/browserSync.js'

/**
 * The sync-group pairing rule -- see #476, decision 6 of ADR-0004.
 *
 * `pairSynchable` is the rule alone: given browsers, which of them should sync
 * with which. It reads no module state and touches no DOM, so the browsers here
 * are fabricated objects carrying only what the rule reads -- a `synchable`
 * flag and a `dataset` that can answer `isCompatible`.
 */

function fakeDataset(genomeId) {
    return {
        genomeId,
        isCompatible(other) {
            return other.genomeId === genomeId
        }
    }
}

function fakeBrowser(name, {dataset, synchable} = {}) {
    const browser = {name}
    if (dataset !== undefined) browser.dataset = dataset
    if (synchable !== undefined) browser.synchable = synchable
    return browser
}

describe('pairSynchable', () => {

    it('pairs two browsers whose datasets are compatible', () => {
        const hg38 = fakeDataset('hg38')
        const a = fakeBrowser('a', {dataset: hg38})
        const b = fakeBrowser('b', {dataset: hg38})

        expect(pairSynchable([a, b])).toEqual([[a, b]])
    })

    it('does not pair browsers whose datasets are incompatible', () => {
        const a = fakeBrowser('a', {dataset: fakeDataset('hg38')})
        const b = fakeBrowser('b', {dataset: fakeDataset('hg19')})

        expect(pairSynchable([a, b])).toEqual([])
    })

    it('skips a browser that opted out with synchable false', () => {
        const hg38 = fakeDataset('hg38')
        const a = fakeBrowser('a', {dataset: hg38})
        const optedOut = fakeBrowser('opted-out', {dataset: hg38, synchable: false})

        expect(pairSynchable([a, optedOut])).toEqual([])
    })

    it('skips a browser that has not loaded a dataset yet', () => {
        const a = fakeBrowser('a', {dataset: fakeDataset('hg38')})
        const empty = fakeBrowser('empty')

        expect(pairSynchable([a, empty])).toEqual([])
    })

    it('returns nothing for an empty list', () => {
        expect(pairSynchable([])).toEqual([])
    })

    it('returns nothing for a single browser', () => {
        const only = fakeBrowser('only', {dataset: fakeDataset('hg38')})

        expect(pairSynchable([only])).toEqual([])
    })

    it('pairs each compatible combination once, ignoring the rest', () => {
        const hg38 = fakeDataset('hg38')
        const a = fakeBrowser('a', {dataset: hg38})
        const b = fakeBrowser('b', {dataset: hg38})
        const c = fakeBrowser('c', {dataset: hg38})
        const other = fakeBrowser('other', {dataset: fakeDataset('hg19')})
        const optedOut = fakeBrowser('opted-out', {dataset: hg38, synchable: false})
        const empty = fakeBrowser('empty')

        expect(pairSynchable([a, other, b, optedOut, empty, c])).toEqual([[a, b], [a, c], [b, c]])
    })
})
