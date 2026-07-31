import {describe, it, expect} from 'vitest'
import ColorScaleWidget from '../js/hicColorScaleWidget.js'
import ColorScale from '../js/colorScale.js'
import RatioColorScale from '../js/ratioColorScale.js'

// updateForColorScale is the widget's whole update path: BrowserCoordinator
// calls it directly from onColorScale and onDisplayMode. Exercise it on a stub
// so the test needs no DOM beyond the three elements the method touches. The
// input stub stringifies on assignment, as a real <input> does.
function stubWidget() {
    return {
        highColorscaleInput: {
            _value: '',
            get value() { return this._value },
            set value(v) { this._value = String(v) }
        },
        plusButton: {style: {}},
        minusButton: {style: {}},
        updateForColorScale: ColorScaleWidget.prototype.updateForColorScale
    }
}

describe('ColorScaleWidget.updateForColorScale', () => {

    it('shows the scale threshold in the input', () => {
        const widget = stubWidget()
        widget.updateForColorScale(new ColorScale({threshold: 1234, r: 0, g: 0, b: 255}))
        expect(widget.highColorscaleInput.value).toBe('1234')
    })

    it('hides the minus swatch for a single-sided scale and paints the plus swatch', () => {
        const widget = stubWidget()
        widget.updateForColorScale(new ColorScale({threshold: 2000, r: 0, g: 0, b: 255}))
        expect(widget.minusButton.style.display).toBe('none')
        expect(widget.plusButton.style.backgroundColor).toBe('#0000ff')
    })

    it('reveals the minus swatch for a signed scale and paints both sides', () => {
        const widget = stubWidget()
        widget.updateForColorScale(new RatioColorScale(5))
        expect(widget.minusButton.style.display).toBe('block')
        expect(widget.minusButton.style.backgroundColor).toBeDefined()
        expect(widget.plusButton.style.backgroundColor).toBeDefined()
        expect(widget.minusButton.style.backgroundColor)
            .not.toBe(widget.plusButton.style.backgroundColor)
    })

    // The coordinator passes contactMatrixView.getColorScale(mode), which is
    // undefined before a map is loaded.
    it('is a no-op when handed no scale', () => {
        const widget = stubWidget()
        widget.updateForColorScale(undefined)
        expect(widget.highColorscaleInput.value).toBe('')
        expect(widget.minusButton.style.display).toBeUndefined()
    })
})
