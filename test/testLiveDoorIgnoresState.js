/**
 * A live contact map opens at its locus, and never reads `config.state`. #650.
 *
 * The rung that read it was deleted rather than repaired; the reason is
 * beside the code, in `dataLoader.loadLiveContactMap`. Before the deletion the
 * normalization was the only part of a state to survive `parseGotoInput`.
 *
 * `testRestoreGolden.js` can't show the deletion: its dataset offers only
 * `NONE`, so the old rung's surviving normalization was already coerced away
 * there. This test uses a dataset that offers the saved normalization, which is
 * the one case where the old rung changed anything.
 */
import {describe, expect, test, vi} from 'vitest'
import State from '../js/hicState.js'
import {restoreDataset} from './utils/restoreDataset.js'
import {restoreFixture} from './utils/restoreFixture.js'

vi.mock('../js/hicDataset.js', async () => {
    const {restoreDataset, datasetModule} = await import('./utils/restoreDataset.js')
    return datasetModule(config => {
        const dataset = restoreDataset(config)
        dataset.getNormalizationOptions = async () => ['NONE', 'VC', 'KR']
        return dataset
    })
})

const {default: HICBrowser} = await import('../js/hicBrowser.js')

describe('the live door does not read config.state (#650)', () => {

    const {embed} = restoreFixture(HICBrowser, {suite: 'live door ignores state'})

    test('a state carrying a normalization the map offers does not reach the view', async () => {

        const browser = embed()
        const {chromosomes} = restoreDataset()

        await browser.loadLiveContactMap({
            liveContactMap: {chromosomes, genomicStart: 0, genomicEnd: 10000000},
            state: new State(1, 1, 3, 10, 10, 2, 'KR'),
        }, true)

        expect(browser.state.normalization).toBe('NONE')
    })
})
