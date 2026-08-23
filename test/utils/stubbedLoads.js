import {beforeEach, afterEach, vi} from 'vitest'
import DataLoader from '../../js/dataLoader.js'
import {decodeState} from '../../js/sessionCodec.js'
import ContactMatrixView from '../../js/contactMatrixView.js'
import HICBrowser from '../../js/hicBrowser.js'
import {restoreDataset} from './restoreDataset.js'

/**
 * Stand the initialization and restore paths up without the two things a test
 * cannot supply: the network read of the `.hic` file and the canvas.
 *
 * The `.hic` read is the real system boundary here, and the only reason a
 * restore cannot otherwise be driven in a test. What stands in for it does
 * exactly what the real loader does with the parts of a config these suites are
 * about: name the dataset, and build the state from `config.state` through the
 * real `decodeState`. Everything downstream -- the registry, the browser's
 * own `toJSON`, the state itself -- is the real thing.
 *
 * The dataset it installs is `restoreDataset`, the honest hg19 stand-in #557
 * built for the restore golden, rather than a thinner one of its own. Once the
 * state goes through the chokepoint (#563) the dataset stops being decoration:
 * `clampXY` reads its chromosome sizes and `minPixelSize` reads its zoom
 * records, so a two-chromosome stand-in with no `getMatrix` is not a dataset
 * this path can be driven against at all.
 *
 * The two update paths are stubbed for the same reason `browserFixture` stubs
 * the 2D context: what a session carries is state, and every route out of a
 * repaint ends at either the network or a pixel. Rendering has its own tests.
 */
export function withStubbedLoads() {

    beforeEach(() => {
        vi.spyOn(ContactMatrixView.prototype, 'update').mockImplementation(async () => undefined)
        vi.spyOn(HICBrowser.prototype, 'update').mockImplementation(async () => undefined)
        vi.spyOn(DataLoader.prototype, 'loadHicFile').mockImplementation(async function (config) {
            // The dataset, then the state through the chokepoint, in that order
            // -- which is the real ladder's order (`dataLoader.js`, all four
            // rungs) and is required rather than tidy: `clampXY` reads the
            // dataset's chromosome table.
            //
            // It used to write `browser.state` directly, and #563 is why it no
            // longer can: a fixture that installs state behind the chokepoint
            // cannot observe the invariant the chokepoint exists to enforce, so
            // every suite standing on it was restoring a state no clamp, no cap
            // and no normalization check had ever seen.
            //
            // `decodeState` rather than `State.fromJSON`, which is what the two
            // ladder rungs that carry a state call. The difference is not
            // cosmetic: a session blob spells its state as the comma-separated
            // string `"2,2,6,1896.15,1916.65,1.54,KR"`, and `fromJSON` on a
            // string returns a State whose every field is `undefined`. That was
            // invisible while the fixture wrote the field, and is a thrown
            // TypeError in `clampXY` the moment it stops -- which is #563's
            // acceptance criterion working as intended.
            this.browser.setActiveDataset(restoreDataset(config))
            await this.browser.setState(decodeState(config.state))
        })
        vi.spyOn(DataLoader.prototype, 'loadTracks').mockImplementation(async () => undefined)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })
}
