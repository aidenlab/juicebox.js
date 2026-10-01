import {describe, it, expect} from 'vitest'
import Genome from '../js/genome.js'
import {locusAtPixel, placeLocus} from '../js/crosshairsLocus.js'

/**
 * The genomic identity of the crosshairs: a pointer pixel to a locus, and a
 * locus back into a panel's own pixels. #706, ADR-0020 decision 3.
 *
 * Every expected number below is worked by hand from the panel it is read in,
 * and stated beside the panel, so no assertion recomputes what the code does.
 */

const MB = 1000000

function table(names, sizes) {
    const real = names.map((name, i) => ({index: i + 1, name, size: sizes[name]}))
    // `All` is sized in kb, as every real dataset sizes it.
    return [{index: 0, name: 'All', size: 230000}, ...real]
}

const SIZES = {chr1: 100 * MB, chr2: 80 * MB, chr3: 50 * MB}

/**
 * A panel: what a browser holds that says where a locus falls on its screen.
 * The whole-genome bin is 500 kb, so the 230 Mb genome is 460 bins.
 */
function panel(names, state, viewDimensions, sizes = SIZES) {
    const chromosomes = table(names, sizes)
    const dataset = {
        chromosomes,
        wholeGenomeResolution: 500000,
        isWholeGenome: index => 0 === index,
        binSizeForZoom: () => 1000,
    }
    return {state, dataset, genome: new Genome('test', chromosomes), viewDimensions}
}

/**
 * chr1 by chr2 at 1 kb and 2 px per bin, from bin 100 by bin 200, 800 x 600 px:
 * a pixel is 500 bp, x shows 100 kb - 500 kb of chr1, y 200 kb - 500 kb of chr2.
 */
function chromosomePanel(names = ['chr1', 'chr2', 'chr3']) {
    return panel(names, {chr1: 1, chr2: 2, x: 100, y: 200, zoom: 0, pixelSize: 2}, {width: 800, height: 600})
}

describe('crosshairs locus', () => {

    describe('in a chromosome view', () => {

        it('resolves a pointer pixel to a chromosome name and bp on each axis', () => {
            expect(locusAtPixel({x: 40, y: 60}, chromosomePanel()))
                .toEqual({chr1: 'chr1', xBP: 120000, chr2: 'chr2', yBP: 230000})
        })

        it('places that locus back on the pixel it came from', () => {
            const view = chromosomePanel()

            expect(placeLocus(locusAtPixel({x: 40, y: 60}, view), view)).toEqual({x: 40, y: 60})
        })

        it('places a locus in a peer on a different rung and viewport by genomic position', () => {
            // 4 px per 1 kb bin from bin 110 by bin 220: 250 bp per pixel.
            const peer = panel(['chr1', 'chr2', 'chr3'],
                {chr1: 1, chr2: 2, x: 110, y: 220, zoom: 0, pixelSize: 4}, {width: 400, height: 400})

            expect(placeLocus({chr1: 'chr1', xBP: 120000, chr2: 'chr2', yBP: 230000}, peer)).toEqual({x: 40, y: 40})
        })

        it('reports an axis before the start of the view as off-screen', () => {
            expect(placeLocus({chr1: 'chr1', xBP: 50000, chr2: 'chr2', yBP: 230000}, chromosomePanel()))
                .toEqual({x: null, y: 60})
        })

        it('reports an axis past the end of the view as off-screen', () => {
            expect(placeLocus({chr1: 'chr1', xBP: 120000, chr2: 'chr2', yBP: 500000}, chromosomePanel()))
                .toEqual({x: 40, y: null})
        })

        it('reports an axis on a chromosome the panel is not showing as off-screen', () => {
            expect(placeLocus({chr1: 'chr3', xBP: 120000, chr2: 'chr2', yBP: 230000}, chromosomePanel()))
                .toEqual({x: null, y: 60})
        })

        it('reports an axis on a chromosome the panel does not carry as off-screen', () => {
            expect(placeLocus({chr1: 'chrUn', xBP: 120000, chr2: 'chr2', yBP: 230000}, chromosomePanel()))
                .toEqual({x: null, y: 60})
        })

        it('reports an axis past the end of the panel\'s own chromosome as off-screen', () => {
            // A peer's chr1 may be longer than this panel's 100 Mb one. From bin 99,990 the view runs past its end.
            const view = panel(['chr1', 'chr2', 'chr3'],
                {chr1: 1, chr2: 2, x: 99990, y: 200, zoom: 0, pixelSize: 2}, {width: 800, height: 600})

            expect(placeLocus({chr1: 'chr1', xBP: 100 * MB + 5000, chr2: 'chr2', yBP: 230000}, view))
                .toEqual({x: null, y: 60})
        })

        it('names the end of the chromosome for a pointer past it', () => {
            // chr1 ends at bin 100,000, 20 px into a view starting at bin 99,990; 40 px is past it.
            const view = panel(['chr1', 'chr2', 'chr3'],
                {chr1: 1, chr2: 2, x: 99990, y: 200, zoom: 0, pixelSize: 2}, {width: 800, height: 600})

            expect(locusAtPixel({x: 40, y: 60}, view)).toEqual({chr1: 'chr1', xBP: 100 * MB, chr2: 'chr2', yBP: 230000})
        })

        it('reads the bin size of the rung the panel is on, the sentinel rung included', () => {
            // A single-chromosome assembly at the sentinel rung (ADR-0010): 200 kb bins, 2 px each.
            const view = panel(['chr1'], {chr1: 1, chr2: 1, x: 0, y: 0, zoom: -1, pixelSize: 2},
                {width: 1000, height: 1000})
            view.dataset.binSizeForZoom = zoom => -1 === zoom ? 200000 : 1000

            const locus = locusAtPixel({x: 40, y: 60}, view)
            expect(locus).toEqual({chr1: 'chr1', xBP: 4 * MB, chr2: 'chr1', yBP: 6 * MB})
            expect(placeLocus(locus, view)).toEqual({x: 40, y: 60})
        })

        it('places a locus named in a peer\'s chromosome spelling', () => {
            expect(placeLocus({chr1: '1', xBP: 120000, chr2: '2', yBP: 230000}, chromosomePanel()))
                .toEqual({x: 40, y: 60})
        })
    })

    describe('in the whole-genome view', () => {

        const WHOLE_GENOME = {chr1: 0, chr2: 0, x: 0, y: 0, zoom: 0, pixelSize: 2}

        /** 2 px per 500 kb bin: a pixel is 250 kb, and the genome is 920 px. */
        function wholeGenomePanel(names = ['chr1', 'chr2', 'chr3']) {
            return panel(names, WHOLE_GENOME, {width: 920, height: 920})
        }

        it('names the real chromosome under the pointer, never All', () => {
            // x: 300 px is 75 Mb, inside chr1. y: 500 px is 125 Mb, 25 Mb into chr2.
            expect(locusAtPixel({x: 300, y: 500}, wholeGenomePanel()))
                .toEqual({chr1: 'chr1', xBP: 75 * MB, chr2: 'chr2', yBP: 25 * MB})
        })

        it('names the last chromosome for a pointer past the end of the genome', () => {
            // 230 Mb ends at 920 px; 940 px is 5 Mb past it, clamped to the end of chr3.
            expect(locusAtPixel({x: 940, y: 0}, wholeGenomePanel()))
                .toEqual({chr1: 'chr3', xBP: 50 * MB, chr2: 'chr1', yBP: 0})
        })

        it('places that locus back on the pixel it came from', () => {
            const view = wholeGenomePanel()

            expect(placeLocus(locusAtPixel({x: 300, y: 500}, view), view)).toEqual({x: 300, y: 500})
        })

        it('lands on the same chromosome and bp in a peer that orders its chromosomes differently', () => {
            // chr3, chr2, chr1 at 1 px per bin: chr1 starts at 130 Mb and chr2 at 50 Mb.
            const peer = panel(['chr3', 'chr2', 'chr1'], {...WHOLE_GENOME, pixelSize: 1}, {width: 460, height: 460})

            // chr1:75 Mb is 205 Mb, bin 410; chr2:25 Mb is 75 Mb, bin 150.
            const placed = placeLocus({chr1: 'chr1', xBP: 75 * MB, chr2: 'chr2', yBP: 25 * MB}, peer)
            expect(placed).toEqual({x: 410, y: 150})

            expect(locusAtPixel(placed, peer)).toEqual({chr1: 'chr1', xBP: 75 * MB, chr2: 'chr2', yBP: 25 * MB})
        })

        it('places a whole-genome locus into a peer showing that chromosome pair', () => {
            // chr1 by chr2 at 100 kb per bin, 2 px per bin, from the origin: 50 kb per pixel.
            const peer = panel(['chr1', 'chr2', 'chr3'],
                {chr1: 1, chr2: 2, x: 0, y: 0, zoom: 0, pixelSize: 2}, {width: 2000, height: 2000})
            peer.dataset.binSizeForZoom = () => 100000

            expect(placeLocus({chr1: 'chr1', xBP: 75 * MB, chr2: 'chr2', yBP: 25 * MB}, peer))
                .toEqual({x: 1500, y: 500})
        })

        it('reports an axis past the end of the panel\'s own chromosome as off-screen, not inside the next one', () => {
            // chr1:105 Mb does not exist here; laid end to end it would fall 5 Mb into chr2.
            expect(placeLocus({chr1: 'chr1', xBP: 105 * MB, chr2: 'chr2', yBP: 25 * MB}, wholeGenomePanel()))
                .toEqual({x: null, y: 500})
        })

        it('reports an axis panned out of a zoomed whole-genome view as off-screen', () => {
            // 4 px per bin from bin 200: x shows 100 Mb - 215 Mb.
            const peer = panel(['chr1', 'chr2', 'chr3'],
                {...WHOLE_GENOME, x: 200, pixelSize: 4}, {width: 920, height: 920})

            // chr1:75 Mb is before the view; chr2:25 Mb is 125 Mb, bin 250, 1000 px down -- past 920.
            expect(placeLocus({chr1: 'chr1', xBP: 75 * MB, chr2: 'chr2', yBP: 25 * MB}, peer))
                .toEqual({x: null, y: null})
        })
    })
})
