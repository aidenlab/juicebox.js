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

import {extractConfig} from "./urlUtils.js"
import {registryForContainer} from "./browserRegistry.js"
import {restoreSession} from "./session.js"

/**
 * Initialize `container` as an embed and hand back the registry that owns it.
 *
 * The real initialization function, and the registry's front door: everything
 * one embed has -- its browsers, which of them is current, its sync group, its
 * session and its alerts -- is reachable from what this returns. Decision 3 of
 * ADR-0004, #483.
 *
 * Calling in twice with the same element finds the same registry and replaces
 * its contents; a different element gets a different registry, which is #384.
 *
 * @param {Element} container - the host element this embed occupies.
 * @param {Object} config - a browser config or a session.
 * @returns {Promise<BrowserRegistry>}
 */
async function initRegistry(container, config) {

    // No `Alert.init(container)` here: igv-ui's singleton was re-bound on every
    // initialization, so the last embed to initialize captured every embed's
    // alerts. Each registry now owns its own dialog -- see #481.

    if (false !== config.queryParametersSupported) {
        const queryConfig = await extractConfig(window.location.href);
        if(queryConfig) {
            config= queryConfig;
        }
    }

    await restoreSession(container, config);

    return registryForContainer(container);
}

/**
 * Initialize `container` as an embed and hand back its browsers.
 *
 * A wrapper over `initRegistry`, and deliberately still the published shape: it
 * resolves to a single browser when the session names one and to an array when
 * it names several, which is what both known host apps depend on. The registry
 * is not smuggled through this return type -- it has its own name. See the
 * rejected alternatives in ADR-0004.
 *
 * @returns {Promise<HICBrowser|HICBrowser[]>}
 */
async function init(container, config) {

    // This container's browsers, not the page's: `init()` must return what it
    // just built even when another embed has since been selected.
    const allBrowsers = (await initRegistry(container, config)).browsers;

    return allBrowsers.length === 1 ? allBrowsers[0] : allBrowsers
}


export {
    init,
    initRegistry
}




