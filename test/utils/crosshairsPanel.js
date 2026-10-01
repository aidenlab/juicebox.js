import {vi} from 'vitest'
import HICBrowser from '../../js/hicBrowser.js'
import Genome from '../../js/genome.js'

/**
 * Panels to hold crosshairs over, for the suites that claim who is told about
 * them: `testCrosshairsEcho.js` (the sync group) and
 * `testCrosshairsHostCallbacks.js` (the host).
 *
 * JSDOM does no layout, so a mouse event's coordinates are viewport pixels.
 */

const MB = 1000000

/** chr1 by chr2 at 1 kb per bin; `All` is index 0. */
const CHROMOSOMES = ['chr1', 'chr2']
const SIZES = {chr1: 100 * MB, chr2: 80 * MB}

/**
 * A browser with a stated map and viewport, its mouse handlers installed. The
 * default is bin 100 by bin 200 at 2 px per bin, 800 x 600 px: a pixel is
 * 500 bp, x starts at 100 kb of chr1 and y at 200 kb of chr2.
 */
export function panel(container, {
    state = {chr1: 1, chr2: 2, x: 100, y: 200, zoom: 0, pixelSize: 2},
    viewDimensions = {width: 800, height: 600},
    names = CHROMOSOMES,
} = {}) {
    const browser = new HICBrowser(container, {})
    const chromosomes = [
        {index: 0, name: 'All', size: 180000},
        ...names.map((name, i) => ({index: i + 1, name, size: SIZES[name]})),
    ]

    Object.defineProperty(browser, 'state', {value: state, configurable: true, writable: true})
    browser.dataset = {
        chromosomes,
        wholeGenomeResolution: 500000,
        binSizeForZoom: () => 1000,
        isWholeGenome: index => 0 === index,
    }
    browser.genome = new Genome('stand-in', chromosomes)
    vi.spyOn(browser.contactMatrixView, 'getViewDimensions').mockReturnValue(viewDimensions)
    vi.spyOn(browser.contactMatrixView.viewportElement, 'getBoundingClientRect')
        .mockReturnValue({top: 0, left: 0, width: viewDimensions.width, height: viewDimensions.height})
    // A view change is stated by writing `state`; painting it is not the
    // claim, and nor is sync -- the peers are told the locus, not the view.
    vi.spyOn(browser, 'repaint').mockResolvedValue(undefined)
    vi.spyOn(browser, 'syncToOtherBrowsers').mockImplementation(() => {})

    browser.isMobile = false
    browser.contactMatrixView.receiveEvent({type: 'MapLoad'})
    return browser
}

export function syncGroup(...browsers) {
    for (const browser of browsers) {
        for (const peer of browsers) {
            if (peer !== browser) browser.synchedBrowsers.add(peer)
        }
    }
}

export function mouse(browser, type, {x = 0, y = 0, ...rest} = {}) {
    browser.contactMatrixView.viewportElement.dispatchEvent(
        new window.MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, ...rest}))
}

export function key(type, init = {}) {
    document.dispatchEvent(new window.KeyboardEvent(type, {bubbles: true, ...init}))
}
