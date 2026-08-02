/**
 * setUrlMapper is the seam a host app throws in development to route .hic reads through the dev
 * proxy. It must be unset by default, so a host app that never calls it is unaffected.
 * See issue #440 and docs/adr/0001-dev-proxy-for-waf-protected-hosts.md.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const strawConfigs = [];

vi.mock('hic-straw', () => ({
    default: class Straw {
        constructor(config) {
            strawConfigs.push(config);
            this.hicFile = {};
        }
    }
}));

const { setUrlMapper, getUrlMapper } = await import("../js/urlMapper.js");
const { HiCDataset } = await import("../js/hicDataset.js");

function strawConfigFor(config) {
    strawConfigs.length = 0;
    new HiCDataset(config);
    return strawConfigs.at(-1);
}

describe("url mapper", function () {

    beforeEach(() => {
        strawConfigs.length = 0;
    });

    afterEach(() => {
        setUrlMapper(undefined);
    });

    test("is unset by default", function () {
        expect(getUrlMapper()).toBeUndefined();
    });

    test("leaves the straw config alone when unset", function () {
        expect(strawConfigFor({ url: "https://example.org/x.hic" }).mapUrl).toBeUndefined();
    });

    test("reaches straw as config.mapUrl once set", function () {
        const mapper = url => url;
        setUrlMapper(mapper);

        expect(strawConfigFor({ url: "https://example.org/x.hic" }).mapUrl).toBe(mapper);
    });

    test("preserves the rest of the config when it injects the mapper", function () {
        setUrlMapper(url => url);

        const config = strawConfigFor({ url: "https://example.org/x.hic", name: "x.hic" });

        expect(config.url).toBe("https://example.org/x.hic");
        expect(config.name).toBe("x.hic");
    });

    test("does not mutate the caller's config object", function () {
        setUrlMapper(url => url);
        const config = { url: "https://example.org/x.hic" };

        new HiCDataset(config);

        expect(config.mapUrl).toBeUndefined();
    });

    test("yields to a mapper the caller supplied explicitly", function () {
        const explicit = url => url;
        setUrlMapper(url => `${url}?module-scope`);

        expect(strawConfigFor({ url: "https://example.org/x.hic", mapUrl: explicit }).mapUrl).toBe(explicit);
    });

    test("can be cleared", function () {
        setUrlMapper(url => url);
        setUrlMapper(undefined);

        expect(strawConfigFor({ url: "https://example.org/x.hic" }).mapUrl).toBeUndefined();
    });

});
