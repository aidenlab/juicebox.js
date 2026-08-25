/*
 *  The MIT License (MIT)
 *
 * Copyright (c) 2016-2017 The Regents of the University of California
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
 * following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial
 * portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,  FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 */

import LocusGoto from "./hicLocusGoto.js"
import ResolutionSelector from "./hicResolutionSelector.js"
import ColorScaleWidget from "./hicColorScaleWidget.js"
import ControlMapWidget from "./controlMapWidget.js"
import NormalizationWidget, {substitutionReason} from "./normalizationWidget.js"
import {getNavbarContainer} from "./layoutController.js"
import SweepZoom from "./sweepZoom.js"
import ScrollbarWidget from "./scrollbarWidget.js"
import ColorScale, {defaultColorScaleConfig} from "./colorScale.js"
import RatioColorScale from "./ratioColorScale.js"
import DiffColorScale from "./diffColorScale.js"
import ContactMatrixView from "./contactMatrixView.js"
import ImageTileSource from "./imageTileSource.js"
import ChromosomeSelector from "./chromosomeSelector.js"
import AnnotationWidget from "./annotationWidget.js"

/**
 * Construct the browser's widgets and return them as a plain record.
 *
 * The record is owned by BrowserCoordinator, which is the only thing that reaches
 * for a widget by name. `browser.coordinator` must already exist when this is
 * called -- the ImageTileSource observer below notifies it directly.
 *
 * @param {HICBrowser} browser
 * @returns {Object} the widget record
 */
function createWidgets(browser) {

    const coordinator = browser.coordinator;

    const navContainer = getNavbarContainer(browser);

    const locusGoto = new LocusGoto(browser, navContainer);

    const resolutionSelector = new ResolutionSelector(browser, navContainer);
    resolutionSelector.setResolutionLock(browser.resolutionLocked);

    const colorScaleWidget = new ColorScaleWidget(browser, navContainer);

    const controlMapWidget = new ControlMapWidget(browser, navContainer);

    const normalizationWidget = new NormalizationWidget(browser, navContainer);

    const chromosomeSelectorContainer = browser.menuElement.querySelector('.hic-chromosome-selector-widget-container');
    const chromosomeSelector = new ChromosomeSelector(browser, chromosomeSelectorContainer);

    const annotationContainer = browser.menuElement.querySelector('.hic-annotation-presentation-button-container');
    const annotation2DWidgetConfig =
        {
            title: '2D Annotations',
            alertMessage: 'No 2D annotations currently loaded for this map'
        };
    const annotationWidget = new AnnotationWidget(browser, annotationContainer, annotation2DWidgetConfig, () => browser.tracks2D);

    const sweepZoom = new SweepZoom(browser, browser.layoutController.getContactMatrixViewport());
    const scrollbar = new ScrollbarWidget(
        browser,
        browser.layoutController.getXAxisScrollbarContainer(),
        browser.layoutController.getYAxisScrollbarContainer()
    );

    const colorScale = new ColorScale(defaultColorScaleConfig);
    // Each signed scale carries its own default threshold and colors.
    const ratioColorScale = new RatioColorScale();
    const diffColorScale = new DiffColorScale();

    const imageTileSource = new ImageTileSource({
        colorScale,
        ratioColorScale,
        diffColorScale,
        observer: {

            colorScaleChanged: (scale) => coordinator.onColorScale(scale),

            // The mid-render half of #372: a vector the file advertises but does
            // not carry at *this* chromosome and resolution. It used to raise a
            // modal; ADR-0012 deleted it, because a substitution is not a
            // failure and the widget is the surface. Same notification path as
            // the restore-time coercion, different reason -- here the remedy is
            // to pan or zoom.
            normalizationSubstituted: (requested, effective) => {
                // The source never writes canonical state, so the correction
                // lands here. Still outside the setView chokepoint, as it was
                // before -- routing it through `browser.setNormalization` would
                // repaint from inside a render pass. See the known
                // inconsistency noted in docs/state-manipulation.md.
                if (browser.state) {
                    browser.state.normalization = effective;
                }
                coordinator.onNormalizationSubstituted(
                    effective,
                    substitutionReason.notAtThisView(requested, effective)
                );
            },

            // Resolved lazily: the browser does not hold its contact matrix view
            // until this function has returned.
            loadingChanged: (isLoading) => {
                const view = browser.contactMatrixView;
                if (!view) return;
                isLoading ? view.startSpinner() : view.stopSpinner();
            }
        }
    });

    // Read, not defaulted: `normalizeSession` resolves `backgroundColor` to an
    // {r, g, b} in every config, including the one that names no colour (#536).
    const backgroundColor = browser.config.backgroundColor;
    const contactMatrixView = new ContactMatrixView(
        browser,
        browser.layoutController.getContactMatrixViewport(),
        sweepZoom,
        scrollbar,
        imageTileSource,
        backgroundColor
    );

    return {
        locusGoto,
        resolutionSelector,
        colorScaleWidget,
        controlMapWidget,
        normalizationWidget,
        chromosomeSelector,
        annotationWidget,
        sweepZoom,
        scrollbar,
        imageTileSource,
        contactMatrixView
    };
}

export default createWidgets;
