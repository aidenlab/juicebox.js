import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import BrowserRegistry from '../js/browserRegistry.js'
import EventBus from '../js/eventBus.js'

/**
 * The browser registry -- see #478, decision 1 of ADR-0004.
 *
 * The registry owns the browser list, the current-browser pointer and the sync
 * group. It never constructs a browser, so the browsers here are fabricated
 * objects carrying only what the registry reads: the two DOM handles it
 * touches, the sync members, and `unsyncSelf`.
 */

function fakeElement() {
    const classes = new Set()
    return {
        removed: false,
        classList: {
            add: name => classes.add(name),
            remove: name => classes.delete(name),
            contains: name => classes.has(name)
        },
        remove() {
            this.removed = true
        }
    }
}

function fakeBrowser(name, {dataset, synchable} = {}) {
    const browser = {
        name,
        rootElement: fakeElement(),
        browserPanelDeleteButton: {style: {display: 'none'}},
        synchedBrowsers: new Set(),
        unsyncSelfCalls: 0,
        unsyncSelf() {
            this.unsyncSelfCalls++
        }
    }
    if (dataset !== undefined) browser.dataset = dataset
    if (synchable !== undefined) browser.synchable = synchable
    return browser
}

function fakeDataset(genomeId) {
    return {
        genomeId,
        isCompatible: other => other.genomeId === genomeId
    }
}

function isSelected(browser) {
    return browser.rootElement.classList.contains('hic-root-selected')
}

function deleteButtonDisplays(registry) {
    return registry.browsers.map(b => b.browserPanelDeleteButton.style.display)
}

describe('BrowserRegistry', () => {

    let registry
    let selectEvents
    let selectListener

    beforeEach(() => {
        registry = new BrowserRegistry()
        selectEvents = []
        selectListener = event => selectEvents.push(event)
        EventBus.globalBus.subscribe('BrowserSelect', selectListener)
    })

    afterEach(() => {
        EventBus.globalBus.unsubscribe('BrowserSelect', selectListener)
    })

    describe('add', () => {

        it('holds the added browser and makes it current', () => {
            const a = fakeBrowser('a')

            registry.add(a)

            expect(registry.browsers).toEqual([a])
            expect(registry.currentBrowser).toBe(a)
            expect(isSelected(a)).toBe(true)
        })

        it('leaves the delete button hidden while there is one browser', () => {
            registry.add(fakeBrowser('a'))

            expect(deleteButtonDisplays(registry)).toEqual(['none'])
        })

        it('shows every delete button once a second browser arrives', () => {
            registry.add(fakeBrowser('a'))
            registry.add(fakeBrowser('b'))

            expect(deleteButtonDisplays(registry)).toEqual(['block', 'block'])
        })
    })

    describe('register', () => {

        it('takes the browser without selecting it', () => {
            const a = fakeBrowser('a')

            registry.register(a)

            expect(registry.browsers).toEqual([a])
            expect(registry.currentBrowser).toBeUndefined()
            expect(isSelected(a)).toBe(false)
            expect(selectEvents).toHaveLength(0)
        })

        it('leaves delete-button visibility alone, the button not existing yet', () => {
            const a = fakeBrowser('a')
            const b = fakeBrowser('b')
            b.browserPanelDeleteButton = undefined

            registry.register(a)

            expect(() => registry.register(b)).not.toThrow()
            expect(a.browserPanelDeleteButton.style.display).toBe('none')
        })
    })

    describe('clear', () => {

        it('gives up the browsers without touching their DOM', () => {
            const a = fakeBrowser('a')
            registry.add(a)

            registry.clear()

            expect(registry.browsers).toEqual([])
            expect(a.rootElement.removed).toBe(false)
        })
    })

    describe('select', () => {

        it('posts BrowserSelect and moves the selected class', () => {
            const a = fakeBrowser('a')
            const b = fakeBrowser('b')
            for (const browser of [a, b]) registry.register(browser)

            registry.select(a)
            registry.select(b)

            expect(registry.currentBrowser).toBe(b)
            expect(isSelected(a)).toBe(false)
            expect(isSelected(b)).toBe(true)
            expect(selectEvents.map(e => e.data)).toEqual([a, b])
        })

        it('does not post when the browser is already current', () => {
            const a = fakeBrowser('a')
            for (const browser of [a]) registry.register(browser)

            registry.select(a)
            registry.select(a)

            expect(selectEvents).toHaveLength(1)
        })

        it('clears the selection without posting when given undefined', () => {
            const a = fakeBrowser('a')
            registry.add(a)
            selectEvents.length = 0

            registry.select(undefined)

            expect(registry.currentBrowser).toBeUndefined()
            expect(isSelected(a)).toBe(false)
            expect(selectEvents).toHaveLength(0)
        })
    })

    describe('delete', () => {

        it('removes the browser from the list and from the DOM', () => {
            const a = fakeBrowser('a')
            const b = fakeBrowser('b')
            registry.add(a)
            registry.add(b)

            registry.delete(a)

            expect(registry.browsers).toEqual([b])
            expect(a.rootElement.removed).toBe(true)
            expect(a.unsyncSelfCalls).toBe(1)
        })

        it('hides the delete buttons once one browser is left', () => {
            const a = fakeBrowser('a')
            const b = fakeBrowser('b')
            registry.add(a)
            registry.add(b)

            registry.delete(a)

            expect(deleteButtonDisplays(registry)).toEqual(['none'])
        })

        it('keeps the delete buttons visible while two browsers remain', () => {
            const [a, b, c] = ['a', 'b', 'c'].map(name => fakeBrowser(name))
            for (const browser of [a, b, c]) registry.add(browser)

            registry.delete(c)

            expect(deleteButtonDisplays(registry)).toEqual(['block', 'block'])
        })

        it('falls selection through to a surviving browser and posts BrowserSelect for it', () => {
            const a = fakeBrowser('a')
            const b = fakeBrowser('b')
            registry.add(a)
            registry.add(b)
            selectEvents.length = 0

            registry.delete(b)

            expect(registry.currentBrowser).toBe(a)
            expect(isSelected(a)).toBe(true)
            expect(selectEvents.map(e => e.data)).toEqual([a])
        })

        it('leaves selection alone and posts nothing when the deleted browser is not current', () => {
            const a = fakeBrowser('a')
            const b = fakeBrowser('b')
            registry.add(a)
            registry.add(b)
            selectEvents.length = 0

            registry.delete(a)

            expect(registry.currentBrowser).toBe(b)
            expect(isSelected(b)).toBe(true)
            expect(selectEvents).toHaveLength(0)
        })

        it('leaves selection undefined once deleting empties the registry', () => {
            const a = fakeBrowser('a')
            registry.add(a)
            selectEvents.length = 0

            registry.delete(a)

            expect(registry.browsers).toEqual([])
            expect(registry.currentBrowser).toBeUndefined()
            expect(isSelected(a)).toBe(false)
            expect(selectEvents).toHaveLength(0)
        })
    })

    describe('deleteAll', () => {

        it('empties the list and removes every root element', () => {
            const a = fakeBrowser('a')
            const b = fakeBrowser('b')
            registry.add(a)
            registry.add(b)

            registry.deleteAll()

            expect(registry.browsers).toEqual([])
            expect(a.rootElement.removed).toBe(true)
            expect(b.rootElement.removed).toBe(true)
        })

        it('leaves selection undefined, the registry now being empty', () => {
            const a = fakeBrowser('a')
            const b = fakeBrowser('b')
            registry.add(a)
            registry.add(b)
            selectEvents.length = 0

            registry.deleteAll()

            expect(registry.currentBrowser).toBeUndefined()
            expect(isSelected(b)).toBe(false)
            expect(selectEvents).toHaveLength(0)
        })
    })

    describe('sync', () => {

        it('joins the registry\'s compatible browsers into each other\'s sync group', () => {
            const hg38 = fakeDataset('hg38')
            const a = fakeBrowser('a', {dataset: hg38})
            const b = fakeBrowser('b', {dataset: hg38})
            const other = fakeBrowser('other', {dataset: fakeDataset('hg19')})
            for (const browser of [a, b, other]) registry.register(browser)

            registry.sync()

            expect([...a.synchedBrowsers]).toEqual([b])
            expect([...b.synchedBrowsers]).toEqual([a])
            expect([...other.synchedBrowsers]).toEqual([])
        })

        it('syncs an explicit list instead of the registry when given one', () => {
            const hg38 = fakeDataset('hg38')
            const a = fakeBrowser('a', {dataset: hg38})
            const b = fakeBrowser('b', {dataset: hg38})
            for (const browser of [a]) registry.register(browser)

            registry.sync([a, b])

            expect([...a.synchedBrowsers]).toEqual([b])
            expect([...b.synchedBrowsers]).toEqual([a])
        })
    })

    describe('updateAll', () => {

        it('awaits an update on every browser', async () => {
            const updated = []
            const browsers = ['a', 'b'].map(name => {
                const browser = fakeBrowser(name)
                browser.update = async () => updated.push(name)
                return browser
            })
            for (const browser of browsers) registry.register(browser)

            await registry.updateAll()

            expect(updated).toEqual(['a', 'b'])
        })
    })

    describe('isolation', () => {

        it('does not share browsers with another registry', () => {
            const other = new BrowserRegistry()

            registry.add(fakeBrowser('a'))

            expect(other.browsers).toEqual([])
            expect(other.currentBrowser).toBeUndefined()
        })
    })
})
