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

/**
 * @author Jim Robinson
 */

import {IGVColor} from 'igv-utils'
import HICEvent from './hicEvent.js'
import * as hicUtils from './hicUtils.js'
import {getLocus} from "./genomicUtils.js"
import {getOffset} from "./utils.js"
import GestureRecognizer from "./gestureRecognizer.js"

const doLegacyTrack2DRendering = false

class ContactMatrixView {

    /**
     * The `backgroundColor` parameter default is this class answering for
     * itself, and is deliberately *not* the kind of default #536 took out of the
     * readers: it never sees a config. `normalizeSession` resolves
     * `config.backgroundColor` for every browser and `createWidgets` passes what
     * it finds there, so in a running juicebox this default is unreachable --
     * it stands up a view constructed without a browser config behind it, which
     * is what the suites that build a browser from `{}` do.
     *
     * A copy, because `defaultBackgroundColor` is a mutable object on the class
     * and `setBackgroundColor` would otherwise let one view edit every other
     * view's default. `normalizeSession.resolveBackgroundColor` copies it for the
     * same reason.
     */
    constructor(browser, viewportElement, sweepZoom, scrollbarWidget, imageTileSource,
                backgroundColor = {...ContactMatrixView.defaultBackgroundColor}) {
        this.browser = browser;
        this.viewportElement = viewportElement;
        this.sweepZoom = sweepZoom;
        this.scrollbarWidget = scrollbarWidget;

        // Supplies the image tiles this view paints. Owns the color scales, the
        // tile cache and rasterization. See CONTEXT.md.
        this.imageTileSource = imageTileSource;

        this.backgroundColor = backgroundColor;
        this.backgroundRGBString = IGVColor.rgbColor(backgroundColor.r, backgroundColor.g, backgroundColor.b);

        this.canvasElement = viewportElement.querySelector('canvas');
        this.ctx = this.canvasElement.getContext('2d');

        this.faSpinnerElement = viewportElement.querySelector('.fa-spinner');
        this.spinnerCount = 0;

        this.xGuideElement = viewportElement.querySelector("div[id$='-x-guide']");
        this.yGuideElement = viewportElement.querySelector("div[id$='-y-guide']");

        this.displayMode = 'A';

        // Holds the in-progress gesture. This view only converts events to
        // viewport pixels and carries out the intents it names. See CONTEXT.md.
        this.gestureRecognizer = new GestureRecognizer();

        /**
         * The handlers this view puts on `document`, so `dispose()` can take
         * them off again.
         *
         * Everything else this view listens on lives inside the viewport and
         * dies when `rootElement` is removed. Three modifier-key and mouse-up
         * handlers do not: they are on `document` because a gesture that starts
         * in the viewport can end outside it. Nothing removed them before, so a
         * `reset()` -- which builds a second view over the same document --
         * would post `DidHideCrosshairs` once per reset the browser had ever
         * had. #494.
         */
        this.documentListeners = [];
    }

    /**
     * Listen on `document`, recording the registration for `dispose()`.
     */
    addDocumentListener(type, handler) {
        document.addEventListener(type, handler);
        this.documentListeners.push([type, handler]);
    }

    /**
     * Give up what this view installed outside its own viewport.
     *
     * Called by `HICBrowser.dispose()`, which is the one teardown path -- and
     * so also by `reset()`, which is that path followed by a reconstruction.
     */
    dispose() {
        for (const [type, handler] of this.documentListeners) {
            document.removeEventListener(type, handler);
        }
        this.documentListeners = [];
    }

    // The color scales live on the image tile source. These read-through
    // accessors keep the existing call sites in hicBrowser, browserCoordinator
    // and hicColorScaleWidget working unchanged.
    get colorScale() {
        return this.imageTileSource.colorScale;
    }

    get ratioColorScale() {
        return this.imageTileSource.ratioColorScale;
    }

    get diffColorScale() {
        return this.imageTileSource.diffColorScale;
    }

    setBackgroundColor(rgb) {
        this.backgroundColor = rgb
        this.backgroundRGBString = IGVColor.rgbColor(rgb.r, rgb.g, rgb.b)
        this.update()
    }

    stringifyBackgroundColor() {
        return `${this.backgroundColor.r},${this.backgroundColor.g},${this.backgroundColor.b}`
    }

    static parseBackgroundColor(rgbString) {
        const [r, g, b] = rgbString.split(",").map(str => parseInt(str))
        return {r, g, b}
    }

    setColorScale(colorScale) {
        this.imageTileSource.setColorScale(colorScale, this.displayMode, this.browser.state)
    }

    async setColorScaleThreshold(threshold) {
        this.imageTileSource.setThreshold(threshold, this.displayMode, this.browser.state)
        await this.update()
    }

    /**
     * The color scale a display mode renders with, defaulting to the mode on
     * screen. Callers announcing a mode change pass the incoming mode, which is
     * not yet the one this view has committed to.
     */
    getColorScale(displayMode = this.displayMode) {
        return this.imageTileSource.getColorScale(displayMode)
    }

    async setDisplayMode(mode) {
        this.displayMode = mode
        this.clearImageCaches()
        await this.update()
    }

    /**
     * @param {boolean} thresholds also discard computed color scale thresholds.
     *        Map load passes true; a pan or color change does not.
     */
    clearImageCaches({thresholds = false} = {}) {
        this.imageTileSource.invalidate({thresholds})
    }

    getViewDimensions() {
        return {
            width: this.viewportElement.offsetWidth,
            height: this.viewportElement.offsetHeight
        };
    }

    async receiveEvent(event) {
        if (event.type === "MapLoad" || event.type === "ControlMapLoad") {
            // Don't enable mouse actions until we have a dataset.
            if (!this.mouseHandlersEnabled) {
                this.addTouchHandlers(this.viewportElement);
                this.addMouseHandlers(this.viewportElement)
                this.mouseHandlersEnabled = true;
            }
            this.clearImageCaches({thresholds: true});
        } else {
            if (event.type !== "LocusChange") {
                this.clearImageCaches();
            }
            this.update();
        }
    }

    async update() {

        if (this.disableUpdates) return   // This flag is set during browser startup

        await this.repaint()

        if (this.browser.dataset && this.browser.state && false === doLegacyTrack2DRendering){
            await this.render2DTracks(this.browser.tracks2D, this.browser.dataset, this.browser.state)
        }

    }

    async repaint() {
        if (!this.browser.dataset || !this.browser.state) return;

        const viewportWidth = this.viewportElement.offsetWidth;
        const viewportHeight = this.viewportElement.offsetHeight;
        const canvasWidth = this.canvasElement.width;
        const canvasHeight = this.canvasElement.height;

        if (canvasWidth !== viewportWidth || canvasHeight !== viewportHeight) {
            this.canvasElement.width = viewportWidth;
            this.canvasElement.height = viewportHeight;
            this.canvasElement.setAttribute('width', viewportWidth);
            this.canvasElement.setAttribute('height', viewportHeight);
        }

        const {state, dataset, controlDataset} = this.browser;

        // Content is fixed for the pass; placement stays live, so tiles that
        // resolve late during a pan land where the view is now rather than
        // where it was when the pass started. See CONTEXT.md.
        const snapshot = {
            chr1: state.chr1,
            chr2: state.chr2,
            x: state.x,
            y: state.y,
            zoom: state.zoom,
            pixelSize: state.pixelSize,
            normalization: state.normalization
        };

        const tiles = this.imageTileSource.tilesFor({
            dataset,
            controlDataset,
            state: snapshot,
            displayMode: this.displayMode,
            viewDimensions: {width: viewportWidth, height: viewportHeight}
        });

        // Cleared on the first tile rather than up front: the source resolves
        // matrices and may fetch for the color scale before yielding anything,
        // and blanking the viewport for that window would flicker on every pass.
        let cleared = false;
        let binSize;

        for await (const tile of tiles) {

            // A pass can outlive the state it started from: reset() clears
            // browser.state, and a subsequent load installs a different State
            // object, while tiles are still resolving. Identity is the test —
            // the chokepoint mutates in place, so pans keep the same object and
            // placement stays live, while a clear or a bulk replacement swaps
            // it and this pass has nothing left to place against (#469).
            const liveState = this.browser.state;
            if (liveState !== state) return;

            if (!cleared) {
                this.ctx.clearRect(0, 0, viewportWidth, viewportHeight);
                cleared = true;
            }

            binSize = tile.binSize;

            if (tile.inProgress) {
                this.paintTile({...tile, image: inProgressTile(tile.blockBinCount)}, liveState);
            } else if (tile.image) {
                this.paintTile(tile, liveState);
            }
        }

        if (undefined !== binSize) {
            this.genomicExtent = {
                chr1: state.chr1,
                chr2: state.chr2,
                x: state.x * binSize,
                y: state.y * binSize,
                w: viewportWidth * binSize / state.pixelSize,
                h: viewportHeight * binSize / state.pixelSize
            };
        }
    }

    async zoomIn() {
        const state = this.browser.state;
        const viewportWidth = this.viewportElement.offsetWidth;
        const viewportHeight = this.viewportElement.offsetHeight;
        // The same matrix and resolution the tile pass drew from, so the extent
        // computed here is in the same units as `this.genomicExtent`, which is
        // recorded off `tile.binSize`. At the sentinel rung both are the
        // whole-genome matrix's, which states its bins in kb where every
        // declared rung states them in bp. The two never meet: the one caller
        // (`interactionHandler._applyStateChange`) runs this only when
        // `resolutionChanged` is false, and moving on or off the sentinel is
        // always a resolution change. ADR-0010 decision 3.
        const view = this.browser.dataset.matrixViewForZoom(state.chr1, state.chr2, state.zoom);
        const matrices = await getMatrices.call(this, view.chr1, view.chr2);

        const matrix = matrices[0];

        if (matrix) {
            const unit = "BP";
            const zd = await matrix.getZoomDataByIndex(view.zoomIndex, unit);
            const newGenomicExtent = {
                x: state.x * zd.zoom.binSize,
                y: state.y * zd.zoom.binSize,
                w: viewportWidth * zd.zoom.binSize / state.pixelSize,
                h: viewportHeight * zd.zoom.binSize / state.pixelSize
            };

            // Zoom out not supported
            if (newGenomicExtent.w > this.genomicExtent.w) return;

            const sx = ((newGenomicExtent.x - this.genomicExtent.x) / this.genomicExtent.w) * viewportWidth;
            const sy = ((newGenomicExtent.y - this.genomicExtent.y) / this.genomicExtent.h) * viewportHeight;
            const sWidth = (newGenomicExtent.w / this.genomicExtent.w) * viewportWidth;
            const sHeight = (newGenomicExtent.h / this.genomicExtent.h) * viewportHeight;
            const img = this.canvasElement;

            const backCanvas = document.createElement('canvas');
            backCanvas.width = img.width;
            backCanvas.height = img.height;
            const backCtx = backCanvas.getContext('2d');
            backCtx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, viewportWidth, viewportHeight);

            this.ctx.clearRect(0, 0, viewportWidth, viewportHeight);
            this.ctx.drawImage(backCanvas, 0, 0);
        }
    }

    // The caller supplies the state to place against, having checked it is
    // still the one this pass belongs to.
    paintTile({image, row, column, blockBinCount}, liveState) {

        const x0 = blockBinCount * column
        const y0 = blockBinCount * row

        const {x, y, pixelSize} = liveState
        //const pixelSizeInt = Math.max(1, Math.floor(pixelSize))
        const offsetX = (x0 - x) * pixelSize
        const offsetY = (y0 - y) * pixelSize

        const scale = pixelSize // / pixelSizeInt
        const scaledWidth = image.width * scale
        const scaledHeight = image.height * scale

        if (offsetX <= this.viewportElement.offsetWidth && offsetX + scaledWidth >= 0 && offsetY <= this.viewportElement.offsetHeight && offsetY + scaledHeight >= 0) {
            this.ctx.fillStyle = this.backgroundRGBString
            this.ctx.fillRect(offsetX, offsetY, scaledWidth, scaledHeight)
            if (scale === 1) {
                this.ctx.drawImage(image, offsetX, offsetY)
            } else {
                this.ctx.drawImage(image, offsetX, offsetY, scaledWidth, scaledHeight)
            }
            // Debugging aid, uncomment to see tile boundaries
            //this.ctx.strokeRect(offsetX, offsetY, scaledWidth, scaledHeight)
            //this.ctx.strokeText(`${row} ${column}`, offsetX, offsetY);
        }
    }

    startSpinner() {
        if (this.browser.isLoadingHICFile && this.browser.userInteractionShield) {
            this.browser.userInteractionShield.style.display = 'block';
        }
        this.faSpinnerElement.style.display = 'inline-block';
        this.spinnerCount++;
    }

    stopSpinner() {
        this.spinnerCount--;
        if (this.spinnerCount === 0) {
            this.faSpinnerElement.style.display = 'none';
        } else if (this.spinnerCount < 0) {
            // An unpaired stop. This used to be clamped away silently, which left
            // the imbalance to be rediscovered; say so instead, and hide the
            // spinner so the symptom is a console error rather than a stuck UI.
            console.error(`ContactMatrixView: unpaired stopSpinner, count is ${this.spinnerCount}`);
            this.spinnerCount = 0;
            this.faSpinnerElement.style.display = 'none';
        }
    }

    /**
     * Wire the viewport's mouse, wheel and key events to the gesture
     * recognizer, and carry out what it recognizes.
     *
     * What stays here is what the recognizer must not hold: converting each
     * event to viewport pixels, and registering listeners. Each event keeps the
     * coordinate source it has always read -- `offsetX` for drag, double-click
     * and wheel, client-minus-rect for the sweep, page-minus-offset for the
     * crosshairs. They agree only when the page is laid out simply, and JSDOM
     * cannot tell them apart, so unifying them is a behaviour change to make
     * deliberately, not here.
     */
    addMouseHandlers(viewportElement) {

        if (this.browser.isMobile) return;

        const recognizer = this.gestureRecognizer;

        viewportElement.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (this.browser.menuElement?.style.display === 'block') {
                this.browser.hideMenu();
            }

            const { top, left } = viewportElement.getBoundingClientRect()
            this.carryOut(recognizer.mouseDown({
                x: e.offsetX,
                y: e.offsetY,
                sweepX: e.clientX - left,
                sweepY: e.clientY - top,
                altKey: e.altKey
            }));
        })

        viewportElement.addEventListener('mousemove', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const { top, left } = getOffset(viewportElement)
            const rect = viewportElement.getBoundingClientRect();

            const pointer =
                {
                    x: e.pageX - left,
                    y: e.pageY - top
                };
            pointer.xNormalized = pointer.x / rect.width;
            pointer.yNormalized = pointer.y / rect.height;

            this.browser.coordinator.onUpdateContactMapMousePosition(pointer);

            this.carryOut(recognizer.mouseMove({
                x: e.offsetX,
                y: e.offsetY,
                sweepX: e.clientX - rect.left,
                sweepY: e.clientY - rect.top,
                pointer
            }));
        })

        viewportElement.addEventListener('mouseup', () => this.carryOut(recognizer.mouseUp()))

        viewportElement.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.carryOut(recognizer.doubleClick({ x: e.offsetX, y: e.offsetY }));
        })

        viewportElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.carryOut(recognizer.wheel({ x: e.offsetX, y: e.offsetY, deltaY: e.deltaY }));
        })

        viewportElement.addEventListener('mouseover', () => this.carryOut(recognizer.mouseOver()))
        viewportElement.addEventListener('mouseout', () => this.carryOut(recognizer.mouseOut()))

        viewportElement.addEventListener('mouseleave', () => {
            this.browser.layoutController.xAxisRuler.unhighlightWholeChromosome();
            this.browser.layoutController.yAxisRuler.unhighlightWholeChromosome();
            this.carryOut(recognizer.mouseLeave());
        })

        this.addDocumentListener('keydown', (e) => this.carryOut(recognizer.keyDown({ shiftKey: e.shiftKey })))

        this.addDocumentListener('keyup', () => this.carryOut(recognizer.keyUp()))

        this.addDocumentListener('mouseup', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.carryOut(recognizer.documentMouseUp());
        })
    }

    /**
     * Wire the viewport's touch events to the gesture recognizer: double tap,
     * one-finger pan and pinch. Touch coordinates are page-minus-rect.
     *
     * Touch-move is throttled here, not in the recognizer, which has no clock.
     */
    addTouchHandlers(viewportElement) {

        const recognizer = this.gestureRecognizer;

        const touchesIn = (ev) => {
            const rect = viewportElement.getBoundingClientRect();
            return Array.from(ev.targetTouches, ({ pageX, pageY }) => ({ x: pageX - rect.left, y: pageY - rect.top }));
        };

        viewportElement.ontouchstart = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this.carryOut(recognizer.touchStart({ touches: touchesIn(ev), timeStamp: ev.timeStamp || Date.now() }));
        };

        viewportElement.ontouchmove = hicUtils.throttle((ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this.carryOut(recognizer.touchMove({ touches: touchesIn(ev), timeStamp: ev.timeStamp || Date.now() }));
        }, 50);

        viewportElement.ontouchend = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this.carryOut(recognizer.touchEnd());
        };
    }

    /**
     * Carry out the intents the gesture recognizer named, in order. Each goes
     * where it went before the recognizer existed: through the browser's
     * forwarding methods, the interaction handler, the sweep zoom, or the bus.
     */
    carryOut(intents) {
        for (const intent of intents) {
            switch (intent.type) {
                case 'pan':
                    this.browser.shiftPixels(intent.dx, intent.dy).catch(err => console.error('Error in shiftPixels:', err));
                    break;
                case 'dragStopped':
                    this.browser.eventBus.post(HICEvent("DragStopped"));
                    break;
                case 'zoomAndCenter':
                    this.browser.zoomAndCenter(intent.direction, intent.x, intent.y);
                    break;
                case 'wheelZoom':
                    this.browser.interactions.handleWheelZoom(intent.x, intent.y, intent.scaleFactor)
                        .catch(err => console.error('Error in handleWheelZoom:', err));
                    break;
                case 'pinchZoom':
                    this.browser.pinchZoom(intent.x, intent.y, intent.scale);
                    break;
                case 'sweepStart':
                    this.sweepZoom.initialize(intent.x, intent.y);
                    break;
                case 'sweepUpdate':
                    this.sweepZoom.update({
                        left: `${intent.left}px`,
                        top: `${intent.top}px`,
                        width: `${intent.width}px`,
                        height: `${intent.height}px`,
                    });
                    break;
                case 'sweepCommit':
                    this.sweepZoom.commit(intent.rect).catch(err => console.error('Error in sweepZoom.commit:', err));
                    break;
                case 'showCrosshairs':
                    this.browser.eventBus.post(HICEvent('DidShowCrosshairs', 'DidShowCrosshairs'));
                    break;
                case 'moveCrosshairs':
                    this.browser.updateCrosshairs(intent.pointer);
                    this.browser.showCrosshairs();
                    break;
                case 'hideCrosshairs':
                    this.browser.hideCrosshairs();
                    this.browser.eventBus.post(HICEvent('DidHideCrosshairs', 'DidHideCrosshairs'));
                    break;
                default:
                    throw new Error(`ContactMatrixView: unknown gesture intent '${intent.type}'`);
            }
        }
    }

    async render2DTracks(track2DList, dataset, state) {

        // Resolved the same way the tile pass resolves it, so `bpPerPixel` below
        // is in the matrix's own units. At the sentinel rung that is the
        // whole-genome matrix, whose axes are named `All` -- so a 2D track keyed
        // to the scaffold matches nothing and draws nothing, exactly as it does
        // in the whole-genome view the sentinel replaces. One rung in, it is
        // back. ADR-0010 decision 3.
        const view = dataset.matrixViewForZoom(state.chr1, state.chr2, state.zoom)
        const matrix = await dataset.getMatrix(view.chr1, view.chr2)
        const zoomData = matrix.getZoomDataByIndex(view.zoomIndex, 'BP')

        const { width, height } = this.getViewDimensions()
        const bpPerPixel = zoomData.zoom.binSize/state.pixelSize
        const { xStartBP, yStartBP, xEndBP, yEndBP } =  getLocus(dataset, state, width, height, bpPerPixel)

        const chr1Name = zoomData.chr1.name
        const chr2Name = zoomData.chr2.name

        const sameChr = zoomData.chr1.index === zoomData.chr2.index

        this.ctx.save()
        this.ctx.lineWidth = 2

        const strokeFeatureRect = ({ xS, xE, yS, yE }) => {

            if (xE < xStartBP || xS > xEndBP || yE < yStartBP || yS > yEndBP) {
                // trivially reject
            } else {
                const w = Math.max(1, (xE - xS)/bpPerPixel)
                const h = Math.max(1, (yE - yS)/bpPerPixel)
                const x = Math.floor((xS - xStartBP)/bpPerPixel)
                const y = Math.floor((yS - yStartBP)/bpPerPixel)
                this.ctx.strokeRect(x, y, w, h)
            }

        }

        const renderFeatures = (track2D, features, mirrored) => {
            for (const feature of features) {
                this.ctx.strokeStyle = track2D.color || feature.color
                strokeFeatureRect(resolveFeatureAxes(feature, chr1Name, mirrored))
            }
        }

        for (const track2D of track2DList) {

            if (false === track2D.isVisible) {
                continue
            }

            const features = track2D.getFeatures(chr1Name, chr2Name)

            if (features) {
                for (const mirrored of featureDrawPasses(track2D.displayMode, sameChr)) {
                    renderFeatures(track2D, features, mirrored)
                }
            }


        }

        this.ctx.restore()

    }
}

ContactMatrixView.defaultBackgroundColor = {r: 255, g: 255, b: 255}

/**
 * Returns a promise for an image tile
 *
 * @param zd
 * @param row
 * @param column
 * @param state
 * @returns {*}
 */

const inProgressCache = {}

function inProgressTile(imageSize) {

    let image = inProgressCache[imageSize]
    if (!image) {
        image = document.createElement('canvas')
        image.width = imageSize
        image.height = imageSize
        const ctx = image.getContext('2d')
        ctx.font = '24px sans-serif'
        ctx.fillStyle = 'rgb(230, 230, 230)'
        ctx.fillRect(0, 0, image.width, image.height)
        ctx.fillStyle = 'black'
        for (let i = 100; i < imageSize; i += 300) {
            for (let j = 100; j < imageSize; j += 300) {
                ctx.fillText('Loading...', i, j)
            }
        }
        inProgressCache[imageSize] = image
    }
    return image
}

/**
 * Resolve which of a 2D feature's coordinate pairs belongs on which axis.
 *
 * A feature is filed under a canonical chromosome key, so the order it stores
 * (`chr1`, `chr2`) may be reversed relative to the axes of the zoom data being
 * drawn. When it is, the feature's x range describes the y axis and vice versa.
 *
 * `mirrored` requests the reflected draw used for the upper triangle. The two
 * swaps compose: applying both cancels out.
 *
 * @param {Object} feature - A 2D feature: {chr1, x1, x2, y1, y2}
 * @param {string} chr1Name - Name of the chromosome on the x axis
 * @param {boolean} mirrored - Reflect across the diagonal
 * @returns {{xS: number, xE: number, yS: number, yE: number}} BP extents per axis
 */
function resolveFeatureAxes({ chr1, x1, x2, y1, y2 }, chr1Name, mirrored) {
    const reversed = chr1Name !== chr1
    return reversed !== mirrored
        ? { xS: y1, xE: y2, yS: x1, yE: x2 }
        : { xS: x1, xE: x2, yS: y1, yE: y2 }
}

/**
 * The draw passes a 2D track needs for the current view, as `mirrored` flags to
 * feed resolveFeatureAxes. An empty list means the track draws nothing.
 *
 * The mode is the 2D track's own setting ('COLLAPSED' | 'lower' | 'upper' |
 * undefined), not the browser display mode in CONTEXT.md. An unrecognized mode
 * draws nothing, as it did before this function existed.
 *
 * An inter-chromosomal view has no diagonal to reflect across, so it draws a
 * single un-mirrored pass whatever the mode asks for; a mirrored pass would put
 * a phantom copy of every feature at transposed coordinates.
 *
 * @param {string|undefined} track2DDisplayMode - The 2D track's display mode
 * @param {boolean} sameChr - Whether both axes show the same chromosome
 * @returns {boolean[]} One `mirrored` flag per pass
 */
function featureDrawPasses(track2DDisplayMode, sameChr) {

    let passes
    if ('COLLAPSED' === track2DDisplayMode || undefined === track2DDisplayMode) {
        passes = [ false, true ]
    } else if ('lower' === track2DDisplayMode) {
        passes = [ false ]
    } else if ('upper' === track2DDisplayMode) {
        passes = [ true ]
    } else {
        passes = []
    }

    return sameChr || 0 === passes.length ? passes : [ false ]
}

function getMatrices(chr1, chr2) {

    var promises = []
    if ('B' === this.displayMode && this.browser.controlDataset) {
        promises.push(this.browser.controlDataset.getMatrix(chr1, chr2))
    } else {
        promises.push(this.browser.dataset.getMatrix(chr1, chr2))
        if (this.displayMode && 'A' !== this.displayMode && this.browser.controlDataset) {
            promises.push(this.browser.controlDataset.getMatrix(chr1, chr2))
        }
    }
    return Promise.all(promises)
}

export { resolveFeatureAxes, featureDrawPasses }
export default ContactMatrixView
