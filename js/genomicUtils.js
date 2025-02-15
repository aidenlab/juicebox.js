import {StringUtils} from "../node_modules/igv-utils/src/index.js";

function getLocus(dataset, state, width, height, bpPerPixel){

    // bp/bin = (bp/pixel) * (pixel/bin) = bp
    const bpPerBin = bpPerPixel * state.pixelSize

    // bp = bin * bp / bin = bp
    const xStartBP = 1 + Math.round(state.x * bpPerBin)
    const yStartBP = 1 + Math.round(state.y * bpPerBin)

    const chromosome1 = dataset.chromosomes[state.chr1]
    const chromosome2 = dataset.chromosomes[state.chr2]

    // bp = (pixel * bin/pixel) * (bp/bin)
    // bp = bin * bp/bin = bp
    const widthBP = Math.round(bpPerPixel * width)
    const heightBP = Math.round(bpPerPixel * height)

    // bp = bp
    const xEndBP = Math.min(chromosome1.size, widthBP + xStartBP - 1)
    const yEndBP = Math.min(chromosome2.size, heightBP + yStartBP - 1)

    return { xStartBP, yStartBP, xEndBP, yEndBP, chromosome1, chromosome2, pixelSize:state.pixelSize }

}

function locusDescription(locus) {

    const { xStartBP, yStartBP, xEndBP, yEndBP, chromosome1, chromosome2, pixelSize } = locus

    const str1 = `${chromosome1.name}:${StringUtils.numberFormatter(xStartBP)}-${StringUtils.numberFormatter(xEndBP)}`
    const str2 = `${chromosome2.name}:${StringUtils.numberFormatter(yStartBP)}-${StringUtils.numberFormatter(yEndBP)}`

    return `${ str1 } ${ str2 } pixelSize ${ pixelSize }`

}
export { getLocus, locusDescription }
