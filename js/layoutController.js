/**
 * Created by dat on 4/4/17.
 */
import Ruler from './ruler.js'
import TrackPair, {setTrackReorderArrowColors} from './trackPair.js'
import TrackRenderer from './trackRenderer.js';
import PendingTrackPair from './pendingTrackPair.js';
import {deleteBrowser} from './createBrowser.js'
import HICEvent from "./hicEvent.js";
import EventBus from "./eventBus.js";
import { createDOMFromHTMLString } from "./utils.js"

class LayoutController {

    constructor(browser, rootElement) {
        this.browser = browser;
        createNavBar(browser, rootElement);
        this.createAllContainers(browser, rootElement);
    }

    createAllContainers(browser, root) {
        const htmlXTrackContainer = createDOMFromHTMLString(`
        <div id="${browser.id}-x-track-container">
            <div id="${browser.id}-track-shim"></div>
            <div id="${browser.id}-x-tracks">
                <div id="${browser.id}-y-track-guide" style="display: none;"></div>
            </div>
        </div>`);

        root.appendChild(htmlXTrackContainer);

        this.xTrackContainer = root.querySelector(`div[id$='x-track-container']`);
        this.trackShim = this.xTrackContainer.querySelector(`div[id$='track-shim']`);
        this.xTracks = this.xTrackContainer.querySelector(`div[id$='x-tracks']`);
        this.yTrackGuideElement = this.xTrackContainer.querySelector(`div[id$='y-track-guide']`);

        this.contentContainer = createDOMFromHTMLString(`<div id="${browser.id}-content-container"></div>`);
        root.appendChild(this.contentContainer);

        const htmlXAxisContainer = createDOMFromHTMLString(`
        <div id="${browser.id}-x-axis-container">
            <div id="${browser.id}-x-axis">
                <canvas></canvas>
                <div id="${browser.id}-x-axis-whole-genome-container"></div>
            </div>
        </div>`);

        this.contentContainer.appendChild(htmlXAxisContainer);
        const xAxisContainer = this.contentContainer.querySelector(`div[id$='x-axis-container']`);

        this.xAxisRuler = new Ruler(browser, xAxisContainer, 'x');

        const htmlYTracksYAxisViewportYScrollbar = createDOMFromHTMLString(`
        <div id="${browser.id}-y-tracks-y-axis-viewport-y-scrollbar">
            <div id="${browser.id}-y-tracks">
                <div id="${browser.id}-x-track-guide" style="display: none;"></div>
            </div>
            <div id="${browser.id}-y-axis">
                <canvas></canvas>
                <div id="${browser.id}-y-axis-whole-genome-container"></div>
            </div>
        </div>`);

        this.contentContainer.appendChild(htmlYTracksYAxisViewportYScrollbar);
        const yTracksYAxisViewportYScrollbar = this.contentContainer.querySelector(`div[id$='-y-tracks-y-axis-viewport-y-scrollbar']`);

        this.yTracks = yTracksYAxisViewportYScrollbar.querySelector(`div[id$='-y-tracks']`);
        this.xTrackGuideElement = this.yTracks.querySelector(`div[id$='-x-track-guide']`);

        this.yAxisRuler = new Ruler(browser, yTracksYAxisViewportYScrollbar, 'y');

        this.xAxisRuler.otherRulerCanvas = this.yAxisRuler.canvasElement;
        this.xAxisRuler.otherRuler = this.yAxisRuler;

        this.yAxisRuler.otherRulerCanvas = this.xAxisRuler.canvasElement;
        this.yAxisRuler.otherRuler = this.xAxisRuler;

        const htmlViewport = createDOMFromHTMLString(`
        <div id="${browser.id}-viewport">
            <div id="${browser.id}-contact-map-canvas-container">
                <canvas></canvas>
            </div>
            <i class="fa fa-spinner fa-spin" style="font-size: 48px; position: absolute; left: 40%; top: 40%; display: none;"></i>
            <div id="${browser.id}-sweep-zoom-container" style="display: none;"></div>
            <div id="${browser.id}-x-guide" style="display: none;"></div>
            <div id="${browser.id}-y-guide" style="display: none;"></div>
        </div>`);

        yTracksYAxisViewportYScrollbar.appendChild(htmlViewport);

        const htmlYAxisScrollbarContainer = createDOMFromHTMLString(`
        <div id="${browser.id}-y-axis-scrollbar-container">
            <div id="${browser.id}-y-axis-scrollbar">
                <div class="scrollbar-label-rotation-in-place"></div>
            </div>
        </div>`);

        yTracksYAxisViewportYScrollbar.appendChild(htmlYAxisScrollbarContainer);

        const htmlXAxisScrollbarContainer = createDOMFromHTMLString(`
        <div id="${browser.id}-x-scrollbar-container">
            <div id="${browser.id}-x-axis-scrollbar-container">
                <div id="${browser.id}-x-axis-scrollbar">
                    <div></div>
                </div>
            </div>
        </div>`);

        this.contentContainer.appendChild(htmlXAxisScrollbarContainer);
    }

    getContactMatrixViewport() {
        const parent = this.contentContainer.querySelector("div[id$='-y-tracks-y-axis-viewport-y-scrollbar']");
        return parent ? parent.querySelector("div[id$='-viewport']") : null;
    }

    getYAxisScrollbarContainer() {
        const parent = this.contentContainer.querySelector("div[id$='-y-tracks-y-axis-viewport-y-scrollbar']");
        return parent ? parent.querySelector("div[id$='-y-axis-scrollbar-container']") : null;
    }

    getXAxisScrollbarContainer() {
        return this.contentContainer.querySelector("div[id$='-x-axis-scrollbar-container']");
    }

    /**
     * Reserve a placeholder row for each pending 1D track, in the position the
     * track takes once it loads, and size the layout for them now -- so it does
     * not move again as the tracks arrive (#664, ADR-0017 decision 3).
     *
     * Each track goes on top of the rows already there, in config order, which
     * is the order a load has always laid its tracks out in.
     *
     * @param {Array<Object>} configs - the configs of the 1D tracks being loaded
     * @returns {Array<PendingTrackPair>} - one per config, in config order
     */
    reservePendingTracks(configs) {

        const { trackHeight } = getLayoutDimensions()

        this.resizeLayoutWithTrackXYPairCount(configs.length + this.browser.trackPairs.length)

        const placeholders = configs.map(config => {
            const placeholder = new PendingTrackPair(this.browser, config)
            this.browser.trackPairs.unshift(placeholder)
            placeholder.init(this.xTracks, this.yTracks, trackHeight, 0)
            return placeholder
        })

        this.#applyTrackOrder()

        return placeholders
    }

    /**
     * Turn a placeholder into the track pair of the track it was reserved for,
     * in whatever position the placeholder holds now.
     *
     * A placeholder no longer in `trackPairs` -- the rows were cleared while the
     * track loaded -- has nowhere to put the track, and the track is dropped.
     * The pair is sized but not drawn; that is the caller's `updateViews`.
     *
     * @returns {TrackPair|undefined} - the new pair, or undefined if the row is gone
     */
    fillPendingTrack(placeholder, track) {

        const index = this.browser.trackPairs.indexOf(placeholder)
        if (-1 === index) {
            return undefined
        }

        const { trackHeight } = getLayoutDimensions()

        const trackPair = new TrackPair(this.browser, track)

        try {
            trackPair.x = new TrackRenderer(this.browser, track, 'x')
            trackPair.x.init(this.xTracks, trackHeight, index)

            trackPair.y = new TrackRenderer(this.browser, track, 'y')
            trackPair.y.init(this.yTracks, trackHeight, index)

            trackPair.init()
        } catch (error) {
            // Half a pair is no row at all; the caller treats this as the track failing.
            trackPair.x?.viewportElement?.remove()
            trackPair.y?.viewportElement?.remove()
            throw error
        }

        placeholder.dispose()
        this.browser.trackPairs[index] = trackPair

        trackPair.x.syncCanvas()
        trackPair.y.syncCanvas()

        const gearContainer = document.querySelector('.hic-igv-right-hand-gutter')
        gearContainer.style.display = this.browser.showTrackLabelAndGutter ? 'block' : 'none'

        setTrackReorderArrowColors(this.browser.trackPairs)

        EventBus.globalBus.post(HICEvent("TrackXYPairLoad", trackPair))

        return trackPair
    }

    /**
     * Take away the row of a pending track that failed to load. Unlike
     * `removeTrackXYPair` it posts no `TrackXYPairRemoval`: no track was loaded.
     *
     * @returns {boolean} - whether there was a row to remove
     */
    removePendingTrack(placeholder) {

        const index = this.browser.trackPairs.indexOf(placeholder)
        if (-1 === index) {
            return false
        }

        placeholder.dispose()
        this.browser.trackPairs.splice(index, 1)

        this.resizeLayoutWithTrackXYPairCount(this.browser.trackPairs.length)
        this.#applyTrackOrder()

        return true
    }

    #applyTrackOrder() {
        for (const [index, trackPair] of this.browser.trackPairs.entries()) {
            trackPair.x.viewportElement.style.order = `${ index }`
            trackPair.y.viewportElement.style.order = `${ index }`
        }

        setTrackReorderArrowColors(this.browser.trackPairs)
    }

    removeAllTrackXYPairs() {

        if (this.browser.trackPairs.length === 0 ) {
            return;
        }

        for(let trackPair of this.browser.trackPairs) {
            // discard DOM element's
            trackPair.dispose();
        }
        this.browser.trackPairs = []
        this.browser.updateLayout();
        this.resizeLayoutWithTrackXYPairCount(0)

    }

    removeTrackXYPair(trackXYPair) {

        if (this.browser.trackPairs.length > 0) {

            // remove DOM element
            trackXYPair.x.viewportElement.remove();
            trackXYPair.y.viewportElement.remove();

            // remove from trackPairs list
            const index = this.browser.trackPairs.indexOf(trackXYPair);
            this.browser.trackPairs.splice(index, 1);

            this.resizeLayoutWithTrackXYPairCount(this.browser.trackPairs.length);

            this.browser.updateLayout();

            EventBus.globalBus.post(HICEvent("TrackXYPairRemoval", trackXYPair));
        }
    }

    resizeLayoutWithTrackXYPairCount(trackXYPairCount) {
        const { trackHeight, trackMargin, axisHeight, scrollbarHeight } = getLayoutDimensions();
        const trackAggregateHeight = (trackXYPairCount === 0) ? 0 : trackXYPairCount * (trackHeight + trackMargin);

        let tokens = [getNavbarHeight(), trackAggregateHeight].map(number => `${number}px`);
        const heightCalc = `calc(100% - (${tokens.join(' + ')}))`;

        tokens = [trackAggregateHeight, axisHeight, scrollbarHeight].map(number => `${number}px`);
        const widthCalc = `calc(100% - (${tokens.join(' + ')}))`;

        // x-track container
        this.xTrackContainer.style.height = `${trackAggregateHeight}px`;

        // track labels
        this.trackShim.style.width = `${trackAggregateHeight}px`;

        // x-tracks
        this.xTracks.style.width = widthCalc;

        // content container
        this.contentContainer.style.height = heightCalc;

        // x-axis - repaint canvas
        this.xAxisRuler.updateWidthWithCalculation(widthCalc);

        // y-tracks
        this.yTracks.style.width = `${trackAggregateHeight}px`;

        // y-axis - repaint canvas
        this.yAxisRuler.updateHeight(this.yAxisRuler.axisElement.offsetHeight);

        // viewport
        this.browser.contactMatrixView.viewportElement.style.width = widthCalc;

        // x-scrollbar
        this.browser.contactMatrixView.scrollbarWidget.xAxisScrollbarContainerElement.style.width = widthCalc;
    }

}

function getNavbarContainer(browser) {
    return browser.rootElement.querySelector('.hic-navbar-container');
}

function getNavbarHeight() {
    const { navBarLabelHeight, navBarWidgetContainerHeight, navBarWidgetContainerMargin } = getLayoutDimensions();
    return 2 * (navBarLabelHeight + navBarWidgetContainerHeight + (2 * navBarWidgetContainerMargin));
}

function getCSSVariable(name) {
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue(name));
}

function setCSSVariable(element, name, value) {
    element.style.setProperty(name, `${value}px`);
}

function getLayoutDimensions() {
    return {
        navBarLabelHeight: getCSSVariable('--nav-bar-label-height'),
        navBarWidgetContainerHeight: getCSSVariable('--nav-bar-widget-container-height'),
        navBarWidgetContainerMargin: getCSSVariable('--nav-bar-widget-container-margin'),
        scrollbarHeight: getCSSVariable('--hic-scrollbar-height'),
        axisHeight: getCSSVariable('--hic-axis-height'),
        trackMargin: getCSSVariable('--track-margin'),
        trackHeight: getCSSVariable('--track-height')
    };
}

/**
 * Sizes one browser, and only that browser.
 *
 * These two properties are written as inline styles on the browser's own
 * `rootElement` rather than on `document.documentElement`, because the page is
 * not the unit being sized. `.hic-root` is the sole rule that reads them, so a
 * property set on that element resolves exactly where it is needed and nowhere
 * else; custom properties inherit, and the `:root` declarations in
 * `css/juicebox.scss` remain the fallback for a browser given no dimensions.
 *
 * Scoped per *browser*, not per container: a registry's container holds many
 * browsers (juicebox-web clones a second browser into the same container), so
 * container scoping would leave last-writer-wins intact within one embed.
 *
 * Consequence, and it is visible: a browser constructed without `width`/`height`
 * used to inherit whatever the last-sized browser wrote to the page. It now
 * falls back to the stylesheet default instead. Issue #477; deferred by ADR-0004.
 */
function setViewportSize(rootElement, width, height) {
    setCSSVariable(rootElement, '--hic-viewport-width', width);
    setCSSVariable(rootElement, '--hic-viewport-height', height);
}

function createNavBar(browser, root) {

    const hicNavbarContainer = document.createElement('div');
    hicNavbarContainer.className = 'hic-navbar-container';
    root.appendChild(hicNavbarContainer);

    // Plain click selects; shift-click aims. The navbar and not the whole panel,
    // because a shift over the contact map already means crosshairs -- see
    // `contactMatrixView`. A plain click is what it has always been, except
    // that it now also clears the target set: it is the only way back from a
    // large aim. #615, docs/adr/0015.
    hicNavbarContainer.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        if (e.shiftKey) {
            browser.registry.toggleTarget(browser);
        } else {
            browser.registry.retarget(browser);
        }
    });

    const htmlContactMapHicNavBarMapContainer =
        `<div id="${browser.id}-contact-map-hic-nav-bar-map-container">
            <div id="${browser.id}-contact-map-hic-nav-bar-map-label"></div>
            <i class="fa fa-chain-broken hic-isolation-mark" hidden></i>
             <div class="hic-nav-bar-button-container">
                <i class="fa fa-bars fa-lg" title="Present menu"></i>
                <i class="fa fa-minus-circle fa-lg" title="Delete browser panel" style="display: none;"></i>
             </div>
        </div>`;

    hicNavbarContainer.appendChild(createDOMFromHTMLString(htmlContactMapHicNavBarMapContainer));

    browser.contactMapLabel = hicNavbarContainer.querySelector(`div[id$='contact-map-hic-nav-bar-map-label']`);

    // Shown only while this panel cannot join any sync group, with the reason
    // as its tooltip; the registry sets it (`HICBrowser.setIsolationReason`).
    // A sibling of the label rather than a child, because a load writes the
    // label's `textContent`. ADR-0016 decision 7, #637.
    browser.isolationMark = hicNavbarContainer.querySelector('.hic-isolation-mark');
    browser.menuPresentDismiss = hicNavbarContainer.querySelector('.fa-bars');
    browser.menuPresentDismiss.addEventListener('click', e => browser.toggleMenu());

    browser.browserPanelDeleteButton = hicNavbarContainer.querySelector('.fa-minus-circle');

    // Stopped here, and it is load-bearing: this button is *inside* the navbar
    // whose click handler selects. The propagation path is computed when the
    // click is dispatched, so removing `rootElement` mid-dispatch does not take
    // the navbar out of it -- the same click would go on to `retarget` the
    // browser that has just disposed, undoing the selection `releaseSlot` fell
    // through to a survivor and making a zombie current. #619.
    browser.browserPanelDeleteButton.addEventListener('click', e => {
        e.stopPropagation();
        deleteBrowser(browser);
    });

    // Delete button is only visible if there is more than one browser
    browser.browserPanelDeleteButton.style.display = 'none';

    const htmlControlMapHicNavBarMapContainer =
        `<div id="${browser.id}-control-map-hic-nav-bar-map-container">
            <div id="${browser.id}-control-map-hic-nav-bar-map-label"></div>
        </div>`;

    hicNavbarContainer.appendChild(createDOMFromHTMLString(htmlControlMapHicNavBarMapContainer));

    browser.controlMapLabel = hicNavbarContainer.querySelector(`div[id$='control-map-hic-nav-bar-map-label']`);

    const htmlUpperHicNavBarWidgetContainer = `<div id="${browser.id}-upper-hic-nav-bar-widget-container"></div>`;
    hicNavbarContainer.appendChild(createDOMFromHTMLString(htmlUpperHicNavBarWidgetContainer));

    const htmlLowerHicNavBarWidgetContainer = `<div id="${browser.id}-lower-hic-nav-bar-widget-container"></div>`;
    hicNavbarContainer.appendChild(createDOMFromHTMLString(htmlLowerHicNavBarWidgetContainer));
}

export {getNavbarHeight, getNavbarContainer, getLayoutDimensions, setViewportSize};

export default LayoutController;
