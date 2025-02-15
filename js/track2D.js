import {igvxhr, StringUtils} from '../node_modules/igv-utils/src/index.js'

class Track2D {

    static DisplayModes = {
        lower: 0b01,
        upper: 0b10,
        both: 0b01 | 0b10,
    }

    constructor(config, features) {

        this.config = config
        this.name = config.name

        if (config.color && validateColor(config.color)) {
            this.color = this.color = config.color    // If specified, this will override colors of individual records.
        }

        this.displayMode = config.displayMode // Can be undefined => both

        this.isVisible = undefined === config.isVisible ? true : config.isVisible

        this.repColor = features.length > 0 ? features[0].color : "black"

        this.featureMap = {}
        this.featureCount = 0
        for (let f of features) {
            this.featureCount++
            const key = getKey(f.chr1, f.chr2)
            let list = this.featureMap[key]
            if (!list) {
                list = []
                this.featureMap[key] = list
            }
            list.push(f)
        }
    }

    static async loadTrack2D(config, genome) {

        const data = await igvxhr.loadString(config.url, buildOptions(config))
        const features = parseData(data, isBedPE(config), genome)
        return new Track2D(config, features)
    }

    getColor() {
        return this.color || this.repColor
    }

    getFeatures(chr1, chr2) {
        const key = getKey(chr1, chr2)
        return this.featureMap[key]
    }

    toJSON() {
        const json =
            {
                url: this.config.url
            }
        if (this.name) {
            json.name = this.name
        }
        if (this.color) {
            json.color = this.color
        }
        if (this.displayMode) {
            json.displayMode = this.displayMode
        }
        if (!this.isVisible) {
            json.isVisible = this.isVisible
        }

        return json

    }

}


function isBedPE(config) {

    if (typeof config.url === "string") {
        return config.url.toLowerCase().indexOf(".bedpe") > 0
    } else if (typeof config.name === "string") {
        return config.name.toLowerCase().indexOf(".bedpe") > 0
    } else {
        return true  // Default
    }
}

function parseData(data, isBedPE, genome) {

    if (!data) return null

    const lines = StringUtils.splitLines(data)
    const allFeatures = []
    const delimiter = "\t"
    const start = isBedPE ? 0 : 1
    const colorColumn = isBedPE ? 10 : 6

    let errorCount = 0
    for (let line of lines) {
        line = line.trim()
        if (line.startsWith("#") || line.startsWith("track") || line.startsWith("browser") || line.length === 0) {
            continue
        }
        const tokens = line.split(delimiter)
        if (tokens.length < 6 && errorCount <= 5) {
            if (errorCount === 5) {
                console.error("...")
            } else {
                console.error("Could not parse line: " + line)
            }
            errorCount++
            continue
        }

        const feature = {
            chr1: genome ? genome.getChromosomeName(tokens[0]) : tokens[0],
            x1: parseInt(tokens[1]),
            x2: parseInt(tokens[2]),
            chr2: genome ? genome.getChromosomeName(tokens[3]) : tokens[3],
            y1: parseInt(tokens[4]),
            y2: parseInt(tokens[5])
        }

        if (tokens.length > colorColumn) {
            feature.color = "rgb(" + tokens[colorColumn] + ")"
        }

        if (!Number.isNaN(feature.x1)) {
            allFeatures.push(feature)
        }
    }

    return allFeatures
}

function getKey(chr1, chr2) {
    return chr1 > chr2 ? chr2 + "_" + chr1 : chr1 + "_" + chr2
}

function validateColor(str) {
    var div = document.createElement("div")
    div.style.borderColor = str
    return div.style.borderColor !== ""
}

function isString(x) {
    return typeof x === "string" || x instanceof String
}

function buildOptions(config, options) {
    const defaultOptions = {
        oauthToken: config.oauthToken,
        headers: config.headers,
        withCredentials: config.withCredentials,
        filename: config.filename
    }

    return Object.assign(defaultOptions, options)
}

export default Track2D
