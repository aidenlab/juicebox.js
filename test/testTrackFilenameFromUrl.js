/**
 * A track the host gives no `filename` gets one from juicebox, derived from its URL by the same rule
 * `extractName` names it by: decoded, and taken from the `file=` parameter of a GEO download link,
 * whose path ends in `/download/`. juicebox routes the track as 1D or 2D by it and hands it to igv,
 * which reads the format from it, so a host need not derive a filename itself. See issue #698.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { igvxhr } from 'igv-utils';

const createTrack = vi.fn();

vi.mock('igv', async (importOriginal) => {
    const igv = (await importOriginal()).default;
    return { default: { ...igv, createTrack: (...args) => createTrack(...args) } };
});

// igv-ui builds its DOMPurify at import, against no window, and the dialog sanitizes its initial
// values with it. The dialog is a track pair's furniture, not what is under test here.
vi.mock('igv-ui', async (importOriginal) => ({ ...(await importOriginal()), DataRangeDialog: class {} }));

const { withBrowser } = await import('./utils/browserFixture.js');
const { restoreDataset } = await import('./utils/restoreDataset.js');
const { decodeState } = await import('../js/sessionCodec.js');
const { default: HICBrowser } = await import('../js/hicBrowser.js');
const { default: ContactMatrixView } = await import('../js/contactMatrixView.js');
const { default: TrackPair } = await import('../js/trackPair.js');

const GEO_DOWNLOAD = "https://www.ncbi.nlm.nih.gov/geo/download/?acc=GSM5182714&format=file&file=";

function track(config) {
    return { name: config.name, config, getFeatures: async () => [], draw: () => undefined };
}

describe("a track the host gives no filename gets one from its URL", function () {

    const context = withBrowser();

    beforeEach(async () => {
        vi.spyOn(ContactMatrixView.prototype, 'update').mockImplementation(async () => undefined);
        vi.spyOn(HICBrowser.prototype, 'update').mockImplementation(async () => undefined);
        vi.spyOn(TrackPair.prototype, 'updateViews').mockImplementation(async () => undefined);
        context.browser.setActiveDataset(restoreDataset({ name: "map", url: "https://example.org/map.hic" }));
        await context.browser.setState(decodeState(undefined));

        createTrack.mockReset();
        createTrack.mockImplementation(async config => track(config));
        vi.spyOn(context.browser.registry, 'presentAlert').mockImplementation(() => undefined);
    });

    afterEach(() => vi.restoreAllMocks());

    test("a 1D track reaches igv with its decoded file name", async function () {
        await context.browser.loadTracks([{ url: "https://example.org/data/peaks%2Ebed" }]);

        const [[config]] = createTrack.mock.calls;
        expect(config.filename).toBe("peaks.bed");
    });

    test("a 1D track from a GEO download link reaches igv with the file= name", async function () {
        await context.browser.loadTracks([{ url: `${GEO_DOWNLOAD}GSM5182714%5Fsignal%2EbigWig` }]);

        const [[config]] = createTrack.mock.calls;
        expect(config.filename).toBe("GSM5182714_signal.bigWig");
        expect(config.name).toBe("GSM5182714_signal.bigWig");
    });

    test("a .bedpe with an encoded dot is routed as 2D", async function () {
        vi.spyOn(igvxhr, 'loadString').mockResolvedValue("chr1\t100\t200\tchr1\t300\t400\n");

        await context.browser.loadTracks([{ url: "https://example.org/data/loops%2Ebedpe" }]);

        expect(context.browser.tracks2D.map(t => t.name)).toEqual(["loops.bedpe"]);
        expect(createTrack).not.toHaveBeenCalled();
    });

    test("a .bedpe from a GEO download link is routed as 2D", async function () {
        vi.spyOn(igvxhr, 'loadString').mockResolvedValue("chr1\t100\t200\tchr1\t300\t400\n");

        await context.browser.loadTracks([{ url: `${GEO_DOWNLOAD}GSM5182714%5Floops%2Ebedpe` }]);

        expect(context.browser.tracks2D.map(t => t.name)).toEqual(["GSM5182714_loops.bedpe"]);
        expect(createTrack).not.toHaveBeenCalled();
    });

    test("a filename the host supplies is kept", async function () {
        await context.browser.loadTracks([{ url: `${GEO_DOWNLOAD}x`, filename: "mine.bed" }]);

        const [[config]] = createTrack.mock.calls;
        expect(config.filename).toBe("mine.bed");
    });
});
