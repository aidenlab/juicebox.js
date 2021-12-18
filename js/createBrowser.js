/*
 * @author Jim Robinson Dec-2020
 */

import {StringUtils} from '../node_modules/igv-utils/src/index.js'
import $ from '../vendor/jquery-3.3.1.slim.js'
import HICBrowser from './hicBrowser.js'
import ColorScale from './colorScale.js'
import State from './hicState.js'
import ContactMatrixView from "./contactMatrixView.js"
import HICEvent from "./hicEvent.js"
import EventBus from "./eventBus.js"

const defaultSize = {width: 640, height: 640}

let allBrowsers = []
let currentBrowser

async function createBrowser(hic_container, config, callback) {

    const $hic_container = $(hic_container);

    setDefaults(config);

    if (StringUtils.isString(config.state)) {
        config.state = State.parse(config.state);
    }
    if (StringUtils.isString(config.colorScale)) {
        config.colorScale = ColorScale.parse(config.colorScale);
    }
    if (StringUtils.isString(config.backgroundColor)) {
        config.backgroundColor = ContactMatrixView.parseBackgroundColor(config.backgroundColor);
    }

    const browser = new HICBrowser($hic_container, config);
    await browser.init(config);
    if (typeof callback === "function") {
        callback();
    }

    allBrowsers.push(browser);
    setCurrentBrowser(browser);
    if (allBrowsers.length > 1) {
        allBrowsers.forEach(function (b) {
            b.$browser_panel_delete_button.show();
        });
    }

    return browser;
}

/**
 * Create multiple browsers, maintaining order specified in configList.  Called from restore session
 *
 * @param hic_container
 * @param configList
 */
async function createBrowserList(hic_container, session) {

    const $hic_container = $(hic_container);
    const configList = session.browsers || [session];


    allBrowsers = [];
    const initPromises = [];
    for (let config of configList) {
        setDefaults(config);
        if (StringUtils.isString(config.state)) {
            config.state = State.parse(config.state);
        }
        if (StringUtils.isString(config.colorScale)) {
            config.colorScale = ColorScale.parse(config.colorScale);
        }
        if (StringUtils.isString(config.backgroundColor)) {
            config.backgroundColor = ContactMatrixView.parseBackgroundColor(config.backgroundColor);
        }
        if(false === session.syncDatasets) {
            config.synchable = false;
        }

        const browser = new HICBrowser($hic_container, config);

        allBrowsers.push(browser);
        initPromises.push(browser.init(config));
    }
    await Promise.all(initPromises);

    setCurrentBrowser(allBrowsers[0]);

    if (allBrowsers.length > 1) {
        allBrowsers.forEach(function (b) {
            b.$browser_panel_delete_button.show();
        });
    }
}

async function updateAllBrowsers() {
    for (let b of allBrowsers) {
        await b.update()
    }
}

function deleteAllBrowsers() {
    for (let b of allBrowsers) {
        b.$root.remove();
    }
    allBrowsers = [];
}

function setCurrentBrowser(browser) {// unselect current browser
    if (undefined === browser) {
        if (currentBrowser) {
            currentBrowser.$root.removeClass('hic-root-selected');
        }
        currentBrowser = browser;
        return;
    }
    if (browser !== currentBrowser) {
        if (currentBrowser) {
            currentBrowser.$root.removeClass('hic-root-selected');
        }
        browser.$root.addClass('hic-root-selected');
        currentBrowser = browser;
        EventBus.globalBus.post(HICEvent("BrowserSelect", browser))
    }
}


function deleteBrowser(browser) {
    browser.unsyncSelf();
    browser.$root.remove();
    allBrowsers = allBrowsers.filter(b => b != browser);
    if (allBrowsers.length <= 1) {
        allBrowsers.forEach(function (b) {
            b.$browser_panel_delete_button.hide();
        });
    }
}

function getCurrentBrowser() {
    return currentBrowser;
}

function syncBrowsers(browsers) {

    const synchableBrowsers = (browsers || allBrowsers).filter(b => (false !== b.synchable) && (b.dataset !== undefined));

    // Sync compatible maps only
    for (let b1 of synchableBrowsers) {
        for (let b2 of synchableBrowsers) {
            if (b1 === b2) continue;
            if (b1.dataset.isCompatible(b2.dataset)) {
                b1.synchedBrowsers.push(b2);
                b2.synchedBrowsers.push(b1);
            }
        }
    }
}

function getAllBrowsers() {
    return allBrowsers;
}


// Set default values for config properties
function setDefaults(config) {

    if (config.state) {

        if (StringUtils.isString(config.state)) {
            config.state = State.parse(config.state)
        } else {
            // copy
            config.state = new State(
                config.state.chr1,
                config.state.chr2,
                config.state.zoom,
                config.state.x,
                config.state.y,
                config.width,
                config.height,
                config.state.pixelSize,
                config.state.normalization)
        }
    }

    if (config.figureMode === true) {
        config.showLocusGoto = false;
        config.showHicContactMapLabel = false;
        config.showChromosomeSelector = false;
    } else {
        if (undefined === config.width) {
            config.width = config.state ? config.state.width : defaultSize.width
        }
        if (undefined === config.height) {
            config.height = config.state ? config.state.height : defaultSize.height
        }
        if (undefined === config.showLocusGoto) {
            config.showLocusGoto = true;
        }
        if (undefined === config.showHicContactMapLabel) {
            config.showHicContactMapLabel = true;
        }
        if (undefined === config.showChromosomeSelector) {
            config.showChromosomeSelector = true
        }
    }

}


// mock igv browser objects for igv.js compatibility
// function createIGV($hic_container, hicBrowser) {
//
//     igv.browser =
//         {
//             constants: {defaultColor: "rgb(0,0,150)"},
//
//             // Compatibility wit igv menus
//             trackContainerDiv: hicBrowser.layoutController.$x_track_container.get(0)
//         };
//     igv.popover = new Popover($hic_container.get(0), igv.browser);
// }

export {
    defaultSize,
    createBrowser,
    createBrowserList,
    deleteBrowser,
    setCurrentBrowser,
    getCurrentBrowser,
    syncBrowsers,
    deleteAllBrowsers,
    getAllBrowsers
}
