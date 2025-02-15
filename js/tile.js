
class Tile {

    constructor(chr, startBP, endBP, bpp, buffer, features) {
        this.chr = chr;
        this.startBP = startBP;
        this.endBP = endBP;
        this.bpp = bpp;
        this.buffer = buffer;
        this.features = features;
    }

    containsRange(chr, startBP, endBP, bpp) {
        return chr === this.chr && this.bpp === bpp && this.startBP <= startBP && this.endBP >= endBP;
    }
}

export default Tile
