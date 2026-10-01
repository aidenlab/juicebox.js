/**
 * The genomic identity of the crosshairs: the locus under a pointer pixel, and
 * the inverse -- where a locus falls in a panel's own pixels. ADR-0020
 * decision 3.
 *
 * A locus is `{chr1, xBP, chr2, yBP}`: a chromosome name and bp per axis. It is
 * what crosses a sync group, so it names a **real** chromosome even when it is
 * read off the whole-genome view -- two peers may order their chromosomes
 * differently, and `All` plus a cumulative bp would then mark different loci.
 *
 * Pure. A *view* here is the four things that say where a locus falls on a
 * panel's screen -- `{state, dataset, genome, viewDimensions}` -- which a
 * browser holds and a test can state.
 *
 * Chromosome starts are summed here rather than read from
 * `Genome.getCumulativeOffset`, which skips `All` by the lowercase name and so
 * counts its kb size into every offset.
 */

/**
 * The locus under a viewport pixel.
 *
 * @param {{x: number, y: number}} pixel - viewport pixels
 * @param {{state, dataset}} view
 * @returns {{chr1: string, xBP: number, chr2: string, yBP: number}}
 */
function locusAtPixel({x, y}, {state, dataset}) {
    // A pointer past either end of what is drawn names the nearest end.
    const xAxis = axisLocus(x, state.chr1, state.x, state, dataset)
    const yAxis = axisLocus(y, state.chr2, state.y, state, dataset)
    return {chr1: xAxis.chr, xBP: xAxis.bp, chr2: yAxis.chr, yBP: yAxis.bp}
}

/**
 * Where a locus falls in a panel, in viewport pixels. An axis whose position
 * the panel is not showing -- out of view, on another chromosome, or on a
 * chromosome the panel does not carry -- is `null`, not a pixel.
 *
 * @param {{chr1: string, xBP: number, chr2: string, yBP: number}} locus
 * @param {{state, dataset, genome, viewDimensions: {width: number, height: number}}} view
 * @returns {{x: number|null, y: number|null}}
 */
function placeLocus({chr1, xBP, chr2, yBP}, {state, dataset, genome, viewDimensions}) {
    return {
        x: axisPixel(chr1, xBP, state.chr1, state.x, viewDimensions.width, state, dataset, genome),
        y: axisPixel(chr2, yBP, state.chr2, state.y, viewDimensions.height, state, dataset, genome),
    }
}

function axisLocus(pixel, chrIndex, origin, state, dataset) {
    const bin = origin + pixel / state.pixelSize

    if (!dataset.isWholeGenome(chrIndex)) {
        const {name, size} = dataset.chromosomes[chrIndex]
        return {chr: name, bp: clamp(bin * dataset.binSizeForZoom(state.zoom), 0, size)}
    }

    // The whole-genome view lays the real chromosomes end to end in the
    // dataset's own order; walk them to find the one this position is in.
    const genomeBP = Math.max(0, bin * dataset.wholeGenomeResolution)
    const chromosomes = realChromosomes(dataset)
    let offset = 0
    for (const chromosome of chromosomes) {
        if (genomeBP < offset + chromosome.size) {
            return {chr: chromosome.name, bp: genomeBP - offset}
        }
        offset += chromosome.size
    }
    const last = chromosomes[chromosomes.length - 1]
    return {chr: last.name, bp: last.size}
}

function axisPixel(chrName, bp, chrIndex, origin, extent, state, dataset, genome) {

    // The receiver's own lookup, aliases included: a peer may spell the
    // chromosome `1` where this panel spells it `chr1` (ADR-0016 decision 3).
    const chromosome = genome.getChromosome(chrName)
    if (undefined === chromosome) return null

    // A peer's chromosome of the same name may be longer. Past this panel's
    // own end there is nothing to mark -- and in the whole-genome view the
    // position would otherwise land inside the next chromosome.
    if (bp < 0 || bp > chromosome.size) return null

    let bin
    if (dataset.isWholeGenome(chrIndex)) {
        bin = (cumulativeOffset(chromosome, dataset) + bp) / dataset.wholeGenomeResolution
    } else if (chromosome.index === chrIndex) {
        bin = bp / dataset.binSizeForZoom(state.zoom)
    } else {
        return null
    }

    const pixel = (bin - origin) * state.pixelSize
    return pixel >= 0 && pixel < extent ? pixel : null
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
}

/** The bp at which a chromosome starts in this dataset's whole-genome view. */
function cumulativeOffset(chromosome, dataset) {
    let offset = 0
    for (const candidate of realChromosomes(dataset)) {
        if (candidate.index === chromosome.index) break
        offset += candidate.size
    }
    return offset
}

/** The chromosome table without `All`, which is a zoom rung and not a chromosome (ADR-0010). */
function realChromosomes(dataset) {
    return dataset.chromosomes.filter(chromosome => !dataset.isWholeGenome(chromosome.index))
}

export {locusAtPixel, placeLocus}
