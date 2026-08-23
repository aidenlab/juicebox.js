/**
 * The dataset a restore lands on, standing in for a `.hic` file.
 *
 * `test/utils/stubbedLoads.js` stubs `loadHicFile` *whole*, which is exactly
 * wrong for #557: `loadHicFile` is the ladder under test. So the seam moves one
 * step out to the thing behind it -- `Dataset.loadDataset`, the network read --
 * and everything above it runs for real: the ladder, `browser.setState`,
 * `State.setView`, `clampXY`, `browser.minPixelSize`.
 *
 * That makes the stub load-bearing in a way `stubbedLoads`' is not. Three of the
 * numbers in the golden are read off it, so it carries real ones:
 *
 * - **chromosome sizes** are hg19's. `clampXY` bounds the origin at
 *   `chromosomes[chr].size / binSize - viewport / pixelSize`, so a made-up size
 *   would make every clamp in the file fictional.
 * - **`bpResolutions`** is the standard nine-entry juicer ladder. The corpus's
 *   harvested states carry zoom indices up to 7; a shorter array would turn a
 *   real fixture into an out-of-range one.
 * - **`getMatrix`** answers with the zoom record `browser.minPixelSize` reads,
 *   which is what puts the stated viewport into `pixelSize`.
 *
 * Nothing here reads a byte or a pixel. `getNormVectorIndex` is deliberately
 * absent rather than stubbed: `loadHicFile` guards on its presence, so omitting
 * it is how a test says "no normalization vector index", and a fixture carrying
 * `nvi=` takes that branch honestly.
 */

/** hg19, the genome every harvested fixture in the corpus was published against. */
const HG19 = [
    ['chr1', 249250621], ['chr2', 243199373], ['chr3', 198022430], ['chr4', 191154276],
    ['chr5', 180915260], ['chr6', 171115067], ['chr7', 159138663], ['chr8', 146364022],
    ['chr9', 141213431], ['chr10', 135534747], ['chr11', 135006516], ['chr12', 133851895],
    ['chr13', 115169878], ['chr14', 107349540], ['chr15', 102531392], ['chr16', 90354753],
    ['chr17', 81195210], ['chr18', 78077248], ['chr19', 59128983], ['chr20', 63025520],
    ['chr21', 48129895], ['chr22', 51304566], ['chrX', 155270560], ['chrY', 59373566],
]

/** The standard juicer resolution ladder, coarsest first — `zoom` indexes this. */
const BP_RESOLUTIONS = [2500000, 1000000, 500000, 250000, 100000, 50000, 25000, 10000, 5000]

function chromosomes() {
    const named = HG19.map(([name, size], i) => ({index: i + 1, name, size}))
    const wholeGenome = {index: 0, name: 'All', size: named.reduce((sum, c) => sum + c.size, 0)}
    return [wholeGenome, ...named]
}

/**
 * The zoom record `minPixelSize` and `minZoom` read. `findZoomForResolution`
 * mirrors `browser.findMatchingZoomIndex`: the finest index whose bin is still
 * no smaller than the target, floored at the whole-genome resolution.
 */
function matrix() {
    return {
        getZoomDataByIndex(index, unit) {
            const binSize = BP_RESOLUTIONS[index]
            return binSize === undefined ? undefined : {zoom: {index, unit, binSize}}
        },
        findZoomForResolution(binSize) {
            for (let z = BP_RESOLUTIONS.length - 1; z > 0; z--) {
                if (BP_RESOLUTIONS[z] >= binSize) return z
            }
            return 0
        },
    }
}

/**
 * @param {object} [config] — the config the loader was called with, so the
 *   dataset can echo the identity `loadHicFile` then reads back off it.
 */
export function restoreDataset(config = {}) {

    const chrs = chromosomes()

    return {
        url: config.url,
        name: config.name,
        // hg19 unless the caller names another. The override exists for the
        // sync suites, whose whole question is whether two datasets name the
        // same genome; nothing in the restore corpus passes one.
        genomeId: config.genomeId || 'hg19',
        datasetType: 'hic',
        chromosomes: chrs,
        bpResolutions: BP_RESOLUTIONS,
        isCompatible(other) {
            return other?.genomeId === this.genomeId
        },
        isWholeGenome(chrIndex) {
            return chrIndex === 0
        },
        getChrIndexFromName(name) {
            const found = chrs.find(c => c.name.toLowerCase() === String(name).toLowerCase())
            return found === undefined ? undefined : found.index
        },
        async getMatrix() {
            return matrix()
        },
        hicFile: {config: {nvi: config.nvi}},
    }
}
