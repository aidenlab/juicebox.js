/*
 * @author Jim Robinson Dec-2020
 */

import { StringUtils } from '../node_modules/igv-utils/src/index.js';
import HICBrowser from './hicBrowser.js';
import ColorScale from './colorScale.js';
import State from './hicState.js';
import ContactMatrixView from "./contactMatrixView.js";
import HICEvent from "./hicEvent.js";
import EventBus from "./eventBus.js";

const defaultSize = { width: 640, height: 640 };

let allBrowsers = [];
let currentBrowser;

async function createBrowser(hicContainer, config, callback) {
    setDefaults(config);

    if (StringUtils.isString(config.state)) config.state = State.parse(config.state);
    if (StringUtils.isString(config.colorScale)) config.colorScale = ColorScale.parse(config.colorScale);
    if (StringUtils.isString(config.backgroundColor)) config.backgroundColor = ContactMatrixView.parseBackgroundColor(config.backgroundColor);

    const browser = new HICBrowser(hicContainer, config);
    await browser.init(config);

    if (typeof callback === "function") callback();

    allBrowsers.push(browser);
    setCurrentBrowser(browser);

    if (allBrowsers.length > 1) {
        allBrowsers.forEach(b => b.browserPanelDeleteButton.style.display = 'block');
    }

    return browser;
}

async function createBrowserList(hicContainer, session) {
    const configList = session.browsers || [session];
    allBrowsers = [];
    const initPromises = [];

    for (const config of configList) {

        if (config.stateJSON) {
            config.state = State.fromJSON(config.stateJSON)
        } else {
            // TODO: Eventually move away from this string approach for State
            if (StringUtils.isString(config.state)) {
                config.state = State.parse(config.state);
            }
        }

        if(undefined === config.state){
            config.state = State.default()
        }

        setDefaults(config)

        if (StringUtils.isString(config.colorScale)) {
            config.colorScale = ColorScale.parse(config.colorScale);
        }
        if (StringUtils.isString(config.backgroundColor)) {
            config.backgroundColor = ContactMatrixView.parseBackgroundColor(config.backgroundColor);
        }
        if (session.syncDatasets === false) {
            config.synchable = false;
        }

        const browser = new HICBrowser(hicContainer, config);
        allBrowsers.push(browser);
        initPromises.push(browser.init(config));
    }
    await Promise.all(initPromises);
    setCurrentBrowser(allBrowsers[0]);

    if (allBrowsers.length > 1) {
        allBrowsers.forEach(b => b.browserPanelDeleteButton.style.display = 'block');
    }
}

async function updateAllBrowsers() {
    for (let b of allBrowsers) {
        await b.update();
    }
}

function deleteAllBrowsers() {
    for (let b of allBrowsers) {
        b.rootElement.remove();
    }
    allBrowsers = [];
}

function setCurrentBrowser(browser) {
    if (browser === undefined) {
        currentBrowser?.rootElement.classList.remove('hic-root-selected');
        currentBrowser = browser;
        return;
    }

    if (browser !== currentBrowser) {
        currentBrowser?.rootElement.classList.remove('hic-root-selected');
        browser.rootElement.classList.add('hic-root-selected');
        currentBrowser = browser;
        EventBus.globalBus.post(HICEvent("BrowserSelect", browser));
    }
}

function deleteBrowser(browser) {
    browser.unsyncSelf();
    browser.rootElement.remove();
    allBrowsers = allBrowsers.filter(b => b !== browser);
    if (allBrowsers.length <= 1) {
        allBrowsers.forEach(b => b.browserPanelDeleteButton.style.display = 'none');
    }
}

function getCurrentBrowser() {
    return currentBrowser;
}

function syncBrowsers(browsers) {
    const synchableBrowsers = (browsers || allBrowsers).filter(b => b.synchable !== false && b.dataset !== undefined);

    synchableBrowsers.forEach(b1 => {
        synchableBrowsers.forEach(b2 => {
            if (b1 !== b2 && b1.dataset.isCompatible(b2.dataset)) {
                b1.synchedBrowsers.add(b2);
                b2.synchedBrowsers.add(b1);
            }
        });
    });
}

function getAllBrowsers() {
    return allBrowsers;
}

function setDefaults(config) {

    // if (config.state) {
    //
    //     config.state = StringUtils.isString(config.state) ? State.parse(config.state) : new State(
    //         config.state.chr1,
    //         config.state.chr2,
    //         config.state.zoom,
    //         config.state.x,
    //         config.state.y,
    //         config.width,
    //         config.height,
    //         config.state.pixelSize,
    //         config.state.normalization
    //     );
    // }

    if (config.figureMode === true) {
        config.showLocusGoto = false;
        config.showHicContactMapLabel = false;
        config.showChromosomeSelector = false;
    } else {

        if (config.state) {
            const { width, height } = config.state
            config.width = width
            config.height = height
        } else {
            config.width = defaultSize.width
            config.height = defaultSize.height
        }
        // config.width = config.width ?? config.state?.width ?? defaultSize.width;
        // config.height = config.height ?? config.state?.height ?? defaultSize.height;

        config.showLocusGoto = config.showLocusGoto ?? true;
        config.showHicContactMapLabel = config.showHicContactMapLabel ?? true;
        config.showChromosomeSelector = config.showChromosomeSelector ?? true;
    }
}

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
};
