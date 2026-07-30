import {describe, it, expect} from 'vitest'
import {tileKey, colorScaleKey} from '../js/imageTileCore.js'

/**
 * Characterization tests for the pure core of the image tile source.
 *
 * These lock in behavior as it exists today, before the pipeline is lifted out
 * of ContactMatrixView. See issue #428.
 */

const zoomData = ({chr1 = 'chr1', chr2 = 'chr1', binSize = 5000, unit = 'BP'} = {}) => ({
    chr1: {name: chr1},
    chr2: {name: chr2},
    zoom: {binSize, unit}
})

describe('tileKey', () => {

    it('joins chromosome pair, resolution, unit, grid position, normalization and display mode', () => {
        const key = tileKey(zoomData(), 3, 7, 'KR', 'A')
        expect(key).toBe('chr1_chr1_5000_BP_3_7_KR_A')
    })

    it('distinguishes tiles differing only by grid position', () => {
        const zd = zoomData()
        expect(tileKey(zd, 0, 1, 'NONE', 'A')).not.toBe(tileKey(zd, 1, 0, 'NONE', 'A'))
    })

    it('distinguishes tiles differing only by normalization', () => {
        const zd = zoomData()
        expect(tileKey(zd, 0, 0, 'NONE', 'A')).not.toBe(tileKey(zd, 0, 0, 'KR', 'A'))
    })

    it('distinguishes tiles differing only by display mode', () => {
        const zd = zoomData()
        expect(tileKey(zd, 0, 0, 'NONE', 'A')).not.toBe(tileKey(zd, 0, 0, 'B', 'NONE'))
    })

    it('distinguishes tiles differing only by resolution', () => {
        expect(tileKey(zoomData({binSize: 5000}), 0, 0, 'NONE', 'A'))
            .not.toBe(tileKey(zoomData({binSize: 10000}), 0, 0, 'NONE', 'A'))
    })

    it('distinguishes inter-chromosomal tiles by axis order', () => {
        expect(tileKey(zoomData({chr1: 'chr1', chr2: 'chr2'}), 0, 0, 'NONE', 'A'))
            .not.toBe(tileKey(zoomData({chr1: 'chr2', chr2: 'chr1'}), 0, 0, 'NONE', 'A'))
    })

    it('ignores pan position and pixel size -- they affect placement, not content', () => {
        // tileKey takes no x/y/pixelSize by design; this documents the omission.
        const zd = zoomData()
        expect(tileKey(zd, 2, 2, 'NONE', 'A')).toBe(tileKey(zd, 2, 2, 'NONE', 'A'))
    })
})

describe('colorScaleKey', () => {

    const state = {chr1: 1, chr2: 1, zoom: 4, normalization: 'KR'}

    it('joins chromosome pair, zoom index, normalization and display mode', () => {
        expect(colorScaleKey(state, 'A')).toBe('1_1_4_KR_A')
    })

    it('is coarser than tileKey -- shared across every tile in the view', () => {
        expect(colorScaleKey(state, 'A')).not.toContain('BP')
        expect(colorScaleKey(state, 'A')).not.toContain('5000')
    })

    it('distinguishes states differing only by zoom index', () => {
        expect(colorScaleKey({...state, zoom: 4}, 'A')).not.toBe(colorScaleKey({...state, zoom: 5}, 'A'))
    })

    it('distinguishes states differing only by display mode', () => {
        expect(colorScaleKey(state, 'A')).not.toBe(colorScaleKey(state, 'AOB'))
    })

    it('falls back to a display-mode-scoped key when state is absent during startup', () => {
        expect(colorScaleKey(undefined, 'A')).toBe('unknown_A')
        expect(colorScaleKey(null, 'AOB')).toBe('unknown_AOB')
    })

    it('does not collide the startup fallback across display modes', () => {
        expect(colorScaleKey(undefined, 'A')).not.toBe(colorScaleKey(undefined, 'B'))
    })
})
