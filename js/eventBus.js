/*
 *  The MIT License (MIT)
 *
 * Copyright (c) 2016-2017 The Regents of the University of California
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
 * following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial
 * portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,  FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 */


/**
 * @author Jim Robinson
 */


/**
 * Barebones event bus.
 */

class EventBus {

    constructor() {

        // Map eventType -> list of subscribers
        this.subscribers = {};

        this.stack = []
    }

    subscribe(eventType, object) {

        var subscriberList = this.subscribers[eventType];
        if (subscriberList == undefined) {
            subscriberList = [];
            this.subscribers[eventType] = subscriberList;
        }
        subscriberList.push(object);

    }

    /**
     * Detach a subscriber. Removes every registration it made for this event
     * type, and is a no-op if the type or the subscriber is unknown.
     *
     * Hosts need this: a handler attached to a browser that is later discarded
     * has no other way off, and `EventBus.globalBus` outlives every browser on
     * the page. See #414.
     */
    unsubscribe(eventType, object) {

        const subscriberList = this.subscribers[eventType];
        if (undefined === subscriberList) {
            return;
        }

        // Spliced in place rather than replaced, so a post already walking this
        // list sees the removal. post() takes its own snapshot to stay safe.
        for (let index = subscriberList.length - 1; index >= 0; index--) {
            if (subscriberList[index] === object) {
                subscriberList.splice(index, 1);
            }
        }
    }

    /**
     * Drop every subscriber, and anything held.
     *
     * For a bus that dies with its owner: `HICBrowser.dispose()` calls this on
     * the per-browser bus, which is what releases the host handlers still
     * attached to a browser being torn down. Never call it on
     * `EventBus.globalBus` -- those registrations belong to the host and
     * outlive every browser on the page. See #493.
     */
    clear() {
        this.subscribers = {};
        this.stack = [];
    }

    post(event) {

        const eventType = event.type

        if (this._hold) {
            this.stack.push(event)
        } else {
            // Snapshot: a subscriber is entitled to detach itself while being
            // notified, and iterating the live list would then skip whoever
            // sits behind it.
            const subscriberList = this.subscribers[eventType];

            if (subscriberList) {
                for (let subscriber of [...subscriberList]) {

                    if ("function" === typeof subscriber.receiveEvent) {
                        subscriber.receiveEvent(event);
                    } else if ("function" === typeof subscriber) {
                        subscriber(event);
                    }
                }
            }
        }
    }

    hold() {
        this._hold = true;
    }

    release() {
        this._hold = false;
        for (let event of this.stack) {
            this.post(event)
        }
        this.stack = []
    }
}

// The global event bus

EventBus.globalBus = new EventBus()

export default EventBus
