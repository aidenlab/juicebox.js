/**
 * A challenged .hic map load used to reject out of HICBrowser.init to the host app with nothing
 * shown to the user. loadHicFile now reports the bot challenge before rethrowing. See issue #441.
 *
 * Both halves are pinned: the public loaders still report, and their `OrThrow` siblings -- what
 * the target-set fan-out calls, reporting once per gesture on the host's surface -- stay silent.
 * See issue #679.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const presented = [];

const loadDataset = vi.fn();

vi.mock('../js/hicDataset.js', () => ({
    default: { loadDataset: (...args) => loadDataset(...args) },
    HiCDataset: class {}
}));

const { default: DataLoader } = await import("../js/dataLoader.js");

function stubBrowser() {
    return {
        clearDataset: () => undefined,
        stopSpinner: () => undefined,
        contactMatrixView: { startSpinner: () => undefined },
        contactMapLabel: { textContent: "", title: "" },
        userInteractionShield: { style: {} },
        controlDataset: undefined,
        // Alerts land in the browser's own embed, not a page-wide singleton -- #481.
        // A failed load recomputes sync membership on its way out -- #635.
        registry: { presentAlert: (message) => presented.push(message), sync: () => undefined }
    };
}

// A browser holding an "A" map the control map cannot be paired with.
function stubBrowserWithIncompatibleMap(order) {
    const browser = stubBrowser();
    browser.dataset = { name: "a", isCompatible: () => false };
    browser.genome = { id: "hg38" };
    browser.stopSpinner = () => order.push("spinner stopped");
    browser.registry.presentAlert = (message) => {
        order.push("alerted");
        presented.push(message);
    };
    return browser;
}

function challengeError() {
    const error = Error("405 Method Not Allowed — https://www.encodeproject.org/x.hic");
    error.code = 405;
    error.headers = new Headers({ 'x-amzn-waf-action': 'captcha' });
    return error;
}

describe("loadHicFile error reporting", function () {

    beforeEach(() => {
        presented.length = 0;
        loadDataset.mockReset();
    });

    test("reports a bot challenge rather than failing silently", async function () {
        loadDataset.mockRejectedValue(challengeError());
        const dataLoader = new DataLoader(stubBrowser());

        await expect(dataLoader.loadHicFile({ url: "https://www.encodeproject.org/x.hic" }))
            .rejects.toThrow();

        expect(presented).toHaveLength(1);
        expect(presented[0]).toContain("bot protection");
        expect(presented[0]).not.toContain("405");
    });

    test("still rethrows so the host app can handle the failure", async function () {
        const error = challengeError();
        loadDataset.mockRejectedValue(error);
        const dataLoader = new DataLoader(stubBrowser());

        await expect(dataLoader.loadHicFile({ url: "https://www.encodeproject.org/x.hic" }))
            .rejects.toBe(error);
    });

    test("leaves ordinary load failures to the host app, unalerted", async function () {
        const error = Error("Not Found");
        error.code = 404;
        loadDataset.mockRejectedValue(error);
        const dataLoader = new DataLoader(stubBrowser());

        await expect(dataLoader.loadHicFile({ url: "https://example.org/missing.hic" }))
            .rejects.toBe(error);

        expect(presented).toEqual([]);
    });

});

describe("loadHicControlFile error reporting", function () {

    beforeEach(() => {
        presented.length = 0;
        loadDataset.mockReset();
    });

    test("reports a bot challenge rather than failing silently", async function () {
        loadDataset.mockRejectedValue(challengeError());
        const dataLoader = new DataLoader(stubBrowser());

        await expect(dataLoader.loadHicControlFile({ url: "https://www.encodeproject.org/b.hic" }))
            .rejects.toThrow();

        expect(presented).toHaveLength(1);
        expect(presented[0]).toContain("bot protection");
        expect(presented[0]).not.toContain("405");
    });

    test("still rethrows so the host app can handle the failure", async function () {
        const error = challengeError();
        loadDataset.mockRejectedValue(error);
        const dataLoader = new DataLoader(stubBrowser());

        await expect(dataLoader.loadHicControlFile({ url: "https://www.encodeproject.org/b.hic" }))
            .rejects.toBe(error);
    });

    test("leaves ordinary load failures to the host app, unalerted", async function () {
        const error = Error("Not Found");
        error.code = 404;
        loadDataset.mockRejectedValue(error);
        const dataLoader = new DataLoader(stubBrowser());

        await expect(dataLoader.loadHicControlFile({ url: "https://example.org/missing.hic" }))
            .rejects.toBe(error);

        expect(presented).toEqual([]);
    });

});

describe("loadHicControlFile refusing an incompatible map", function () {

    beforeEach(() => {
        presented.length = 0;
        loadDataset.mockReset();
        loadDataset.mockResolvedValue({ genomeId: "mm10" });
    });

    test("alerts, then puts the spinner away, and resolves undefined", async function () {
        const order = [];
        const dataLoader = new DataLoader(stubBrowserWithIncompatibleMap(order));

        await expect(dataLoader.loadHicControlFile({ url: "https://example.org/b.hic" }))
            .resolves.toBeUndefined();

        expect(presented).toEqual(['"B" map genome (mm10) does not match "A" map genome (hg38)']);
        expect(order).toEqual(["alerted", "spinner stopped"]);
    });

    test("OrThrow throws a coded error instead, and raises no modal", async function () {
        const order = [];
        const dataLoader = new DataLoader(stubBrowserWithIncompatibleMap(order));

        const error = await dataLoader.loadHicControlFileOrThrow({ url: "https://example.org/b.hic" })
            .catch(e => e);

        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe('control-incompatible');
        expect(error.message).toBe('"B" map genome (mm10) does not match "A" map genome (hg38)');
        expect(presented).toEqual([]);
        expect(order).toEqual(["spinner stopped"]);
    });

});

// A refusal is a declined placement: the panel keeps the control map it had,
// and so must keep that map's URL, or `toJSON` writes the refused map's URL
// beside the kept map's name. Routine once a control map is broadcast (#681).
describe("a refused control map leaves the panel as it was", function () {

    test.each(["loadHicControlFile", "loadHicControlFileOrThrow"])("%s keeps the previous controlUrl", async function (door) {
        const browser = stubBrowserWithIncompatibleMap([]);
        browser.controlUrl = "https://example.org/kept.hic";
        const dataLoader = new DataLoader(browser);

        await dataLoader[door]({ url: "https://example.org/refused.hic" }).catch(() => undefined);

        expect(browser.controlUrl).toBe("https://example.org/kept.hic");
    });
});

describe("the OrThrow loaders stay silent", function () {

    beforeEach(() => {
        presented.length = 0;
        loadDataset.mockReset();
    });

    test("loadHicFileOrThrow rethrows a bot challenge without reporting it", async function () {
        const error = challengeError();
        loadDataset.mockRejectedValue(error);
        const dataLoader = new DataLoader(stubBrowser());

        await expect(dataLoader.loadHicFileOrThrow({ url: "https://www.encodeproject.org/x.hic" }))
            .rejects.toBe(error);

        expect(presented).toEqual([]);
    });

    test("loadHicControlFileOrThrow rethrows a bot challenge without reporting it", async function () {
        const error = challengeError();
        loadDataset.mockRejectedValue(error);
        const dataLoader = new DataLoader(stubBrowser());

        await expect(dataLoader.loadHicControlFileOrThrow({ url: "https://www.encodeproject.org/b.hic" }))
            .rejects.toBe(error);

        expect(presented).toEqual([]);
    });

    test("loadHicFileOrThrow rethrows an ordinary failure", async function () {
        const error = Error("Not Found");
        error.code = 404;
        loadDataset.mockRejectedValue(error);
        const dataLoader = new DataLoader(stubBrowser());

        await expect(dataLoader.loadHicFileOrThrow({ url: "https://example.org/missing.hic" }))
            .rejects.toBe(error);

        expect(presented).toEqual([]);
    });

});
