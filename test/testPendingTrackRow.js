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

const { withBrowser } = await import('./utils/browserFixture.js');
const { restoreDataset } = await import('./utils/restoreDataset.js');
const { decodeState } = await import('../js/sessionCodec.js');
const { default: HICBrowser } = await import('../js/hicBrowser.js');
const { default: ContactMatrixView } = await import('../js/contactMatrixView.js');

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

const yRowCount = browser => browser.layoutController.yTracks.querySelectorAll('.y-track-canvas-container').length;

describe("a pending track is a placeholder row", function () {

    const context = withBrowser();
    const alerts = [];

    beforeEach(async () => {
        // A map to lay tracks out against; drawing it is not under test.
        vi.spyOn(ContactMatrixView.prototype, 'update').mockImplementation(async () => undefined);
        vi.spyOn(HICBrowser.prototype, 'update').mockImplementation(async () => undefined);
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
        const { default: TrackPair } = await import('../js/trackPair.js');
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

    test("a session saved while a track pends is written as it is today, without the pending track", async function () {
        const { browser } = context;
        const pending = deferredCreateTrack();

        const load = browser.loadTracks(["a", "b"].map(config));
        await flush();
        pending.get("a").resolve();
        await flush();

        const tracks = browser.toJSON().tracks;
        expect(tracks).toHaveLength(1);
        expect(tracks[0].name).toBe("a");

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

describe("a restore does not show the map spinner for its tracks", function () {

    const context = withBrowser();

    afterEach(() => vi.restoreAllMocks());

    test("the map spinner is down while the restore waits on its tracks, and the restore still waits", async function () {
        const { browser } = context;
        const { default: DataLoader } = await import('../js/dataLoader.js');

        vi.spyOn(ContactMatrixView.prototype, 'update').mockImplementation(async () => undefined);
        vi.spyOn(HICBrowser.prototype, 'update').mockImplementation(async () => undefined);
        vi.spyOn(DataLoader.prototype, 'loadHicFile').mockImplementation(async function (config) {
            this.browser.contactMatrixView.startSpinner();
            this.browser.setActiveDataset(restoreDataset(config));
            await this.browser.setState(decodeState(undefined));
            this.browser.contactMatrixView.stopSpinner();
        });

        let tracksLoaded;
        vi.spyOn(DataLoader.prototype, 'loadTracks').mockImplementation(() => new Promise(resolve => tracksLoaded = resolve));

        let restored = false;
        const restore = browser.init({ url: "https://example.org/map.hic", tracks: [config("a")] }).then(() => restored = true);
        await flush();

        expect(restored).toBe(false);
        expect(browser.contactMatrixView.spinnerCount).toBe(0);

        tracksLoaded();
        await restore;
        expect(browser.contactMatrixView.spinnerCount).toBe(0);
    });

});
