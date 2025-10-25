/*
 * CoordinateTransformer - Pure utility functions for coordinate transformations
 * Extracted from HICBrowser for better separation of concerns and testability
 */

class CoordinateTransformer {
    /**
     * Calculate genomic state for a given axis
     * @param {Object} dataset - The dataset object
     * @param {Object} state - The browser state
     * @param {Object} contactMatrixView - The contact matrix view
     * @param {Object} genome - The genome object
     * @param {string} axis - Either 'x' or 'y'
     * @returns {Object} Genomic state object
     */
    static genomicState(dataset, state, contactMatrixView, genome, axis) {
        let width = contactMatrixView.getViewDimensions().width;
        let resolution = dataset.bpResolutions[state.zoom];
        const bpp =
            (dataset.chromosomes[state.chr1].name.toLowerCase() === "all") ?
                genome.getGenomeLength() / width :
                resolution / state.pixelSize;

        const gs = { bpp };

        if (axis === "x") {
            gs.chromosome = dataset.chromosomes[state.chr1];
            gs.startBP = state.x * resolution;
            gs.endBP = gs.startBP + bpp * width;
        } else {
            gs.chromosome = dataset.chromosomes[state.chr2];
            gs.startBP = state.y * resolution;
            gs.endBP = gs.startBP + bpp * contactMatrixView.getViewDimensions().height;
        }
        return gs;
    }

    /**
     * Get current resolution from dataset and state
     * @param {Object} dataset - The dataset object
     * @param {Object} state - The browser state
     * @returns {number} Current resolution
     */
    static resolution(dataset, state) {
        return dataset.bpResolutions[state.zoom];
    }

    /**
     * Find the closest matching zoom index for the target resolution
     * @param {number} targetResolution - Target resolution to find
     * @param {Array} resolutionArray - Array of resolutions or objects with index and binSize
     * @returns {number} Matching zoom index
     */
    static findMatchingZoomIndex(targetResolution, resolutionArray) {
        const isObject = resolutionArray.length > 0 && resolutionArray[0].index !== undefined;
        for (let z = resolutionArray.length - 1; z > 0; z--) {
            const binSize = isObject ? resolutionArray[z].binSize : resolutionArray[z];
            const index = isObject ? resolutionArray[z].index : z;
            if (binSize >= targetResolution) {
                return index;
            }
        }
        return 0;
    }
}

export default CoordinateTransformer;
