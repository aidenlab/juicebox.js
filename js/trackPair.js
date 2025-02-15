/**
 * Created by dat on 4/5/17.
 */

import igv from '../node_modules/igv/dist/igv.esm.js'
import {ColorPicker, DataRangeDialog} from '../node_modules/igv-ui/dist/igv-ui.js'
import MenuUtils from "./trackMenuUtils.js"
import TrackGearPopup from "./trackGearPopup.js"
import {createIcon} from "./igv-icons.js"
import Tile from "./tile.js";

class TrackPair {

    constructor(browser, track) {
        this.browser = browser
        this.track = track
        this.x = undefined
        this.y = undefined
    }

    init() {
        this.colorPicker = new ColorPicker({
            parent: this.x.viewportElement,
            width: 456,
            height: undefined,
            colorHandler: color => this.setColor(color)
        });
        this.colorPicker.hide();

        this.dataRangeDialog = new DataRangeDialog(this.x.viewportElement, (min, max) => this.setDataRange(min, max));

        this.appendRightHandGutter(this.x.viewportElement);

        for (const el of this.x.trackReorderHandleElement.querySelectorAll('.fa')) {
            el.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();

                const direction = e.target.classList.contains('fa-arrow-up') ? -1 : 1;

                let order = parseInt(this.x.viewportElement.style.order);

                if (order === 0 && direction === -1) {
                    return;
                } else if (this.browser.trackPairs.length - 1 === order && direction === 1) {
                    return;
                }

                const newOrder = direction === -1 ? order - 1 : order + 1;

                const targetTrackPair = this.browser.trackPairs.find(
                    trackPair => newOrder === parseInt(trackPair.x.viewportElement.style.order)
                );

                if (targetTrackPair) {
                    targetTrackPair.x.viewportElement.style.order = `${order}`;
                    targetTrackPair.y.viewportElement.style.order = `${order}`;
                }

                this.x.viewportElement.style.order = `${newOrder}`;
                this.y.viewportElement.style.order = `${newOrder}`;

                const a = this.browser.trackPairs;
                [a[order], a[newOrder]] = [a[newOrder], a[order]];

                setTrackReorderArrowColors(this.browser.trackPairs);
            });
        }

        // igvjs compatibility
        this.track.trackView = this;
        this.track.trackView.trackDiv = this.x.viewportElement;
    }

    presentColorPicker() {
        const bbox = this.x.trackDiv.getBoundingClientRect();
        this.colorPicker.origin = { x: bbox.x, y: 0 };

        // Set the position of the colorPicker container
        this.colorPicker.containerElement.style.left = `${this.colorPicker.origin.x}px`;
        this.colorPicker.containerElement.style.top = `${this.colorPicker.origin.y}px`;

        // Show the colorPicker container
        this.colorPicker.containerElement.style.display = 'block';
    }

    setTrackLabelName(name) {
        this.x.labelElement.textContent = name;
        this.x.labelElement.title = name;
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

    appendRightHandGutter(parentElement) {
        const div = document.createElement('div');
        div.className = 'hic-igv-right-hand-gutter';
        parentElement.appendChild(div);
        this.createTrackGearPopup(div);
    }

    createTrackGearPopup(parentElement) {
        const container = document.createElement('div');
        container.className = 'igv-trackgear-container';
        parentElement.appendChild(container);

        container.appendChild(createIcon('cog'));

        this.trackGearPopup = new TrackGearPopup(parentElement);
        this.trackGearPopup.popoverElement.style.display = 'none';

        container.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();

            const { trackMenuItemList, numericDataMenuItems, nucleotideColorChartMenuItems } = MenuUtils;

            const list = [...trackMenuItemList(this)];

            if (this.track.type === 'wig') {
                list.push(...numericDataMenuItems(this));
            }

            if (this.track.type === 'sequence') {
                list.push(...nucleotideColorChartMenuItems(this));
            }

            const width = this.trackGearPopup.popoverElement.getBoundingClientRect().width;

            this.trackGearPopup.presentMenuList(-width, 0, list);
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
            this.tileX = await this.createImageTile({ axis: 'x', ...genomicStateX }, this.tileX.features)
            this.x.drawTile(this.tileX, genomicStateX);
        }

        const genomicStateY = this.browser.genomicState(this.y.axis);
        if (this.tileY) {
            this.tileY = await this.createImageTile({ axis: 'y', ...genomicStateY }, this.tileY.features)
            this.y.drawTile(this.tileY, genomicStateY)
        }
    }

    async getTileX(genomicState) {

        const { chromosome, bpp } = genomicState

        if (!(this.tileX && this.tileX.containsRange(chromosome.name, genomicState.startBP, genomicState.endBP, bpp))) {
            this.tileX = await this.createImageTile({ axis: 'x', ...genomicState })
        }

        return this.tileX
    }

    async getTileY(genomicState) {

        const { chromosome, bpp } = genomicState

        if (!(this.tileY && this.tileY.containsRange(chromosome.name, genomicState.startBP, genomicState.endBP, bpp))) {
            this.tileY = await this.createImageTile({ axis: 'y', ...genomicState })
        }

        return this.tileY
    }

    async createImageTile(genomicState, tileFeatures) {
        if (
            this.track.visibilityWindow > 0 &&
            genomicState.bpp * Math.max(this.x.canvasElement.width, this.x.canvasElement.height) > this.track.visibilityWindow
        ) {
            // TODO -- return zoom in message
        } else {
            // Expand the requested range so we can pan a bit without reloading
            const pixelWidth = 3 * this.x.canvasElement.width;
            const lengthBP = Math.round(genomicState.bpp * pixelWidth);
            const bpStart = Math.max(0, Math.round(genomicState.startBP - lengthBP / 3));
            const bpEnd = bpStart + lengthBP;

            const features = tileFeatures || await this.track.getFeatures(
                genomicState.chromosome.name,
                bpStart,
                bpEnd,
                genomicState.bpp
            );

            const canvas = document.createElement('canvas');
            canvas.width = pixelWidth;
            canvas.height = this.x.canvasElement.height;

            const context = canvas.getContext('2d');

            if (features) {
                const drawConfiguration = {
                    axis: genomicState.axis,
                    features,
                    context,
                    pixelWidth,
                    bpStart,
                    bpEnd,
                    bpPerPixel: genomicState.bpp,
                    genomicState,
                    pixelHeight: Math.min(canvas.width, canvas.height),
                    viewportContainerX: (genomicState.startBP - bpStart) / genomicState.bpp,
                    viewportContainerWidth: pixelWidth,
                    viewportWidth: pixelWidth,
                    referenceFrame: {},
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
                const wye = canvas.height - canvas.height / 4;
                igv.IGVGraphics.fillRect(context, 0, wye, canvas.width, 2, { fillStyle: 'rgba(0,0,0,0.1)' });
            }

            this.tile = new Tile(genomicState.chromosome.name, bpStart, bpEnd, genomicState.bpp, canvas, features);
            return this.tile;
        }
    }

    dispose() {
        this.x.dispose()
        this.y.dispose()
    }
}

function doAutoscale (features = []) {
    let min = Number.MAX_VALUE;
    let max = -Number.MAX_VALUE;

    if (features.length > 0) {
        for (const { value } of features) {
            if (!Number.isNaN(value)) {
                min = Math.min(min, value);
                max = Math.max(max, value);
            }
        }

        // Ensure we have a zero baseline
        if (max > 0) min = Math.min(0, min);
        if (max < 0) max = 0;
    } else {
        // No features -- default
        min = 0;
        max = 100;
    }

    return { min, max };
}

function setTrackReorderArrowColors(trackPairs) {

    for (const trackPair of trackPairs) {
        const el = trackPair.x.viewportElement;
        const order = parseInt(el.style.order);

        const arrowUp = el.querySelector('.fa-arrow-up');
        const arrowDown = el.querySelector('.fa-arrow-down');

        if (order === 0) {
            arrowUp.style.color = 'rgba(0, 0, 0, 0)';
            arrowDown.style.color = '#7F7F7F';
        } else if (order === trackPairs.length - 1) {
            arrowUp.style.color = '#7F7F7F';
            arrowDown.style.color = 'rgba(0, 0, 0, 0)';
        } else {
            arrowUp.style.color = '#7F7F7F';
            arrowDown.style.color = '#7F7F7F';
        }
    }

}

export { setTrackReorderArrowColors }
export default TrackPair
