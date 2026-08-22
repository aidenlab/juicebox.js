import {beforeEach, afterEach, vi} from 'vitest'
import DataLoader from '../../js/dataLoader.js'
import State from '../../js/hicState.js'
import ContactMatrixView from '../../js/contactMatrixView.js'
import HICBrowser from '../../js/hicBrowser.js'

/**
 * Stand the initialization and restore paths up without the two things a test
 * cannot supply: the network read of the `.hic` file and the canvas.
 *
 * The `.hic` read is the real system boundary here, and the only reason a
 * restore cannot otherwise be driven in a test. What stands in for it does
 * exactly what the real loader does with the parts of a config these suites are
 * about: name the dataset, and build the state from `config.state` through the
 * real `State.fromJSON`. Everything downstream -- the registry, the browser's
 * own `toJSON`, the state itself -- is the real thing.
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
            this.browser.dataset = stubDataset(config)
            this.browser.state = config.state ? State.fromJSON(config.state) : State.default()
        })
        vi.spyOn(DataLoader.prototype, 'loadTracks').mockImplementation(async () => undefined)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })
}

/**
 * What a loaded dataset has to carry for the paths these suites drive.
 *
 * Beyond the identity a session round trip reads, it carries what the *sync*
 * path reads: the genome id and `isCompatible` the pairing rule tests, and the
 * chromosomes and resolutions a pan reads its sync state out of. Two datasets
 * are compatible when they name the same genome, which is what the real
 * `Dataset.isCompatible` decides first.
 */
function stubDataset(config) {
    return {
        url: config.url,
        name: config.name,
        genomeId: config.genomeId || 'hg19',
        isCompatible(other) {
            return other.genomeId === this.genomeId
        },
        chromosomes: [{index: 0, name: 'All', size: 3088286401}, {index: 1, name: 'chr1', size: 249250621}],
        bpResolutions: [2500000, 1000000, 500000, 250000, 100000, 50000],
        hicFile: {config: {nvi: config.nvi}}
    }
}
