import FeatureTrack from "./feature/featureTrack.js";
import WigTrack from "./feature/wigTrack.js";
import VariantTrack from "./variant/variantTrack.js";

const tracks = {

    'feature': (config, browser) => {
        return new FeatureTrack(config, browser);
    },

    'wig': (config, browser) => {
        return new WigTrack(config, browser);
    },
    'variant': (config, browser) => {
        return new VariantTrack(config, browser);
    }
}

const addTrack = function (name, track) {
    this.tracks[name] = track;
}

const getTrack = function (name) {
    return this.tracks[name];
}

export default {
    tracks,
    addTrack,
    getTrack
}
