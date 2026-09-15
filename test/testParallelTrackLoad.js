/**
 * 1D tracks load in parallel and settle one by one: a failing track no longer loses the tracks
 * around it, everything that loads is laid out in session order, and the failures come back as one
 * report. See issue #663 and docs/adr/0017-restore-does-not-await-tracks.md, decision 6.
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
const { default: Track2D } = await import("../js/track2D.js");

const presented = [];
const laidOut = [];

function stubBrowser() {
    return {
        genome: undefined,
        tracks2D: [],
        showTrackLabelAndGutter: false,
        contactMatrixView: { startSpinner: () => undefined, stopSpinner: () => undefined },
        layoutController: { updateLayoutWithTracks: (tracks) => laidOut.push(tracks.map(t => t.name)) },
        updateLayout: async () => undefined,
        coordinator: { onTrackLoad2D: () => undefined },
        registry: { presentAlert: (message) => presented.push(message) }
    };
}

function config(name) {
    return { name, url: `https://example.org/${name}.bigWig`, format: "bigwig" };
}

/** A createTrack whose every call waits until the test settles it by track name. */
function deferredCreateTrack() {
    const pending = new Map();
    createTrack.mockImplementation(({ name }) => new Promise((resolve, reject) => {
        pending.set(name, { resolve: () => resolve({ name }), reject });
    }));
    return pending;
}

/** loadTracks reaches for layout dimensions and the track gutter; neither is under test. */
function reset() {
    createTrack.mockReset();
    vi.restoreAllMocks();
    presented.length = 0;
    laidOut.length = 0;
    global.document.querySelector = () => ({ style: {} });
    global.getComputedStyle = () => ({ getPropertyValue: () => "0" });
}

function config2D(name) {
    return { name, url: `https://example.org/${name}.bedpe`, format: "bedpe" };
}

function challengeError() {
    const error = Error("405 Method Not Allowed");
    error.code = 405;
    error.headers = new Headers({ 'x-amzn-waf-action': 'captcha' });
    return error;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("1D tracks load in parallel", function () {

    beforeEach(reset);

    test("starts every track before any of them finishes", async function () {
        const pending = deferredCreateTrack();

        const load = new DataLoader(stubBrowser()).loadTracks(["a", "b", "c"].map(config));
        await flush();

        expect(createTrack).toHaveBeenCalledTimes(3);

        for (const { resolve } of pending.values()) resolve();
        await load;
    });

    test("lays out in session order, whatever order the tracks finish in", async function () {
        const pending = deferredCreateTrack();

        const load = new DataLoader(stubBrowser()).loadTracks(["a", "b", "c"].map(config));
        await flush();

        pending.get("c").resolve();
        await flush();
        pending.get("b").resolve();
        await flush();
        pending.get("a").resolve();
        await load;

        expect(laidOut).toEqual([["a", "b", "c"]]);
    });

    test("lays out every good track when one track fails", async function () {
        createTrack.mockImplementation(async ({ name }) => {
            if ("b" === name) throw Error("Not Found");
            return { name };
        });

        await new DataLoader(stubBrowser()).loadTracks(["a", "b", "c", "d"].map(config));

        expect(laidOut).toEqual([["a", "c", "d"]]);
    });

    test("a load where every track succeeds lays out once and alerts nothing", async function () {
        createTrack.mockImplementation(async ({ name }) => ({ name }));

        await new DataLoader(stubBrowser()).loadTracks(["a", "b"].map(config));

        expect(laidOut).toEqual([["a", "b"]]);
        expect(presented).toEqual([]);
    });

});

describe("track load failures make one report", function () {

    beforeEach(() => {
        reset();
        createTrack.mockImplementation(async ({ name }) => {
            if ("b" === name) throw Error("Not Found");
            if ("d" === name) {
                const error = Error("Forbidden");
                error.code = 403;
                throw error;
            }
            return { name };
        });
    });

    test("loadTracks raises one alert naming each failed track", async function () {
        await new DataLoader(stubBrowser()).loadTracks(["a", "b", "c", "d"].map(config));

        expect(presented).toHaveLength(1);
        expect(presented[0]).toContain("b: Not Found");
        expect(presented[0]).toContain("d: Access forbidden");
        expect(presented[0]).not.toContain("a:");
        expect(presented[0]).not.toContain("c:");
    });

    test("loadTracksOrThrow rejects once, naming each failed track", async function () {
        const load = new DataLoader(stubBrowser()).loadTracksOrThrow(["a", "b", "c", "d"].map(config));

        await expect(load).rejects.toThrow(/b: Not Found.*d: Access forbidden/);
        expect(laidOut).toEqual([["a", "c"]]);
        expect(presented).toEqual([]);
    });

    test("a single-track load reports exactly as it always has", async function () {
        await new DataLoader(stubBrowser()).loadTracks([config("d")]);

        expect(presented).toEqual(["Error loading track d: Access forbidden"]);
    });

    test("a single-track load rethrows the track's own error", async function () {
        const load = new DataLoader(stubBrowser()).loadTracksOrThrow([config("b")]);

        await expect(load).rejects.toThrow(/^Not Found$/);
    });

    test("names a bot challenge per track and explains it once", async function () {
        createTrack.mockImplementation(async ({ name }) => {
            if ("a" === name) return { name };
            throw challengeError();
        });

        await new DataLoader(stubBrowser()).loadTracks(["a", "b", "c"].map(config));

        expect(presented).toHaveLength(1);
        expect(presented[0]).toContain("b: blocked by bot protection; c: blocked by bot protection");
        expect(presented[0].match(/allowlist/g)).toHaveLength(1);
        expect(presented[0]).not.toContain("405");
    });

});

describe("a load mixing 1D and 2D tracks", function () {

    beforeEach(reset);

    test("reports 1D and 2D failures together, in session order", async function () {
        createTrack.mockImplementation(async ({ name }) => {
            if ("c" === name) throw Error("Not Found");
            return { name };
        });
        vi.spyOn(Track2D, "loadTrack2D").mockRejectedValue(Error("Bad bedpe"));

        const browser = stubBrowser();
        await new DataLoader(browser).loadTracks([config("a"), config2D("b"), config("c")]);

        expect(laidOut).toEqual([["a"]]);
        expect(browser.tracks2D).toEqual([]);
        expect(presented).toEqual(["Error loading tracks: b: Bad bedpe; c: Not Found"]);
    });

    test("keeps the good 2D tracks when another 2D track fails", async function () {
        createTrack.mockImplementation(async ({ name }) => ({ name }));
        vi.spyOn(Track2D, "loadTrack2D").mockImplementation(async ({ name }) => {
            if ("c" === name) throw Error("Bad bedpe");
            return { name };
        });

        const browser = stubBrowser();
        await new DataLoader(browser).loadTracks([config("a"), config2D("b"), config2D("c")]);

        expect(laidOut).toEqual([["a"]]);
        expect(browser.tracks2D).toEqual([{ name: "b" }]);
        expect(presented).toEqual(["Error loading tracks: c: Bad bedpe"]);
    });

});
