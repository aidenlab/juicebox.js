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

import {FileUtils} from '../node_modules/igv-utils/src/index.js'

function isMobile() {
    return (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
}

function throttle(fn, threshhold, scope) {
    var last,
        deferTimer;

    threshhold || (threshhold = 200);

    return function () {
        var context,
            now,
            args;

        context = scope || this;
        now = +new Date;
        args = arguments;

        if (last && now < last + threshhold) {
            // hold on to it
            clearTimeout(deferTimer);
            deferTimer = setTimeout(function () {
                last = now;
                fn.apply(context, args);
            }, threshhold);
        } else {
            last = now;
            fn.apply(context, args);
        }
    }
}

function getExtension(url) {

    if (undefined === url) {
        return undefined
    }

    let path = (FileUtils.isFile(url) || url.google_url) ? url.name : url
    let filename = path.toLowerCase()

    //Strip parameters -- handle local files later
    let index = filename.indexOf("?")
    if (index > 0) {
        filename = filename.substr(0, index)
    }

    //Strip aux extensions .gz, .tab, and .txt
    if (filename.endsWith(".gz")) {
        filename = filename.substr(0, filename.length - 3)
    } else if (filename.endsWith(".txt") || filename.endsWith(".tab") || filename.endsWith(".bgz")) {
        filename = filename.substr(0, filename.length - 4)
    }

    index = filename.lastIndexOf(".")

    return index < 0 ? filename : filename.substr(1 + index)
}


export { isMobile, throttle, getExtension }
