/**
 * A sequence track reaches igv with an index, whichever way it was loaded.
 *
 * `DataLoader.loadTracks` is the one road for both a session restore and a
 * runtime load, so pinning the config igv is handed covers both. The rules of
 * the guess itself are in testInferSequenceIndex.js. #587.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const createTrack = vi.fn();

vi.mock('igv', () => ({
    default: { createTrack: (...args) => createTrack(...args) }
}));

vi.mock('igv-ui', () => ({
    AlertDialog: class {},
    InputDialog: class {},
    DOMUtils: {}
}));

const { default: DataLoader } = await import("../js/dataLoader.js");

/** Just enough of the browser for the loader to reserve and fill one row. */
function stubBrowser() {
    const trackPairs = [];
    return {
        genome: undefined,
        tracks2D: [],
        showTrackLabelAndGutter: false,
        trackPairs,
        layoutController: {
            reservePendingTracks: (configs) => configs.map(({ name }) => {
                const placeholder = { name, isPendingTrack: true };
                trackPairs.push(placeholder);
                return placeholder;
            }),
            hasPendingTrack: (placeholder) => trackPairs.includes(placeholder),
            fillPendingTrack: () => ({ updateViews: async () => undefined }),
            removePendingTrack: () => true
        },
        updateLayout: async () => undefined,
        registry: { presentAlert: () => undefined }
    };
}

async function configHandedToIgv(config) {
    const browser = stubBrowser();
    await new DataLoader(browser).loadTracks([config]);
    return createTrack.mock.calls[0][0];
}

describe("a sequence track loaded through DataLoader", function () {

    beforeEach(() => {
        createTrack.mockReset();
        createTrack.mockImplementation(async (config) => ({ name: config.name }));
        vi.restoreAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        global.document.querySelector = () => ({ style: {} });
        global.getComputedStyle = () => ({ getPropertyValue: () => "0" });
    });

    test("is given the sibling .fai when it names no index", async function () {
        const config = await configHandedToIgv({ url: "https://igv.org/genomes/data/hg38/hg38.fa" });

        expect(config.type).toBe("sequence");
        expect(config.indexURL).toBe("https://igv.org/genomes/data/hg38/hg38.fa.fai");
    });

    test("keeps the index it names", async function () {
        const config = await configHandedToIgv({
            url: "https://igv.org/genomes/data/hg38/hg38.fa",
            indexURL: "https://igv.org/genomes/data/hg38/hg38.fa.fai?v=2"
        });

        expect(config.indexURL).toBe("https://igv.org/genomes/data/hg38/hg38.fa.fai?v=2");
    });

    test("leaves a track that is not a sequence track alone", async function () {
        const config = await configHandedToIgv({ url: "https://example.org/signal.bigWig", format: "bigwig" });

        expect(config.indexURL).toBeUndefined();
    });
});
