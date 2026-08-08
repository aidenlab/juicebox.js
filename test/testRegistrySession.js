import {describe, it, expect} from 'vitest'
import BrowserRegistry, {registryForContainer} from '../js/browserRegistry.js'
import {toJSON, compressedSession, restoreSession} from '../js/session.js'
import {init} from '../js/init.js'
import {withContainers} from './utils/browserFixture.js'
import {withStubbedLoads} from './utils/stubbedLoads.js'
import {BGZip} from 'igv-utils'

/**
 * A session belongs to one embed -- #482, decision 5 of ADR-0004.
 *
 * `registry.toJSON()` and `registry.restoreSession(config)` are the real
 * methods; the exported functions in `js/session.js` delegate. What these tests
 * assert is *whose* session is being written or replaced, so wherever the claim
 * is about isolation there are two registries in play. A single-registry
 * assertion would pass against the page-scoped code these replace.
 */

/**
 * Carries only what the registry and the session path read off a browser.
 *
 * Its root element is real and lives in the registry's container, because the
 * claim under test is that restoring one embed leaves another embed's *DOM*
 * standing -- which only a real element can answer.
 */
function fakeBrowser(name, registry) {
    const rootElement = registry.container
        ? registry.container.ownerDocument.createElement('div')
        : {classList: {add: () => undefined, remove: () => undefined}, remove: () => undefined}
    registry.container?.appendChild(rootElement)
    return {
        name,
        registry,
        rootElement,
        browserPanelDeleteButton: {style: {display: 'none'}},
        synchedBrowsers: new Set(),
        unsyncSelf: () => undefined,
        // Since #493 a restore's opening `deleteAll()` asks each browser to
        // dispose itself; what the registry sees of that is the DOM going and
        // the slot being given up.
        dispose() {
            this.rootElement.remove()
            this.registry.releaseSlot(this)
        },
        toJSON: () => ({name})
    }
}

describe('registry.toJSON', () => {

    const dom = withContainers()

    it('serializes this registry\'s browsers, not another registry\'s', () => {
        const mine = registryForContainer(dom.container)
        const theirs = registryForContainer(dom.another())
        mine.register(fakeBrowser('a', mine))
        theirs.register(fakeBrowser('b', theirs))

        expect(mine.toJSON().browsers).toEqual([{name: 'a'}])
        expect(theirs.toJSON().browsers).toEqual([{name: 'b'}])
    })

    it('serializes this registry\'s selected gene, not another registry\'s', () => {
        const mine = registryForContainer(dom.container)
        const theirs = registryForContainer(dom.another())
        mine.selectedGene = 'ace'
        theirs.selectedGene = 'egfr'

        expect(mine.toJSON().selectedGene).toBe('ace')
        expect(theirs.toJSON().selectedGene).toBe('egfr')
    })

    it('leaves selectedGene out entirely when the embed has none', () => {
        expect(Object.hasOwn(registryForContainer(dom.container).toJSON(), 'selectedGene')).toBe(false)
    })

    it('writes an empty browser list for an empty registry', () => {
        expect(new BrowserRegistry().toJSON().browsers).toEqual([])
    })
})

describe('exported toJSON', () => {

    const dom = withContainers()

    it('serializes the registry owning the current browser', () => {
        const mine = registryForContainer(dom.container)
        const theirs = registryForContainer(dom.another())
        for (const [registry, name] of [[mine, 'a'], [theirs, 'b']]) {
            registry.register(fakeBrowser(name, registry))
        }

        theirs.select(theirs.browsers[0])
        expect(toJSON().browsers).toEqual([{name: 'b'}])

        mine.select(mine.browsers[0])
        expect(toJSON().browsers).toEqual([{name: 'a'}])
    })

    it('still carries the page caption, which no registry owns', () => {
        const caption = dom.window.document.createElement('div')
        caption.id = 'hic-caption'
        caption.textContent = '  a figure legend  '
        dom.window.document.body.appendChild(caption)

        const registry = registryForContainer(dom.container)
        registry.add(fakeBrowser('a', registry))

        expect(toJSON().caption).toBe('a figure legend')
    })

    it('compresses the same document it returns', () => {
        const registry = registryForContainer(dom.container)
        registry.add(fakeBrowser('a', registry))
        registry.selectedGene = 'ace'

        const compressed = compressedSession()

        expect(compressed.startsWith('session=blob:')).toBe(true)
        expect(JSON.parse(BGZip.uncompressString(compressed.slice('session=blob:'.length))))
            .toEqual({browsers: [{name: 'a'}], selectedGene: 'ace'})
    })
})

describe('registry.restoreSession', () => {

    const dom = withContainers()
    withStubbedLoads()

    it('replaces this registry\'s browsers and takes their DOM down with them', async () => {
        const registry = registryForContainer(dom.container)
        const outgoing = fakeBrowser('a', registry)
        registry.add(outgoing)

        await registry.restoreSession({browsers: []})

        expect(registry.browsers).toEqual([])
        expect(outgoing.rootElement.isConnected).toBe(false)
    })

    it('leaves another embed\'s browsers and DOM standing', async () => {
        const mine = registryForContainer(dom.container)
        const theirs = registryForContainer(dom.another())
        const survivor = fakeBrowser('b', theirs)
        theirs.add(survivor)
        mine.add(fakeBrowser('a', mine))

        await mine.restoreSession({browsers: []})

        expect(theirs.browsers).toEqual([survivor])
        expect(theirs.currentBrowser).toBe(survivor)
        expect(survivor.rootElement.isConnected).toBe(true)
    })

    it('restores the selected gene onto itself and nobody else', async () => {
        const mine = registryForContainer(dom.container)
        const theirs = registryForContainer(dom.another())

        await mine.restoreSession({browsers: [], selectedGene: 'ace'})

        expect(mine.selectedGene).toBe('ace')
        expect(theirs.selectedGene).toBeUndefined()
    })

    it('leaves a previously selected gene alone when the session names none', async () => {
        const registry = registryForContainer(dom.container)
        registry.selectedGene = 'ace'

        await registry.restoreSession({browsers: []})

        expect(registry.selectedGene).toBe('ace')
    })

    it('expands URL shortcuts in the configs it is handed', async () => {
        const registry = registryForContainer(dom.container)
        const session = {
            browsers: [{
                url: '*s3/hiseq/gm12878/in-situ/combined.hic',
                tracks: [{url: '*s3/hiseq/gm12878/in-situ/combined_peaks.txt'}]
            }]
        }

        await registry.restoreSession(session)

        expect(session.browsers[0].url).toBe('https://hicfiles.s3.amazonaws.com/hiseq/gm12878/in-situ/combined.hic')
        expect(session.browsers[0].tracks[0].url)
            .toBe('https://hicfiles.s3.amazonaws.com/hiseq/gm12878/in-situ/combined_peaks.txt')
    })
})

describe('exported restoreSession', () => {

    const dom = withContainers()
    withStubbedLoads()

    it('restores into the registry owning the container it is given', async () => {
        const mine = registryForContainer(dom.container)
        const theirs = registryForContainer(dom.another())
        const survivor = fakeBrowser('b', theirs)
        theirs.add(survivor)

        await restoreSession(dom.container, {browsers: [{url: 'https://example.com/a.hic'}]})

        expect(mine.browsers).toHaveLength(1)
        expect(theirs.browsers).toEqual([survivor])
        expect(survivor.rootElement.isConnected).toBe(true)
    })

    it('restores the page caption, which no registry owns', async () => {
        const caption = dom.window.document.createElement('div')
        caption.id = 'hic-caption'
        dom.window.document.body.appendChild(caption)

        await restoreSession(dom.container, {browsers: [], caption: 'a figure legend'})

        expect(caption.textContent).toBe('a figure legend')
    })

    it('returns a promise that settles once the browsers are built', async () => {
        const registry = registryForContainer(dom.container)

        await restoreSession(dom.container, {browsers: [{url: 'https://example.com/a.hic'}]})

        expect(registry.browsers).toHaveLength(1)
        expect(registry.currentBrowser).toBe(registry.browsers[0])
    })
})

describe('session round trip', () => {

    const dom = withContainers()
    withStubbedLoads()

    /**
     * A session written by hand, not by the code under test. The canonical
     * state below is the independent source of truth the round trip is checked
     * against -- reading it back off the browser that produced it would make
     * the assertion true by construction.
     */
    const saved = {
        browsers: [{
            url: 'https://example.com/a.hic',
            state: {chr1: 17, chr2: 17, zoom: 8, x: 12025, y: 12025, pixelSize: 1, normalization: 'NONE'}
        }],
        selectedGene: 'ace'
    }

    it('restores the canonical state it saved, into another embed', async () => {
        const first = registryForContainer(dom.container)
        await first.restoreSession(structuredClone(saved))

        const second = registryForContainer(dom.another())
        await second.restoreSession(first.toJSON())

        expect(second.browsers[0].state.toJSON()).toEqual(saved.browsers[0].state)
        expect(second.selectedGene).toBe('ace')
    })

    it('restores the same canonical state a second time round', async () => {
        // A session that survives one trip can still be lossy in a way the
        // first pass hides -- a field defaulted on read and dropped on write
        // looks right until it is written again.
        const registry = registryForContainer(dom.container)

        await registry.restoreSession(structuredClone(saved))
        await registry.restoreSession(registry.toJSON())
        await registry.restoreSession(registry.toJSON())

        expect(registry.browsers[0].state.toJSON()).toEqual(saved.browsers[0].state)
    })

    it('survives the compressed URL form', async () => {
        const first = registryForContainer(dom.container)
        await first.restoreSession(structuredClone(saved))
        first.select(first.browsers[0])

        const blob = compressedSession().slice('session=blob:'.length)

        const second = registryForContainer(dom.another())
        await second.restoreSession(JSON.parse(BGZip.uncompressString(blob)))

        expect(second.browsers[0].state.toJSON()).toEqual(saved.browsers[0].state)
        expect(second.browsers[0].dataset.url).toBe('https://example.com/a.hic')
    })
})

describe('init on a second container', () => {

    const dom = withContainers()
    withStubbedLoads()

    const config = url => ({url, queryParametersSupported: false})

    it('leaves the first embed\'s browsers and DOM standing -- #384', async () => {
        const first = await init(dom.container, config('https://example.com/a.hic'))
        const firstRoot = first.rootElement

        const second = await init(dom.another(), config('https://example.com/b.hic'))

        expect(first.dataset.url).toBe('https://example.com/a.hic')
        expect(second.dataset.url).toBe('https://example.com/b.hic')
        expect(firstRoot.isConnected).toBe(true)
        expect(registryForContainer(dom.container).browsers).toEqual([first])
    })

    it('replaces the contents of a container initialized twice', async () => {
        const outgoing = await init(dom.container, config('https://example.com/a.hic'))
        const outgoingRoot = outgoing.rootElement

        const incoming = await init(dom.container, config('https://example.com/b.hic'))

        expect(registryForContainer(dom.container).browsers).toEqual([incoming])
        expect(outgoingRoot.isConnected).toBe(false)
    })

    it('gives each embed its own selected gene across a restore', async () => {
        await init(dom.container, {...config('https://example.com/a.hic'), selectedGene: 'ace'})
        const other = dom.another()
        await init(other, {...config('https://example.com/b.hic'), selectedGene: 'egfr'})

        expect(registryForContainer(dom.container).selectedGene).toBe('ace')
        expect(registryForContainer(other).selectedGene).toBe('egfr')
    })
})
