import { DOMUtils } from '../node_modules/igv-ui/dist/igv-ui.js';

class TrackRenderer {

    constructor(browser, track, axis) {
        this.browser = browser;
        this.track = track;
        this.axis = axis;
        this.id = `trackRender_${DOMUtils.guid()}`;
    }

    init(containerElement, size, order) {
        this.viewportElement = document.createElement('div');
        this.viewportElement.className = (this.axis === 'x') ? 'x-track-canvas-container' : 'y-track-canvas-container';
        containerElement.appendChild(this.viewportElement);

        if (this.axis === 'x') {
            this.viewportElement.style.height = `${size}px`;
        } else {
            this.viewportElement.style.width = `${size}px`;
        }
        this.viewportElement.style.order = `${order}`;

        this.canvasElement = document.createElement('canvas');
        this.viewportElement.appendChild(this.canvasElement);
        this.ctx = this.canvasElement.getContext("2d");

        if (this.axis === 'x') {
            this.trackReorderHandleElement = document.createElement('div');
            this.trackReorderHandleElement.className = 'x-track-reorder-handle';
            this.viewportElement.appendChild(this.trackReorderHandleElement);

            this.trackReorderHandleElement.innerHTML = '<i class="fa fa-arrow-up"></i><i class="fa fa-arrow-down"></i>';

            this.labelElement = document.createElement('div');
            this.labelElement.className = 'x-track-label';
            this.viewportElement.appendChild(this.labelElement);

            const labelText = this.track.name || '';
            this.labelElement.textContent = labelText;
            this.labelElement.title = labelText;

            this.labelElement.style.display = this.browser.showTrackLabelAndGutter ? 'block' : 'none';

            this.viewportElement.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.browser.toggleTrackLabelAndGutterState();
                const displayState = this.browser.showTrackLabelAndGutter ? 'block' : 'none';
                document.querySelectorAll('.x-track-label, .hic-igv-right-hand-gutter').forEach(el => {
                    el.style.display = displayState;
                });
            });
        }

        this.spinnerElement = document.createElement('div');
        this.spinnerElement.className = (this.axis === 'x') ? 'x-track-spinner' : 'y-track-spinner';
        this.viewportElement.appendChild(this.spinnerElement);
        this.stopSpinner();
    }

    dispose() {
        this.tile = undefined;
        this.viewportElement.remove();
    }

    syncCanvas() {
        this.canvasElement.width = this.viewportElement.offsetWidth;
        this.canvasElement.height = this.viewportElement.offsetHeight;
    }

    drawTile(tile, genomicState) {
        if (tile) {

            let w
            let h
            if (this.axis === 'x') {
                w = this.canvasElement.width
                h = this.canvasElement.height
            } else {
                h = this.canvasElement.width
                w = this.canvasElement.height
                this.ctx.setTransform(0, 1, 1, 0, 0, 0);
            }

            this.ctx.clearRect(0, 0, w, h);

            this.offsetPixel = Math.round((tile.startBP - genomicState.startBP) / genomicState.bpp);
            this.ctx.drawImage(tile.buffer, this.offsetPixel, 0);

        }
    }

    startSpinner() {
        this.browser.startSpinner();
    }

    stopSpinner() {
        this.browser.stopSpinner();
    }

    isLoading() {
        return this.loading !== undefined;
    }
}

export default TrackRenderer;
