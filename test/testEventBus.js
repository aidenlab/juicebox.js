import {describe, it, expect} from 'vitest'
import fs from 'fs'
import path from 'path'
import {fileURLToPath} from 'url'
import EventBus from '../js/eventBus.js'
import HICEvent from '../js/hicEvent.js'

/**
 * The event bus is host-facing plumbing -- see #414.
 *
 * Nothing inside this repo subscribes to it; the coordinator is the internal
 * routing abstraction. What subscribes are host apps: Spacewalk on the
 * per-browser bus, juicebox-web on the global one. So the thing worth testing
 * is what a host can do with it, and until now a host could only ever add.
 *
 * `unsubscribe` closes that: a host that attaches a handler to a browser it
 * later discards has had no way to detach, and `EventBus.globalBus` outlives
 * every browser on the page.
 */

describe('unsubscribe', () => {

    it('stops delivering to a detached subscriber', () => {
        const bus = new EventBus()
        const seen = []
        const subscriber = {receiveEvent: event => seen.push(event.type)}

        bus.subscribe('DragStopped', subscriber)
        bus.post(HICEvent('DragStopped'))
        bus.unsubscribe('DragStopped', subscriber)
        bus.post(HICEvent('DragStopped'))

        expect(seen).toEqual(['DragStopped'])
    })

    it('detaches a bare function subscriber', () => {
        // post() accepts either shape, so unsubscribe has to as well.
        const bus = new EventBus()
        const seen = []
        const subscriber = event => seen.push(event.type)

        bus.subscribe('DragStopped', subscriber)
        bus.unsubscribe('DragStopped', subscriber)
        bus.post(HICEvent('DragStopped'))

        expect(seen).toEqual([])
    })

    it('leaves other subscribers of the same event attached', () => {
        const bus = new EventBus()
        const seen = []
        const staying = {receiveEvent: () => seen.push('staying')}
        const leaving = {receiveEvent: () => seen.push('leaving')}

        bus.subscribe('DragStopped', staying)
        bus.subscribe('DragStopped', leaving)
        bus.unsubscribe('DragStopped', leaving)
        bus.post(HICEvent('DragStopped'))

        expect(seen).toEqual(['staying'])
    })

    it('removes every registration when one was made twice', () => {
        // A host that subscribed twice by accident should not have to call
        // unsubscribe twice to stop hearing about it.
        const bus = new EventBus()
        const seen = []
        const subscriber = {receiveEvent: () => seen.push('once')}

        bus.subscribe('DragStopped', subscriber)
        bus.subscribe('DragStopped', subscriber)
        bus.unsubscribe('DragStopped', subscriber)
        bus.post(HICEvent('DragStopped'))

        expect(seen).toEqual([])
    })

    it('is a no-op for an event type nobody subscribed', () => {
        const bus = new EventBus()
        expect(() => bus.unsubscribe('NeverSubscribed', {})).not.toThrow()
    })

    it('is a no-op for a subscriber that was never attached', () => {
        const bus = new EventBus()
        bus.subscribe('DragStopped', {receiveEvent: () => {}})
        expect(() => bus.unsubscribe('DragStopped', {receiveEvent: () => {}})).not.toThrow()
    })

    it('does not disturb a post already in flight', () => {
        // A subscriber that detaches itself while being notified must not make
        // post() skip the subscriber sitting behind it in the list.
        const bus = new EventBus()
        const seen = []
        const first = {receiveEvent: () => {
            seen.push('first')
            bus.unsubscribe('DragStopped', first)
        }}
        const second = {receiveEvent: () => seen.push('second')}

        bus.subscribe('DragStopped', first)
        bus.subscribe('DragStopped', second)
        bus.post(HICEvent('DragStopped'))

        expect(seen).toEqual(['first', 'second'])
    })
})

describe('internal subscribers', () => {

    // The bus is for hosts. Internally, the coordinator is the routing
    // abstraction -- it calls its collaborators directly. Eight subscriptions
    // survived the coordinator migration as a second, silent route for events
    // nothing posted any more; this keeps a ninth from growing back. A host
    // subscribing from outside this directory is unaffected.
    const jsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../js')

    function sourceFiles(directory) {
        return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
            const entryPath = path.join(directory, entry.name)
            if (entry.isDirectory()) return sourceFiles(entryPath)
            return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : []
        })
    }

    it('routes through the coordinator, not the bus', () => {

        const offenders = []

        for (const filePath of sourceFiles(jsDirectory)) {
            const lines = fs.readFileSync(filePath, 'utf8').split('\n')
            lines.forEach((line, index) => {
                if (/\.subscribe\(/.test(line)) {
                    offenders.push(`${path.relative(jsDirectory, filePath)}:${index + 1}`)
                }
            })
        }

        expect(offenders, `these subscribe internally instead of using the coordinator: ${offenders.join(', ')}`).toEqual([])
    })
})
