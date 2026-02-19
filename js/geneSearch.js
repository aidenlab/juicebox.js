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

import {igvxhr, StringUtils} from 'igv-utils'

async function geneSearch(genomeId, featureName) {
    const searchServiceURL = `https://portals.broadinstitute.org/webservices/igv/locus?genome=${genomeId}&name=${encodeURIComponent(featureName)}`;

    try {
        const data = await igvxhr.loadString(searchServiceURL);
        const results = parseSearchResults(data);

        return results.length ? results[0] : undefined;
    } catch (error) {
        console.error(`Error fetching gene data for "${featureName}":`, error);
        return undefined;
    }
}


function parseSearchResults(data) {
    const parsed = StringUtils.splitLines(data)
        .filter(line => line.trim() !== '').map(line => line.split('\t'))
        .filter(tokens => tokens.length >= 3).map(tokens => tokens[1])

    return parsed
}

export { geneSearch }
