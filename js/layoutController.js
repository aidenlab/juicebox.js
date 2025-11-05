/**
 * Created by dat on 4/4/17.
 */
import Ruler from './ruler.js'
import TrackPair, {setTrackReorderArrowColors} from './trackPair.js'
import TrackRenderer from './trackRenderer.js';
import {deleteBrowser, setCurrentBrowser} from './createBrowser.js'
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

    updateLayoutWithTracks(tracks) {

        const { trackHeight } = getLayoutDimensions()

        this.resizeLayoutWithTrackXYPairCount(tracks.length + this.browser.trackPairs.length)

        for (const track of tracks) {

            const trackPair = new TrackPair(this.browser, track)
            this.browser.trackPairs.unshift(trackPair)

            trackPair.x = new TrackRenderer(this.browser, track, 'x')
            trackPair.x.init(this.xTracks, trackHeight, this.browser.trackPairs.indexOf(trackPair))

            trackPair.y = new TrackRenderer(this.browser, track, 'y')
            trackPair.y.init(this.yTracks, trackHeight, this.browser.trackPairs.indexOf(trackPair))

            trackPair.init()

            EventBus.globalBus.post(HICEvent("TrackXYPairLoad", trackPair))
        }

        for (const trackPair of this.browser.trackPairs) {
            const order = `${ this.browser.trackPairs.indexOf(trackPair) }`
            trackPair.x.viewportElement.style.order = order
            trackPair.y.viewportElement.style.order = order
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

function setCSSVariable(name, value) {
    document.documentElement.style.setProperty(name, `${value}px`);
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

function setViewportSize(width, height) {
    setCSSVariable('--hic-viewport-width', width);
    setCSSVariable('--hic-viewport-height', height);
}

function createNavBar(browser, root) {

    const hicNavbarContainer = document.createElement('div');
    hicNavbarContainer.className = 'hic-navbar-container';
    root.appendChild(hicNavbarContainer);

    hicNavbarContainer.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        setCurrentBrowser(browser);
    });

    const htmlContactMapHicNavBarMapContainer =
        `<div id="${browser.id}-contact-map-hic-nav-bar-map-container">
            <div id="${browser.id}-contact-map-hic-nav-bar-map-label"></div>
             <div class="hic-nav-bar-button-container">
                <i class="fa fa-bars fa-lg" title="Present menu"></i>
                <i class="fa fa-minus-circle fa-lg" title="Delete browser panel" style="display: none;"></i>
             </div>
        </div>`;

    hicNavbarContainer.appendChild(createDOMFromHTMLString(htmlContactMapHicNavBarMapContainer));

    browser.contactMapLabel = hicNavbarContainer.querySelector(`div[id$='contact-map-hic-nav-bar-map-label']`);
    browser.menuPresentDismiss = hicNavbarContainer.querySelector('.fa-bars');
    browser.menuPresentDismiss.addEventListener('click', e => browser.toggleMenu());

    browser.browserPanelDeleteButton = hicNavbarContainer.querySelector('.fa-minus-circle');
    browser.browserPanelDeleteButton.addEventListener('click', e => deleteBrowser(browser));

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
