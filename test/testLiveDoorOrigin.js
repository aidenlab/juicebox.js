/**
 * A live contact map opens at its extent, not one bp below it. #567.
 *
 * `loadLiveContactMap` navigates to the live extent by formatting it as a locus
 * string, and `parseLocusString` reads a locus string as 1-based -- it is what a
 * user types -- and subtracts one. The extent is already 0-based, so the
 * formatter adds the one back, as the locus box and the gene lookup do. Without
 * it an extent starting at 0 opened at `-1` bp, and `updateWithLoci` does not
 * clamp (#649), so nothing pulled it back.
 *
 * `testRestoreGolden.js` records the same fact in its live column; this states
 * it by name, so a regression fails here rather than as a snapshot diff.
 */
import {describe, expect, test, vi} from 'vitest'
import {restoreDataset} from './utils/restoreDataset.js'
import {restoreFixture} from './utils/restoreFixture.js'

vi.mock('../js/hicDataset.js', async () => {
    const {restoreDataset, datasetModule} = await import('./utils/restoreDataset.js')
    return datasetModule(restoreDataset)
})

const {default: HICBrowser} = await import('../js/hicBrowser.js')

describe('the live door opens inside its extent (#567)', () => {

    const {embed} = restoreFixture(HICBrowser, {suite: 'live door origin'})

    test('an extent starting at bp 0 opens at a non-negative origin', async () => {

        const browser = embed()
        const {chromosomes} = restoreDataset()

        await browser.loadLiveContactMap({liveContactMap: {chromosomes, genomicStart: 0, genomicEnd: 10000000}}, true)

        expect(browser.state.x).toBeGreaterThanOrEqual(0)
        expect(browser.state.y).toBeGreaterThanOrEqual(0)
    })
})
