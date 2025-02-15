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
import {getCurrentBrowser} from "./createBrowser.js"
import {getAllBrowsers} from "./createBrowser.js"
import {restoreSession} from "./session.js"
import {Alert} from "../node_modules/igv-ui/dist/igv-ui.js"

async function init(container, config) {

    Alert.init(container);

    if (false !== config.queryParametersSupported) {
        const queryConfig = await extractConfig(window.location.href);
        if(queryConfig) {
            config= queryConfig;
        }
    }

    await restoreSession(container, config);

    const allBrowsers = getAllBrowsers();

    return allBrowsers.length === 1 ? allBrowsers[0] : allBrowsers
}


export {
    init
}




