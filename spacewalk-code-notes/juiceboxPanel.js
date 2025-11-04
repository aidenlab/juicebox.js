import hic from 'juicebox.js'
import SpacewalkEventBus from '../spacewalkEventBus.js'
import Panel from '../panel.js'
import { ballAndStick, liveContactMapService, liveDistanceMapService, ensembleManager, ribbon, igvPanel, genomicNavigator } from '../app.js'
// LiveMapDataset is now part of juicebox.js and will be used via browser.loadLiveMapDataset()
import { renderLiveMapWithDistanceData } from './liveDistanceMapService.js'
import {appleCrayonColorRGB255, rgb255String, compositeColors} from "../utils/colorUtils"
import {transferRGBAMatrixToLiveMapCanvas} from "../utils/utils.js"

// Helper function to create ImageBitmap (polyfill if needed)
async function createImageBitmap(...args) {
    if (window.createImageBitmap) {
        return window.createImageBitmap(...args)
    } else {
        // Fallback for browsers without createImageBitmap
        throw new Error('createImageBitmap not supported')
    }
}

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
            await hic.restoreSession(document.querySelector('#spacewalk_juicebox_root_container'), session)
        } catch (e) {
            const error = new Error(`Error loading Juicebox Session ${ e.message }`)
            console.error(error.message)
            alert(error.message)
        }

        this.browser = hic.getCurrentBrowser()

        // Initialize live map canvas contexts (Spacewalk-specific)
        this.initializeLiveMapContexts()

        if (ensembleManager.datasource) {
            await this.loadLiveMapDataset()
        }

        this.attachMouseHandlersAndEventSubscribers()

        this.hicMapTab.show()

    }

    /**
     * Initialize live map canvas contexts for bitmaprenderer rendering.
     * This method creates and configures the ctx_live and ctx_live_distance
     * contexts that are required for live map rendering in Spacewalk.
     */
    initializeLiveMapContexts() {
        const browser = this.browser
        const rootElement = browser.rootElement
        
        // Find or create container divs for live map canvases
        let liveContactContainer = rootElement.querySelector(`#${browser.id}-live-contact-map-canvas-container`)
        if (!liveContactContainer) {
            liveContactContainer = document.createElement('div')
            liveContactContainer.id = `${browser.id}-live-contact-map-canvas-container`
            liveContactContainer.style.position = 'relative'
            liveContactContainer.style.width = '100%'
            liveContactContainer.style.height = '100%'
            liveContactContainer.style.display = 'none' // Hidden by default, shown via tab
            // Insert after the main contact map viewport
            const viewport = browser.layoutController.getContactMatrixViewport()
            viewport.parentNode.insertBefore(liveContactContainer, viewport.nextSibling)
        }
        
        // Get or create live contact map canvas
        let canvas = liveContactContainer.querySelector(`#${browser.id}-live-contact-map-canvas`)
        if (!canvas) {
            canvas = document.createElement('canvas')
            canvas.id = `${browser.id}-live-contact-map-canvas`
            canvas.style.width = '100%'
            canvas.style.height = '100%'
            liveContactContainer.appendChild(canvas)
        }
        
        const ctx_live = canvas.getContext('bitmaprenderer')
        if (!ctx_live) {
            console.warn('bitmaprenderer context not available for live contact map')
        }
        
        // Find or create container for live distance map canvas
        let liveDistanceContainer = rootElement.querySelector(`#${browser.id}-live-distance-map-canvas-container`)
        if (!liveDistanceContainer) {
            liveDistanceContainer = document.createElement('div')
            liveDistanceContainer.id = `${browser.id}-live-distance-map-canvas-container`
            liveDistanceContainer.style.position = 'relative'
            liveDistanceContainer.style.width = '100%'
            liveDistanceContainer.style.height = '100%'
            liveDistanceContainer.style.display = 'none' // Hidden by default, shown via tab
            // Insert after live contact container
            liveContactContainer.parentNode.insertBefore(liveDistanceContainer, liveContactContainer.nextSibling)
        }
        
        // Get or create live distance map canvas
        canvas = liveDistanceContainer.querySelector(`#${browser.id}-live-distance-map-canvas`)
        if (!canvas) {
            canvas = document.createElement('canvas')
            canvas.id = `${browser.id}-live-distance-map-canvas`
            canvas.style.width = '100%'
            canvas.style.height = '100%'
            liveDistanceContainer.appendChild(canvas)
        }
        
        const ctx_live_distance = canvas.getContext('bitmaprenderer')
        if (!ctx_live_distance) {
            console.warn('bitmaprenderer context not available for live distance map')
        }
        
        // Set contexts on ContactMatrixView
        browser.contactMatrixView.setLiveMapContexts(ctx_live, ctx_live_distance)
        
        // Update canvas sizes to match viewport when viewport is resized
        this.updateLiveMapCanvasSizes()
    }
    
    /**
     * Update live map canvas sizes to match the main canvas viewport
     * Uses viewport dimensions directly, matching the old approach where width/height
     * were passed directly from the ContactMatrixView viewport.
     */
    updateLiveMapCanvasSizes() {
        const browser = this.browser
        const contactMatrixView = browser.contactMatrixView
        
        // Get viewport dimensions directly - this matches the old approach
        // where width and height were passed directly from the viewport
        const width = contactMatrixView.viewportElement.offsetWidth
        const height = contactMatrixView.viewportElement.offsetHeight
        
        // Ensure we have valid dimensions
        if (width === 0 || height === 0) {
            console.warn(`Viewport dimensions are invalid: ${width}x${height}. Canvas sizes not updated.`)
            return
        }
        
        if (contactMatrixView.ctx_live) {
            const canvas = contactMatrixView.ctx_live.canvas
            canvas.width = width
            canvas.height = height
            // Set CSS size to match viewport
            canvas.style.width = `${width}px`
            canvas.style.height = `${height}px`
            console.log(`Updated ctx_live canvas size: ${canvas.width}x${canvas.height}`)
        }
        
        if (contactMatrixView.ctx_live_distance) {
            const canvas = contactMatrixView.ctx_live_distance.canvas
            canvas.width = width
            canvas.height = height
            // Set CSS size to match viewport
            canvas.style.width = `${width}px`
            canvas.style.height = `${height}px`
            console.log(`Updated ctx_live_distance canvas size: ${canvas.width}x${canvas.height}`)
        }
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
        // Note: locus can be undefined - setState will derive it using configureLocus()
        // Or we can create it explicitly with the proper structure: { x: {chr, start, end}, y: {chr, start, end} }
        const stateConfig = {
            chr1: chrIndex,
            chr2: chrIndex,
            locus: undefined, // Let setState configure it automatically
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

        // Update canvas sizes to match current viewport
        this.updateLiveMapCanvasSizes()

        // Trigger color scale check (will use standard checkColorScale method)
        await browser.contactMatrixView.update()

        // Paint and transfer RGBA matrix to canvas
        this.paintContactMapRGBAMatrix(contactFrequencies, contactFrequencyArray, browser.contactMatrixView.colorScale, browser.contactMatrixView.backgroundColor)

        // Transfer RGBA matrix to live map canvas
        const ctx_live = browser.contactMatrixView.ctx_live
        if (ctx_live) {
            const canvas = ctx_live.canvas
            
            // Ensure canvas has valid dimensions
            if (canvas.width === 0 || canvas.height === 0) {
                console.warn(`Canvas dimensions are invalid: ${canvas.width}x${canvas.height}. Updating sizes...`)
                this.updateLiveMapCanvasSizes()
                // Check again after update
                if (canvas.width === 0 || canvas.height === 0) {
                    console.error(`Cannot render: canvas dimensions are still invalid: ${canvas.width}x${canvas.height}`)
                    return
                }
            }
            
            console.log(`Transferring RGBA matrix: matrixDimension=${liveMapTraceLength}, canvas size=${canvas.width}x${canvas.height}`)
            
            // Scale the matrix to match canvas size if needed
            if (liveMapTraceLength !== canvas.width || liveMapTraceLength !== canvas.height) {
                // Create a temporary canvas at source size
                const tempCanvas = document.createElement('canvas')
                tempCanvas.width = liveMapTraceLength
                tempCanvas.height = liveMapTraceLength
                const tempCtx = tempCanvas.getContext('2d')
                const imageData = new ImageData(contactFrequencyArray, liveMapTraceLength, liveMapTraceLength)
                tempCtx.putImageData(imageData, 0, 0)
                
                // Create an offscreen canvas at target size and scale the image
                const scaledCanvas = document.createElement('canvas')
                scaledCanvas.width = canvas.width
                scaledCanvas.height = canvas.height
                const scaledCtx = scaledCanvas.getContext('2d')
                // Use imageSmoothingEnabled: false for pixelated scaling
                scaledCtx.imageSmoothingEnabled = false
                scaledCtx.drawImage(tempCanvas, 0, 0, liveMapTraceLength, liveMapTraceLength, 0, 0, canvas.width, canvas.height)
                
                // Verify scaled canvas has valid dimensions before creating ImageBitmap
                if (scaledCanvas.width > 0 && scaledCanvas.height > 0) {
                    // Create image bitmap from scaled canvas
                    const imageBitmap = await createImageBitmap(scaledCanvas)
                    ctx_live.transferFromImageBitmap(imageBitmap)
                } else {
                    console.error(`Cannot create ImageBitmap: scaled canvas dimensions are invalid: ${scaledCanvas.width}x${scaledCanvas.height}`)
                }
            } else {
                // Direct transfer if dimensions match
                await transferRGBAMatrixToLiveMapCanvas(ctx_live, contactFrequencyArray, liveMapTraceLength)
            }
        } else {
            console.warn('ctx_live not available for live map rendering')
        }
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

    // Hide all canvas containers first
    const viewport = browser.layoutController.getContactMatrixViewport()
    const mainContainer = viewport.parentElement
    const hicContainer = viewport
    const liveContactContainer = mainContainer.querySelector(`#${browser.id}-live-contact-map-canvas-container`)
    const liveDistanceContainer = mainContainer.querySelector(`#${browser.id}-live-distance-map-canvas-container`)
    
    // Hide all containers
    if (hicContainer) hicContainer.style.display = 'none'
    if (liveContactContainer) liveContactContainer.style.display = 'none'
    if (liveDistanceContainer) liveDistanceContainer.style.display = 'none'

    switch (activeTabButton.id) {
        case 'spacewalk-juicebox-panel-hic-map-tab':
            if (hicContainer) hicContainer.style.display = 'block'
            document.getElementById('hic-live-distance-map-toggle-widget').style.display = 'none'
            document.getElementById('hic-live-contact-frequency-map-threshold-widget').style.display = 'none'
            document.getElementById('hic-file-chooser-dropdown').style.display = 'block'
            break;

        case 'spacewalk-juicebox-panel-live-map-tab':
            if (liveContactContainer) liveContactContainer.style.display = 'block'
            document.getElementById('hic-live-distance-map-toggle-widget').style.display = 'none'
            document.getElementById('hic-live-contact-frequency-map-threshold-widget').style.display = 'block'
            document.getElementById('hic-file-chooser-dropdown').style.display = 'none'
            break;

        case 'spacewalk-juicebox-panel-live-distance-map-tab':
            if (liveDistanceContainer) liveDistanceContainer.style.display = 'block'
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
