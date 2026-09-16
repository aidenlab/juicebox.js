/**
 * A pending track is a placeholder row: every 1D track load reserves a row in the track's position
 * as the load starts, with the track's name and the track spinner. The row becomes the track pair
 * when the track loads and is removed when it fails, and the map spinner stays down throughout.
 * See issue #664 and docs/adr/0017-restore-does-not-await-tracks.md, decision 3.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const createTrack = vi.fn();

vi.mock('igv', async (importOriginal) => {
    const igv = (await importOriginal()).default;
    return { default: { ...igv, createTrack: (...args) => createTrack(...args) } };
});

// igv-ui builds its DOMPurify at import, against no window, and the dialog sanitizes its initial
// values with it. The dialog is a track pair's furniture, not what is under test here.
vi.mock('igv-ui', async (importOriginal) => ({ ...(await importOriginal()), DataRangeDialog: class {} }));

const { withBrowser, withContainers } = await import('./utils/browserFixture.js');
const { withStubbedLoads } = await import('./utils/stubbedLoads.js');
const { registryForContainer } = await import('../js/browserRegistry.js');
const { default: EventBus } = await import('../js/eventBus.js');
const { default: Track2D } = await import('../js/track2D.js');
const { default: DataLoader } = await import('../js/dataLoader.js');
const { restoreDataset } = await import('./utils/restoreDataset.js');
const { decodeState } = await import('../js/sessionCodec.js');
const { default: HICBrowser } = await import('../js/hicBrowser.js');
const { default: ContactMatrixView } = await import('../js/contactMatrixView.js');
const { default: TrackPair } = await import('../js/trackPair.js');
const { setUrlMapper } = await import('../js/urlMapper.js');

function config(name) {
    return { name, url: `https://example.org/${name}.bigWig`, format: "bigwig" };
}

/** A stand-in igv track: enough for a track pair to be built around it and never drawn. */
function track(name) {
    return { name, config: { name, url: `https://example.org/${name}.bigWig` }, getFeatures: async () => [], draw: () => undefined };
}

/** A createTrack whose every call waits until the test settles it by track name. */
function deferredCreateTrack() {
    const pending = new Map();
    createTrack.mockImplementation(({ name }) => new Promise((resolve, reject) => {
        pending.set(name, { resolve: () => resolve(track(name)), reject });
    }));
    return pending;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/** The x rows as the page shows them: flex order, then the label and whether the row spins. */
function rows(browser) {
    return [...browser.layoutController.xTracks.querySelectorAll('.x-track-canvas-container')]
        .sort((a, b) => parseInt(a.style.order) - parseInt(b.style.order))
        .map(el => ({
            name: el.querySelector('.x-track-label').textContent,
            spinning: null !== el.querySelector('.x-track-spinner .fa-spinner')
        }));
}

/** A row's remove control, found by the row's name; a loaded row has none. */
const dismissControl = (browser, name) => [...browser.layoutController.xTracks.querySelectorAll('.x-track-canvas-container')]
    .find(el => name === el.querySelector('.x-track-label').textContent)
    ?.querySelector('.x-track-dismiss');

const yRowCount = browser => browser.layoutController.yTracks.querySelectorAll('.y-track-canvas-container').length;

describe("a pending track is a placeholder row", function () {

    const context = withBrowser();
    const alerts = [];

    beforeEach(async () => {
        // A map to lay tracks out against; drawing it is not under test.
        vi.spyOn(ContactMatrixView.prototype, 'update').mockImplementation(async () => undefined);
        vi.spyOn(HICBrowser.prototype, 'update').mockImplementation(async () => undefined);
        vi.spyOn(TrackPair.prototype, 'updateViews').mockImplementation(async () => undefined);
        context.browser.setActiveDataset(restoreDataset({ name: "map", url: "https://example.org/map.hic" }));
        await context.browser.setState(decodeState(undefined));

        createTrack.mockReset();
        alerts.length = 0;
        vi.spyOn(context.browser.registry, 'presentAlert').mockImplementation(message => alerts.push(message));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => vi.restoreAllMocks());

    test("starting a load shows one spinning row per track, named, in position", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();

        const load = browser.loadTracks(["a", "b", "c"].map(config));

        expect(rows(browser)).toEqual([
            { name: "c", spinning: true },
            { name: "b", spinning: true },
            { name: "a", spinning: true }
        ]);
        expect(yRowCount(browser)).toBe(3);

        await flush();
        for (const { resolve } of pending.values()) resolve();
        await load;
        expect(alerts).toEqual([]);
    });

    test("a placeholder becomes its track pair while the others still pend", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();

        const load = browser.loadTracks(["a", "b", "c"].map(config));
        await flush();

        pending.get("b").resolve();
        await flush();

        expect(rows(browser)).toEqual([
            { name: "c", spinning: true },
            { name: "b", spinning: false },
            { name: "a", spinning: true }
        ]);
        expect(browser.trackPairs[1].track.name).toBe("b");

        pending.get("a").resolve();
        pending.get("c").resolve();
        await load;
    });

    test("a failed track's row is removed", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();

        const load = browser.loadTracks(["a", "b", "c"].map(config));
        await flush();

        pending.get("b").reject(Error("Not Found"));
        await flush();

        expect(rows(browser).map(row => row.name)).toEqual(["c", "a"]);
        expect(yRowCount(browser)).toBe(2);

        pending.get("a").resolve();
        pending.get("c").resolve();
        await load;

        expect(browser.trackPairs.map(pair => pair.track.name)).toEqual(["c", "a"]);
    });

    test("a track whose pair cannot be built fails like any other, and leaves no row", async function () {
        const { browser } = context;
        createTrack.mockImplementation(async ({ name }) => track(name));
        const init = TrackPair.prototype.init;
        vi.spyOn(TrackPair.prototype, 'init').mockImplementation(function () {
            if ("b" === this.track.name) throw Error("No gutter");
            return init.call(this);
        });

        await browser.loadTracks(["a", "b"].map(config));

        expect(rows(browser).map(row => row.name)).toEqual(["a"]);
        expect(yRowCount(browser)).toBe(1);
        expect(alerts).toEqual(["Error loading tracks: b: No gutter"]);
    });

    test("a session saved while a track pends writes the pending track from its config, in its row's place", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();

        const load = browser.loadTracks([
            { ...config("a"), color: "rgb(0,0,255)" },
            { ...config("b"), color: "rgb(255,0,0)", min: 0, max: 10 }
        ]);
        await flush();
        pending.get("a").resolve();
        await flush();

        // Row order, which is the session's: each load puts its rows on top, so "b" -- last in
        // the config -- is the first row, as it is once loaded.
        expect(browser.toJSON().tracks).toEqual([
            { url: "https://example.org/b.bigWig", format: "bigwig", name: "b", min: 0, max: 10, color: "rgb(255,0,0)" },
            { url: "https://example.org/a.bigWig", name: "a" }
        ]);

        pending.get("b").resolve();
        await load;
    });

    test("a pending track keeps a min its config sets without a max", async function () {
        const { browser } = context;
        deferredCreateTrack();

        browser.loadTracks([{ ...config("a"), min: 5 }]);
        await flush();

        expect(browser.toJSON().tracks[0]).toHaveProperty("min", 5);
    });

    test("a track dismissed while another still pends is not written", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();

        const load = browser.loadTracks(["a", "b"].map(config));
        await flush();
        dismissControl(browser, "a").click();
        await flush();

        expect(browser.toJSON().tracks.map(t => t.name)).toEqual(["b"]);

        pending.get("a").resolve();
        pending.get("b").resolve();
        await load;
    });

    test("a pending track is written with its original urls, never a dev-proxy path", async function () {
        const { browser } = context;
        deferredCreateTrack();
        setUrlMapper(url => "string" === typeof url ? `/__hic-proxy/${url}` : url);

        try {
            browser.loadTracks([{ ...config("a"), indexURL: "https://example.org/a.bigWig.idx" }]);
            await flush();

            expect(createTrack.mock.calls[0][0].url).toBe("/__hic-proxy/https://example.org/a.bigWig");
            expect(browser.toJSON().tracks).toEqual([
                { url: "https://example.org/a.bigWig", indexURL: "https://example.org/a.bigWig.idx", format: "bigwig", name: "a" }
            ]);
        } finally {
            setUrlMapper(undefined);
        }
    });

    test("a session saved while a track pends restores that track", async function () {
        const { browser } = context;
        deferredCreateTrack();

        browser.loadTracks([config("a")]);
        await flush();
        const saved = browser.toJSON().tracks;

        createTrack.mockReset();
        createTrack.mockImplementation(async ({ name }) => track(name));
        await browser.loadTracks(saved);

        expect(createTrack.mock.calls.map(([c]) => [c.name, c.url, c.format]))
            .toEqual([["a", "https://example.org/a.bigWig", "bigwig"]]);
        expect(alerts).toEqual([]);
    });

    test("a track that failed is not written", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();

        const load = browser.loadTracks(["a", "b"].map(config));
        await flush();
        pending.get("a").reject(Error("Not Found"));
        pending.get("b").resolve();
        await load;

        expect(browser.toJSON().tracks.map(t => t.name)).toEqual(["b"]);
    });

    test("with no tracks at all, pending or loaded, the session has no tracks entry", function () {
        expect(context.browser.toJSON()).not.toHaveProperty("tracks");
    });

    test("a loaded track with a repaint queued is still written to the session", async function () {
        const { browser } = context;
        createTrack.mockImplementation(async ({ name }) => track(name));

        await browser.loadTracks([config("a")]);
        browser.trackPairs[0].pending = true;   // TrackPair's own flag: an updateViews call waiting its turn

        expect(browser.toJSON().tracks.map(t => t.name)).toEqual(["a"]);
    });

    test("an arriving track repaints its own row, not the whole browser", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();

        const load = browser.loadTracks(["a", "b"].map(config));
        await flush();
        const updates = HICBrowser.prototype.update.mock.calls.length;

        pending.get("a").resolve();
        await flush();

        expect(HICBrowser.prototype.update.mock.calls.length).toBe(updates);
        expect(TrackPair.prototype.updateViews.mock.contexts.map(pair => pair.track.name)).toEqual(["a"]);

        pending.get("b").resolve();
        await load;
    });

    test("the map spinner never shows for a track load", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();
        const start = vi.spyOn(browser.contactMatrixView, 'startSpinner');

        const load = browser.loadTracksOrThrow(["a", "b"].map(config));
        await flush();
        pending.get("a").resolve();
        await flush();
        pending.get("b").resolve();
        await load;

        expect(start).not.toHaveBeenCalled();
    });

    test("the load resolves only once its own tracks settle", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();
        let settled = false;

        const load = browser.loadTracks(["a", "b"].map(config)).then(() => settled = true);
        await flush();
        pending.get("a").resolve();
        await flush();

        expect(settled).toBe(false);

        pending.get("b").resolve();
        await load;
        expect(settled).toBe(true);
    });

    test("once every track loads, the order is the order a load has always given", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();

        const first = browser.loadTracks([config("e")]);
        await flush();
        pending.get("e").resolve();
        await first;

        const second = browser.loadTracks(["a", "b", "c"].map(config));
        await flush();
        pending.get("c").resolve();
        await flush();
        pending.get("a").resolve();
        await flush();
        pending.get("b").resolve();
        await second;

        expect(browser.trackPairs.map(pair => pair.track.name)).toEqual(["c", "b", "a", "e"]);
        expect(rows(browser)).toEqual(["c", "b", "a", "e"].map(name => ({ name, spinning: false })));
        expect(browser.trackPairs.every(pair => pair.x.track === pair.track)).toBe(true);
    });

    test("a load settling after its row is gone is not laid out", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();

        const load = browser.loadTracks([config("a")]);
        await flush();

        browser.layoutController.removeAllTrackXYPairs();
        pending.get("a").resolve();
        await load;

        expect(browser.trackPairs).toEqual([]);
        expect(rows(browser)).toEqual([]);
    });

});

/**
 * A restore does not wait for its tracks: it resolves once the map is usable, and its tracks arrive
 * after. A 1D track is a pending track meanwhile; a 2D track has no indicator and draws when it
 * arrives. See issue #667 and docs/adr/0017-restore-does-not-await-tracks.md, decisions 1 and 7.
 */
describe("a restore does not wait for its tracks", function () {

    const context = withBrowser();
    const alerts = [];

    const map = { url: "https://example.org/map.hic" };
    const config2D = name => ({ name, url: `https://example.org/${name}.bedpe` });

    /** A Track2D.loadTrack2D whose every call waits until the test settles it by track name. */
    function deferredLoadTrack2D() {
        const pending = new Map();
        vi.spyOn(Track2D, 'loadTrack2D').mockImplementation(config => new Promise((resolve, reject) => {
            pending.set(config.name, { resolve: () => resolve({ name: config.name, config, toJSON: () => ({ name: config.name }) }), reject });
        }));
        return pending;
    }

    beforeEach(() => {
        vi.spyOn(ContactMatrixView.prototype, 'update').mockImplementation(async () => undefined);
        vi.spyOn(HICBrowser.prototype, 'update').mockImplementation(async () => undefined);
        vi.spyOn(TrackPair.prototype, 'updateViews').mockImplementation(async () => undefined);
        vi.spyOn(DataLoader.prototype, 'loadHicFile').mockImplementation(async function (config) {
            this.browser.contactMatrixView.startSpinner();
            this.browser.setActiveDataset(restoreDataset(config));
            await this.browser.setState(decodeState(undefined));
            this.browser.contactMatrixView.stopSpinner();
        });

        createTrack.mockReset();
        alerts.length = 0;
        vi.spyOn(context.browser.registry, 'presentAlert').mockImplementation(message => alerts.push(message));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => vi.restoreAllMocks());

    test("a 1D track that never settles leaves a usable map, the track a dismissable placeholder", async function () {
        const { browser } = context;
        deferredCreateTrack();

        await browser.init({ ...map, tracks: [config("a")] });

        expect(browser.userInteractionShield.style.display).toBe('none');
        expect(browser.contactMatrixView.disableUpdates).toBe(false);
        expect(browser.contactMatrixView.spinnerCount).toBe(0);
        expect(rows(browser)).toEqual([{ name: "a", spinning: true }]);

        dismissControl(browser, "a").click();
        expect(rows(browser)).toEqual([]);
    });

    test("a 2D track that never settles leaves a usable map", async function () {
        const { browser } = context;
        deferredLoadTrack2D();

        await browser.init({ ...map, tracks: [config2D("loops")] });

        expect(browser.userInteractionShield.style.display).toBe('none');
        expect(browser.contactMatrixView.disableUpdates).toBe(false);
        expect(browser.contactMatrixView.spinnerCount).toBe(0);
        expect(browser.tracks2D).toEqual([]);
    });

    test("the session's normalization and colour scale are applied before any track settles", async function () {
        const { browser } = context;
        deferredCreateTrack();
        deferredLoadTrack2D();
        const resolved = vi.spyOn(browser.coordinator, 'onNormalizationResolved');
        const setColorScale = vi.spyOn(ContactMatrixView.prototype, 'setColorScale');

        await browser.init({ ...map, tracks: [config("a"), config2D("loops")], normalization: "NONE", colorScale: "1,255,0,0" });

        expect(resolved).toHaveBeenCalledWith("NONE");
        expect(setColorScale).toHaveBeenCalled();
    });

    test("a 2D track draws when it arrives, while a 1D track still pends", async function () {
        const { browser } = context;
        deferredCreateTrack();
        const pending2D = deferredLoadTrack2D();
        const onTrackLoad2D = vi.spyOn(browser.coordinator, 'onTrackLoad2D');

        await browser.init({ ...map, tracks: [config("a"), config2D("loops")] });
        pending2D.get("loops").resolve();
        await vi.waitFor(() => expect(browser.tracks2D.map(track => track.name)).toEqual(["loops"]));

        expect(onTrackLoad2D).toHaveBeenCalledWith(browser.tracks2D);
        expect(rows(browser)).toEqual([{ name: "a", spinning: true }]);
    });

    test("a 2D track that fails after the restore resolved is still reported", async function () {
        const { browser } = context;
        const pending2D = deferredLoadTrack2D();

        await browser.init({ ...map, tracks: [config2D("loops")] });
        pending2D.get("loops").reject(Error("Not Found"));

        await vi.waitFor(() => expect(alerts).toHaveLength(1));
        expect(browser.tracks2D).toEqual([]);
    });

    test("once every track arrives, however it arrived, the tracks and the saved session are in the order a restore has always given", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();
        const pending2D = deferredLoadTrack2D();

        await browser.init({ ...map, tracks: [config2D("p"), config("a"), config2D("q"), config("b"), config2D("r"), config("c")] });

        for (const name of ["r", "c", "p", "a", "q", "b"]) {
            (pending.get(name) ?? pending2D.get(name)).resolve();
            await flush();
        }

        await vi.waitFor(() => expect(browser.tracks2D).toHaveLength(3));
        expect(browser.trackPairs.map(pair => pair.track.name)).toEqual(["c", "b", "a"]);
        expect(rows(browser)).toEqual(["c", "b", "a"].map(name => ({ name, spinning: false })));
        expect(browser.tracks2D.map(track => track.name)).toEqual(["p", "q", "r"]);
        expect(browser.toJSON().tracks.map(track => track.name)).toEqual(["c", "b", "a", "p", "q", "r"]);
    });

});

/**
 * A pending track can be dismissed, and a load that settles after its placeholder is gone -- dismissed,
 * its browser disposed or reset, or its session replaced -- is discarded silently. See issue #665 and
 * docs/adr/0017-restore-does-not-await-tracks.md, decisions 4 and 8.
 */
describe("a pending track can be dismissed", function () {

    const context = withBrowser();
    const alerts = [];

    beforeEach(async () => {
        vi.spyOn(ContactMatrixView.prototype, 'update').mockImplementation(async () => undefined);
        vi.spyOn(HICBrowser.prototype, 'update').mockImplementation(async () => undefined);
        vi.spyOn(TrackPair.prototype, 'updateViews').mockImplementation(async () => undefined);
        context.browser.setActiveDataset(restoreDataset({ name: "map", url: "https://example.org/map.hic" }));
        await context.browser.setState(decodeState(undefined));

        createTrack.mockReset();
        alerts.length = 0;
        vi.spyOn(context.browser.registry, 'presentAlert').mockImplementation(message => alerts.push(message));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => vi.restoreAllMocks());


    test("a placeholder has a remove control, and using it removes the row", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();

        const load = browser.loadTracks(["a", "b"].map(config));
        await flush();

        dismissControl(browser, "a").click();

        expect(rows(browser).map(row => row.name)).toEqual(["b"]);
        expect(yRowCount(browser)).toBe(1);
        expect(browser.trackPairs.map(pair => pair.track.name)).toEqual(["b"]);

        pending.get("a").resolve();
        pending.get("b").resolve();
        await load;
    });

    test("a loaded track has no remove control of the placeholder's", async function () {
        const { browser } = context;
        createTrack.mockImplementation(async ({ name }) => track(name));

        await browser.loadTracks([config("a")]);

        expect(dismissControl(browser, "a")).toBeNull();
    });

    test("a dismissed track that later loads does not appear", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();
        const loaded = vi.fn();
        EventBus.globalBus.subscribe("TrackXYPairLoad", loaded);

        const load = browser.loadTracks(["a", "b"].map(config));
        await flush();
        dismissControl(browser, "a").click();

        pending.get("a").resolve();
        pending.get("b").resolve();
        await load;

        expect(rows(browser)).toEqual([{ name: "b", spinning: false }]);
        expect(browser.toJSON().tracks.map(t => t.name)).toEqual(["b"]);
        expect(loaded.mock.calls.map(([event]) => event.data.track.name)).toEqual(["b"]);
        expect(alerts).toEqual([]);
    });

    test("a dismissed track that later fails raises no alert, and the rest of its load still reports", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();

        const load = browser.loadTracks(["a", "b", "c"].map(config));
        await flush();
        dismissControl(browser, "a").click();

        pending.get("a").reject(Error("Not Found"));
        pending.get("b").reject(Error("Forbidden"));
        pending.get("c").resolve();
        await load;

        expect(rows(browser).map(row => row.name)).toEqual(["c"]);
        expect(alerts).toEqual(["Error loading tracks: b: Forbidden"]);
    });

    test("loadTracksOrThrow resolves when its only track was dismissed and then failed", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();

        const load = browser.loadTracksOrThrow([config("a")]);
        await flush();
        dismissControl(browser, "a").click();
        pending.get("a").reject(Error("Not Found"));

        await expect(load).resolves.toBeUndefined();
    });

    for (const [how, teardown] of [["disposed", browser => browser.dispose()], ["reset", browser => browser.reset()]]) {

        test(`a load that settles after its browser was ${how} writes nothing and raises no alert`, async function () {
            const { browser } = context;
            const pending = deferredCreateTrack();
            let track2DLoaded;
            vi.spyOn(Track2D, 'loadTrack2D').mockImplementation(() => new Promise(resolve => track2DLoaded = resolve));

            const load = browser.loadTracks([...["a", "b"].map(config), { name: "loops", url: "https://example.org/loops.bedpe" }]);
            await flush();

            teardown(browser);
            const trackPairs = [...browser.trackPairs];
            const tracks2D = [...browser.tracks2D];
            const loaded = vi.spyOn(browser.layoutController, 'fillPendingTrack');

            pending.get("a").resolve();
            pending.get("b").reject(Error("Not Found"));
            track2DLoaded({ name: "loops" });
            await load;

            expect(loaded).not.toHaveBeenCalled();
            expect(browser.trackPairs).toEqual(trackPairs);
            expect(browser.tracks2D).toEqual(tracks2D);
            expect(alerts).toEqual([]);
        });
    }

});

/**
 * A restore no longer waits on its tracks, so what it can be torn down during is its map: the `.hic`
 * load, and the normalization vector files when it has them. #665, #667.
 */
describe("a restore whose browser goes while it loads its map", function () {

    const context = withBrowser();

    afterEach(() => vi.restoreAllMocks());

    const stalls = [
        ["the map", {}, stall => vi.spyOn(DataLoader.prototype, 'loadHicFile').mockImplementation(async function (config) {
            this.browser.setActiveDataset(restoreDataset(config));
            await this.browser.setState(decodeState(undefined));
            await new Promise(resolve => stall(resolve));
        })],
        ["its normalization vectors", { normVectorFiles: ["https://example.org/map.nv"] }, stall => {
            vi.spyOn(DataLoader.prototype, 'loadHicFile').mockImplementation(async function (config) {
                this.browser.setActiveDataset(restoreDataset(config));
                await this.browser.setState(decodeState(undefined));
            });
            vi.spyOn(DataLoader.prototype, 'loadNormalizationFile').mockImplementation(() => new Promise(resolve => stall(resolve)));
        }]
    ];

    for (const [waitingOn, fields, stallOn] of stalls) {
        for (const [how, teardown] of [["reset", browser => browser.reset()], ["disposed", browser => browser.dispose()]]) {

            test(`stands down once its browser is ${how} while it waits on ${waitingOn}, writing nothing more to it`, async function () {
                const { browser } = context;

                vi.spyOn(ContactMatrixView.prototype, 'update').mockImplementation(async () => undefined);
                const update = vi.spyOn(HICBrowser.prototype, 'update').mockImplementation(async () => undefined);
                let release;
                stallOn(resolve => release = resolve);
                const setColorScale = vi.spyOn(ContactMatrixView.prototype, 'setColorScale');

                const restore = browser.init({ url: "https://example.org/map.hic", ...fields, colorScale: "1,255,0,0" });
                await vi.waitFor(() => expect(release).toBeDefined());

                teardown(browser);
                const { contactMatrixView, userInteractionShield } = browser;
                const shieldDisplay = userInteractionShield.style.display;
                const disableUpdates = contactMatrixView.disableUpdates;
                const spinnerCount = contactMatrixView.spinnerCount;
                const updates = update.mock.calls.length;

                release();
                await expect(restore).resolves.toBeUndefined();

                expect(setColorScale).not.toHaveBeenCalled();
                expect(update.mock.calls.length).toBe(updates);
                expect(contactMatrixView.spinnerCount).toBe(spinnerCount);
                expect(userInteractionShield.style.display).toBe(shieldDisplay);
                expect(contactMatrixView.disableUpdates).toBe(disableUpdates);
            });
        }
    }

});

describe("a load that settles after another restore replaced the session", function () {

    const dom = withContainers();
    withStubbedLoads();

    afterEach(() => vi.restoreAllMocks());

    test("writes nothing to the new session and raises no alert", async function () {
        // The fixture stands track loads down for a restore; this one is the subject.
        DataLoader.prototype.loadTracks.mockRestore();
        const registry = registryForContainer(dom.container);
        const alerts = [];
        vi.spyOn(registry, 'presentAlert').mockImplementation(message => alerts.push(message));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        createTrack.mockReset();
        const pending = deferredCreateTrack();

        await registry.restoreSession({ browsers: [{ url: "https://example.org/map.hic" }] });
        const load = registry.browsers[0].loadTracks(["a", "b"].map(config));
        await vi.waitFor(() => expect(pending.size).toBe(2));

        await registry.restoreSession({ browsers: [{ url: "https://example.org/map.hic" }] });
        const [replacement] = registry.browsers;

        pending.get("a").resolve();
        pending.get("b").reject(Error("Not Found"));
        await load;

        expect(replacement.trackPairs).toEqual([]);
        expect(rows(replacement)).toEqual([]);
        expect(alerts).toEqual([]);
    });

});
