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

const DRAG_THRESHOLD = 2
const DOUBLE_TAP_DIST_THRESHOLD = 20
const DOUBLE_TAP_TIME_THRESHOLD = 300

const doLegacyTrack2DRendering = false

class ContactMatrixView {

    constructor(browser, viewportElement, sweepZoom, scrollbarWidget, imageTileSource, backgroundColor) {
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

        // Note: MapLoad and ControlMapLoad subscriptions removed - now handled by BrowserCoordinator
        // NormalizationChange, TrackLoad2D, TrackState2D, and ColorChange are still posted to eventBus
        // for cross-browser synchronization, so we keep those subscriptions
        this.browser.eventBus.subscribe("NormalizationChange", this);
        this.browser.eventBus.subscribe("TrackLoad2D", this);
        this.browser.eventBus.subscribe("TrackState2D", this);
        this.browser.eventBus.subscribe("ColorChange", this);
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

            if (!cleared) {
                this.ctx.clearRect(0, 0, viewportWidth, viewportHeight);
                cleared = true;
            }

            binSize = tile.binSize;

            if (tile.inProgress) {
                this.paintTile({...tile, image: inProgressTile(tile.blockBinCount)});
            } else if (tile.image) {
                this.paintTile(tile);
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
        const matrices = await getMatrices.call(this, state.chr1, state.chr2);

        const matrix = matrices[0];

        if (matrix) {
            const unit = "BP";
            const zd = await matrix.getZoomDataByIndex(state.zoom, unit);
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

    paintTile({image, row, column, blockBinCount}) {

        const x0 = blockBinCount * column
        const y0 = blockBinCount * row

        const {x, y, pixelSize} = this.browser.state
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

    addMouseHandlers(viewportElement) {

        let startX = 0;
        let startY = 0;
        let currentX = 0;
        let currentY = 0;

        let isMouseDown = false;
        let isSweepZooming = false;
        let mouseDown
        let mouseLast
        let mouseOver;

        const panMouseUpOrMouseOut = () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.browser.eventBus.post(HICEvent("DragStopped"));
            }
            isMouseDown = false;
            mouseDown = mouseLast = undefined;
        };

        this.isDragging = false;

        if (!this.browser.isMobile) {

            viewportElement.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (this.browser.menuElement?.style.display === 'block') {
                    this.browser.hideMenu();
                }

                mouseLast = { x: e.offsetX, y: e.offsetY };
                mouseDown = { x: e.offsetX, y: e.offsetY };

                if (e.altKey) {
                    isSweepZooming = true

                    const { top, left } = viewportElement.getBoundingClientRect()
                    startX = e.clientX - left
                    startY = e.clientY - top

                    this.sweepZoom.initialize(startX, startY);
                }

                isMouseDown = true;
            })

            viewportElement.addEventListener('mousemove', (e) => {

                e.preventDefault();
                e.stopPropagation();

                const coords =
                    {
                        x: e.offsetX,
                        y: e.offsetY
                    };

                const { top, left } = getOffset(viewportElement)

                const xy =
                    {
                        x: e.pageX - left,
                        y: e.pageY - top
                    };

                const { width, height } = viewportElement.getBoundingClientRect();
                xy.xNormalized = xy.x / width;
                xy.yNormalized = xy.y / height;

                this.browser.coordinator.onUpdateContactMapMousePosition(xy);

                if (this.willShowCrosshairs) {
                    this.browser.updateCrosshairs(xy);
                    this.browser.showCrosshairs();
                }

                if (isMouseDown) {
                    if (isSweepZooming) {

                        const { left, top } = viewportElement.getBoundingClientRect();
                        currentX = e.clientX - left;
                        currentY = e.clientY - top;
                        const width = Math.abs(currentX - startX);
                        const height = Math.abs(currentY - startY);

                        const config =
                            {
                                left: `${Math.min(startX, currentX)}px`,
                                top: `${Math.min(startY, currentY)}px`,
                                width: `${width}px`,
                                height: `${height}px`,
                            }


                        this.sweepZoom.update(config);

                    } else if (mouseDown.x && Math.abs(coords.x - mouseDown.x) > DRAG_THRESHOLD) {
                        this.isDragging = true;
                        const dx = mouseLast.x - coords.x;
                        const dy = mouseLast.y - coords.y;
                        this.browser.shiftPixels(dx, dy).catch(err => console.error('Error in shiftPixels:', err));
                    }
                    mouseLast = coords;
                }
            })

            viewportElement.addEventListener('mouseup', panMouseUpOrMouseOut)

            viewportElement.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const mouseX = e.offsetX;
                const mouseY = e.offsetY;
                this.browser.zoomAndCenter(1, mouseX, mouseY);
            })

            viewportElement.addEventListener('wheel', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const zoomFactor = 0.008;
                // deltaY > 0 means scroll down (zoom out), deltaY < 0 means scroll up (zoom in)
                // For juicebox: scaleFactor > 1 = zoom in, scaleFactor < 1 = zoom out
                const scaleFactor = e.deltaY > 0 ? 1 - zoomFactor : 1 + zoomFactor;
                const anchorPx = e.offsetX;
                const anchorPy = e.offsetY;

                this.browser.interactions.handleWheelZoom(anchorPx, anchorPy, scaleFactor)
                    .catch(err => console.error('Error in handleWheelZoom:', err));
            })

            viewportElement.addEventListener('mouseover', () => mouseOver = true)
            viewportElement.addEventListener('mouseout', () => mouseOver = undefined)


            viewportElement.addEventListener('mouseleave', () => {
                this.browser.layoutController.xAxisRuler.unhighlightWholeChromosome();
                this.browser.layoutController.yAxisRuler.unhighlightWholeChromosome();
                panMouseUpOrMouseOut();
            })

            document.addEventListener('keydown', (e) => {
                if (!this.willShowCrosshairs && mouseOver && e.shiftKey) {
                    this.willShowCrosshairs = true;
                    this.browser.eventBus.post(HICEvent('DidShowCrosshairs', 'DidShowCrosshairs', false));
                }
            })

            document.addEventListener('keyup', () => {
                this.browser.hideCrosshairs();
                this.willShowCrosshairs = undefined;
                this.browser.eventBus.post(HICEvent('DidHideCrosshairs', 'DidHideCrosshairs', false));
            })

            document.addEventListener('mouseup', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (isSweepZooming) {
                    isSweepZooming = false;

                    const sweepRect =
                        {
                            xPixel: Math.min(startX, currentX),
                            yPixel: Math.min(startY, currentY),
                            width: Math.abs(currentX - startX),
                            height: Math.abs(currentY - startY)
                        };

                    this.sweepZoom.commit(sweepRect).catch(err => console.error('Error in sweepZoom.commit:', err));
                }
            })
        }
    }

    /**
     * Add touch handlers.  Touches are mapped to one of the following application level events
     *  - double tap, equivalent to double click
     *  - move
     *  - pinch
     *
     * @param $viewport
     */

    addTouchHandlers(viewportElement) {
        let lastTouch, pinch;

        const translateTouchCoordinates = (e, target) => {
            const rect = target.getBoundingClientRect();
            return {
                x: e.pageX - rect.left,
                y: e.pageY - rect.top
            };
        };

        viewportElement.ontouchstart = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            let touchCoords = translateTouchCoordinates(ev.targetTouches[0], viewportElement);
            let offsetX = touchCoords.x;
            let offsetY = touchCoords.y;
            const count = ev.targetTouches.length;
            const timeStamp = ev.timeStamp || Date.now();
            let resolved = false;

            if (count === 2) {
                touchCoords = translateTouchCoordinates(ev.targetTouches[1], viewportElement);
                offsetX = (offsetX + touchCoords.x) / 2;
                offsetY = (offsetY + touchCoords.y) / 2;
            }

            if (lastTouch && (timeStamp - lastTouch.timeStamp < DOUBLE_TAP_TIME_THRESHOLD) && count > 1 && lastTouch.count === 1) {
                lastTouch = { x: offsetX, y: offsetY, timeStamp, count };
                return;
            }

            if (lastTouch && (timeStamp - lastTouch.timeStamp < DOUBLE_TAP_TIME_THRESHOLD)) {
                const dx = lastTouch.x - offsetX;
                const dy = lastTouch.y - offsetY;
                const dist = Math.hypot(dx, dy);
                const direction = (lastTouch.count === 2 || count === 2) ? -1 : 1;

                if (dist < DOUBLE_TAP_DIST_THRESHOLD) {
                    this.browser.zoomAndCenter(direction, offsetX, offsetY);
                    lastTouch = undefined;
                    resolved = true;
                }
            }

            if (!resolved) {
                lastTouch = { x: offsetX, y: offsetY, timeStamp, count };
            }
        };

        viewportElement.ontouchmove = hicUtils.throttle((ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            if (ev.targetTouches.length === 2) {
                const touchCoords1 = translateTouchCoordinates(ev.targetTouches[0], viewportElement);
                const touchCoords2 = translateTouchCoordinates(ev.targetTouches[1], viewportElement);

                const t = {
                    x1: touchCoords1.x,
                    y1: touchCoords1.y,
                    x2: touchCoords2.x,
                    y2: touchCoords2.y
                };

                pinch ? (pinch.end = t) : (pinch = { start: t });
            } else {
                const touchCoords = translateTouchCoordinates(ev.targetTouches[0], viewportElement);
                const offsetX = touchCoords.x;
                const offsetY = touchCoords.y;

                if (lastTouch) {
                    const dx = lastTouch.x - offsetX;
                    const dy = lastTouch.y - offsetY;
                    if (!isNaN(dx) && !isNaN(dy)) {
                        this.isDragging = true;
                        this.browser.shiftPixels(dx, dy).catch(err => console.error('Error in shiftPixels:', err));
                    }
                }

                lastTouch = {
                    x: offsetX,
                    y: offsetY,
                    timeStamp: ev.timeStamp || Date.now(),
                    count: ev.targetTouches.length
                };
            }
        }, 50);

        viewportElement.ontouchend = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            if (pinch && pinch.end) {
                const { start, end } = pinch;
                const dxStart = start.x2 - start.x1;
                const dyStart = start.y2 - start.y1;
                const dxEnd = end.x2 - end.x1;
                const dyEnd = end.y2 - end.y1;

                const distStart = Math.hypot(dxStart, dyStart);
                const distEnd = Math.hypot(dxEnd, dyEnd);
                const scale = distEnd / distStart;

                const anchorX = (start.x1 + start.x2) / 2;
                const anchorY = (start.y1 + start.y2) / 2;

                if (scale < 0.8 || scale > 1.2) {
                    lastTouch = undefined;
                    this.browser.pinchZoom(anchorX, anchorY, scale);
                }
            } else if (this.isDragging) {
                this.isDragging = false;
                this.browser.eventBus.post(HICEvent("DragStopped"));
            }

            pinch = undefined;
        };
    }

    async render2DTracks(track2DList, dataset, state) {

        const matrix = await dataset.getMatrix(state.chr1, state.chr2)
        const zoomData = matrix.getZoomDataByIndex(state.zoom, 'BP')

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
