import {describe, it, expect} from 'vitest'
import ColorScale, {defaultColorScaleConfig} from '../js/colorScale.js'
import {parseColorScale} from '../js/colorScaleParser.js'
import RatioColorScale, {defaultRatioColorScaleConfig} from '../js/ratioColorScale.js'
import DiffColorScale, {defaultDiffColorScaleConfig} from '../js/diffColorScale.js'

/**
 * The two-sided color scales: the ratio scale used by AOB / BOA, and the signed
 * difference scale used by AMB. See issue #426.
 */

describe('DiffColorScale', () => {

    const scale = () => new DiffColorScale()

    it('paints positive differences with the positive color', () => {
        const {red, green, blue} = scale().getColor(50)
        expect({red, green, blue}).toEqual({
            red: defaultDiffColorScaleConfig.positive.r,
            green: defaultDiffColorScaleConfig.positive.g,
            blue: defaultDiffColorScaleConfig.positive.b
        })
    })

    // The whole point of the signed scale: RatioColorScale takes Math.log of the
    // score, which is NaN for a negative difference, and NaN alpha coerces to a
    // fully transparent pixel. Half a difference map would silently vanish.
    it('paints negative differences with the negative color, opaquely', () => {
        const {red, green, blue, alpha} = scale().getColor(-50)
        expect({red, green, blue}).toEqual({
            red: defaultDiffColorScaleConfig.negative.r,
            green: defaultDiffColorScaleConfig.negative.g,
            blue: defaultDiffColorScaleConfig.negative.b
        })
        expect(alpha).toBeGreaterThan(0)
    })

    it('assigns equal alpha to differences of equal magnitude', () => {
        const cs = scale()
        expect(cs.getColor(-50).alpha).toBe(cs.getColor(50).alpha)
    })

    it('scales alpha linearly with magnitude', () => {
        const cs = new DiffColorScale(100)
        expect(cs.getColor(0).alpha).toBe(0)
        expect(cs.getColor(50).alpha).toBe(127)
        expect(cs.getColor(100).alpha).toBe(255)
    })

    it('clamps magnitudes beyond the threshold to full alpha', () => {
        const cs = new DiffColorScale(100)
        expect(cs.getColor(1000).alpha).toBe(255)
        expect(cs.getColor(-1000).alpha).toBe(255)
    })

    it('applies a new threshold to both sides', () => {
        const cs = new DiffColorScale(100)
        cs.setThreshold(50)
        expect(cs.getThreshold()).toBe(50)
        expect(cs.getColor(50).alpha).toBe(255)
        expect(cs.getColor(-50).alpha).toBe(255)
    })

    // The old RatioColorScale ignored the RGB in its config, so every caller
    // had to re-apply the colors after construction. Neither scale does now.
    it('takes its default threshold and colors from its config', () => {
        const cs = new DiffColorScale()
        expect(cs.getThreshold()).toBe(defaultDiffColorScaleConfig.threshold)
        expect(cs.getColorComponents('+')).toEqual(defaultDiffColorScaleConfig.positive)
        expect(cs.getColorComponents('-')).toEqual(defaultDiffColorScaleConfig.negative)
    })

    it('reads back the color components it was given', () => {
        const cs = scale()
        cs.setColorComponents({r: 1, g: 2, b: 3}, '+')
        cs.setColorComponents({r: 4, g: 5, b: 6}, '-')
        expect(cs.getColorComponents('+')).toEqual({r: 1, g: 2, b: 3})
        expect(cs.getColorComponents('-')).toEqual({r: 4, g: 5, b: 6})
    })
})

describe('RatioColorScale', () => {

    it('splits on the log of the score, not its sign', () => {
        const cs = new RatioColorScale()

        // Ratios are positive and centered on 1: below 1 is the negative side.
        const below = cs.getColor(0.2)
        const above = cs.getColor(5)
        expect(below.blue).toBe(defaultRatioColorScaleConfig.negative.b)
        expect(above.red).toBe(defaultRatioColorScaleConfig.positive.r)
        expect(below.alpha).toBe(above.alpha)
    })

    it('takes its default threshold and colors from its config', () => {
        const cs = new RatioColorScale()
        expect(cs.getThreshold()).toBe(defaultRatioColorScaleConfig.threshold)
        expect(cs.getColorComponents('+')).toEqual(defaultRatioColorScaleConfig.positive)
        expect(cs.getColorComponents('-')).toEqual(defaultRatioColorScaleConfig.negative)
    })
})

describe('parseColorScale', () => {

    it('round-trips a plain color scale', () => {
        const cs = new ColorScale({threshold: 2000, r: 255, g: 0, b: 0})
        const parsed = parseColorScale(cs.stringify())
        expect(parsed).toBeInstanceOf(ColorScale)
        expect(parsed.threshold).toBe(2000)
        expect(parsed.getColorComponents()).toEqual({r: 255, g: 0, b: 0})
    })

    // Harvested links carry a bare threshold with no RGB components (#514). A
    // missing component must fall back to the default color, not reach getColor
    // undefined and paint rgba(undefined,undefined,undefined,alpha).
    it('falls back to the default color for a bare threshold', () => {
        const parsed = parseColorScale('18.9')
        expect(parsed.getThreshold()).toBe(18.9)
        expect(parsed.getColorComponents()).toEqual({
            r: defaultColorScaleConfig.r,
            g: defaultColorScaleConfig.g,
            b: defaultColorScaleConfig.b
        })
        expect(parsed.getColor(18.9).rgbaString).toBe('rgba(255,0,0, 255)')
    })

    it('falls back per component when only some are supplied', () => {
        expect(parseColorScale('18.9,1,2').getColorComponents()).toEqual({
            r: 1,
            g: 2,
            b: defaultColorScaleConfig.b
        })
    })

    // parseSingle decodes both halves of a signed scale, and the two halves do
    // not share a default: red above the neutral point, blue below. A negative
    // half short of components must not come back red.
    it('defaults each half of a signed scale to that half\'s color', () => {
        const parsed = parseColorScale('R:5:5:5')
        expect(parsed.getColorComponents('+')).toEqual(defaultRatioColorScaleConfig.positive)
        expect(parsed.getColorComponents('-')).toEqual(defaultRatioColorScaleConfig.negative)
    })

    it('round-trips a ratio color scale', () => {
        const cs = new RatioColorScale(5)
        const parsed = parseColorScale(cs.stringify())
        expect(parsed).toBeInstanceOf(RatioColorScale)
        expect(parsed.getThreshold()).toBe(5)
        expect(parsed.getColorComponents('+')).toEqual(cs.getColorComponents('+'))
        expect(parsed.getColorComponents('-')).toEqual(cs.getColorComponents('-'))
    })

    it('round-trips a difference color scale', () => {
        const cs = new DiffColorScale(100)
        cs.setColorComponents({r: 1, g: 2, b: 3}, '+')
        const parsed = parseColorScale(cs.stringify())
        expect(parsed).toBeInstanceOf(DiffColorScale)
        expect(parsed.getThreshold()).toBe(100)
        expect(parsed.getColorComponents('+')).toEqual({r: 1, g: 2, b: 3})
    })

    it('keeps a difference scale distinguishable from a ratio scale', () => {
        expect(new DiffColorScale(100).stringify())
            .not.toBe(new RatioColorScale(100).stringify())
    })
})
