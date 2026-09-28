/**
 * A track the host names nothing is named by juicebox, from its URL, decoded -- the name
 * `extractName` gives a contact map. The name is filled in on the config before the load
 * starts, so the placeholder row, igv and a 2D track all see the same one, and it is marked
 * `_derivedName` so igv still lets a `track name=` line in the file replace it. See issue #695.
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

/** A stand-in igv track named as igv would name it: by the config's name when it has one. */
function track(config) {
    return { name: config.name, config, getFeatures: async () => [], draw: () => undefined };
}

describe("a track the host names nothing is named from its URL", function () {

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

    test("a 1D track reaches igv with its decoded file name, marked as derived", async function () {
        await context.browser.loadTracks([{ url: "https://example.org/data/sample%5Fa.bigWig", format: "bigwig" }]);

        const [[config]] = createTrack.mock.calls;
        expect(config.name).toBe("sample_a.bigWig");
        expect(config._derivedName).toBe(true);
    });

    test("the placeholder row shows the same name while the track loads", async function () {
        let settle;
        createTrack.mockImplementation(config => new Promise(resolve => settle = () => resolve(track(config))));

        const load = context.browser.loadTracks([{ url: "https://example.org/data/sample%5Fa.bigWig", format: "bigwig" }]);

        const label = context.browser.layoutController.xTracks.querySelector('.x-track-label');
        expect(label.textContent).toBe("sample_a.bigWig");

        await new Promise(resolve => setTimeout(resolve, 0));
        settle();
        await load;
        expect(context.browser.trackPairs[0].track.name).toBe("sample_a.bigWig");
    });

    test("a 2D track is named by its decoded file name", async function () {
        vi.spyOn(igvxhr, 'loadString').mockResolvedValue("chr1\t100\t200\tchr1\t300\t400\n");

        await context.browser.loadTracks([{ url: "https://example.org/data/loops%5Fa.bedpe" }]);

        expect(context.browser.tracks2D.map(t => t.name)).toEqual(["loops_a.bedpe"]);
    });

    test("a 2D .txt track is named by its decoded file name", async function () {
        vi.spyOn(igvxhr, 'loadString').mockResolvedValue("chr1\t100\t200\tchr1\t300\t400\n");

        await context.browser.loadTracks([{ url: "https://example.org/data/loops%5Fa.txt" }]);

        expect(context.browser.tracks2D.map(t => t.name)).toEqual(["loops_a.txt"]);
    });

    test("a 2D track given only a label is named by it", async function () {
        vi.spyOn(igvxhr, 'loadString').mockResolvedValue("chr1\t100\t200\tchr1\t300\t400\n");

        await context.browser.loadTracks([{ url: "https://example.org/data/loops%5Fa.bedpe", label: "Loops" }]);

        expect(context.browser.tracks2D.map(t => t.name)).toEqual(["Loops"]);
    });

    test("the placeholder row of a track given only a label shows the label", async function () {
        let settle;
        createTrack.mockImplementation(config => new Promise(resolve => settle = () => resolve(track(config))));

        const load = context.browser.loadTracks([{ url: "https://example.org/data/sample%5Fa.bigWig", format: "bigwig", label: "Mine" }]);

        const label = context.browser.layoutController.xTracks.querySelector('.x-track-label');
        expect(label.textContent).toBe("Mine");

        await new Promise(resolve => setTimeout(resolve, 0));
        settle();
        await load;
    });

    test("a data: URL track is left unnamed, placeholder row included", async function () {
        let settle;
        createTrack.mockImplementation(config => new Promise(resolve => settle = () => resolve(track(config))));

        const load = context.browser.loadTracks([{ url: "data:application/gzip;base64,H4sIAAAAAAAAA/NIzcnJBwCCidH3BQAAAA==", format: "bed" }]);

        const label = context.browser.layoutController.xTracks.querySelector('.x-track-label');
        expect(label.textContent).toBe("");

        await new Promise(resolve => setTimeout(resolve, 0));
        settle();
        await load;

        const [[config]] = createTrack.mock.calls;
        expect(config).not.toHaveProperty('name');
        expect(config).not.toHaveProperty('_derivedName');
    });

    test.each([
        ["a name", { name: "Mine" }, "Mine"],
        ["a label", { label: "Mine" }, undefined]
    ])("a track given %s keeps it", async function (_, given, expectedName) {
        await context.browser.loadTracks([{ url: "https://example.org/data/sample%5Fa.bigWig", format: "bigwig", ...given }]);

        const [[config]] = createTrack.mock.calls;
        expect(config.name).toBe(expectedName);
        expect(config.label).toBe(given.label);
        expect(config._derivedName).toBeUndefined();
    });

    test("a local file track is named by its file name", async function () {
        const file = new File([""], "local%5Fa.bigWig");

        await context.browser.loadTracks([{ url: file, format: "bigwig" }]);

        const [[config]] = createTrack.mock.calls;
        expect(config.name).toBe("local%5Fa.bigWig");
    });
});
