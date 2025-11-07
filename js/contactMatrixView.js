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

import {IGVColor} from '../node_modules/igv-utils/src/index.js'
import ColorScale from './colorScale.js'
import HICEvent from './hicEvent.js'
import * as hicUtils from './hicUtils.js'
import {getLocus} from "./genomicUtils.js"
import {getOffset} from "./utils.js"

const DRAG_THRESHOLD = 2
const DOUBLE_TAP_DIST_THRESHOLD = 20
const DOUBLE_TAP_TIME_THRESHOLD = 300

const imageTileDimension = 685

const doLegacyTrack2DRendering = false

class ContactMatrixView {

    constructor(browser, viewportElement, sweepZoom, scrollbarWidget, colorScale, ratioColorScale, backgroundColor) {
        this.browser = browser;
        this.viewportElement = viewportElement;
        this.sweepZoom = sweepZoom;
        this.scrollbarWidget = scrollbarWidget;

        // Set initial color scales. These might be overridden/adjusted via parameters
        this.colorScale = colorScale;
        this.ratioColorScale = ratioColorScale;
        // this.diffColorScale = new RatioColorScale(100, false);

        this.backgroundColor = backgroundColor;
        this.backgroundRGBString = IGVColor.rgbColor(backgroundColor.r, backgroundColor.g, backgroundColor.b);

        this.canvasElement = viewportElement.querySelector('canvas');
        this.ctx = this.canvasElement.getContext('2d');

        this.faSpinnerElement = viewportElement.querySelector('.fa-spinner');
        this.spinnerCount = 0;

        this.xGuideElement = viewportElement.querySelector("div[id$='-x-guide']");
        this.yGuideElement = viewportElement.querySelector("div[id$='-y-guide']");

        this.displayMode = 'A';
        this.imageTileCache = {};
        this.imageTileCacheKeys = [];
        this.imageTileCacheLimit = 8; // 8 is the minimum number required to support A/B cycling
        this.colorScaleThresholdCache = {};

        this.browser.eventBus.subscribe("NormalizationChange", this);
        this.browser.eventBus.subscribe("TrackLoad2D", this);
        this.browser.eventBus.subscribe("TrackState2D", this);
        this.browser.eventBus.subscribe("MapLoad", this);
        this.browser.eventBus.subscribe("ControlMapLoad", this);
        this.browser.eventBus.subscribe("ColorChange", this);

        this.drawsInProgress = new Set();

        // Optional live map contexts (for Spacewalk integration)
        // These can be set via setLiveMapContexts() or passed in config
        this.ctx_live = undefined;
        this.ctx_live_distance = undefined;
        
        // Initialize from config if provided
        if (browser.config?.liveMapContexts) {
            this.setLiveMapContexts(
                browser.config.liveMapContexts.ctx_live,
                browser.config.liveMapContexts.ctx_live_distance
            );
        }
    }

    setBackgroundColor(rgb) {
        this.backgroundColor = rgb
        this.backgroundRGBString = IGVColor.rgbColor(rgb.r, rgb.g, rgb.b)
        this.update()
    }

    /**
     * Set live map canvas contexts for bitmaprenderer rendering.
     * This is an optional method for applications that need live map rendering
     * (e.g., Spacewalk). If not set, live map rendering will be skipped.
     * 
     * @param {OffscreenCanvasRenderingContext2D} ctx_live - Context for live contact map canvas
     * @param {OffscreenCanvasRenderingContext2D} ctx_live_distance - Context for live distance map canvas
     */
    setLiveMapContexts(ctx_live, ctx_live_distance) {
        this.ctx_live = ctx_live;
        this.ctx_live_distance = ctx_live_distance;
        
        // Resize contexts to match main canvas if they exist
        if (ctx_live && this.canvasElement) {
            ctx_live.canvas.width = this.canvasElement.width;
            ctx_live.canvas.height = this.canvasElement.height;
        }
        if (ctx_live_distance && this.canvasElement) {
            ctx_live_distance.canvas.width = this.canvasElement.width;
            ctx_live_distance.canvas.height = this.canvasElement.height;
        }
    }

    stringifyBackgroundColor() {
        return `${this.backgroundColor.r},${this.backgroundColor.g},${this.backgroundColor.b}`
    }

    static parseBackgroundColor(rgbString) {
        const [r, g, b] = rgbString.split(",").map(str => parseInt(str))
        return {r, g, b}
    }

    setColorScale(colorScale) {

        switch (this.displayMode) {
            case 'AOB':
            case 'BOA':
                this.ratioColorScale = colorScale
                break
            case 'AMB':
                this.diffColorScale = colorScale
                break
            default:
                this.colorScale = colorScale
        }
        this.colorScaleThresholdCache[colorScaleKey(this.browser.state, this.displayMode)] = colorScale.threshold
    }

    async setColorScaleThreshold(threshold) {
        this.getColorScale().setThreshold(threshold)
        this.colorScaleThresholdCache[colorScaleKey(this.browser.state, this.displayMode)] = threshold
        this.imageTileCache = {}
        await this.update()
    }

    getColorScale() {
        switch (this.displayMode) {
            case 'AOB':
            case 'BOA':
                return this.ratioColorScale
            case 'AMB':
                return this.diffColorScale
            default:
                return this.colorScale
        }
    }

    async setDisplayMode(mode) {
        this.displayMode = mode
        this.clearImageCaches()
        await this.update()
    }

    clearImageCaches() {
        this.imageTileCache = {}
        this.imageTileCacheKeys = []
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
            this.clearImageCaches();
            this.colorScaleThresholdCache = {};
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

        const { state, dataset, controlDataset } = this.browser;
        let ds = dataset, dsControl = null, zdControl = null;
        let zoom = state.zoom, controlZoom;

        switch (this.displayMode) {
            case 'B':
                zoom = getBZoomIndex(state.zoom);
                ds = controlDataset;
                break;
            case 'AOB':
            case 'AMB':
                controlZoom = getBZoomIndex(state.zoom);
                dsControl = controlDataset;
                break;
            case 'BOA':
                zoom = getBZoomIndex(state.zoom);
                controlZoom = state.zoom;
                ds = controlDataset;
                dsControl = dataset;
                break;
        }

        const matrix = await ds.getMatrix(state.chr1, state.chr2);
        const zd = matrix.getZoomDataByIndex(zoom, "BP");

        if (dsControl) {
            const matrixControl = await dsControl.getMatrix(state.chr1, state.chr2);
            zdControl = matrixControl.getZoomDataByIndex(controlZoom, "BP");
        }

        const pixelSizeInt = Math.max(1, Math.floor(state.pixelSize));
        const widthInBins = viewportWidth / pixelSizeInt;
        const heightInBins = viewportHeight / pixelSizeInt;
        const blockCol1 = Math.floor(state.x / imageTileDimension);
        const blockCol2 = Math.floor((state.x + widthInBins) / imageTileDimension);
        const blockRow1 = Math.floor(state.y / imageTileDimension);
        const blockRow2 = Math.floor((state.y + heightInBins) / imageTileDimension);

        if (state.normalization !== "NONE") {
            if (!ds.hasNormalizationVector(state.normalization, zd.chr1.name, zd.zoom.unit, zd.zoom.binSize)) {
                Alert.presentAlert(`Normalization option ${state.normalization} unavailable at this resolution.`);
                this.browser.notifyNormalizationExternalChange("NONE");
                state.normalization = "NONE";
            }
        }

        await this.checkColorScale(ds, zd, blockRow1, blockRow2, blockCol1, blockCol2, state.normalization);

        this.ctx.clearRect(0, 0, viewportWidth, viewportHeight);
        for (let r = blockRow1; r <= blockRow2; r++) {
            for (let c = blockCol1; c <= blockCol2; c++) {
                const tile = await this.getImageTile(ds, dsControl, zd, zdControl, r, c, state);
                if (tile.image) this.paintTile(tile);
            }
        }

        this.genomicExtent = {
            chr1: state.chr1,
            chr2: state.chr2,
            x: state.x * zd.zoom.binSize,
            y: state.y * zd.zoom.binSize,
            w: viewportWidth * zd.zoom.binSize / state.pixelSize,
            h: viewportHeight * zd.zoom.binSize / state.pixelSize
        };

        function getBZoomIndex(zoom) {
            const binSize = dataset.getBinSizeForZoomIndex(zoom);
            if (!binSize) throw new Error(`Invalid zoom (resolution) index: ${zoom}`);

            const bZoom = controlDataset.getZoomIndexForBinSize(binSize);
            if (bZoom < 0) throw new Error(`Invalid binSize for "B" map: ${binSize}`);

            return bZoom;
        }
    }

    /**
     * This is where the image tile is actually drawn, if not in the cache
     *
     * @param ds
     * @param dsControl
     * @param zd
     * @param zdControl
     * @param row
     * @param column
     * @param state
     * @returns {Promise<{image: HTMLCanvasElement, column: *, row: *, blockBinCount}|{image, inProgress: boolean, column: *, row: *, blockBinCount}|*>}
     */
    async getImageTile(ds, dsControl, zd, zdControl, row, column, state) {

        const key = `${zd.chr1.name}_${zd.chr2.name}_${zd.zoom.binSize}_${zd.zoom.unit}_${row}_${column}_${state.normalization}_${this.displayMode}`

        if (this.imageTileCache.hasOwnProperty(key)) {
            return this.imageTileCache[key]

        } else {
            if (this.drawsInProgress.has(key)) {
                //console.log("In progress")
                const imageSize = imageTileDimension
                const image = inProgressTile(imageSize)
                return {
                    row: row,
                    column: column,
                    blockBinCount: imageTileDimension,
                    image: image,
                    inProgress: true
                }  // TODO return an image at a coarser resolution if avaliable

            }
            this.drawsInProgress.add(key)

            try {
                this.startSpinner()
                const sameChr = zd.chr1.index === zd.chr2.index
                const transpose = sameChr && row < column
                const averageCount = zd.averageCount
                const ctrlAverageCount = zdControl ? zdControl.averageCount : 1
                const averageAcrossMapAndControl = (averageCount + ctrlAverageCount) / 2

                const imageSize = imageTileDimension
                const image = document.createElement('canvas')
                image.width = imageSize
                image.height = imageSize
                const ctx = image.getContext('2d')
                //ctx.clearRect(0, 0, image.width, image.height);

                // Get blocks
                const widthInBP = imageTileDimension * zd.zoom.binSize
                const x0bp = column * widthInBP
                const region1 = {chr: zd.chr1.name, start: x0bp, end: x0bp + widthInBP}
                const y0bp = row * widthInBP
                const region2 = {chr: zd.chr2.name, start: y0bp, end: y0bp + widthInBP}
                const records = await ds.getContactRecords(state.normalization, region1, region2, zd.zoom.unit, zd.zoom.binSize)
                let cRecords
                if (zdControl) {
                    cRecords = await dsControl.getContactRecords(state.normalization, region1, region2, zdControl.zoom.unit, zdControl.zoom.binSize)
                }

                if (records.length > 0) {

                    const controlRecords = {}
                    if ('AOB' === this.displayMode || 'BOA' === this.displayMode || 'AMB' === this.displayMode) {
                        for (let record of cRecords) {
                            controlRecords[record.getKey()] = record
                        }
                    }

                    let id = ctx.getImageData(0, 0, image.width, image.height)


                    const x0 = transpose ? row * imageTileDimension : column * imageTileDimension
                    const y0 = transpose ? column * imageTileDimension : row * imageTileDimension
                    for (let i = 0; i < records.length; i++) {

                        const rec = records[i]
                        let x = Math.floor((rec.bin1 - x0))
                        let y = Math.floor((rec.bin2 - y0))

                        if (transpose) {
                            const t = y
                            y = x
                            x = t
                        }

                        let rgba
                        switch (this.displayMode) {

                            case 'AOB':
                            case 'BOA':
                                let key = rec.getKey()
                                let controlRec = controlRecords[key]
                                if (!controlRec) {
                                    continue    // Skip
                                }
                                let score = (rec.counts / averageCount) / (controlRec.counts / ctrlAverageCount)

                                rgba = this.ratioColorScale.getColor(score)

                                break

                            case 'AMB':
                                key = rec.getKey()
                                controlRec = controlRecords[key]
                                if (!controlRec) {
                                    continue    // Skip
                                }
                                score = averageAcrossMapAndControl * ((rec.counts / averageCount) - (controlRec.counts / ctrlAverageCount))

                                rgba = this.diffColorScale.getColor(score)

                                break

                            default:    // Either 'A' or 'B'
                                rgba = this.colorScale.getColor(rec.counts)
                        }

                        // TODO -- verify that this bitblting is faster than fillRect
                        setPixel(id, x, y, rgba.red, rgba.green, rgba.blue, rgba.alpha)
                        if (sameChr && row === column) {
                            setPixel(id, y, x, rgba.red, rgba.green, rgba.blue, rgba.alpha)
                        }

                    }

                    ctx.putImageData(id, 0, 0)
                }


                if (true === doLegacyTrack2DRendering) {

                    //Draw 2D tracks
                    ctx.save()
                    ctx.lineWidth = 2

                    const onDiagonalTile = sameChr && row === column

                    for (let track2D of this.browser.tracks2D) {
                        const skip =
                            !track2D.isVisible ||
                            (sameChr && "lower" === track2D.displayMode  && row < column) ||
                            (sameChr && "upper" === track2D.displayMode && row > column)

                        if (!skip) {

                            const chr1Name = zd.chr1.name
                            const chr2Name = zd.chr2.name

                            const features = track2D.getFeatures(chr1Name, chr2Name)

                            if (features) {

                                for (let {chr1, x1, x2, y1, y2, color} of features) {

                                    ctx.strokeStyle = track2D.color || color

                                    // Chr name order -- test for equality of zoom data chr1 and feature chr1
                                    const flip = chr1Name !== chr1

                                    //Note: transpose = sameChr && row < column
                                    const fx1 = transpose || flip ? y1 : x1
                                    const fx2 = transpose || flip ? y2 : x2
                                    const fy1 = transpose || flip ? x1 : y1
                                    const fy2 = transpose || flip ? x2 : y2

                                    let px1 = (fx1 - x0bp) / zd.zoom.binSize
                                    let px2 = (fx2 - x0bp) / zd.zoom.binSize
                                    let py1 = (fy1 - y0bp) / zd.zoom.binSize
                                    let py2 = (fy2 - y0bp) / zd.zoom.binSize
                                    let w = px2 - px1
                                    let h = py2 - py1

                                    const dim = Math.max(image.width, image.height)
                                    if (px2 > 0 && px1 < dim && py2 > 0 && py1 < dim) {


                                        if (!onDiagonalTile || "upper" !== track2D.displayMode) {
                                            ctx.strokeRect(px1, py1, w, h)
                                        }

                                        // By convention intra-chromosome data is always stored in lower diagonal coordinates.
                                        // If we are on a diagonal tile, draw the symmetrical reflection unless display mode is lower
                                        if (onDiagonalTile && "lower" !== track2D.displayMode) {
                                            ctx.strokeRect(py1, px1, h, w)
                                        }
                                    }
                                }

                            } // if (features)

                        }
                    }

                    ctx.restore()

                } // if (true === doLegacyTrack2DRendering)

                // Uncomment to reveal tile boundaries for debugging.
                // ctx.strokeStyle = "rgb(255,255,255)"
                // ctx.strokeStyle = "pink"
                // ctx.strokeRect(0, 0, image.width - 1, image.height - 1)

                const imageTile = { row, column, blockBinCount: imageTileDimension, image }

                if (this.imageTileCacheLimit > 0) {
                    if (this.imageTileCacheKeys.length > this.imageTileCacheLimit) {
                        delete this.imageTileCache[this.imageTileCacheKeys[0]]
                        this.imageTileCacheKeys.shift()
                    }
                    this.imageTileCache[key] = imageTile

                }

                return imageTile

            } finally {
                this.drawsInProgress.delete(key)
                this.stopSpinner()
            }
        }


        function setPixel(imageData, x, y, r, g, b, a) {
            const index = (x + y * imageData.width) * 4
            imageData.data[index + 0] = r
            imageData.data[index + 1] = g
            imageData.data[index + 2] = b
            imageData.data[index + 3] = a
        }

    }

    /**
     * Return a promise to adjust the color scale, if needed.  This function might need to load the contact
     * data to computer scale.
     *
     * @param zd
     * @param row1
     * @param row2
     * @param col1
     * @param col2
     * @param normalization
     * @returns {*}
     */
    async checkColorScale(ds, zd, row1, row2, col1, col2, normalization) {

        // Safety check: ensure state exists before accessing it
        if (!this.browser.state) {
            return this.colorScale;
        }

        const colorKey = colorScaleKey(this.browser.state, this.displayMode)   // This doesn't feel right, state should be an argument
        if ('AOB' === this.displayMode || 'BOA' === this.displayMode) {
            return this.ratioColorScale     // Don't adjust color scale for A/B.
        }

        if (this.colorScaleThresholdCache[colorKey]) {
            const changed = this.colorScale.threshold !== this.colorScaleThresholdCache[colorKey]
            this.colorScale.setThreshold(this.colorScaleThresholdCache[colorKey])
            if (changed) {
                this.browser.notifyColorScale(this.colorScale)
            }
            return this.colorScale
        } else {
            try {
                const widthInBP = imageTileDimension * zd.zoom.binSize
                const x0bp = col1 * widthInBP
                const xWidthInBP = (col2 - col1 + 1) * widthInBP
                const region1 = {chr: zd.chr1.name, start: x0bp, end: x0bp + xWidthInBP}
                const y0bp = row1 * widthInBP
                const yWidthInBp = (row2 - row1 + 1) * widthInBP
                const region2 = {chr: zd.chr2.name, start: y0bp, end: y0bp + yWidthInBp}
                const records = await ds.getContactRecords(normalization, region1, region2, zd.zoom.unit, zd.zoom.binSize, true)

                let s = computePercentile(records, 95)
                if (!isNaN(s)) {  // Can return NaN if all blocks are empty
                    if (0 === zd.chr1.index) s *= 4   // Heuristic for whole genome view
                    this.colorScale = new ColorScale(this.colorScale)
                    this.colorScale.setThreshold(s)
                    this.computeColorScale = false
                    this.browser.notifyColorScale(this.colorScale)
                    this.colorScaleThresholdCache[colorKey] = s
                }

                return this.colorScale
            } finally {
                this.stopSpinner()
            }


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
            const sy = ((newGenomicExtent.y - this.genomicExtent.y) / this.genomicExtent.w) * viewportHeight;
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
        }
        this.spinnerCount = Math.max(0, this.spinnerCount); // This should not be necessary
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

                this.browser.notifyUpdateContactMapMousePosition(xy);

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

        const renderFeatures = (xS, xE, yS, yE) => {

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

        const renderLowerFeatures = (track2D, features) => {
            for (const { chr1, x1:xS, x2:xE, y1:yS, y2:yE, color } of features) {

                const flip = chr1Name !== chr1

                this.ctx.strokeStyle = track2D.color || color
                renderFeatures(xS, xE, yS, yE)
            }
        }

        const renderUpperFeatures = (track2D, features) => {
            for (const { chr1, x1:yS, x2:yE, y1:xS, y2:xE, color } of features) {

                const flip = chr1Name !== chr1

                this.ctx.strokeStyle = track2D.color || color
                renderFeatures(xS, xE, yS, yE)
            }
        }

        for (const track2D of track2DList) {

            if (false === track2D.isVisible) {
                continue
            }

            const features = track2D.getFeatures(zoomData.chr1.name, zoomData.chr1.name)

            if (features) {

                if ('COLLAPSED' === track2D.displayMode || undefined === track2D.displayMode) {
                    renderLowerFeatures(track2D, features)
                    renderUpperFeatures(track2D, features)
                } else if ('lower' === track2D.displayMode) {
                    renderLowerFeatures(track2D, features)
                } else if ('upper' === track2D.displayMode) {
                    renderUpperFeatures(track2D, features)
                }

            }


        }

        this.ctx.restore()

    }
}

ContactMatrixView.defaultBackgroundColor = {r: 255, g: 255, b: 255}

function colorScaleKey(state, displayMode) {
    // Safety check: ensure state exists before accessing its properties
    if (!state) {
        return "unknown_" + displayMode;
    }
    return "" + state.chr1 + "_" + state.chr2 + "_" + state.zoom + "_" + state.normalization + "_" + displayMode
}

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

function computePercentile(records, p) {
    const counts = records.map(r => r.counts)
    counts.sort(function (a, b) {
        return a - b
    })
    const idx = Math.floor((p / 100) * records.length)
    return counts[idx]

    // return HICMath.percentile(array, p);
}

export default ContactMatrixView
