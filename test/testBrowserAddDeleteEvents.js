import {describe, it, expect, afterEach} from 'vitest'
import HICBrowser from '../js/hicBrowser.js'
import {registryForContainer} from '../js/browserRegistry.js'
import EventBus from '../js/eventBus.js'
import {withContainers} from './utils/browserFixture.js'
import {withStubbedLoads} from './utils/stubbedLoads.js'

/**
 * `BrowserAdd` and `BrowserDelete` on the global bus: what a host mirroring
 * this embed on another page needs to open and close panels in step. Each
 * carries the browser, and each is posted while the browser is in
 * `registry.browsers`, so its position is readable from the payload alone.
 * A restore (`deleteAll` then the session path's `register`) and a `reset()`
 * post neither: they are not the user opening or closing a panel.
 */
describe('BrowserAdd and BrowserDelete', () => {

    const dom = withContainers()
    withStubbedLoads()

    const heard = []
    const record = name => ({data}) => heard.push({name, browser: data, position: data.registry.browsers.indexOf(data)})
    const onAdd = record('BrowserAdd')
    const onDelete = record('BrowserDelete')

    function listening() {
        heard.length = 0
        EventBus.globalBus.subscribe('BrowserAdd', onAdd)
        EventBus.globalBus.subscribe('BrowserDelete', onDelete)
    }

    afterEach(() => {
        EventBus.globalBus.unsubscribe('BrowserAdd', onAdd)
        EventBus.globalBus.unsubscribe('BrowserDelete', onDelete)
    })

    it('add posts BrowserAdd once the browser is in the list', () => {
        const registry = registryForContainer(dom.container)
        const first = new HICBrowser(dom.container, {})
        registry.add(first)
        listening()

        const second = new HICBrowser(dom.container, {})
        registry.add(second)

        expect(heard).toEqual([{name: 'BrowserAdd', browser: second, position: 1}])
    })

    it('delete posts BrowserDelete while the browser is still in the list', () => {
        const registry = registryForContainer(dom.container)
        const first = new HICBrowser(dom.container, {})
        const second = new HICBrowser(dom.container, {})
        registry.add(first)
        registry.add(second)
        listening()

        registry.delete(second)

        expect(heard).toEqual([{name: 'BrowserDelete', browser: second, position: 1}])
        expect(registry.browsers).toEqual([first])
    })

    it('delete still tears the browser down when a listener throws', () => {
        // Codex adversarial review: the post used to sit unguarded in front of
        // dispose(), so one failing host left the panel, its handlers and its
        // sync membership alive after earlier listeners had been told it was gone.
        const registry = registryForContainer(dom.container)
        const first = new HICBrowser(dom.container, {})
        const second = new HICBrowser(dom.container, {})
        registry.add(first)
        registry.add(second)
        const failure = new Error('host bug')
        const failing = () => { throw failure }
        EventBus.globalBus.subscribe('BrowserDelete', failing)
        listening()

        try {
            expect(() => registry.delete(second)).toThrow(failure)
        } finally {
            EventBus.globalBus.unsubscribe('BrowserDelete', failing)
        }

        expect(heard.map(({name, browser}) => [name, browser])).toEqual([['BrowserDelete', second]])
        expect(registry.browsers).toEqual([first])
        expect(second.rootElement.isConnected).toBe(false)
    })

    it('a second delete of the same browser posts nothing', () => {
        const registry = registryForContainer(dom.container)
        const first = new HICBrowser(dom.container, {})
        const second = new HICBrowser(dom.container, {})
        registry.add(first)
        registry.add(second)
        registry.delete(second)
        listening()

        registry.delete(second)

        expect(heard).toEqual([])
        expect(registry.browsers).toEqual([first])
    })

    it('a listener deleting the browser it is told about posts once', () => {
        const registry = registryForContainer(dom.container)
        const first = new HICBrowser(dom.container, {})
        const second = new HICBrowser(dom.container, {})
        registry.add(first)
        registry.add(second)
        const reentrant = ({data}) => registry.delete(data)
        EventBus.globalBus.subscribe('BrowserDelete', reentrant)
        listening()

        try {
            registry.delete(second)
        } finally {
            EventBus.globalBus.unsubscribe('BrowserDelete', reentrant)
        }

        expect(heard).toEqual([{name: 'BrowserDelete', browser: second, position: 1}])
        expect(registry.browsers).toEqual([first])
    })

    it('a reset posts neither', () => {
        const registry = registryForContainer(dom.container)
        const browser = new HICBrowser(dom.container, {})
        registry.add(browser)
        listening()

        browser.reset()

        expect(heard).toEqual([])
    })

    it('deleteAll posts neither', () => {
        const registry = registryForContainer(dom.container)
        registry.add(new HICBrowser(dom.container, {}))
        registry.add(new HICBrowser(dom.container, {}))
        listening()

        registry.deleteAll()

        expect(heard).toEqual([])
    })
})
