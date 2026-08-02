/**
 * A challenged .hic map load used to reject out of HICBrowser.init to the host app with nothing
 * shown to the user. loadHicFile now reports the bot challenge before rethrowing. See issue #441.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const presented = [];

vi.mock('igv-ui', () => ({
    Alert: {
        presentAlert: (message) => presented.push(message),
        init: () => undefined
    }
}));

const loadDataset = vi.fn();

vi.mock('../js/hicDataset.js', () => ({
    default: { loadDataset: (...args) => loadDataset(...args) },
    HiCDataset: class {}
}));

const { default: DataLoader } = await import("../js/dataLoader.js");

function stubBrowser() {
    return {
        clearSession: () => undefined,
        stopSpinner: () => undefined,
        contactMatrixView: { startSpinner: () => undefined },
        contactMapLabel: { textContent: "", title: "" },
        userInteractionShield: { style: {} },
        controlDataset: undefined
    };
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
