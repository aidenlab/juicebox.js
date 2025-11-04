import hic from 'juicebox.js'
import SpacewalkEventBus from '../spacewalkEventBus.js'
import Panel from '../panel.js'
import { ballAndStick, liveContactMapService, liveDistanceMapService, ensembleManager, ribbon, igvPanel, genomicNavigator } from '../app.js'
// LiveMapDataset is now part of juicebox.js and will be used via browser.loadLiveMapDataset()
import { renderLiveMapWithDistanceData } from './liveDistanceMapService.js'
import {appleCrayonColorRGB255, rgb255String, compositeColors} from "../utils/colorUtils"
import {transferRGBAMatrixToLiveMapCanvas} from "../utils/utils.js"

// Store reference to the singleton JuiceboxPanel instance for event handlers
let juiceboxPanelInstance = null;

class JuiceboxPanel extends Panel {

    constructor ({ container, panel, isHidden }) {

        const xFunction = (cw, w) => {
            return (cw - w)/2;
        };

        const yFunction = (ch, h) => {
            return ch - (h * 1.05);
        };

        super({ container, panel, isHidden, xFunction, yFunction });

        // Store singleton instance for event handlers to access
        juiceboxPanelInstance = this;

        // const dragHandle = panel.querySelector('.spacewalk_card_drag_container')
        // makeDraggable(panel, dragHandle)

        this.panel.addEventListener('mouseenter', (event) => {
            event.stopPropagation();
            SpacewalkEventBus.globalBus.post({ type: 'DidEnterGenomicNavigator', data: 'DidEnterGenomicNavigator' });
        });

        this.panel.addEventListener('mouseleave', (event) => {
            event.stopPropagation();
            SpacewalkEventBus.globalBus.post({ type: 'DidLeaveGenomicNavigator', data: 'DidLeaveGenomicNavigator' });
        });

        panel.querySelector('#hic-live-contact-frequency-map-calculation-button').addEventListener('click', async e => {
            liveContactMapService.updateEnsembleContactFrequencyCanvas(undefined)
        })

        SpacewalkEventBus.globalBus.subscribe('DidLoadEnsembleFile', this)

    }

    async initialize(container, config) {

        let session

        if (config.browsers) {
            session = Object.assign({ queryParametersSupported: false }, config)
        } else {
            const { width, height } = config
            session =
                {
                    browsers:
                        [
                            {
                                width,
                                height,
                                queryParametersSupported: false
                            }
                        ]
                }
        }

        await this.loadSession(session)

    }

    async loadSession(session) {

        this.detachMouseHandlers()

        try {
            this.browser = await hic.restoreSession(document.querySelector('#spacewalk_juicebox_root_container'), session)
        } catch (e) {
            const error = new Error(`Error loading Juicebox Session ${ e.message }`)
            console.error(error.message)
            alert(error.message)
        }

        if (ensembleManager.datasource) {
            await this.loadLiveMapDataset()
        }

        this.attachMouseHandlersAndEventSubscribers()

        this.hicMapTab.show()

    }

    attachMouseHandlersAndEventSubscribers() {

        this.browser.eventBus.subscribe('DidHideCrosshairs', ribbon)

        this.browser.eventBus.subscribe('DidHideCrosshairs', ballAndStick)

        this.browser.eventBus.subscribe('DidHideCrosshairs', genomicNavigator)

        this.browser.eventBus.subscribe('DidUpdateColor', async ({ data }) => {
            await this.colorPickerHandler(data)
        })

        this.browser.eventBus.subscribe('DidUpdateColorScaleThreshold', async ({ data }) => {
            const { threshold, r, g, b } = data
            console.log('JuiceboxPanel. Render Live Contact Map')
            await this.renderLiveMapWithContactData(liveContactMapService.contactFrequencies, liveContactMapService.rgbaMatrix, ensembleManager.getLiveMapTraceLength())

        })

        this.browser.eventBus.subscribe('MapLoad', async event => {
            const activeTabButton = this.container.querySelector('button.nav-link.active')
            tabAssessment(this.browser, activeTabButton)
        })

        this.browser.setCustomCrosshairsHandler(({ xBP, yBP, startXBP, startYBP, endXBP, endYBP, interpolantX, interpolantY }) => {
            juiceboxMouseHandler({ xBP, yBP, startXBP, startYBP, endXBP, endYBP, interpolantX, interpolantY });
        })

        this.configureTabs()
    }

    configureTabs() {

        // Locate tab elements
        const hicMapTabElement = document.getElementById('spacewalk-juicebox-panel-hic-map-tab')
        const liveMapTabElement = document.getElementById('spacewalk-juicebox-panel-live-map-tab')
        const liveDistanceMapTabElement = document.getElementById('spacewalk-juicebox-panel-live-distance-map-tab')

        // Assign data-bs-target to refer to corresponding map canvas container (hi-c or live-contact or live-distance)
        hicMapTabElement.setAttribute("data-bs-target", `#${this.browser.id}-contact-map-canvas-container`)
        liveMapTabElement.setAttribute("data-bs-target", `#${this.browser.id}-live-contact-map-canvas-container`)
        liveDistanceMapTabElement.setAttribute("data-bs-target", `#${this.browser.id}-live-distance-map-canvas-container`)

        // Create instance property for each tab
        this.hicMapTab = new bootstrap.Tab(hicMapTabElement)
        this.liveMapTab = new bootstrap.Tab(liveMapTabElement)
        this.liveDistanceMapTab = new bootstrap.Tab(liveDistanceMapTabElement)

        // Default to show Live Map tab
        this.liveMapTab.show()

        const activeTabButton = this.container.querySelector('button.nav-link.active')
        tabAssessment(this.browser, activeTabButton)

        for (const tabElement of this.container.querySelectorAll('button[data-bs-toggle="tab"]')) {
            tabElement.addEventListener('show.bs.tab', tabEventHandler)
        }

        this.liveDistanceMapTab._element.addEventListener('shown.bs.tab', event => {
            if (liveDistanceMapService.isTraceToggleChecked()) {
                liveDistanceMapService.updateTraceDistanceCanvas(ensembleManager.getLiveMapTraceLength(), ensembleManager.currentTrace)
            }
        })

    }

    isActiveTab(tab) {
        return tab._element.classList.contains('active')
    }

    detachMouseHandlers() {

        for (const tabElement of this.container.querySelectorAll('button[data-bs-toggle="tab"]')) {
            tabElement.removeEventListener('show.bs.tab', tabEventHandler);
        }

    }

    async receiveEvent({ type, data }) {

        if ('DidLoadEnsembleFile' === type) {

            // Clear Hi-C map rendering
            const ctx = this.browser.contactMatrixView.ctx
            ctx.fillStyle = rgb255String( appleCrayonColorRGB255('snow') )
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

            // Load live map dataset
            await this.loadLiveMapDataset()

            // Show Live Map tab to be consistent with Live Dataset
            this.liveMapTab.show()

            // MapLoad event will be posted automatically by loadLiveMapDataset
            // Locus change will be handled by the standard update cycle

        }

        super.receiveEvent({ type, data });

    }

    getClassName(){ return 'JuiceboxPanel' }

    async loadHicFile(url, name, mapType) {

        try {
            const isControl = ('control-map' === mapType)

            const config = { url, name, isControl }

            if (false === isControl) {

                this.present()

                await this.browser.loadHicFile(config)

            }

        } catch (e) {
            const error = new Error(`Error loading ${ url }: ${ e }`)
            console.error(error.message)
            alert(error.message)
        }

        const { chr, genomicStart, genomicEnd } = ensembleManager.locus

        try {
            await this.browser.parseGotoInput(`${chr}:${genomicStart}-${genomicEnd}`)
        } catch (error) {
            console.warn(error.message)
        }

    }

    async loadLiveMapDataset() {
        if (!isLiveMapSupported()) {
            return;
        }

        const { chr, genomicStart, genomicEnd } = ensembleManager.locus
        const traceLength = ensembleManager.getLiveMapTraceLength()
        const binSize = (genomicEnd - genomicStart) / traceLength
        
        // Get chromosome from IGV genome
        const chromosome = igvPanel.browser.genome.getChromosome(chr)
        if (!chromosome) {
            console.warn(`Live Maps are not available for chromosome ${chr}`)
            return
        }

        // Convert IGV genome chromosomes to array format expected by LiveMapDataset
        // LiveMapDataset expects chromosomes with: name, size (or bpLength), index
        const chromosomes = Array.from(igvPanel.browser.genome.chromosomes.values()).map((chr, idx) => ({
            name: chr.name,
            size: chr.size || chr.bpLength,
            bpLength: chr.size || chr.bpLength,
            index: idx
        }))
        // Move "All" chromosome to front if it exists
        const allIndex = chromosomes.findIndex(c => c.name.toLowerCase() === 'all')
        if (allIndex > 0) {
            const allChr = chromosomes.splice(allIndex, 1)[0]
            chromosomes.unshift(allChr)
            // Re-index after moving
            chromosomes.forEach((chr, idx) => { chr.index = idx })
        }

        // Find the chromosome index in our constructed array (for state chr1/chr2)
        // Juicebox uses 0-based array indexing, but state.chr1/chr2 use 1-based (0 = whole genome, 1 = first chr)
        const chrArrayIndex = chromosomes.findIndex(c => c.name === chromosome.name)
        if (chrArrayIndex < 0) {
            console.warn(`Chromosome ${chromosome.name} not found in chromosomes array`)
            return
        }
        // Juicebox state: 0 = whole genome, 1 = first chromosome (index 0), 2 = second chromosome (index 1), etc.
        const chrIndex = chrArrayIndex + 1

        // Create LiveMapDataset config
        const datasetConfig = {
            name: 'Live Map',
            genomeId: igvPanel.browser.genome.id,
            chromosomes: chromosomes,
            bpResolutions: [binSize],
            binSize: binSize,
            contactRecordList: [] // Will be populated by liveContactMapService
        }

        // Create state from genomic coordinates
        // Calculate bin positions for the genomic region
        const xBin = Math.floor(genomicStart / binSize)
        const yBin = Math.floor(genomicStart / binSize)
        const zoom = 0 // Live maps typically have single resolution
        
        // Create state object matching State constructor signature
        const stateConfig = {
            chr1: chrIndex,
            chr2: chrIndex,
            locus: `${chr}:${genomicStart}-${genomicEnd}`,
            zoom: zoom,
            x: xBin,
            y: yBin,
            pixelSize: 1,
            normalization: 'NONE'
        }

        await this.browser.loadLiveMapDataset({
            ...datasetConfig,
            state: stateConfig
        })
    }

    async renderLiveMapWithContactData(contactFrequencies, contactFrequencyArray, liveMapTraceLength) {
        console.log('JuiceboxPanel. Render Live Contact Map')
        
        const browser = this.browser
        
        // Ensure live map dataset is loaded
        if (!browser.activeDataset || browser.activeDataset.datasetType !== 'livemap') {
            await this.loadLiveMapDataset()
        }

        const state = browser.activeState
        const dataset = browser.activeDataset

        if (!state || !dataset) {
            console.warn('Live map state or dataset not available')
            return
        }

        // Update locus if needed
        const { chr, genomicStart, genomicEnd } = ensembleManager.locus
        try {
            await browser.parseGotoInput(`${chr}:${genomicStart}-${genomicEnd}`)
        } catch (error) {
            console.warn(error.message)
        }

        // Trigger color scale check (will use standard checkColorScale method)
        await browser.contactMatrixView.update()

        // Paint and transfer RGBA matrix to canvas
        this.paintContactMapRGBAMatrix(contactFrequencies, contactFrequencyArray, browser.contactMatrixView.colorScale, browser.contactMatrixView.backgroundColor)

        await transferRGBAMatrixToLiveMapCanvas(browser.contactMatrixView.ctx_live, contactFrequencyArray, liveMapTraceLength)
    }

    paintContactMapRGBAMatrix(frequencies, rgbaMatrix, colorScale, backgroundRGB) {
        let i = 0
        for (const frequency of frequencies) {
            const { red, green, blue, alpha } = colorScale.getColor(frequency)
            const foregroundRGBA = { r:red, g:green, b:blue, a:alpha }
            const { r, g, b } = compositeColors(foregroundRGBA, backgroundRGB)

            rgbaMatrix[i++] = r
            rgbaMatrix[i++] = g
            rgbaMatrix[i++] = b
            rgbaMatrix[i++] = 255
        }
    }

    async renderLiveMapWithDistanceData(distances, maxDistance, rgbaMatrix, liveMapTraceLength) {
        console.log('JuiceboxPanel. Render Live Distance Map')
        await renderLiveMapWithDistanceData(this.browser, distances, maxDistance, rgbaMatrix, liveMapTraceLength)
    }

    async colorPickerHandler(data) {
        if (liveContactMapService.contactFrequencies) {
            console.log('JuiceboxPanel.colorPickerHandler(). Will render Live Contact Map')
            await this.renderLiveMapWithContactData(liveContactMapService.contactFrequencies, liveContactMapService.rgbaMatrix, ensembleManager.getLiveMapTraceLength())
        }
        if (liveDistanceMapService.distances) {
            console.log('JuiceboxPanel.colorPickerHandler(). Will render Live Distance Map')
            await this.renderLiveMapWithDistanceData(liveDistanceMapService.distances, liveDistanceMapService.maxDistance, liveDistanceMapService.rgbaMatrix, ensembleManager.getLiveMapTraceLength())
        }

    }
}

function juiceboxMouseHandler({ xBP, yBP, startXBP, startYBP, endXBP, endYBP, interpolantX, interpolantY }) {

    if (undefined === ensembleManager || undefined === ensembleManager.locus) {
        return
    }

    const { genomicStart, genomicEnd } = ensembleManager.locus

    const trivialRejection = startXBP > genomicEnd || endXBP < genomicStart || startYBP > genomicEnd || endYBP < genomicStart

    if (trivialRejection) {
        return
    }

    const xRejection = xBP < genomicStart || xBP > genomicEnd
    const yRejection = yBP < genomicStart || yBP > genomicEnd

    if (xRejection || yRejection) {
        return
    }

    SpacewalkEventBus.globalBus.post({ type: 'DidUpdateGenomicInterpolant', data: { poster: this, interpolantList: [ interpolantX, interpolantY ] } })
}

function isLiveMapSupported() {

    const { chr } = ensembleManager.locus
    // const chromosome = igvPanel.browser.genome.getChromosome(chr.toLowerCase())
    const chromosome = igvPanel.browser.genome.getChromosome(chr)
    if (undefined === chromosome) {
        console.warn(`Live Maps are not available for chromosome ${ chr }. No associated genome found`)
        return false
    } else {
        return true
    }
}


function tabEventHandler(event) {
    tabAssessment(juiceboxPanelInstance.browser, event.target);
}

function tabAssessment(browser, activeTabButton) {

    // console.log(`JuiceboxPanel. Tab ${ activeTabButton.id } is active`);

    switch (activeTabButton.id) {
        case 'spacewalk-juicebox-panel-hic-map-tab':
            document.getElementById('hic-live-distance-map-toggle-widget').style.display = 'none'
            document.getElementById('hic-live-contact-frequency-map-threshold-widget').style.display = 'none'
            document.getElementById('hic-file-chooser-dropdown').style.display = 'block'
            break;

        case 'spacewalk-juicebox-panel-live-map-tab':
            document.getElementById('hic-live-distance-map-toggle-widget').style.display = 'none'
            document.getElementById('hic-live-contact-frequency-map-threshold-widget').style.display = 'block'
            document.getElementById('hic-file-chooser-dropdown').style.display = 'none'
            break;

        case 'spacewalk-juicebox-panel-live-distance-map-tab':
            document.getElementById('hic-live-distance-map-toggle-widget').style.display = 'block'
            document.getElementById('hic-live-contact-frequency-map-threshold-widget').style.display = 'none'
            document.getElementById('hic-file-chooser-dropdown').style.display = 'none'
            break;

        default:
            console.log('Unknown tab is active');
            break;
    }
}

export default JuiceboxPanel;
