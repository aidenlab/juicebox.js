/**
 * A registered URL mapper must reach track reads, not only the .hic read — and must never leak the
 * mapped URL into a saved session. See issue #450 and
 * docs/adr/0001-dev-proxy-for-waf-protected-hosts.md.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const createTrack = vi.fn();

vi.mock('igv', () => ({
    default: { createTrack: (...args) => createTrack(...args) }
}));

vi.mock('igv-ui', () => ({
    Alert: { presentAlert: (message) => { throw Error(message) }, init: () => undefined },
    InputDialog: class {},
    DOMUtils: {}
}));

const loadString = vi.fn();

vi.mock('igv-utils', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, igvxhr: { ...actual.igvxhr, loadString: (...args) => loadString(...args) } };
});

const { setUrlMapper, mapTrackConfig, unmappedUrl } = await import("../js/urlMapper.js");
const { default: DataLoader } = await import("../js/dataLoader.js");
const { default: Track2D } = await import("../js/track2D.js");
const { default: HICBrowser } = await import("../js/hicBrowser.js");

const PROXIED = "https://www.encodeproject.org/files/ENCFF144KUK/@@download/ENCFF144KUK.bigWig";

/** The shipped mapper's shape: host-scoped, idempotent, non-http input untouched. */
function proxyMapper(url) {
    if (typeof url !== "string" || url.startsWith("/__hic-proxy/")) return url;
    return url.startsWith("https://www.encodeproject.org/") ? `/__hic-proxy/${url}` : url;
}

function stubBrowser() {
    return {
        genome: undefined,
        tracks2D: [],
        showTrackLabelAndGutter: false,
        contactMatrixView: { startSpinner: () => undefined, stopSpinner: () => undefined },
        layoutController: { updateLayoutWithTracks: () => undefined },
        updateLayout: async () => undefined,
        notifyTrackLoad2D: () => undefined
    };
}

async function configHandedToIgv(config) {
    createTrack.mockResolvedValue({ name: "t" });
    await new DataLoader(stubBrowser()).loadTracks([config]);
    expect(createTrack).toHaveBeenCalledTimes(1);
    return createTrack.mock.calls[0][0];
}

describe("mapTrackConfig", function () {

    afterEach(() => setUrlMapper(undefined));

    test("returns the very same config when no mapper is registered", function () {
        const config = { url: PROXIED };

        expect(mapTrackConfig(config)).toBe(config);
    });

    test("returns the very same config when the mapper claims neither URL", function () {
        setUrlMapper(proxyMapper);
        const config = { url: "https://example.org/a.bigWig" };

        expect(mapTrackConfig(config)).toBe(config);
    });

    test("maps url and indexURL, and does not mutate the caller's config", function () {
        setUrlMapper(proxyMapper);
        const config = { url: PROXIED, indexURL: `${PROXIED}.tbi`, name: "ENCFF144KUK" };

        const mapped = mapTrackConfig(config);

        expect(mapped.url).toBe(`/__hic-proxy/${PROXIED}`);
        expect(mapped.indexURL).toBe(`/__hic-proxy/${PROXIED}.tbi`);
        expect(mapped.name).toBe("ENCFF144KUK");
        expect(config.url).toBe(PROXIED);
        expect(config.indexURL).toBe(`${PROXIED}.tbi`);

        // Both originals are recoverable, index included: a rewrite whose original is lost is the
        // leak the stash exists to prevent, whether or not anything serializes it today.
        expect(mapped.unmappedUrls).toEqual({ url: PROXIED, indexURL: `${PROXIED}.tbi` });
    });

    test("does not invent an indexURL key on a config that had none", function () {
        setUrlMapper(proxyMapper);

        expect(Object.hasOwn(mapTrackConfig({ url: PROXIED }), "indexURL")).toBe(false);
    });

    test("leaves a File url to the loader untouched", function () {
        setUrlMapper(proxyMapper);
        const config = { url: new File([], "local.bigWig") };

        expect(mapTrackConfig(config)).toBe(config);
    });

    test("recovers the original url, mapped or not", function () {
        setUrlMapper(proxyMapper);

        expect(unmappedUrl(mapTrackConfig({ url: PROXIED }))).toBe(PROXIED);
        expect(unmappedUrl({ url: "https://example.org/a.bigWig" })).toBe("https://example.org/a.bigWig");
    });

});

describe("1D track loading", function () {

    beforeEach(() => {
        createTrack.mockReset();
        // loadTracks reaches for layout dimensions and the track gutter; neither is under test.
        global.document.querySelector = () => ({ style: {} });
        global.getComputedStyle = () => ({ getPropertyValue: () => "0" });
    });

    afterEach(() => setUrlMapper(undefined));

    test("hands igv the untouched url when no mapper is registered", async function () {
        expect((await configHandedToIgv({ url: PROXIED, format: "bigwig" })).url).toBe(PROXIED);
    });

    test("hands igv the mapped url once a mapper is registered", async function () {
        setUrlMapper(proxyMapper);

        expect((await configHandedToIgv({ url: PROXIED, format: "bigwig" })).url)
            .toBe(`/__hic-proxy/${PROXIED}`);
    });

    test("leaves an unclaimed host fetching directly", async function () {
        setUrlMapper(proxyMapper);
        const url = "https://example.org/a.bigWig";

        expect((await configHandedToIgv({ url, format: "bigwig" })).url).toBe(url);
    });

    test("keeps the original url recoverable from the config igv holds", async function () {
        setUrlMapper(proxyMapper);

        expect(unmappedUrl(await configHandedToIgv({ url: PROXIED, format: "bigwig" }))).toBe(PROXIED);
    });

});

/**
 * toJSON is exercised against a minimal stand-in for a browser rather than a live one: the only
 * part under test is which URL a track contributes to the session.
 */
function sessionTracksFor(trackConfigs, tracks2D = []) {
    const stub = {
        dataset: { url: "https://example.org/x.hic", hicFile: { config: {} } },
        state: { toJSON: () => ({}) },
        contactMatrixView: {
            stringifyBackgroundColor: () => "255,255,255",
            getColorScale: () => ({ stringify: () => "" })
        },
        controlDataset: undefined,
        trackPairs: trackConfigs.map(config => ({ x: { track: { config, name: config.name } } })),
        tracks2D
    };

    return HICBrowser.prototype.toJSON.call(stub).tracks;
}

describe("session serialization", function () {

    afterEach(() => setUrlMapper(undefined));

    test("emits the original url for a mapped 1D track, never a proxy path", function () {
        setUrlMapper(proxyMapper);

        const tracks = sessionTracksFor([mapTrackConfig({ url: PROXIED, name: "ENCFF144KUK" })]);

        expect(tracks).toHaveLength(1);
        expect(tracks[0].url).toBe(PROXIED);
    });

    test("emits an unmapped 1D track's url unchanged", function () {
        const url = "https://example.org/a.bigWig";

        expect(sessionTracksFor([{ url, name: "a" }])[0].url).toBe(url);
    });

    test("round-trips: a session saved with a mapper reloads with none registered", async function () {
        setUrlMapper(proxyMapper);
        global.document.querySelector = () => ({ style: {} });
        global.getComputedStyle = () => ({ getPropertyValue: () => "0" });
        createTrack.mockReset();

        const saved = sessionTracksFor([await configHandedToIgv({ url: PROXIED, format: "bigwig" })]);
        setUrlMapper(undefined);
        createTrack.mockReset();

        // Reloading the saved session in production — no mapper — must fetch the real host.
        expect((await configHandedToIgv(saved[0])).url).toBe(PROXIED);
    });

    test("keeps a mapped 2D track's url original", function () {
        setUrlMapper(proxyMapper);
        const url = "https://www.encodeproject.org/x.bedpe";
        const track2D = new Track2D({ url }, []);

        expect(sessionTracksFor([], [track2D])[0].url).toBe(url);
    });

});

describe("2D track loading", function () {

    beforeEach(() => {
        loadString.mockReset();
        loadString.mockResolvedValue("chr1\t100\t200\tchr1\t300\t400");
    });

    afterEach(() => setUrlMapper(undefined));

    test("fetches the untouched url when no mapper is registered", async function () {
        const url = "https://www.encodeproject.org/x.bedpe";

        await Track2D.loadTrack2D({ url });

        expect(loadString.mock.calls[0][0]).toBe(url);
    });

    test("fetches the mapped url once a mapper is registered", async function () {
        setUrlMapper(proxyMapper);
        const url = "https://www.encodeproject.org/x.bedpe";

        await Track2D.loadTrack2D({ url });

        expect(loadString.mock.calls[0][0]).toBe(`/__hic-proxy/${url}`);
    });

    test("serializes the original url — the config is never rewritten", async function () {
        setUrlMapper(proxyMapper);
        const url = "https://www.encodeproject.org/x.bedpe";

        const track2D = await Track2D.loadTrack2D({ url });

        expect(track2D.config.url).toBe(url);
        expect(track2D.toJSON().url).toBe(url);
    });

});
