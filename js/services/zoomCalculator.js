/*
 * ZoomCalculator - Handles zoom constraint calculations
 * Extracted from HICBrowser for better separation of concerns
 */

class ZoomCalculator {
    /**
     * Calculate minimum zoom level for given chromosomes
     * @param {number} chr1 - First chromosome index
     * @param {number} chr2 - Second chromosome index
     * @param {Object} dataset - The dataset object
     * @param {Object} contactMatrixView - The contact matrix view
     * @returns {Promise<number>} Minimum zoom index
     */
    static async minZoom(chr1, chr2, dataset, contactMatrixView) {
        const chromosome1 = dataset.chromosomes[chr1];
        const chromosome2 = dataset.chromosomes[chr2];

        const { width, height } = contactMatrixView.getViewDimensions();
        const binSize = Math.max(chromosome1.size / width, chromosome2.size / height);

        const matrix = await dataset.getMatrix(chr1, chr2);
        if (!matrix) {
            throw new Error(`Data not available for chromosomes ${chromosome1.name} - ${chromosome2.name}`);
        }
        return matrix.findZoomForResolution(binSize);
    }

    /**
     * Calculate minimum pixel size for given chromosomes and zoom
     * @param {number} chr1 - First chromosome index
     * @param {number} chr2 - Second chromosome index
     * @param {number} zoomIndex - Zoom index
     * @param {Object} dataset - The dataset object
     * @param {Object} contactMatrixView - The contact matrix view
     * @returns {Promise<number>} Minimum pixel size
     */
    static async minPixelSize(chr1, chr2, zoomIndex, dataset, contactMatrixView) {
        // bp
        const chr1Length = dataset.chromosomes[chr1].size;
        const chr2Length = dataset.chromosomes[chr2].size;

        const matrix = await dataset.getMatrix(chr1, chr2);
        const { zoom } = matrix.getZoomDataByIndex(zoomIndex, "BP");

        // bin = bp * bin/bp = bin
        const nBins1 = chr1Length / zoom.binSize;
        const nBins2 = chr2Length / zoom.binSize;

        const { width, height } = contactMatrixView.getViewDimensions();

        // pixel/bin
        return Math.min(width / nBins1, height / nBins2);
    }
}

export default ZoomCalculator;
