/**
 * hic-straw's `alert` hook is a substitution channel, and it hands the
 * substitution to the browser. #600, restated by ADR-0012 decision 4.
 *
 * The issue was filed against the premise that this hook is a read-failure
 * channel, and asked for the widget update to be deleted. Decision 4 retired
 * that premise: the hook has exactly one caller in the library, and it fires
 * when a vector is absent at this chromosome and resolution -- the same event
 * `imageTileSource` reports one layer up. So the announcement stays, and what
 * was missing is the other half of it, decision 3's sticky state write.
 *
 * That rule is not written out here. It lives on `browser.substituteNormalization`,
 * shared with the mid-render caller in `createWidgets`, and is driven at its own
 * seam by `testSubstitutionIsSticky.js` against a real browser. What this file
 * claims is narrower and is the loader's own: both `.hic` loads install the
 * hook, and the hook reports the request that was refused rather than inventing
 * one.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const loadDataset = vi.fn();

vi.mock('../js/hicDataset.js', () => ({
    default: { loadDataset: (...args) => loadDataset(...args) },
    HiCDataset: class {}
}));

const { default: DataLoader } = await import("../js/dataLoader.js");

function stubBrowser(normalization) {
    return {
        state: undefined === normalization ? undefined : { normalization },
        substituted: [],
        clearDataset: () => undefined,
        stopSpinner: () => undefined,
        contactMatrixView: { startSpinner: () => undefined },
        contactMapLabel: { textContent: "", title: "" },
        userInteractionShield: { style: {} },
        controlDataset: undefined,
        controlUrl: undefined,
        registry: { presentAlert: () => undefined },
        substituteNormalization(requested, effective) {
            this.substituted.push({ requested, effective });
        }
    };
}

/**
 * Run a load far enough to capture the `alert` hook it hands to hic-straw, and
 * hand back the hook itself. The load is failed deliberately: what is under
 * test is the callback that was passed in, and nothing past the call needs to
 * run for it to exist.
 */
async function captureStrawAlert(browser, load) {
    loadDataset.mockRejectedValue(Error("stop here"));
    await load(new DataLoader(browser)).catch(() => undefined);
    return loadDataset.mock.calls[0][0].alert;
}

const REFUSAL = "Normalization option KR not available at resolution 10000. Will use NONE.";

describe("the hic-straw alert hook reports a substitution (#600)", () => {

    beforeEach(() => {
        loadDataset.mockReset();
    });

    test("it names the refused request and NONE as what will be drawn", async () => {
        const browser = stubBrowser('KR');
        const alert = await captureStrawAlert(browser, loader =>
            loader.loadHicFile({ url: "https://example.com/x.hic" }));

        alert(REFUSAL);

        expect(browser.substituted).toEqual([{ requested: 'KR', effective: 'NONE' }]);
    });

    test("the control map's loader installs the same hook", async () => {
        const browser = stubBrowser('SCALE');
        const alert = await captureStrawAlert(browser, loader =>
            loader.loadHicControlFile({ url: "https://example.com/control.hic" }));

        alert(REFUSAL);

        expect(browser.substituted).toEqual([{ requested: 'SCALE', effective: 'NONE' }]);
    });

    test("the request is read from state, not from hic-straw's sentence", async () => {

        // hic-straw hands over a formatted sentence rather than the pieces. The
        // sentence here names VC and state names KR; the browser is told what
        // was actually asked for, which is the thing the widget must explain.
        const browser = stubBrowser('KR');
        const alert = await captureStrawAlert(browser, loader =>
            loader.loadHicFile({ url: "https://example.com/x.hic" }));

        alert("Normalization option VC not available at resolution 10000. Will use NONE.");

        expect(browser.substituted[0].requested).toBe('KR');
    });

    test("a browser with no state yet asks for nothing, so nothing is reported", async () => {
        const browser = stubBrowser(undefined);
        const alert = await captureStrawAlert(browser, loader =>
            loader.loadHicFile({ url: "https://example.com/x.hic" }));

        alert(REFUSAL);

        expect(browser.substituted).toEqual([{ requested: undefined, effective: 'NONE' }]);
    });
});
