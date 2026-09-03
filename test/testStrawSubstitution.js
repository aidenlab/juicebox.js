/**
 * hic-straw's `alert` hook is a substitution channel, and a substitution is
 * sticky. #600, restated by ADR-0012 decision 4.
 *
 * The issue was filed against the premise that this hook is a read-failure
 * channel, and asked for the widget update to be deleted. Decision 4 retired
 * that premise: the hook has exactly one caller in the library, and it fires
 * when a vector is absent at this chromosome and resolution -- the same event
 * `imageTileSource` reports one layer up. So the announcement stays.
 *
 * What was left behind is the other half of it. Decision 3 says a substitution
 * is sticky: state is rewritten to name what is drawn, because a state that
 * still names the request is the lie ADR-0009 removed, and the next render pass
 * re-asks for a vector the file has already refused. The two sibling paths --
 * `#resolveNormalization` and `createWidgets`' `normalizationSubstituted` --
 * both write it. This one did not, so the widget read NONE while canonical
 * state still read KR.
 *
 * The write is a direct field assignment rather than `setNormalization`, for
 * the same reason `createWidgets` makes it directly: the hook fires from inside
 * a tile fetch, and repainting from there is a re-entrancy hazard. It is the
 * exception documented at `docs/state-manipulation.md`.
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
        state: { normalization },
        substituted: [],
        clearDataset: () => undefined,
        stopSpinner: () => undefined,
        contactMatrixView: { startSpinner: () => undefined },
        contactMapLabel: { textContent: "", title: "" },
        userInteractionShield: { style: {} },
        controlDataset: undefined,
        controlUrl: undefined,
        registry: { presentAlert: () => undefined },
        get coordinator() {
            return {
                onNormalizationSubstituted: (normalization, reason) =>
                    this.substituted.push({ normalization, reason })
            };
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

describe("the hic-straw alert hook is a sticky substitution (#600)", () => {

    beforeEach(() => {
        loadDataset.mockReset();
    });

    test("it announces the substitution in the widget", async () => {
        const browser = stubBrowser('KR');
        const alert = await captureStrawAlert(browser, loader =>
            loader.loadHicFile({ url: "https://example.com/x.hic" }));

        alert("Normalization option KR not available at resolution 10000. Will use NONE.");

        expect(browser.substituted).toHaveLength(1);
        expect(browser.substituted[0].normalization).toBe('NONE');
        expect(browser.substituted[0].reason).toContain('KR');
    });

    test("it writes canonical state, so the widget and the state agree", async () => {
        const browser = stubBrowser('KR');
        const alert = await captureStrawAlert(browser, loader =>
            loader.loadHicFile({ url: "https://example.com/x.hic" }));

        alert("Normalization option KR not available at resolution 10000. Will use NONE.");

        expect(browser.state.normalization).toBe('NONE');
    });

    test("the control map's loader is the same hook, and is sticky too", async () => {
        const browser = stubBrowser('SCALE');
        const alert = await captureStrawAlert(browser, loader =>
            loader.loadHicControlFile({ url: "https://example.com/control.hic" }));

        alert("Normalization option SCALE not available at resolution 10000. Will use NONE.");

        expect(browser.state.normalization).toBe('NONE');
        expect(browser.substituted).toHaveLength(1);
    });

    test("a request already on NONE was not substituted, so nothing is said", async () => {
        const browser = stubBrowser('NONE');
        const alert = await captureStrawAlert(browser, loader =>
            loader.loadHicFile({ url: "https://example.com/x.hic" }));

        alert("Normalization option NONE not available at resolution 10000. Will use NONE.");

        expect(browser.substituted).toHaveLength(0);
        expect(browser.state.normalization).toBe('NONE');
    });

    test("a browser with no state yet is left alone rather than grown one", async () => {
        const browser = stubBrowser(undefined);
        browser.state = undefined;
        const alert = await captureStrawAlert(browser, loader =>
            loader.loadHicFile({ url: "https://example.com/x.hic" }));

        alert("Normalization option KR not available at resolution 10000. Will use NONE.");

        expect(browser.state).toBeUndefined();
        expect(browser.substituted).toHaveLength(0);
    });
});
