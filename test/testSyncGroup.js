import {describe, it, expect} from 'vitest'
import {pairSynchable, canBeSynched} from '../js/syncGroup.js'

/**
 * The sync-group pairing rule -- see #476, decision 6 of ADR-0004.
 *
 * `pairSynchable` is the rule alone: given browsers, which of them should sync
 * with which. It reads no module state and touches no DOM, so the browsers here
 * are fabricated objects carrying only what the rule reads -- a `synchable`
 * flag and a `dataset` that can answer `isCompatible`.
 */

function fakeDataset(genomeId, chromosomeNames = ['all', 'chr1', 'chr2']) {
    return {
        genomeId,
        isCompatible(other) {
            return other.genomeId === genomeId
        },
        getChrIndexFromName(name) {
            const index = chromosomeNames.indexOf(name)
            return index === -1 ? undefined : index
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

    it('never pairs a browser with itself, even if the list repeats it', () => {
        const only = fakeBrowser('only', {dataset: fakeDataset('hg38')})

        expect(pairSynchable([only, only])).toEqual([])
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

/**
 * `canBeSynched` is the inbound half of the same rule: not "which browsers pair
 * with which" but "may this one browser take that published state". It lives
 * here because it asks the same two questions the pairing filter asks -- has
 * this browser opted out, and does it have a dataset -- and then one more, that
 * the dataset knows the chromosomes the state names. Keeping it beside
 * `pairSynchable` is what lets `synchable` be read in exactly one expression
 * (#562, ADR-0009 decision 6).
 */
describe('canBeSynched', () => {

    const syncState = {chr1Name: 'chr1', chr2Name: 'chr2', binSize: 100000, binX: 0, binY: 0, pixelSize: 1}

    it('accepts a browser whose dataset knows both chromosomes', () => {
        const browser = fakeBrowser('a', {dataset: fakeDataset('hg38')})

        expect(canBeSynched(browser, syncState)).toBe(true)
    })

    it('keeps a browser that opted out of syncing out, even when its dataset would fit', () => {
        const browser = fakeBrowser('opted-out', {dataset: fakeDataset('hg38'), synchable: false})

        expect(canBeSynched(browser, syncState)).toBe(false)
    })

    it('refuses a browser with no dataset', () => {
        const browser = fakeBrowser('empty')

        expect(canBeSynched(browser, syncState)).toBe(false)
    })

    it('refuses a state naming a chromosome the dataset does not have', () => {
        const browser = fakeBrowser('a', {dataset: fakeDataset('hg38', ['all', 'chr1'])})

        expect(canBeSynched(browser, syncState)).toBe(false)
    })

    it('refuses a missing state rather than throwing', () => {
        const browser = fakeBrowser('a', {dataset: fakeDataset('hg38')})

        expect(canBeSynched(browser, undefined)).toBe(false)
    })
})
