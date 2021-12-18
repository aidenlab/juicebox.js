/**
 * Created by dat on 4/5/17.
 */

import {DOMUtils} from '../node_modules/igv-utils/src/index.js'
import {ColorPicker, DataRangeDialog} from '../node_modules/igv-ui/dist/igv-ui.js'
import $ from '../vendor/jquery-3.3.1.slim.js'
import MenuUtils from "./trackMenuUtils.js"
import MenuPopup from "./trackMenuPopup.js"
import {createIcon} from "./igv-icons.js"
import {doAutoscale} from "./igv/util/igvUtils.js"

class TrackPair {

    constructor(browser, trackHeight, $x_tracks, $y_tracks, track, index) {

        this.browser = browser;
        this.track = track;
        this.x = new TrackRenderer(browser, {height: trackHeight}, $x_tracks, track, 'x', index)
        this.y = new TrackRenderer(browser, {width: trackHeight}, $y_tracks, track, 'y', index)
        this.init();
    }

    init() {

        this.colorPicker = new ColorPicker({
            parent: this.x.$viewport[0],
            width: 456,
            height: undefined,
            colorHandler: color => this.setColor(color)
        });
        this.colorPicker.hide();

        this.dataRangeDialog = new DataRangeDialog(this.x.$viewport[0],
            (min, max) => this.setDataRange(min, max));


        this.appendRightHandGutter(this.x.$viewport);

        // igvjs compatibility
        this.track.trackView = this;
        this.track.trackView.trackDiv = this.x.$viewport.get(0);

    }

    presentColorPicker() {
        const bbox = this.x.trackDiv.getBoundingClientRect();
        this.colorPicker.origin = {x: bbox.x, y: 0};
        this.colorPicker.$container.offset({left: this.colorPicker.origin.x, top: this.colorPicker.origin.y});
        this.colorPicker.$container.show();
    }

    setTrackName(name) {
        this.track.name = name;
        this.x.$label.text(name);
    }

    setColor(color) {
        this.y.tile = undefined;
        this.x.tile = undefined;
        this.track.color = color;
        this.repaintViews();
    }

    dataRange() {
        return this.track.dataRange ? this.track.dataRange : undefined;
    }

    setDataRange(min, max) {
        if (min !== undefined) {
            this.track.dataRange.min = min;
            this.track.config.min = min;
        }
        if (max !== undefined) {
            this.track.dataRange.max = max;
            this.track.config.max = max;
        }
        this.track.autoscale = false;
        this.track.config.autoScale = false
        this.y.tile = undefined;
        this.x.tile = undefined;
        this.repaintViews();
    }

    appendRightHandGutter($parent) {
        let $div = $('<div class="hic-igv-right-hand-gutter">')
        $parent.append($div)
        this.createTrackGearPopup($div);
    }

    createTrackGearPopup($parent) {

        let $container = $("<div>", {class: 'igv-trackgear-container'});
        $parent.append($container);

        $container.append(createIcon('cog'));

        this.trackGearPopup = new MenuPopup($parent);
        this.trackGearPopup.$popover.hide();
        $container.click(e => {
            e.preventDefault();
            e.stopPropagation();
            this.trackGearPopup.presentMenuList(-(this.trackGearPopup.$popover.width()), 0, MenuUtils.trackMenuItemList(this));
        });
    }

    async updateViews() {

        if (this.updating) {
            this.pending = true;
        } else {
            try {
                this.updating = true;
                const genomicStateX = this.browser.genomicState(this.x.axis);
                let imageTileX = await this.getTileX(genomicStateX);
                if (imageTileX) {
                    this.x.drawTile(imageTileX, genomicStateX);
                }

                const genomicStateY = this.browser.genomicState(this.y.axis);
                let imageTileY = await this.getTileY(genomicStateY);
                if (imageTileY) {
                    this.y.drawTile(imageTileY, genomicStateY);
                }
            } finally {
                this.updating = false;
                if (this.pending) {
                    this.pending = false;
                    this.updateViews();
                }
            }
        }
    }

    /**
     * Repaint current tiles with cached features (due to color, scale, or other visual attribute change)
     * @returns {Promise<void>}
     */
    async repaintViews() {

        const genomicStateX = this.browser.genomicState(this.x.axis);
        if (this.tileX) {
            this.tileX = await this.createImageTile(genomicStateX, this.tileX.features)
            this.x.drawTile(this.tileX, genomicStateX);
        }

        const genomicStateY = this.browser.genomicState(this.y.axis);
        if (this.tileY) {
            this.tileY = await this.createImageTile(genomicStateX, this.tileY.features)
            this.y.drawTile(this.tileY, genomicStateY);
        }
    }

    async getTileX(genomicState) {
        const chrName = genomicState.chromosome.name;
        const bpPerPixel = genomicState.bpp;
        if (!(this.tileX && this.tileX.containsRange(chrName, genomicState.startBP, genomicState.endBP, bpPerPixel))) {
            this.tileX = await this.createImageTile(genomicState);
        }
        return this.tileX;
    }

    async getTileY(genomicState) {
        const chrName = genomicState.chromosome.name;
        const bpPerPixel = genomicState.bpp;
        if (this.tileX && this.tileX.containsRange(chrName, genomicState.startBP, genomicState.endBP, bpPerPixel)) {
            this.tileY = this.tileX;
        } else if (!(this.tileY && this.tileY.containsRange(chrName, genomicState.startBP, genomicState.endBP, bpPerPixel))) {
            this.tileY = await this.createImageTile(genomicState);
        }
        return this.tileY;
    }

    async createImageTile(genomicState, tileFeatures) {

        const chrName = genomicState.chromosome.name;
        const bpPerPixel = genomicState.bpp

        if (bpPerPixel * Math.max(this.x.$canvas.width(), this.x.$canvas.height()) > this.track.visibilityWindow) {
            // TODO -- return zoom in message
        } else {

            // Expand the requested range so we can pan a bit without reloading
            const pixelWidth = 3 * this.x.$canvas.width();
            const lengthBP = Math.round(bpPerPixel * pixelWidth);
            const bpStart = Math.max(0, Math.round(genomicState.startBP - lengthBP / 3));
            const bpEnd = bpStart + lengthBP;

            const features = tileFeatures || await this.track.getFeatures(genomicState.chromosome.name, bpStart, bpEnd, bpPerPixel)

            const buffer = document.createElement('canvas');
            buffer.width = pixelWidth;
            buffer.height = this.x.$canvas.height();

            const context = buffer.getContext("2d");

            if (features) {
                const drawConfiguration =
                    {
                        features,
                        context,
                        pixelWidth,
                        bpStart,
                        bpEnd,
                        bpPerPixel,
                        genomicState,
                        pixelHeight: Math.min(buffer.width, buffer.height),
                        viewportContainerX: (genomicState.startBP - bpStart) / bpPerPixel,
                        viewportContainerWidth: pixelWidth,
                        viewportWidth: pixelWidth,
                        referenceFrame: {}
                    };

                if (this.track.autoscale || !this.track.dataRange) {
                    if (typeof this.track.doAutoscale === 'function') {
                        this.track.doAutoscale(features);
                    } else {
                        this.track.dataRange = doAutoscale(features);
                    }
                }
                this.track.draw(drawConfiguration);


            } else {
                context.clearRect(0, 0, this.$canvas.width(), this.$canvas.height());
            }

            this.tile = new Tile(chrName, bpStart, bpEnd, bpPerPixel, buffer, features);
            return this.tile
        }
    }

    dispose() {
        this['x'].dispose();
        this['y'].dispose();
    }
}

class TrackRenderer {

    constructor(browser, size, $container, track, axis, order) {

        this.browser = browser;
        this.track = track;
        this.id = `trackRender_${DOMUtils.guid()}`;
        this.axis = axis;
        this.init($container, size, order);

    }

    init($container, size, order) {

        var self = this;

        // track canvas container
        this.$viewport = ('x' === this.axis) ? $('<div class="x-track-canvas-container">') : $('<div class="y-track-canvas-container">');
        if (size.width) {
            this.$viewport.width(size.width);
        }
        if (size.height) {
            this.$viewport.height(size.height);
        }
        $container.append(this.$viewport);
        this.$viewport.css({order: order});

        // canvas
        this.$canvas = $('<canvas>');
        this.$viewport.append(this.$canvas);
        this.ctx = this.$canvas.get(0).getContext("2d");

        if ('x' === this.axis) {
            // label
            this.$label = $('<div class="x-track-label">');
            const str = this.track.name || 'untitled';
            this.$label.text(str);
            this.$viewport.append(this.$label);
            if (true === self.browser.showTrackLabelAndGutter) {
                this.$label.show();
            } else {
                this.$label.hide();
            }

            this.$viewport.on('click', function (e) {

                e.preventDefault();
                e.stopPropagation();

                self.browser.toggleTrackLabelAndGutterState();
                if (true === self.browser.showTrackLabelAndGutter) {
                    $('.x-track-label').show();
                    $('.hic-igv-right-hand-gutter').show();
                } else {
                    $('.x-track-label').hide();
                    $('.hic-igv-right-hand-gutter').hide();
                }
            })
        } else {
            // Context transform

            //this.ctx.rotate(Math.PI/2)
        }

        // track spinner container
        this.$spinner = ('x' === this.axis) ? $('<div class="x-track-spinner">') : $('<div class="y-track-spinner">');
        this.$viewport.append(this.$spinner);
        this.stopSpinner();

    }

    dispose($container, size, order) {
        this.tile = undefined;
        this.$viewport.remove();
    }


    syncCanvas() {
        this.$canvas.width(this.$viewport.width());
        this.$canvas.attr('width', this.$viewport.width());
        this.$canvas.height(this.$viewport.height());
        this.$canvas.attr('height', this.$viewport.height());
    }

    drawTile(tile, genomicState) {

        if (tile) {
            this.offsetPixel = Math.round((tile.startBP - genomicState.startBP) / genomicState.bpp);
            if ('x' === this.axis) {
                this.ctx.clearRect(0, 0, this.$canvas.width(), this.$canvas.height());
                this.ctx.drawImage(tile.buffer, this.offsetPixel, 0);
            } else {
                this.ctx.setTransform(0, 1, 1, 0, 0, 0)
                this.ctx.clearRect(0, 0, this.$canvas.height(), this.$canvas.width());
                this.ctx.drawImage(tile.buffer, this.offsetPixel, 0);
            }
        }
    }

    startSpinner() {
        this.browser.startSpinner();
    }

    stopSpinner() {
        this.browser.stopSpinner();
    }

    isLoading() {
        return !(undefined === this.loading);
    }

}

class Tile {

    constructor(chr, startBP, endBP, bpp, buffer, features) {
        this.chr = chr;
        this.startBP = startBP;
        this.endBP = endBP;
        this.bpp = bpp;
        this.buffer = buffer;
        this.features = features;
    }

    containsRange(chr, startBP, endBP, bpp) {
        return chr === this.chr && this.bpp === bpp && this.startBP <= startBP && this.endBP >= endBP;
    }
}

function compareGenomicStates(gs1, gs2) {
    return gs1.bpp === gs2.bpp && gs1.chromosome === gs2.chromosome && gs1.startBP === gs2.startBP && gs1.endBP === gs2.endBP;
}

export {TrackPair}
