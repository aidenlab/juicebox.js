import TrackRenderer from './trackRenderer.js'
import {extractName} from './utils.js'

/**
 * The placeholder row of a pending track (`CONTEXT.md`, *Pending track*): a 1D
 * track a load has named but not yet finished loading.
 *
 * It holds the track's slot in `browser.trackPairs` from the moment the load
 * starts, so the row sits in the track's position and the layout is sized once,
 * not once per arriving track. It is built from the same renderers a track pair
 * is -- the same x and y rows, reorder handle and label -- around a stand-in
 * track carrying only the name, plus the track spinner. `LayoutController`
 * swaps it for the track pair when the track loads, and removes it when the
 * load fails. #664, ADR-0017 decision 3.
 *
 * It carries a remove control where a track pair has its gear. There is no
 * timeout on a track load, so dismissing the row is how the user gets out of a
 * hung one; the load it was reserved for is discarded when it settles. #665,
 * ADR-0017 decisions 4 and 8.
 *
 * It is part of the session: `HICBrowser.toJSON` writes it from `config`, so a
 * save made while it loads keeps it. #666, ADR-0017 decision 5.
 *
 * Everything that walks `trackPairs` sees it. It draws nothing, and
 * `isPendingTrack` is what the walkers that read the track itself skip it by --
 * not `pending`, which `TrackPair` already uses for a queued repaint.
 */
class PendingTrackPair {

    constructor(browser, config) {
        this.browser = browser
        this.config = config
        this.isPendingTrack = true
        this.track = {name: extractName(config)}
        this.x = undefined
        this.y = undefined
    }

    init(xTracks, yTracks, trackHeight, order) {

        this.x = new TrackRenderer(this.browser, this.track, 'x')
        this.x.init(xTracks, trackHeight, order)

        this.y = new TrackRenderer(this.browser, this.track, 'y')
        this.y.init(yTracks, trackHeight, order)

        // The name is the point of the row, so it shows whether or not the
        // labels of loaded tracks are toggled on.
        this.x.labelElement.style.display = 'block'

        for (const renderer of [this.x, this.y]) {
            renderer.spinnerElement.innerHTML = '<i class="fa fa-spinner fa-spin"></i>'
        }

        const dismissElement = document.createElement('div')
        dismissElement.className = 'x-track-dismiss'
        dismissElement.title = 'Remove track'
        dismissElement.innerHTML = '<i class="fa fa-times"></i>'
        dismissElement.addEventListener('click', async e => {
            // Not the row's own click, which toggles every track label.
            e.preventDefault()
            e.stopPropagation()
            try {
                await this.browser.layoutController.dismissPendingTrack(this)
            } catch (error) {
                console.error(error)
            }
        })
        this.x.viewportElement.appendChild(dismissElement)
    }

    async updateViews() {
    }

    async repaintViews() {
    }

    dispose() {
        this.x.dispose()
        this.y.dispose()
    }
}

export default PendingTrackPair
