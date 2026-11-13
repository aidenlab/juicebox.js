import { DOMUtils } from 'igv-ui';

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
        }

        // The track label (`CONTEXT.md`), on x and y tracks alike. The y label reads
        // bottom-to-top, like the ruler beside it: that is CSS, not this.
        this.labelElement = document.createElement('div');
        this.labelElement.className = (this.axis === 'x') ? 'x-track-label' : 'y-track-label';
        this.viewportElement.appendChild(this.labelElement);
        this.setLabelText(this.track.name || '');
        this.labelElement.style.display = this.browser.showTrackLabelAndGutter ? 'block' : 'none';

        this.viewportElement.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.browser.toggleTrackLabelAndGutterState();
        });

        this.spinnerElement = document.createElement('div');
        this.spinnerElement.className = (this.axis === 'x') ? 'x-track-spinner' : 'y-track-spinner';
        this.viewportElement.appendChild(this.spinnerElement);
    }

    /**
     * The track spinner: a pending track's (ADR-0017), and a track pair's while
     * its paint fetches (#776). Not the map spinner, which covers only the
     * contact matrix (ADR-0022).
     */
    showSpinner(show) {
        this.spinnerElement.innerHTML = show ? '<i class="fa fa-spinner fa-spin"></i>' : '';
    }

    setLabelText(text) {
        this.labelElement.textContent = text;
        this.labelElement.title = text;
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

    isLoading() {
        return this.loading !== undefined;
    }
}

export default TrackRenderer;
