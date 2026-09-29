/**
 * A track label is a track's name, drawn on both its x track and its y track and shown or hidden
 * for both at once, per browser (`CONTEXT.md`, *Track label*). Clicking either half of a track pair
 * toggles it, and the toggle reaches only the browser clicked (ADR-0004). See issue #702.
 *
 * Only what the DOM shows is asserted: which labels exist, their text, whether they show. The size
 * cap, the rotation and the backing are layout, which node does not do (ADR-0013).
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

const { withContainers } = await import('./utils/browserFixture.js');
const { restoreDataset } = await import('./utils/restoreDataset.js');
const { decodeState } = await import('../js/sessionCodec.js');
const { default: HICBrowser } = await import('../js/hicBrowser.js');
const { default: ContactMatrixView } = await import('../js/contactMatrixView.js');
const { default: TrackPair } = await import('../js/trackPair.js');

function config(name) {
    return { name, url: `https://example.org/${name}.bigWig`, format: "bigwig" };
}

/** A stand-in igv track: enough for a track pair to be built around it and never drawn. */
function track(name) {
    return { name, config: { name, url: `https://example.org/${name}.bigWig` }, getFeatures: async () => [], draw: () => undefined };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const xRows = browser => [...browser.layoutController.xTracks.querySelectorAll('.x-track-canvas-container')];
const yRows = browser => [...browser.layoutController.yTracks.querySelectorAll('.y-track-canvas-container')];

/** Each row's label as the page shows it, x rows then y rows. */
function labels(browser) {
    const read = el => ({ text: el.textContent, title: el.title, shown: 'none' !== el.style.display });
    return {
        x: xRows(browser).map(row => read(row.querySelector('.x-track-label'))),
        y: yRows(browser).map(row => read(row.querySelector('.y-track-label')))
    };
}

const gutterShown = browser => xRows(browser)
    .map(row => row.querySelector('.hic-igv-right-hand-gutter'))
    .filter(Boolean)
    .map(el => 'none' !== el.style.display);

const click = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

describe("track labels on x and y tracks", function () {

    const context = withContainers();

    async function browserIn(container) {
        const browser = new HICBrowser(container, {});
        browser.setActiveDataset(restoreDataset({ name: "map", url: "https://example.org/map.hic" }));
        await browser.setState(decodeState(undefined));
        vi.spyOn(browser.registry, 'presentAlert').mockImplementation(() => undefined);
        return browser;
    }

    beforeEach(() => {
        vi.spyOn(ContactMatrixView.prototype, 'update').mockImplementation(async () => undefined);
        vi.spyOn(HICBrowser.prototype, 'update').mockImplementation(async () => undefined);
        vi.spyOn(TrackPair.prototype, 'updateViews').mockImplementation(async () => undefined);

        createTrack.mockReset();
        createTrack.mockImplementation(async ({ name }) => track(name));
    });

    afterEach(() => vi.restoreAllMocks());

    test("a loaded track pair has a y label with the track's name and tooltip", async function () {
        const browser = await browserIn(context.container);

        await browser.loadTracks([config("Homo sapiens A3")]);

        expect(labels(browser).y).toEqual([{ text: "Homo sapiens A3", title: "Homo sapiens A3", shown: true }]);
    });

    test("renaming a track pair updates the labels on its x and y tracks", async function () {
        const browser = await browserIn(context.container);
        await browser.loadTracks([config("a")]);

        browser.trackPairs[0].setTrackLabelName("renamed");

        const { x, y } = labels(browser);
        expect(x).toEqual([{ text: "renamed", title: "renamed", shown: true }]);
        expect(y).toEqual([{ text: "renamed", title: "renamed", shown: true }]);
    });

    for (const axis of ['x', 'y']) {
        test(`clicking a ${axis} track flips the labels on x and y tracks, and the gutter`, async function () {
            const browser = await browserIn(context.container);
            await browser.loadTracks([config("a"), config("b")]);

            const rows = 'x' === axis ? xRows : yRows;

            click(context.window, rows(browser)[0]);

            let { x, y } = labels(browser);
            expect([...x, ...y].map(({ shown }) => shown)).toEqual([false, false, false, false]);
            expect(gutterShown(browser)).toEqual([false, false]);

            click(context.window, rows(browser)[1]);

            ({ x, y } = labels(browser));
            expect([...x, ...y].map(({ shown }) => shown)).toEqual([true, true, true, true]);
            expect(gutterShown(browser)).toEqual([true, true]);
        });
    }

    test("a pending track shows its name on its x and y tracks while labels are toggled off", async function () {
        const browser = await browserIn(context.container);
        await browser.loadTracks([config("a")]);
        click(context.window, xRows(browser)[0]);

        let settle;
        createTrack.mockImplementation(({ name }) => new Promise(resolve => settle = () => resolve(track(name))));
        const load = browser.loadTracks([config("pending")]);

        const shownNames = axis => labels(browser)[axis].filter(({ shown }) => shown).map(({ text }) => text);
        expect(shownNames('x')).toEqual(["pending"]);
        expect(shownNames('y')).toEqual(["pending"]);

        // A toggle while it pends leaves its name up.
        click(context.window, xRows(browser)[0]);
        click(context.window, xRows(browser)[0]);
        expect(shownNames('x')).toEqual(["pending"]);
        expect(shownNames('y')).toEqual(["pending"]);

        await flush();
        settle();
        await load;

        // Loaded, it follows the browser's setting, gutter and all.
        const { x, y } = labels(browser);
        expect([...x, ...y].map(({ shown }) => shown)).toEqual([false, false, false, false]);
        expect(gutterShown(browser)).toEqual([false, false]);
    });

    test("toggling labels in one browser leaves the other browser's labels and setting alone", async function () {
        const a = await browserIn(context.container);
        const b = await browserIn(context.another());
        await a.loadTracks([config("a")]);
        await b.loadTracks([config("b")]);

        click(context.window, xRows(a)[0]);

        expect(a.showTrackLabelAndGutter).toBe(false);
        expect(b.showTrackLabelAndGutter).toBe(true);

        const { x, y } = labels(b);
        expect([...x, ...y].map(({ shown }) => shown)).toEqual([true, true]);
        expect(gutterShown(b)).toEqual([true]);

        // A track loaded into the other browser follows that browser's own setting.
        await b.loadTracks([config("c")]);
        expect(labels(b).x.map(({ shown }) => shown)).toEqual([true, true]);
        expect(gutterShown(b)).toEqual([true, true]);
    });
});
