/**
 * A browser stub shaped for `InteractionHandler`'s gesture methods.
 *
 * Just the collaborator surface `pinchZoom` / `_performWheelZoom` touch: a real
 * `State` so the non-branching path runs real arithmetic, a chromosome table
 * whose first entry is the whole-genome one, and the spinner / update / view
 * hooks `_applyStateChange` calls.
 */
import State from '../../js/hicState.js'

const CHROMOSOMES = [
    {index: 0, name: 'all', size: 3000000000},
    {index: 1, name: 'chr1', size: 250000000},
    {index: 2, name: 'chr2', size: 240000000},
    {index: 3, name: 'chr3', size: 200000000},
]

/** The single-chromosome table: the whole-genome entry plus one scaffold. */
const SOLE_SCAFFOLD = CHROMOSOMES.slice(0, 2)

const BIN_SIZES = [2500000, 1000000, 500000, 250000, 100000, 50000, 25000, 10000, 5000]

export const VIEW_DIMENSIONS = {width: 800, height: 800}

/**
 * @param {object} [options]
 * @param {boolean} [options.resolutionLocked]
 * @param {boolean} [options.isSingleChromosome]
 */
export function createInteractionBrowser({resolutionLocked = false, isSingleChromosome = false} = {}) {
    const chromosomes = isSingleChromosome ? SOLE_SCAFFOLD : CHROMOSOMES
    const resolutions = BIN_SIZES.map((binSize, index) => ({binSize, index}))

    const dataset = {
        chromosomes,
        bpResolutions: BIN_SIZES,
        wholeGenomeChromosome: chromosomes[0],
        isWholeGenome: chrIndex => 0 === chrIndex,
        isSingleChromosome: () => isSingleChromosome,
        soleChromosome: () => chromosomes[1],
        binSizeForZoom: zoom => BIN_SIZES[zoom],
        matrixViewForZoom: (chr1, chr2, zoom) => ({chr1, chr2, zoomIndex: zoom}),
    }

    return {
        dataset,
        resolutionLocked,
        // Zoom rung 3 with rung 3 as the floor: any coarser match falls out to
        // the whole genome, which is the branch under test.
        state: new State(1, 1, 3, 200, 200, 4, 'NONE'),
        minZoom: async () => 3,
        minPixelSize: async () => 1,
        getResolutions: () => resolutions,
        binSizeForZoom: zoom => BIN_SIZES[zoom],
        genome: {getChromosome: name => chromosomes.find(chromosome => chromosome.name === name)},
        contactMatrixView: {
            getViewDimensions: () => VIEW_DIMENSIONS,
            clearImageCaches: () => {},
            zoomIn: async () => {},
        },
        update: async () => {},
        coordinator: {onLocusChange: () => {}},
        startSpinner: () => {},
        stopSpinner: () => {},
    }
}
