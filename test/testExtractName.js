/**
 * extractName derives a display name from a config. A name taken from a URL is percent-decoded,
 * and the last segment is found after the query string is removed. See issue #692.
 */
import { describe, test, expect } from 'vitest';

import { extractName } from "../js/utils.js";

describe("extractName", function () {

    test("percent-decodes a name derived from a URL", function () {
        const url = "https://ftp.ncbi.nlm.nih.gov/geo/samples/GSM5182nnn/GSM5182714/suppl/GSM5182714%5Fme%2D1k%2Eaca%2Ehic";
        expect(extractName({url})).toBe("GSM5182714_me-1k.aca.hic");
    });

    test("finds the last segment after removing the query string", function () {
        expect(extractName({url: "https://h.org/a/b.hic?x=/y/z"})).toBe("b.hic");
    });

    test("falls back to the raw segment when decoding throws", function () {
        expect(extractName({url: "https://h.org/a/100%.hic"})).toBe("100%.hic");
    });

    test("returns an explicit name unchanged", function () {
        expect(extractName({url: "https://h.org/a/b.hic", name: "a%5Fb"})).toBe("a%5Fb");
    });

    test("uses a File's own name", function () {
        const file = new File([""], "local%5Fmap.hic");
        expect(extractName({url: file})).toBe("local%5Fmap.hic");
    });
});
