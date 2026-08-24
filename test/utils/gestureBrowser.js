/**
 * A browser stub shaped for `InteractionHandler`'s gesture zoom -- `pinchZoom`,
 * `_performWheelZoom`, and the `_zoomByScaleFactor` they share.
 *
 * Only the collaborators that path reaches, plus the ones `setChromosomes`
 * needs behind it, so a gesture can be driven end to end into a real `State`
 * rather than into a spy.
 *
 * The chromosome table spells the whole-genome entry `All`, as every real
 * dataset does, and the genome looks names up case-insensitively as
 * `genome.getChromosome` does. Both matter here: `parseLocusString` branches on
 * the exact string `'All'`, and a lowercase table would send the gesture down a
 * `wholeChr` path production never takes.
 */
import State from '../../js/hicState.js'

const CHROMOSOMES = [
    {index: 0, name: 'All', size: 3000000000},
    {index: 1, name: 'chr1', size: 250000000},
    {index: 2, name: 'chr2', size: 240000000},
    {index: 3, name: 'chr3', size: 200000000},
]

/** The single-chromosome table: the whole-genome entry plus one scaffold. */
const SOLE_SCAFFOLD = CHROMOSOMES.slice(0, 2)

const BIN_SIZES = [2500000, 1000000, 500000, 250000, 100000, 50000, 25000, 10000, 5000]

export const VIEW_DIMENSIONS = {width: 800, height: 800}

/** The rung the gesture starts on, and the floor it is asked to fall below. */
export const START_ZOOM = 3
export const START_PIXEL_SIZE = 4

/**
 * @param {object} [options]
 * @param {boolean} [options.resolutionLocked]
 * @param {boolean} [options.isSingleChromosome]
 */
export function createGestureBrowser({resolutionLocked = false, isSingleChromosome = false} = {}) {
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
    }

    return {
        dataset,
        resolutionLocked,
        // Rung 3 with rung 3 as the floor: any coarser match falls below it,
        // which is the branch these tests are about.
        state: new State(1, 1, START_ZOOM, 200, 200, START_PIXEL_SIZE, 'NONE'),
        minZoom: async () => START_ZOOM,
        minPixelSize: async () => 1,
        getResolutions: () => resolutions,
        binSizeForZoom: zoom => BIN_SIZES[zoom],
        genome: {
            getChromosome: name =>
                chromosomes.find(chromosome => chromosome.name.toLowerCase() === String(name).toLowerCase()),
        },
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
