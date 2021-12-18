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

import $ from '../vendor/jquery-3.3.1.slim.js'
import {IGVColor} from '../node_modules/igv-utils/src/index.js'
import ColorScale from './colorScale.js'
import HICEvent from './hicEvent.js'
import * as hicUtils from './hicUtils.js'

const DRAG_THRESHOLD = 2;
const DOUBLE_TAP_DIST_THRESHOLD = 20;
const DOUBLE_TAP_TIME_THRESHOLD = 300;

const imageTileDimension = 685;

class ContactMatrixView {


    constructor(browser, $viewport, sweepZoom, scrollbarWidget, colorScale, ratioColorScale, backgroundColor) {


        this.browser = browser;
        this.$viewport = $viewport;
        this.sweepZoom = sweepZoom;
        this.scrollbarWidget = scrollbarWidget;

        // Set initial color scales.  These might be overriden / adjusted via parameters
        this.colorScale = colorScale;

        this.ratioColorScale = ratioColorScale;
        // this.diffColorScale = new RatioColorScale(100, false);

        this.backgroundColor = backgroundColor;
        this.backgroundRGBString = IGVColor.rgbColor(backgroundColor.r, backgroundColor.g, backgroundColor.b)

        this.$canvas = $viewport.find('canvas');
        this.ctx = this.$canvas.get(0).getContext('2d');

        this.$fa_spinner = $viewport.find('.fa-spinner');
        this.spinnerCount = 0;

        this.$x_guide = $viewport.find("div[id$='-x-guide']");
        this.$y_guide = $viewport.find("div[id$='-y-guide']");

        this.displayMode = 'A';
        this.imageTileCache = {};
        this.imageTileCacheKeys = [];
        this.imageTileCacheLimit = 8; //8 is the minimum number required to support A/B cycling
        this.colorScaleThresholdCache = {};


        this.browser.eventBus.subscribe("NormalizationChange", this);
        this.browser.eventBus.subscribe("TrackLoad2D", this);
        this.browser.eventBus.subscribe("TrackState2D", this);
        this.browser.eventBus.subscribe("MapLoad", this)
        this.browser.eventBus.subscribe("ControlMapLoad", this);
        this.browser.eventBus.subscribe("ColorChange", this)

        this.drawsInProgress = new Set()
    }

    setBackgroundColor(rgb) {
        this.backgroundColor = rgb
        this.backgroundRGBString = IGVColor.rgbColor(rgb.r, rgb.g, rgb.b)
        this.repaint()
    }

    stringifyBackgroundColor() {
        return `${this.backgroundColor.r},${this.backgroundColor.g},${this.backgroundColor.b}`;
    }

    static parseBackgroundColor(rgbString) {
        const [r, g, b] = rgbString.split(",").map(str => parseInt(str))
        return {r, g, b}
    }

    setColorScale(colorScale) {

        switch (this.displayMode) {
            case 'AOB':
            case 'BOA':
                this.ratioColorScale = colorScale;
                break;
            case 'AMB':
                this.diffColorScale = colorScale;
                break;
            default:
                this.colorScale = colorScale;
        }
        this.colorScaleThresholdCache[colorScaleKey(this.browser.state, this.displayMode)] = colorScale.threshold;
    }

    async setColorScaleThreshold(threshold) {
        this.getColorScale().setThreshold(threshold);
        this.colorScaleThresholdCache[colorScaleKey(this.browser.state, this.displayMode)] = threshold;
        this.imageTileCache = {};
        await this.update()
    }

    getColorScale() {
        switch (this.displayMode) {
            case 'AOB':
            case 'BOA':
                return this.ratioColorScale;
            case 'AMB':
                return this.diffColorScale;
            default:
                return this.colorScale;
        }
    }

    async setDisplayMode(mode) {
        this.displayMode = mode;
        this.clearImageCaches();
        await this.update();
    }

    clearImageCaches() {
        this.imageTileCache = {};
        this.imageTileCacheKeys = [];
    }

    getViewDimensions() {
        return {
            width: this.$viewport.width(),
            height: this.$viewport.height()
        }
    }

    async receiveEvent(event) {

        if ("MapLoad" === event.type || "ControlMapLoad" === event.type) {

            // Don't enable mouse actions until we have a dataset.
            if (!this.mouseHandlersEnabled) {
                this.addTouchHandlers(this.$viewport);
                this.addMouseHandlers(this.$viewport);
                this.mouseHandlersEnabled = true;
            }
            this.clearImageCaches();
            this.colorScaleThresholdCache = {};
        } else {
            if (!("LocusChange" === event.type)) {
                this.clearImageCaches();
            }
            this.update();
        }
    }

    async update() {

        if (this.disableUpdates) return   // This flag is set during browser startup

        await this.repaint()

    }

    async repaint() {

        if (!this.browser.dataset) {
            return;
        }

        const viewportWidth = this.$viewport.width()
        const viewportHeight = this.$viewport.height()
        const canvasWidth = this.$canvas.width()
        const canvasHeight = this.$canvas.height()
        if (canvasWidth !== viewportWidth || canvasHeight !== viewportHeight) {
            this.$canvas.width(viewportWidth);
            this.$canvas.height(viewportHeight);
            this.$canvas.attr('width', this.$viewport.width());
            this.$canvas.attr('height', this.$viewport.height());
        }

        const browser = this.browser;
        const state = browser.state;

        let ds;
        let dsControl;
        let zdControl;
        let zoom;
        let controlZoom;
        switch (this.displayMode) {
            case 'A':
                zoom = state.zoom;
                ds = this.browser.dataset;
                break;
            case 'B':
                zoom = getBZoomIndex(state.zoom);
                ds = this.browser.controlDataset;
                break;
            case 'AOB':
            case 'AMB':
                zoom = state.zoom;
                controlZoom = getBZoomIndex(state.zoom);
                ds = this.browser.dataset
                dsControl = this.browser.controlDataset
                break;
            case 'BOA':
                zoom = getBZoomIndex(state.zoom);
                controlZoom = state.zoom;
                ds = this.browser.controlDataset
                dsControl = this.browser.dataset
        }

        const matrix = await ds.getMatrix(state.chr1, state.chr2)
        const unit = "BP";   // FRAG is not supported
        const zd = matrix.getZoomDataByIndex(zoom, unit);

        if (dsControl) {
            const matrixControl = await dsControl.getMatrix(state.chr1, state.chr2)
            zdControl = matrixControl.getZoomDataByIndex(controlZoom, unit);
        }

        const pixelSizeInt = Math.max(1, Math.floor(state.pixelSize))
        const widthInBins = this.$viewport.width() / pixelSizeInt
        const heightInBins = this.$viewport.height() / pixelSizeInt
        const blockCol1 = Math.floor(state.x / imageTileDimension)
        const blockCol2 = Math.floor((state.x + widthInBins) / imageTileDimension)
        const blockRow1 = Math.floor(state.y / imageTileDimension)
        const blockRow2 = Math.floor((state.y + heightInBins) / imageTileDimension)

        if ("NONE" !== state.normalization) {
            if (!ds.hasNormalizationVector(state.normalization, zd.chr1.name, zd.zoom.unit, zd.zoom.binSize)) {
                Alert.presentAlert("Normalization option " + normalization + " unavailable at this resolution.");
                this.browser.eventBus.post(new HICEvent("NormalizationExternalChange", "NONE"));
                state.normalization = "NONE";
            }
        }

        await this.checkColorScale(ds, zd, blockRow1, blockRow2, blockCol1, blockCol2, state.normalization)

        this.ctx.clearRect(0, 0, viewportWidth, viewportHeight);
        for (let r = blockRow1; r <= blockRow2; r++) {
            for (let c = blockCol1; c <= blockCol2; c++) {
                const tile = await this.getImageTile(ds, dsControl, zd, zdControl, r, c, state)
                if (tile.image) {
                    this.paintTile(tile)
                }
            }
        }

        // Record genomic extent of current canvas
        this.genomicExtent = {
            chr1: state.chr1,
            chr2: state.chr2,
            x: state.x * zd.zoom.binSize,
            y: state.y * zd.zoom.binSize,
            w: viewportWidth * zd.zoom.binSize / state.pixelSize,
            h: viewportHeight * zd.zoom.binSize / state.pixelSize
        }

        function getBZoomIndex(zoom) {
            const binSize = browser.dataset.getBinSizeForZoomIndex(zoom);
            if (!binSize) {
                throw Error("Invalid zoom (resolution) index: " + zoom);
            }
            const bZoom = browser.controlDataset.getZoomIndexForBinSize(binSize);
            if (bZoom < 0) {
                throw Error(`Invalid binSize for "B" map: ${binSize}`);
            }
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
                const image = document.createElement('canvas');
                image.width = imageSize;
                image.height = imageSize;
                const ctx = image.getContext('2d');
                //ctx.clearRect(0, 0, image.width, image.height);

                // Get blocks
                const widthInBP = imageTileDimension * zd.zoom.binSize;
                const x0bp = column * widthInBP;
                const region1 = {chr: zd.chr1.name, start: x0bp, end: x0bp + widthInBP};
                const y0bp = row * widthInBP;
                const region2 = {chr: zd.chr2.name, start: y0bp, end: y0bp + widthInBP};
                const records = await ds.getContactRecords(state.normalization, region1, region2, zd.zoom.unit, zd.zoom.binSize);
                let cRecords;
                if (zdControl) {
                    cRecords = await dsControl.getContactRecords(state.normalization, region1, region2, zdControl.zoom.unit, zdControl.zoom.binSize);
                }

                if (records.length > 0) {

                    const controlRecords = {};
                    if ('AOB' === this.displayMode || 'BOA' === this.displayMode || 'AMB' === this.displayMode) {
                        for (let record of cRecords) {
                            controlRecords[record.getKey()] = record
                        }
                    }

                    let id = ctx.getImageData(0, 0, image.width, image.height);


                    const x0 = transpose ? row * imageTileDimension : column * imageTileDimension;
                    const y0 = transpose ? column * imageTileDimension : row * imageTileDimension;
                    for (let i = 0; i < records.length; i++) {

                        const rec = records[i];
                        let x = Math.floor((rec.bin1 - x0));
                        let y = Math.floor((rec.bin2 - y0));

                        if (transpose) {
                            const t = y;
                            y = x;
                            x = t;
                        }

                        let rgba
                        switch (this.displayMode) {

                            case 'AOB':
                            case 'BOA':
                                let key = rec.getKey();
                                let controlRec = controlRecords[key];
                                if (!controlRec) {
                                    continue;    // Skip
                                }
                                let score = (rec.counts / averageCount) / (controlRec.counts / ctrlAverageCount);

                                rgba = this.ratioColorScale.getColor(score);

                                break;

                            case 'AMB':
                                key = rec.getKey();
                                controlRec = controlRecords[key];
                                if (!controlRec) {
                                    continue;    // Skip
                                }
                                score = averageAcrossMapAndControl * ((rec.counts / averageCount) - (controlRec.counts / ctrlAverageCount));

                                rgba = this.diffColorScale.getColor(score);

                                break;

                            default:    // Either 'A' or 'B'
                                rgba = this.colorScale.getColor(rec.counts);
                        }

                        // TODO -- verify that this bitblting is faster than fillRect
                        setPixel(id, x, y, rgba.red, rgba.green, rgba.blue, rgba.alpha);
                        if (sameChr && row === column) {
                            setPixel(id, y, x, rgba.red, rgba.green, rgba.blue, rgba.alpha);
                        }

                    }

                    ctx.putImageData(id, 0, 0);
                } else {
                    //console.log("No block for " + blockNumber);
                }

                //Draw 2D tracks
                ctx.save();
                ctx.lineWidth = 2;
                for (let track2D of this.browser.tracks2D) {

                    if (track2D.isVisible) {

                        const chr1Name = zd.chr1.name;
                        const chr2Name = zd.chr2.name;
                        const features = track2D.getFeatures(chr1Name, chr2Name);

                        if (features) {

                            for (let {chr1, x1, x2, y1, y2, color} of features) {

                                // Chr name order
                                const flip = chr1Name !== chr1;

                                const fx1 = transpose || flip ? y1 : x1;
                                const fx2 = transpose || flip ? y2 : x2;
                                const fy1 = transpose || flip ? x1 : y1;
                                const fy2 = transpose || flip ? x2 : y2;

                                let px1 = (fx1 - x0bp) / zd.zoom.binSize;
                                let px2 = (fx2 - x0bp) / zd.zoom.binSize;
                                let py1 = (fy1 - y0bp) / zd.zoom.binSize;
                                let py2 = (fy2 - y0bp) / zd.zoom.binSize;
                                let w = px2 - px1;
                                let h = py2 - py1;

                                const dim = Math.max(image.width, image.height);
                                if (px2 > 0 && px1 < dim && py2 > 0 && py1 < dim) {
                                    //console.log(`${row} ${column}    ${x1} ${x2}`)
                                    ctx.strokeStyle = track2D.color ? track2D.color : color;
                                    ctx.strokeRect(px1, py1, w, h);
                                    if (sameChr && row === column) {
                                        ctx.strokeRect(py1, px1, h, w);
                                    }
                                }
                            }
                        }
                    }
                }


                ctx.restore();

                // Uncomment to reveal tile boundaries for debugging.
                //  ctx.fillStyle = "rgb(255,255,255)";
                //  ctx.strokeRect(0, 0, image.width - 1, image.height - 1)


                var imageTile = {row: row, column: column, blockBinCount: imageTileDimension, image: image}


                if (this.imageTileCacheLimit > 0) {
                    if (this.imageTileCacheKeys.length > this.imageTileCacheLimit) {
                        delete this.imageTileCache[this.imageTileCacheKeys[0]]
                        this.imageTileCacheKeys.shift()
                    }
                    this.imageTileCache[key] = imageTile

                }

                return imageTile;

            } finally {
                //console.log("Finish load for " + key)
                this.drawsInProgress.delete(key)
                this.stopSpinner()
            }
        }


        function setPixel(imageData, x, y, r, g, b, a) {
            const index = (x + y * imageData.width) * 4;
            imageData.data[index + 0] = r;
            imageData.data[index + 1] = g;
            imageData.data[index + 2] = b;
            imageData.data[index + 3] = a;
        }

    };

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

        const colorKey = colorScaleKey(this.browser.state, this.displayMode);   // This doesn't feel right, state should be an argument
        if ('AOB' === this.displayMode || 'BOA' === this.displayMode) {
            return this.ratioColorScale;     // Don't adjust color scale for A/B.
        }

        if (this.colorScaleThresholdCache[colorKey]) {
            const changed = this.colorScale.threshold !== this.colorScaleThresholdCache[colorKey];
            this.colorScale.setThreshold(this.colorScaleThresholdCache[colorKey]);
            if (changed) {
                this.browser.eventBus.post(HICEvent("ColorScale", this.colorScale));
            }
            return this.colorScale;
        } else {
            try {
                const widthInBP = imageTileDimension * zd.zoom.binSize;
                const x0bp = col1 * widthInBP;
                const xWidthInBP = (col2 - col1 + 1) * widthInBP;
                const region1 = {chr: zd.chr1.name, start: x0bp, end: x0bp + xWidthInBP};
                const y0bp = row1 * widthInBP;
                const yWidthInBp = (row2 - row1 + 1) * widthInBP;
                const region2 = {chr: zd.chr2.name, start: y0bp, end: y0bp + yWidthInBp};
                const records = await ds.getContactRecords(normalization, region1, region2, zd.zoom.unit, zd.zoom.binSize, true);

                let s = computePercentile(records, 95);
                if (!isNaN(s)) {  // Can return NaN if all blocks are empty
                    if (0 === zd.chr1.index) s *= 4;   // Heuristic for whole genome view
                    this.colorScale = new ColorScale(this.colorScale);
                    this.colorScale.setThreshold(s);
                    this.computeColorScale = false;
                    this.browser.eventBus.post(HICEvent("ColorScale", this.colorScale));
                    this.colorScaleThresholdCache[colorKey] = s;
                }

                return this.colorScale;
            } finally {
                this.stopSpinner()
            }


        }

    }

    async zoomIn() {
        const state = this.browser.state
        const viewportWidth = this.$viewport.width()
        const viewportHeight = this.$viewport.height()
        const matrices = await getMatrices.call(this, state.chr1, state.chr2)

        var matrix = matrices[0];

        if (matrix) {
            const unit = "BP";
            const zd = await matrix.getZoomDataByIndex(state.zoom, unit);
            const newGenomicExtent = {
                x: state.x * zd.zoom.binSize,
                y: state.y * zd.zoom.binSize,
                w: viewportWidth * zd.zoom.binSize / state.pixelSize,
                h: viewportHeight * zd.zoom.binSize / state.pixelSize
            }

            // Zoom out not supported
            if (newGenomicExtent.w > this.genomicExtent.w) return

            const sx = ((newGenomicExtent.x - this.genomicExtent.x) / this.genomicExtent.w) * viewportWidth
            const sy = ((newGenomicExtent.y - this.genomicExtent.y) / this.genomicExtent.w) * viewportHeight
            const sWidth = (newGenomicExtent.w / this.genomicExtent.w) * viewportWidth
            const sHeight = (newGenomicExtent.h / this.genomicExtent.h) * viewportHeight
            const img = this.$canvas[0]

            const backCanvas = document.createElement('canvas');
            backCanvas.width = img.width;
            backCanvas.height = img.height;
            const backCtx = backCanvas.getContext('2d');
            backCtx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, viewportWidth, viewportHeight)

            this.ctx.clearRect(0, 0, viewportWidth, viewportHeight)
            this.ctx.drawImage(backCanvas, 0, 0)
        }
    }

    paintTile({image, row, column, blockBinCount}) {

        const x0 = blockBinCount * column
        const y0 = blockBinCount * row

        const {x, y, pixelSize} = this.browser.state
        //const pixelSizeInt = Math.max(1, Math.floor(pixelSize))
        const offsetX = (x0 - x) * pixelSize
        const offsetY = (y0 - y) * pixelSize

        const scale = pixelSize; // / pixelSizeInt
        const scaledWidth = image.width * scale
        const scaledHeight = image.height * scale

        const viewportWidth = this.$viewport.width()
        const viewportHeight = this.$viewport.height()

        if (offsetX <= viewportWidth && offsetX + scaledWidth >= 0 && offsetY <= viewportHeight && offsetY + scaledHeight >= 0) {
            this.ctx.fillStyle = this.backgroundRGBString;
            this.ctx.fillRect(offsetX, offsetY, scaledWidth, scaledHeight);
            if (scale === 1) {
                this.ctx.drawImage(image, offsetX, offsetY);
            } else {
                this.ctx.drawImage(image, offsetX, offsetY, scaledWidth, scaledHeight);
            }
            // Debugging aid, uncomment to see tile boundaries
            //this.ctx.strokeRect(offsetX, offsetY, scaledWidth, scaledHeight)
            //this.ctx.strokeText(`${row} ${column}`, offsetX, offsetY);
        }
    }

    startSpinner() {

        if (true === this.browser.isLoadingHICFile && this.browser.$user_interaction_shield) {
            this.browser.$user_interaction_shield.show();
        }
        this.$fa_spinner.css("display", "inline-block");
        this.spinnerCount++
    }

    stopSpinner() {
        this.spinnerCount--
        if (0 === this.spinnerCount) {
            this.$fa_spinner.css("display", "none")
        }
        this.spinnerCount = Math.max(0, this.spinnerCount)   // This should not be neccessary
    }


    addMouseHandlers($viewport) {

        let isMouseDown = false;
        let isSweepZooming = false;
        let mouseDown;
        let mouseLast;
        let mouseOver;

        const panMouseUpOrMouseOut = (e) => {
            if (true === this.isDragging) {
                this.isDragging = false;
                this.browser.eventBus.post(HICEvent("DragStopped"));
            }
            isMouseDown = false;
            mouseDown = mouseLast = undefined;
        }

        // function shiftCurrentImage(self, dx, dy) {
        //     var canvasWidth = self.$canvas.width(),
        //         canvasHeight = self.$canvas.height(),
        //         imageData;
        //
        //     imageData = self.ctx.getImageData(0, 0, canvasWidth, canvasHeight);
        //     self.ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        //     self.ctx.putImageData(imageData, dx, dy);
        // }
        //
        // function mouseWheelHandler(e) {
        //     e.preventDefault();
        //     e.stopPropagation();
        //
        //     const t = Date.now();
        //     if (lastWheelTime === undefined || (t - lastWheelTime > 1000)) {
        //         // cross-browser wheel delta  -- Firefox returns a "detail" object that is opposite in sign to wheelDelta
        //         var direction = e.deltaY < 0 ? 1 : -1,
        //             coords = DOMUtils.translateMouseCoordinates(e, $viewport[0]),
        //             x = coords.x,
        //             y = coords.y;
        //         self.browser.wheelClickZoom(direction, x, y);
        //         lastWheelTime = t;
        //     }
        // }


        this.isDragging = false;

        if (!this.browser.isMobile) {

            $viewport.dblclick((e) => {
                e.preventDefault();
                e.stopPropagation();
                const mouseX = e.offsetX || e.layerX
                const mouseY = e.offsetY || e.layerX;
                this.browser.zoomAndCenter(1, mouseX, mouseY);
            });

            $viewport.on('mouseover', (e) => mouseOver = true)

            $viewport.on('mouseout', (e) => mouseOver = undefined)

            $viewport.on('mousedown', (e) => {

                e.preventDefault();
                e.stopPropagation();

                if (this.browser.$menu.is(':visible')) {
                    this.browser.hideMenu();
                }

                mouseLast = {x: e.offsetX, y: e.offsetY};
                mouseDown = {x: e.offsetX, y: e.offsetY};

                isSweepZooming = (true === e.altKey);
                if (isSweepZooming) {
                    const eFixed = $.event.fix(e);
                    this.sweepZoom.initialize({x: eFixed.pageX, y: eFixed.pageY});
                }

                isMouseDown = true;

            })

            $viewport.on('mousemove', (e) => {

                e.preventDefault();
                e.stopPropagation();
                const coords =
                    {
                        x: e.offsetX,
                        y: e.offsetY
                    };

                // Sets pageX and pageY for browsers that don't support them
                const eFixed = $.event.fix(e);

                const xy =
                    {
                        x: eFixed.pageX - $viewport.offset().left,
                        y: eFixed.pageY - $viewport.offset().top
                    };

                const {width, height} = $viewport.get(0).getBoundingClientRect();
                xy.xNormalized = xy.x / width;
                xy.yNormalized = xy.y / height;


                this.browser.eventBus.post(HICEvent("UpdateContactMapMousePosition", xy, false));

                if (true === this.willShowCrosshairs) {
                    this.browser.updateCrosshairs(xy);
                    this.browser.showCrosshairs();
                }

                if (isMouseDown) { // Possibly dragging

                    if (isSweepZooming) {
                        this.sweepZoom.update({x: eFixed.pageX, y: eFixed.pageY});

                    } else if (mouseDown.x && Math.abs(coords.x - mouseDown.x) > DRAG_THRESHOLD) {

                        this.isDragging = true;
                        const dx = mouseLast.x - coords.x;
                        const dy = mouseLast.y - coords.y;

                        // If matrix data is updating shift current map image while we wait
                        //if (this.updating) {
                        //    shiftCurrentImage(this, -dx, -dy);
                        //}

                        this.browser.shiftPixels(dx, dy);
                    }

                    mouseLast = coords;
                }
            })

            $viewport.on('mouseup', panMouseUpOrMouseOut)

            $viewport.on('mouseleave', () => {
                this.browser.layoutController.xAxisRuler.unhighlightWholeChromosome();
                this.browser.layoutController.yAxisRuler.unhighlightWholeChromosome();
                panMouseUpOrMouseOut();
            })


            // Mousewheel events -- ie exposes event only via addEventListener, no onwheel attribute
            // NOte from spec -- trackpads commonly map pinch to mousewheel + ctrl
            // $viewport[0].addEventListener("wheel", mouseWheelHandler, 250, false);

            // document level events
            $(document).on('keydown.contact_matrix_view', (e) => {
                if (undefined === this.willShowCrosshairs && true === mouseOver && true === e.shiftKey) {
                    this.willShowCrosshairs = true;
                    this.browser.eventBus.post(HICEvent('DidShowCrosshairs', 'DidShowCrosshairs', false));
                }
            })

            $(document).on('keyup.contact_matrix_view', (e) => {
                this.browser.hideCrosshairs();
                this.willShowCrosshairs = undefined;
                this.browser.eventBus.post(HICEvent('DidHideCrosshairs', 'DidHideCrosshairs', false));
            })

            // for sweep-zoom allow user to sweep beyond viewport extent
            // sweep area clamps since viewport mouse handlers stop firing
            // when the viewport boundary is crossed.
            $(document).on('mouseup.contact_matrix_view', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isSweepZooming) {
                    isSweepZooming = false;
                    this.sweepZoom.commit();
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

    addTouchHandlers($viewport) {

        let lastTouch, pinch;
        const viewport = $viewport[0];

        /**
         * Touch start -- 3 possibilities
         *   (1) beginning of a drag (pan)
         *   (2) first tap of a double tap
         *   (3) beginning of a pinch
         */
        viewport.ontouchstart = (ev) => {

            ev.preventDefault();
            ev.stopPropagation();

            var touchCoords = translateTouchCoordinates(ev.targetTouches[0], viewport),
                offsetX = touchCoords.x,
                offsetY = touchCoords.y,
                count = ev.targetTouches.length,
                timeStamp = ev.timeStamp || Date.now(),
                resolved = false,
                dx, dy, dist, direction;

            if (count === 2) {
                touchCoords = translateTouchCoordinates(ev.targetTouches[0], viewport);
                offsetX = (offsetX + touchCoords.x) / 2;
                offsetY = (offsetY + touchCoords.y) / 2;
            }

            // NOTE: If the user makes simultaneous touches, the browser may fire a
            // separate touchstart event for each touch point. Thus if there are
            // two simultaneous touches, the first touchstart event will have
            // targetTouches length of one and the second event will have a length
            // of two.  In this case replace previous touch with this one and return
            if (lastTouch && (timeStamp - lastTouch.timeStamp < DOUBLE_TAP_TIME_THRESHOLD) && ev.targetTouches.length > 1 && lastTouch.count === 1) {
                lastTouch = {x: offsetX, y: offsetY, timeStamp: timeStamp, count: ev.targetTouches.length};
                return;
            }


            if (lastTouch && (timeStamp - lastTouch.timeStamp < DOUBLE_TAP_TIME_THRESHOLD)) {

                direction = (lastTouch.count === 2 || count === 2) ? -1 : 1;
                dx = lastTouch.x - offsetX;
                dy = lastTouch.y - offsetY;
                dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < DOUBLE_TAP_DIST_THRESHOLD) {
                    this.browser.zoomAndCenter(direction, offsetX, offsetY);
                    lastTouch = undefined;
                    resolved = true;
                }
            }

            if (!resolved) {
                lastTouch = {x: offsetX, y: offsetY, timeStamp: timeStamp, count: ev.targetTouches.length};
            }
        }

        viewport.ontouchmove = hicUtils.throttle((ev) => {

            var touchCoords1, touchCoords2, t;

            ev.preventDefault();
            ev.stopPropagation();

            if (ev.targetTouches.length === 2) {

                // Update pinch  (assuming 2 finger movement is a pinch)
                touchCoords1 = translateTouchCoordinates(ev.targetTouches[0], viewport);
                touchCoords2 = translateTouchCoordinates(ev.targetTouches[1], viewport);

                t = {
                    x1: touchCoords1.x,
                    y1: touchCoords1.y,
                    x2: touchCoords2.x,
                    y2: touchCoords2.y
                };

                if (pinch) {
                    pinch.end = t;
                } else {
                    pinch = {start: t};
                }
            } else {
                // Assuming 1 finger movement is a drag

                var touchCoords = translateTouchCoordinates(ev.targetTouches[0], viewport),
                    offsetX = touchCoords.x,
                    offsetY = touchCoords.y;
                if (lastTouch) {
                    var dx = lastTouch.x - offsetX,
                        dy = lastTouch.y - offsetY;
                    if (!isNaN(dx) && !isNaN(dy)) {
                        this.isDragging = true
                        this.browser.shiftPixels(lastTouch.x - offsetX, lastTouch.y - offsetY);
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

        viewport.ontouchend = (ev) => {

            ev.preventDefault();
            ev.stopPropagation();

            if (pinch && pinch.end !== undefined) {

                var startT = pinch.start,
                    endT = pinch.end,
                    dxStart = startT.x2 - startT.x1,
                    dyStart = startT.y2 - startT.y1,
                    dxEnd = endT.x2 - endT.x1,
                    dyEnd = endT.y2 - endT.y1,
                    distStart = Math.sqrt(dxStart * dxStart + dyStart * dyStart),
                    distEnd = Math.sqrt(dxEnd * dxEnd + dyEnd * dyEnd),
                    scale = distEnd / distStart,
                    deltaX = (endT.x1 + endT.x2) / 2 - (startT.x1 + startT.x2) / 2,
                    deltaY = (endT.y1 + endT.y2) / 2 - (startT.y1 + startT.y2) / 2,
                    anchorPx = (startT.x1 + startT.x2) / 2,
                    anchorPy = (startT.y1 + startT.y2) / 2;

                if (scale < 0.8 || scale > 1.2) {
                    lastTouch = undefined;
                    this.browser.pinchZoom(anchorPx, anchorPy, scale);
                }
            } else if (this.isDragging) {
                this.isDragging = false;
                this.browser.eventBus.post(HICEvent("DragStopped"));
            }

            // a touch end always ends a pinch
            pinch = undefined;

        }

        function translateTouchCoordinates(e, target) {

            var $target = $(target),
                posx,
                posy;
            posx = e.pageX - $target.offset().left;
            posy = e.pageY - $target.offset().top;
            return {x: posx, y: posy}
        }

    }

}

ContactMatrixView.defaultBackgroundColor = {r: 255, g: 255, b: 255}

function colorScaleKey(state, displayMode) {
    return "" + state.chr1 + "_" + state.chr2 + "_" + state.zoom + "_" + state.normalization + "_" + displayMode;
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
        image = document.createElement('canvas');
        image.width = imageSize;
        image.height = imageSize;
        const ctx = image.getContext('2d');
        ctx.font = '24px sans-serif';
        ctx.fillStyle = 'rgb(230, 230, 230)'
        ctx.fillRect(0, 0, image.width, image.height)
        ctx.fillStyle = 'black'
        for (let i = 100; i < imageSize; i += 300) {
            for (let j = 100; j < imageSize; j += 300) {
                ctx.fillText('Loading...', i, j);
            }
        }
        inProgressCache[imageSize] = image
    }
    return image;
}

function getMatrices(chr1, chr2) {

    var promises = [];
    if ('B' === this.displayMode && this.browser.controlDataset) {
        promises.push(this.browser.controlDataset.getMatrix(chr1, chr2));
    } else {
        promises.push(this.browser.dataset.getMatrix(chr1, chr2));
        if (this.displayMode && 'A' !== this.displayMode && this.browser.controlDataset) {
            promises.push(this.browser.controlDataset.getMatrix(chr1, chr2));
        }
    }
    return Promise.all(promises);
}


function computePercentile(records, p) {
    const counts = records.map(r => r.counts)
    counts.sort(function (a, b) {
        return a - b;
    })
    const idx = Math.floor((p / 100) * records.length);
    return counts[idx];

    // return HICMath.percentile(array, p);
}

export default ContactMatrixView
