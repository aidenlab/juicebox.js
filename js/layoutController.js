/**
 * Created by dat on 4/4/17.
 */
import $ from '../vendor/jquery-3.3.1.slim.js'
import Ruler from './ruler.js'
import {TrackPair} from './trackPair.js'
import {deleteBrowser, setCurrentBrowser} from "./createBrowser.js"

// Keep in sync with juicebox.scss variables

// $nav-bar-label-height: 36px;
const nav_bar_label_height = 36;

// $nav-bar-widget-container-height: 36px;
const nav_bar_widget_container_height = 36;

// $nav-bar-widget-container-margin: 4px;
const nav_bar_widget_container_margin = 4;

// $hic-scrollbar-height: 20px;
const scrollbar_height = 20;

// $hic-axis-height: 40px;
const axis_height = 40;

// $track-margin: 2px;
const track_margin = 2;

export const trackHeight = 40;

class LayoutController {

    constructor(browser, $root) {

        this.browser = browser;

        createNavBar(browser, $root);

        this.createAllContainers(browser, $root);
    }


    createAllContainers(browser, $root) {

        const html_x_track_container =
            `<div id="${browser.id}-x-track-container"><div id="${browser.id}-track-shim"></div><div id="${browser.id}-x-tracks"><div id="${browser.id}-y-track-guide" style="display: none;"></div></div></div>`;
        $root.append($(html_x_track_container));

        this.$x_track_container = $root.find("div[id$='x-track-container']");
        this.$track_shim = this.$x_track_container.find("div[id$='track-shim']");
        this.$x_tracks = this.$x_track_container.find("div[id$='x-tracks']");
        this.$y_track_guide = this.$x_track_container.find("div[id$='y-track-guide']");

        const html_content_container = `<div id="${browser.id}-content-container"></div>`;

        this.$content_container = $(html_content_container);

        $root.append(this.$content_container);

        const html_x_axis_container =
            `<div id="${browser.id}-x-axis-container">
            <div id="${browser.id}-x-axis">
                <canvas></canvas>
                <div id="${browser.id}-x-axis-whole-genome-container"></div>
            </div>
	    </div>`;

        this.$content_container.append($(html_x_axis_container));

        const $x_axis_container = this.$content_container.find("div[id$='x-axis-container']");

        this.xAxisRuler = new Ruler(browser, $x_axis_container, 'x');

        const html_y_tracks_y_axis_viewport_y_scrollbar =
            `<div id="${browser.id}-y-tracks-y-axis-viewport-y-scrollbar">

            <div id="${browser.id}-y-tracks">
                <div id="${browser.id}-x-track-guide" style="display: none;"></div>
            </div>
            
            <div id="${browser.id}-y-axis">
    			<canvas></canvas>
			    <div id="${browser.id}-y-axis-whole-genome-container"></div>
		    </div>
		    
        </div>`;

        this.$content_container.append($(html_y_tracks_y_axis_viewport_y_scrollbar));
        const $y_tracks_y_axis_viewport_y_scrollbar = this.$content_container.find("div[id$='-y-tracks-y-axis-viewport-y-scrollbar']");

        this.$y_tracks = $y_tracks_y_axis_viewport_y_scrollbar.find("div[id$='-y-tracks']");
        this.$x_track_guide = this.$y_tracks.find("div[id$='-x-track-guide']");

        this.yAxisRuler = new Ruler(browser, $y_tracks_y_axis_viewport_y_scrollbar, 'y');

        this.xAxisRuler.$otherRulerCanvas = this.yAxisRuler.$canvas;
        this.xAxisRuler.otherRuler = this.yAxisRuler;

        this.yAxisRuler.$otherRulerCanvas = this.xAxisRuler.$canvas;
        this.yAxisRuler.otherRuler = this.xAxisRuler;

        const html_viewport =
            `<div id="${browser.id}-viewport">
			<canvas></canvas>
			<i class="fa fa-spinner fa-spin" style="font-size: 48px; position: absolute; left: 40%; top: 40%; display: none;"></i>
			<div id="${browser.id}-sweep-zoom-container" style="display: none;"></div>
			<div id="${browser.id}-x-guide" style="display: none;"></div>
			<div id="${browser.id}-y-guide" style="display: none;"></div>
		</div>`;

        $y_tracks_y_axis_viewport_y_scrollbar.append($(html_viewport));

        const html_y_axis_scrollbar_container =
            `<div id="${browser.id}-y-axis-scrollbar-container">
			<div id="${browser.id}-y-axis-scrollbar">
				<div class="scrollbar-label-rotation-in-place"></div>
			</div>
		</div>`;

        $y_tracks_y_axis_viewport_y_scrollbar.append($(html_y_axis_scrollbar_container));

        const html_x_axis_scrollbar_container =
            `<div id="${browser.id}-x-scrollbar-container">
            <div id="${browser.id}-x-axis-scrollbar-container">
                <div id="${browser.id}-x-axis-scrollbar">
                    <div></div>
                </div>
            </div>
	    </div>`;

        this.$content_container.append($(html_x_axis_scrollbar_container));

    }

    getContactMatrixViewport() {
        const $parent = this.$content_container.find("div[id$='-y-tracks-y-axis-viewport-y-scrollbar']");
        return $parent.find("div[id$='-viewport']");
    }

    getYAxisScrollbarContainer() {
        const $parent = this.$content_container.find("div[id$='-y-tracks-y-axis-viewport-y-scrollbar']");
        return $parent.find("div[id$='-y-axis-scrollbar-container']");
    }

    getXAxisScrollbarContainer() {
        return this.$content_container.find("div[id$='-x-axis-scrollbar-container']");
    }

    tracksLoaded(tracks) {

        this.doLayoutTrackXYPairCount(tracks.length + this.browser.trackPairs.length);

        tracks.forEach((track, index) => {
            const trackPair = new TrackPair(
                this.browser,
                trackHeight,
                this.$x_tracks,
                this.$y_tracks,
                track,
                index
            )
            this.browser.trackPairs.push(trackPair);
        });
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
        this.doLayoutTrackXYPairCount(0)

        // What ???
        // [...Array(this.browser.trackPairs.length).keys()].forEach(() => {
        //
        //     // select last track to discard
        //     let discard = this.browser.trackPairs[this.browser.trackPairs.length - 1];
        //
        //     // discard DOM element's
        //     discard['x'].$viewport.remove();
        //     discard['y'].$viewport.remove();
        //
        //     // remove discard from list
        //     const index = this.browser.trackPairs.indexOf(discard);
        //     this.browser.trackPairs.splice(index, 1);
        //
        //     discard = undefined;
        //     this.doLayoutTrackXYPairCount(this.browser.trackPairs.length);
        //
        // });
    };

    removeLastTrackXYPair() {

        if (this.browser.trackPairs.length > 0) {

            // select last track to dicard
            let discard = this.browser.trackPairs[this.browser.trackPairs.length - 1];

            // discard DOM element's
            discard['x'].$viewport.remove();
            discard['y'].$viewport.remove();

            // remove discard from list
            const index = this.browser.trackPairs.indexOf(discard);
            this.browser.trackPairs.splice(index, 1);

            discard = undefined;
            this.doLayoutTrackXYPairCount(this.browser.trackPairs.length);

            this.browser.updateLayout();

        } else {
            //console.log('No more tracks.');
        }
    }

    removeTrackXYPair(trackXYPair) {

        if (this.browser.trackPairs.length > 0) {

            const discard = trackXYPair;

            // discard DOM element's
            discard['x'].$viewport.remove();
            discard['y'].$viewport.remove();

            // remove discard from list
            const index = this.browser.trackPairs.indexOf(discard);
            this.browser.trackPairs.splice(index, 1);

            this.doLayoutTrackXYPairCount(this.browser.trackPairs.length);

            this.browser.updateLayout();


        } else {
            //console.log('No more tracks.');
        }

    };

    doLayoutTrackXYPairCount(trackXYPairCount) {


        const track_aggregate_height = (0 === trackXYPairCount) ? 0 : trackXYPairCount * (trackHeight + track_margin);

        let tokens = [getNavbarHeight(), track_aggregate_height].map(number => `${number}px`);
        const height_calc = 'calc(100% - (' + tokens.join(' + ') + '))';

        tokens = [track_aggregate_height, axis_height, scrollbar_height].map(number => `${number}px`);
        const width_calc = 'calc(100% - (' + tokens.join(' + ') + '))';

        // x-track container
        this.$x_track_container.height(track_aggregate_height);

        // track labels
        this.$track_shim.width(track_aggregate_height);

        // x-tracks
        this.$x_tracks.css('width', width_calc);


        // content container
        this.$content_container.css('height', height_calc);

        // x-axis - repaint canvas
        this.xAxisRuler.updateWidthWithCalculation(width_calc);

        // y-tracks
        this.$y_tracks.width(track_aggregate_height);

        // y-axis - repaint canvas
        this.yAxisRuler.updateHeight(this.yAxisRuler.$axis.height());

        // viewport
        this.browser.contactMatrixView.$viewport.css('width', width_calc);

        // x-scrollbar
        this.browser.contactMatrixView.scrollbarWidget.$x_axis_scrollbar_container.css('width', width_calc);

    }

    doLayoutWithRootContainerSize(size) {

        this.browser.$root.width(size.width);
        this.browser.$root.height(size.height + getNavbarHeight());

        const count = this.browser.trackPairs.length > 0 ? this.browser.trackPairs.length : 0;
        this.doLayoutTrackXYPairCount(count);

        this.browser.updateLayout();
    }
}

const getNavbarHeight = () => 2 * (nav_bar_label_height + nav_bar_widget_container_height + (2 * nav_bar_widget_container_margin));

const getNavbarContainer = browser => browser.$root.find('.hic-navbar-container');

function createNavBar(browser, $root) {

    const $hic_navbar_container = $('<div>', {class: 'hic-navbar-container'});
    $root.append($hic_navbar_container);

    $hic_navbar_container.on('click', e => {
        e.stopPropagation();
        e.preventDefault();
        setCurrentBrowser(browser);
    });

    const html_contact_map_hic_nav_bar_map_container =
        `<div id="${browser.id}-contact-map-hic-nav-bar-map-container">
            <div id="${browser.id}-contact-map-hic-nav-bar-map-label">
            </div>
             <div class="hic-nav-bar-button-container">
                <i class="fa fa-bars fa-lg" title="Present menu"></i>
                <i class="fa fa-minus-circle fa-lg" title="Delete browser panel" style="display: none;"></i>
             </div>
        </div>`;

    $hic_navbar_container.append($(html_contact_map_hic_nav_bar_map_container));

    browser.$contactMaplabel = $hic_navbar_container.find("div[id$='contact-map-hic-nav-bar-map-label']");

    browser.$menuPresentDismiss = $hic_navbar_container.find('.fa-bars');
    browser.$menuPresentDismiss.on('click', e => browser.toggleMenu());

    browser.$browser_panel_delete_button = $hic_navbar_container.find('.fa-minus-circle');
    browser.$browser_panel_delete_button.on('click', e => deleteBrowser(browser));

    // Delete button is only vidible if there is more then one browser
    browser.$browser_panel_delete_button.hide();

    const html_control_map_hic_nav_bar_map_container =
        `<div id="${browser.id}-control-map-hic-nav-bar-map-container">
            <div id="${browser.id}-control-map-hic-nav-bar-map-label"></div>
        </div>`;

    $hic_navbar_container.append($(html_control_map_hic_nav_bar_map_container));

    browser.$controlMaplabel = $hic_navbar_container.find("div[id$='control-map-hic-nav-bar-map-label']");

    const html_upper_hic_nav_bar_widget_container = `<div id="${browser.id}-upper-hic-nav-bar-widget-container"></div>`;
    $hic_navbar_container.append($(html_upper_hic_nav_bar_widget_container));

    const html_lower_hic_nav_bar_widget_container = `<div id="${browser.id}-lower-hic-nav-bar-widget-container"></div>`;
    $hic_navbar_container.append($(html_lower_hic_nav_bar_widget_container));

}

export {getNavbarHeight, getNavbarContainer};

export default LayoutController;
