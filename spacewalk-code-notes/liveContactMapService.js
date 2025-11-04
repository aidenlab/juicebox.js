import {ensembleManager, juiceboxPanel} from "../app.js"
import EnsembleManager from "../ensembleManager.js"
import SpacewalkEventBus from "../spacewalkEventBus.js"
import {hideGlobalSpinner, showGlobalSpinner} from "../utils/utils.js"
import {clamp} from "../utils/mathUtils.js"
import {enableLiveMaps} from "../utils/liveMapUtils.js"
import {postMessageToWorker} from "../utils/webWorkerUtils.js"

const maxDistanceThreshold = 1e4
const defaultDistanceThreshold = 256

/**
 * Convert Float32Array contact frequencies to contact record format
 * @param {Float32Array} contactFrequencies - Array of contact frequencies (traceLength * traceLength)
 * @param {number} traceLength - Length of the trace
 * @returns {Array<Object>} Array of contact records with {bin1, bin2, counts, getKey()}
 */
function convertContactFrequencyArrayToRecords(contactFrequencies, traceLength) {
    const records = [];
    for (let bin1 = 0; bin1 < traceLength; bin1++) {
        for (let bin2 = bin1; bin2 < traceLength; bin2++) {
            const index = bin1 * traceLength + bin2;
            const count = contactFrequencies[index];
            if (count > 0) {
                records.push({
                    bin1: bin1,
                    bin2: bin2,
                    counts: count,
                    getKey: function() {
                        return `${bin1}_${bin2}`;
                    }
                });
            }
        }
    }
    return records;
}

class LiveContactMapService {

    constructor (distanceThreshold) {

        this.distanceThreshold = distanceThreshold

        this.input = document.querySelector('#spacewalk_contact_frequency_map_adjustment_select_input')
        this.input.value = distanceThreshold.toString()

        document.querySelector('#hic-live-contact-frequency-map-threshold-button').addEventListener('click', () => {

            this.distanceThreshold = clamp(parseInt(this.input.value, 10), 0, maxDistanceThreshold)

            window.setTimeout(() => {
                this.updateEnsembleContactFrequencyCanvas(this.distanceThreshold)
            }, 0)
        })

        this.worker = new Worker(new URL('./liveContactMapWorker.js', import.meta.url), { type: 'module' })

        SpacewalkEventBus.globalBus.subscribe('DidLoadEnsembleFile', this);

    }

    receiveEvent({ type, data }) {

        if ("DidLoadEnsembleFile" === type) {

            // Safety check: ctx_live may not exist yet if browser isn't fully initialized
            if (juiceboxPanel?.browser?.contactMatrixView?.ctx_live) {
                juiceboxPanel.browser.contactMatrixView.ctx_live.transferFromImageBitmap(null)
            }

            this.contactFrequencies = undefined
            this.rgbaMatrix = undefined

            this.distanceThreshold = distanceThresholdEstimate(ensembleManager.currentTrace)

            this.input.value = this.distanceThreshold.toString()
        }
    }

    setState(distanceThreshold) {
        this.distanceThreshold = distanceThreshold
        this.input.value = distanceThreshold.toString()
    }

    getClassName(){
        return 'LiveContactMapService'
    }

    async updateEnsembleContactFrequencyCanvas(distanceThresholdOrUndefined) {

        const status = await enableLiveMaps()

        if (true === status) {

            showGlobalSpinner()

            this.distanceThreshold = distanceThresholdOrUndefined || distanceThresholdEstimate(ensembleManager.currentTrace)
            this.input.value = this.distanceThreshold.toString()

            const data =
                {
                    traceOrEnsemble: 'ensemble',
                    traceLength: ensembleManager.getLiveMapTraceLength(),
                    vertexListsString: JSON.stringify( ensembleManager.getLiveMapVertexLists()),
                    distanceThreshold: this.distanceThreshold
                }

            let result
            try {
                console.log(`Live Contact Map ${ data.traceOrEnsemble } payload sent to worker`)
                result = await postMessageToWorker(this.worker, data)
                hideGlobalSpinner()
            } catch (err) {
                hideGlobalSpinner()
                console.error('Error: Live Contact Map', err)

            }

            const traceLength = ensembleManager.getLiveMapTraceLength()
            const arrayLength = traceLength * traceLength * 4

            if (undefined === this.rgbaMatrix || this.rgbaMatrix.length !== arrayLength) {
                this.rgbaMatrix = new Uint8ClampedArray(arrayLength)
            } else {
                this.rgbaMatrix.fill(0)
            }

            this.contactFrequencies = result.workerValuesBuffer
            
            // Update LiveMapDataset with new contact records
            if (juiceboxPanel.browser.activeDataset && 
                juiceboxPanel.browser.activeDataset.datasetType === 'livemap') {
                const contactRecords = convertContactFrequencyArrayToRecords(this.contactFrequencies, traceLength);
                // Get binSize from the dataset's bpResolutions
                const binSize = juiceboxPanel.browser.activeDataset.bpResolutions[0];
                juiceboxPanel.browser.activeDataset.updateContactRecords(contactRecords, binSize);
            }

            await juiceboxPanel.renderLiveMapWithContactData(this.contactFrequencies, this.rgbaMatrix, traceLength)

        }

    }
}

function distanceThresholdEstimate(trace) {
    const { radius } = EnsembleManager.getTraceBounds(trace)
    return Math.floor(2 * radius / 4)
}

export { defaultDistanceThreshold }

export default LiveContactMapService
