/*
 * @author Jim Robinson Dec-2020
 */
import {URIUtils, StringUtils, TrackUtils} from '../../node_modules/igv-utils/src/index.js'
import {inferTrackType} from "./util/igvUtils.js"
import TrackFactory from './trackFactory.js'
import FeatureSource from "./feature/featureSource.js"

const igv = {

    async createTrack(config, browser) {

        // Resolve function and promise urls
        let url = await URIUtils.resolveURL(config.url);
        if (StringUtils.isString(url)) {
            url = url.trim();
        }

        if (url) {
            if (config.format) {
                config.format = config.format.toLowerCase();
            } else {
                let filename = config.filename;
                if (!filename) {
                    filename = await getFilename(url);
                }
                config.format = TrackUtils.inferFileFormat(filename);
            }
        }

        let type = config.type;
        if (type && "bedtype" !== type) {
            type = type.toLowerCase();
        } else {
            type = inferTrackType(config);
            if ("bedtype" === type) {
                // Bed files must be read to determine track type
                const featureSource = FeatureSource(config, browser.genome);
                config._featureSource = featureSource;    // This is a temp variable, bit of a hack
                const trackType = await featureSource.trackType();
                if (trackType) {
                    type = trackType;
                } else {
                    type = "annotation";
                }
                // Record in config to make type persistent in session
                config.type = type;
            }
        }


        let track
        switch (type) {
            case "annotation":
            case "genes":
            case "fusionjuncspan":
            case "junctions":
            case "splicejunctions":
            case "snp":
                track = TrackFactory.getTrack("feature")(config, browser);
                break;
            default:
                if (TrackFactory.tracks.hasOwnProperty(type)) {
                    track = TrackFactory.getTrack(type)(config, browser);
                } else {
                    track = undefined;
                }
        }

        if (config.roi && track) {
            track.roi = [];
            for (let r of config.roi) {
                track.roi.push(new ROI(r, browser.genome));
            }
        }

        return track

    }
}

export default igv