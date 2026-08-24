import { describe, test, expect } from 'vitest'
import ContactMatrixView, { resolveFeatureAxes, featureDrawPasses } from '../js/contactMatrixView.js'

/**
 * Geometry decisions behind render2DTracks. These are the two pieces of the
 * inter-chromosomal rendering bug (#430) that can be reasoned about without a
 * canvas.
 */

// chr1/chr2 as stored on the feature; x is the chr1 range, y is the chr2 range.
const feature = { chr1: 'chr1', chr2: 'chr5', x1: 100, x2: 200, y1: 3000, y2: 4000 }

describe('resolveFeatureAxes', () => {
    test('feature order matching the axes, lower pass: x range on x, y range on y', () => {
        expect(resolveFeatureAxes(feature, 'chr1', false))
            .toEqual({ xS: 100, xE: 200, yS: 3000, yE: 4000 })
    })

    test('feature order reversed relative to the axes: ranges swap', () => {
        // Viewing chr5 on x and chr1 on y. The feature is stored chr1-first, so
        // its x range belongs on the y axis.
        expect(resolveFeatureAxes(feature, 'chr5', false))
            .toEqual({ xS: 3000, xE: 4000, yS: 100, yE: 200 })
    })

    test('upper pass mirrors across the diagonal', () => {
        expect(resolveFeatureAxes(feature, 'chr1', true))
            .toEqual({ xS: 3000, xE: 4000, yS: 100, yE: 200 })
    })

    test('reversed order and upper pass cancel out', () => {
        expect(resolveFeatureAxes(feature, 'chr5', true))
            .toEqual({ xS: 100, xE: 200, yS: 3000, yE: 4000 })
    })

    test('intra-chromosomal features are never treated as reversed', () => {
        const intra = { chr1: 'chr8', chr2: 'chr8', x1: 10, x2: 20, y1: 30, y2: 40 }
        expect(resolveFeatureAxes(intra, 'chr8', false))
            .toEqual({ xS: 10, xE: 20, yS: 30, yE: 40 })
    })
})

describe('featureDrawPasses', () => {
    test('intra-chromosomal COLLAPSED draws both triangles', () => {
        expect(featureDrawPasses('COLLAPSED', true)).toEqual([ false, true ])
    })

    test('intra-chromosomal undefined display mode behaves as COLLAPSED', () => {
        expect(featureDrawPasses(undefined, true)).toEqual([ false, true ])
    })

    test('intra-chromosomal lower and upper draw one triangle each', () => {
        expect(featureDrawPasses('lower', true)).toEqual([ false ])
        expect(featureDrawPasses('upper', true)).toEqual([ true ])
    })

    test('an unrecognized display mode draws nothing', () => {
        expect(featureDrawPasses('nonsense', true)).toEqual([])
        expect(featureDrawPasses('nonsense', false)).toEqual([])
    })

    test('inter-chromosomal views draw a single un-mirrored pass', () => {
        // There is no diagonal to reflect across, so the mirrored pass would put
        // a phantom copy of every feature at transposed coordinates.
        expect(featureDrawPasses('COLLAPSED', false)).toEqual([ false ])
        expect(featureDrawPasses(undefined, false)).toEqual([ false ])
        expect(featureDrawPasses('lower', false)).toEqual([ false ])
        expect(featureDrawPasses('upper', false)).toEqual([ false ])
    })
})

/**
 * render2DTracks end to end, against a recording 2D context. Covers the call
 * site the pure helpers cannot: which chromosome pair the features are fetched
 * for, and where the rectangles land.
 */

const BIN_SIZE = 1000
const PIXEL_SIZE = 1
const VIEWPORT = 800

function createView({ chr1, chr2, features, displayMode }) {

    const strokeRects = []
    const getFeaturesCalls = []

    const chromosomes = [
        { name: 'All', size: 1000000 },
        { name: 'chr1', size: 1000000 },
        { name: 'chr5', size: 1000000 },
    ]

    const zoomData = {
        chr1: { name: chromosomes[chr1].name, index: chr1 },
        chr2: { name: chromosomes[chr2].name, index: chr2 },
        zoom: { binSize: BIN_SIZE },
    }

    const view = Object.create(ContactMatrixView.prototype)
    view.viewportElement = { offsetWidth: VIEWPORT, offsetHeight: VIEWPORT }
    view.ctx = {
        save: () => {},
        restore: () => {},
        strokeRect: (x, y, w, h) => strokeRects.push({ x, y, w, h }),
    }

    const dataset = {
        chromosomes,
        getMatrix: async () => ({ getZoomDataByIndex: () => zoomData }),
        // An identity at a declared rung. The sentinel rung has its own suite.
        matrixViewForZoom: (chr1, chr2, zoom) => ({ chr1, chr2, zoomIndex: zoom }),
    }
    const state = { chr1, chr2, zoom: 0, x: 0, y: 0, pixelSize: PIXEL_SIZE }

    const track2D = {
        isVisible: true,
        displayMode,
        color: 'red',
        getFeatures: (a, b) => {
            getFeaturesCalls.push([ a, b ])
            return features
        },
    }

    return { view, dataset, state, track2D, strokeRects, getFeaturesCalls }
}

describe('render2DTracks', () => {

    // chr1 index 1, chr5 index 2 — an inter-chromosomal view.
    const interChrFeature = { chr1: 'chr1', chr2: 'chr5', x1: 10000, x2: 20000, y1: 50000, y2: 60000, color: 'blue' }

    test('features are fetched for both axes, not chr1 twice', async () => {
        const { view, dataset, state, track2D, getFeaturesCalls } =
            createView({ chr1: 1, chr2: 2, features: [ interChrFeature ] })

        await view.render2DTracks([ track2D ], dataset, state)

        expect(getFeaturesCalls).toEqual([[ 'chr1', 'chr5' ]])
    })

    test('an inter-chromosomal feature is drawn once, at its own axes', async () => {
        const { view, dataset, state, track2D, strokeRects } =
            createView({ chr1: 1, chr2: 2, features: [ interChrFeature ] })

        await view.render2DTracks([ track2D ], dataset, state)

        // bpPerPixel = binSize/pixelSize = 1000; origin is 1bp.
        expect(strokeRects).toEqual([{ x: 9, y: 49, w: 10, h: 10 }])
    })

    test('a feature stored in reversed chromosome order lands on the right axes', async () => {
        // Same feature, viewed with chr5 on x and chr1 on y. Its x range
        // describes chr1, so it must be drawn on the y axis.
        const { view, dataset, state, track2D, strokeRects, getFeaturesCalls } =
            createView({ chr1: 2, chr2: 1, features: [ interChrFeature ] })

        await view.render2DTracks([ track2D ], dataset, state)

        expect(getFeaturesCalls).toEqual([[ 'chr5', 'chr1' ]])
        expect(strokeRects).toEqual([{ x: 49, y: 9, w: 10, h: 10 }])
    })

    test('an intra-chromosomal feature is still reflected across the diagonal', async () => {
        const intra = { chr1: 'chr1', chr2: 'chr1', x1: 10000, x2: 20000, y1: 50000, y2: 60000, color: 'blue' }
        const { view, dataset, state, track2D, strokeRects } =
            createView({ chr1: 1, chr2: 1, features: [ intra ] })

        await view.render2DTracks([ track2D ], dataset, state)

        expect(strokeRects).toEqual([
            { x: 9, y: 49, w: 10, h: 10 },
            { x: 49, y: 9, w: 10, h: 10 },
        ])
    })

    test('an invisible track draws nothing and is not queried', async () => {
        const { view, dataset, state, track2D, strokeRects, getFeaturesCalls } =
            createView({ chr1: 1, chr2: 2, features: [ interChrFeature ] })
        track2D.isVisible = false

        await view.render2DTracks([ track2D ], dataset, state)

        expect(getFeaturesCalls).toEqual([])
        expect(strokeRects).toEqual([])
    })

    test('a feature outside the view is trivially rejected', async () => {
        const offscreen = { chr1: 'chr1', chr2: 'chr5', x1: 900000, x2: 910000, y1: 900000, y2: 910000 }
        const { view, dataset, state, track2D, strokeRects } =
            createView({ chr1: 1, chr2: 2, features: [ offscreen ] })

        await view.render2DTracks([ track2D ], dataset, state)

        expect(strokeRects).toEqual([])
    })
})
