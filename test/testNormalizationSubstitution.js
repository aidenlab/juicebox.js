/**
 * A substitution is announced in the widget, never in a modal. #372, ADR-0012.
 *
 * *Substitution* is CONTEXT.md's word for rendering with a normalization other
 * than the one asked for, because the one asked for is not on offer. It is not
 * a failure -- a saved link that opens on `NONE` opened correctly -- which is
 * why the modal ADR-0012 deleted was the wrong surface and the widget is the
 * right one.
 *
 * What this file drives is the widget's own seam: the marker, the `title` that
 * carries the reason, and the three conditions that clear it. The other half of
 * the claim -- that a coerced restore reaches this seam at all -- is in
 * `testRestoreNormalization.js`, where a real browser runs a real load.
 *
 * The reason is transient by decision (ADR-0012 decision 2): it lives here and
 * nowhere else, so there is no eighth state field and nothing to serialize. The
 * clearing conditions are the three that can make it false -- a chromosome
 * change, a zoom change, and the user answering the question themselves. A pan
 * cannot, and the test that says so is what keeps the scope check from
 * collapsing into "clear on any locus change".
 */
import {describe, test, expect, beforeEach, afterEach} from 'vitest'
import {withDOM} from './utils/browserFixture.js'
import NormalizationWidget, {substitutionReason} from '../js/normalizationWidget.js'

/** The chr1 x chr1 view at zoom 3, and the neighbours it can move to. */
const VIEW = {chr1: 1, chr2: 1, zoom: 3, x: 10, y: 10}
const PANNED = {...VIEW, x: 400, y: 400}
const OTHER_CHROMOSOME = {...VIEW, chr1: 2, chr2: 2}
const OTHER_ZOOM = {...VIEW, zoom: 4}

describe('a normalization substitution is announced in the widget (#372)', () => {

    let fixture
    let widget
    let asked

    beforeEach(() => {
        fixture = withDOM()
        const {document} = fixture.window

        // The one thing the constructor reads out of the navbar.
        const navbar = document.createElement('div')
        const lower = document.createElement('div')
        lower.id = 'suite-lower-hic-nav-bar-widget-container'
        navbar.appendChild(lower)
        document.body.appendChild(navbar)

        // A browser stub, not a browser: this suite is about the widget, and
        // the only thing the widget asks of its browser is where a user
        // selection goes.
        asked = []
        widget = new NormalizationWidget({
            state: {...VIEW},
            setNormalization: normalization => asked.push(normalization)
        }, navbar)
    })

    afterEach(() => {
        fixture.restore()
    })

    /** Is the marker on screen? The marker is the visible half of the announcement. */
    const markerShowing = () => 'none' !== widget.substitutionMarker.style.display

    test('nothing is announced until something is substituted', () => {
        expect(markerShowing()).toBe(false)
        expect(widget.container.title).toBe('Normalization')
    })

    test('an announcement shows a marker and puts the reason in the title', () => {

        widget.announceSubstitution(substitutionReason.notInFile('KR', 'NONE'), VIEW)

        // Both halves, because either alone is the silence #372 is about: a
        // title is invisible on touch, and a marker with no title says nothing.
        expect(markerShowing()).toBe(true)
        expect(widget.container.title).toContain('KR')
    })

    test('the announcement survives a pan, which cannot make it false', () => {

        widget.announceSubstitution(substitutionReason.notInFile('KR', 'NONE'), VIEW)
        widget.clearSubstitutionIfStale(PANNED)

        expect(markerShowing()).toBe(true)
    })

    test('a chromosome change clears it', () => {

        widget.announceSubstitution(substitutionReason.notAtThisView('KR', 'NONE'), VIEW)
        widget.clearSubstitutionIfStale(OTHER_CHROMOSOME)

        expect(markerShowing()).toBe(false)
        expect(widget.container.title).toBe('Normalization')
    })

    test('a zoom change clears it', () => {

        widget.announceSubstitution(substitutionReason.notAtThisView('KR', 'NONE'), VIEW)
        widget.clearSubstitutionIfStale(OTHER_ZOOM)

        expect(markerShowing()).toBe(false)
    })

    test('a user selection clears it, and still reaches the browser', () => {

        widget.announceSubstitution(substitutionReason.notInFile('KR', 'NONE'), VIEW)

        const option = fixture.window.document.createElement('option')
        option.value = 'VC'
        widget.normalizationSelector.appendChild(option)
        widget.normalizationSelector.value = 'VC'
        widget.normalizationSelector.dispatchEvent(new fixture.window.Event('change'))

        expect(markerShowing()).toBe(false)
        expect(asked).toEqual(['VC'])
    })

    test('a programmatic selector update does not answer the question, so it does not clear', () => {

        // `setNormalizationProgrammatically` is how a *substitution* puts the
        // effective value on the selector -- it is the announcement's other
        // half, not the user's answer to it.
        widget.announceSubstitution(substitutionReason.notInFile('KR', 'NONE'), VIEW)
        widget.setNormalizationProgrammatically('NONE')

        expect(markerShowing()).toBe(true)
        expect(asked).toEqual([])
    })
})

describe('the three reasons a substitution happens', () => {

    // Three literals rather than three code paths, because the user's remedy
    // differs: nothing to do, unload the control map, or pan and zoom.
    test('each names the normalization that was asked for and the one being drawn', () => {
        for (const reason of Object.values(substitutionReason)) {
            const text = reason('KR', 'VC')
            expect(text).toContain('KR')
            expect(text).toContain('VC')
        }
    })

    test('they are distinct, so the marker never says the same thing three ways', () => {
        const texts = Object.values(substitutionReason).map(reason => reason('KR', 'NONE'))
        expect(new Set(texts).size).toBe(texts.length)
    })

    test('the intersection reason names the remedy, which is the control map', () => {
        expect(substitutionReason.notInBothMaps('KR', 'NONE')).toMatch(/control map/i)
    })

    test('the this-view reason names its remedy, which is to pan or zoom', () => {
        expect(substitutionReason.notAtThisView('KR', 'NONE')).toMatch(/zoom/i)
    })
})
