/*
 * @author Jim Robinson Dec-2020
 */

import { StringUtils } from 'igv-utils';
import HICBrowser from './hicBrowser.js';
import BrowserRegistry from './browserRegistry.js';
import {parseColorScale} from './colorScaleParser.js';
import ContactMatrixView from "./contactMatrixView.js";

const defaultSize = { width: 640, height: 640 };

/**
 * The page's one registry. Every export below is a convenience over it, kept
 * and delegating per decision 4 of ADR-0004 -- both known host apps import
 * them, as ADR-0003 measures.
 *
 * Resolving a registry from the container element instead -- so two embeds can
 * coexist -- is decisions 2 and 8 of `docs/adr/0004-browser-registry-per-container.md`
 * and lands separately. Until then this constant is the whole population.
 */
const defaultRegistry = new BrowserRegistry();

async function createBrowser(hicContainer, config, callback) {

    normalizeConfig(config);

    const browser = new HICBrowser(hicContainer, config);
    await browser.init(config);

    if (typeof callback === "function") callback();

    defaultRegistry.add(browser);

    return browser;
}

async function createBrowserList(hicContainer, session) {

    const configList = session.browsers || [session];
    const initPromises = [];

    defaultRegistry.clear();

    for (const config of configList) {

        normalizeConfig(config);

        if (session.syncDatasets === false) {
            config.synchable = false;
        }

        const browser = new HICBrowser(hicContainer, config);

        // Registered before init: loading a dataset consults the registry.
        defaultRegistry.register(browser);
        initPromises.push(browser.init(config));
    }
    await Promise.all(initPromises);

    defaultRegistry.select(defaultRegistry.browsers[0]);
    defaultRegistry.refreshDeleteButtonVisibility();
}

async function updateAllBrowsers() {
    await defaultRegistry.updateAll();
}

function deleteAllBrowsers() {
    defaultRegistry.deleteAll();
}

function setCurrentBrowser(browser) {
    defaultRegistry.select(browser);
}

function deleteBrowser(browser) {
    defaultRegistry.delete(browser);
}

function getCurrentBrowser() {
    return defaultRegistry.currentBrowser;
}

function syncBrowsers(browsers) {
    defaultRegistry.sync(browsers);
}

function getAllBrowsers() {
    return defaultRegistry.browsers;
}

function normalizeConfig(config) {

    setDefaults(config);

    if (StringUtils.isString(config.colorScale)) {
        config.colorScale = parseColorScale(config.colorScale);
    }
    if (StringUtils.isString(config.backgroundColor)) {
        config.backgroundColor = ContactMatrixView.parseBackgroundColor(config.backgroundColor);
    }
}

function setDefaults(config) {

    if (config.figureMode === true) {
        config.showLocusGoto = false;
        config.showHicContactMapLabel = false;
        config.showChromosomeSelector = false;
    } else {


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
