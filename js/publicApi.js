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
 */

/**
 * The declared public surface of juicebox.js.
 *
 * juicebox.js is an embeddable component, not an application. Its correctness
 * condition is not "the dev harness still works" -- it is "the host apps still
 * work, and so does an embedder we have never heard of."
 *
 * Most of that surface is not visible from inside this repo. `js/index.js`
 * exports twelve names and `HICBrowser` is not one of them: hosts get browser
 * instances from `init()` and then use them directly. So asking "does anything
 * call this?" and grepping `js/` returns *no* for members two shipped
 * applications depend on. Every refactor that trusts that grep is reasoning
 * from a false negative -- and one already has, see ADR-0003.
 *
 * This module is the fix. It names the surface as data so there is somewhere to
 * look, and `test/testPublicApi.js` reads it so there is something that breaks.
 *
 * **A name in this file is a promise.** Renaming it, removing it, or changing
 * its signature or return type is a breaking change requiring a coordinated
 * release across both known consumers -- see the release ceremony.
 *
 * **Absence from this file is not permission.** juicebox.js is MIT, published
 * and embeddable by anyone; the consumers we can measure are not the
 * population. For anything resembling a load, a session, a state or a
 * lifecycle call, prefer deprecation over deletion even when this file is
 * silent. For genuinely internal machinery, this file is sufficient.
 *
 * Nothing imports this module at runtime. It ships with the library so that
 * consumers and future refactors can read it, and bundlers drop it from
 * consumer builds.
 */

/**
 * Names exported from `js/index.js`.
 *
 * This half of the contract is healthy: it is declared in an explicit export
 * block and used roughly as intended. It is listed here so the whole surface
 * sits in one place, and so the test can check both directions -- an addition
 * here is as much a contract change as a removal.
 */
export const NAMESPACE_SURFACE = [
    'version',
    'init',
    'toJSON',
    'restoreSession',
    'compressedSession',
    'createBrowser',
    'getCurrentBrowser',
    'setCurrentBrowser',
    'getAllBrowsers',
    'igvxhr',
    'EventBus',
    'setUrlMapper'
]
