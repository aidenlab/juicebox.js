/**
 * The client-side half of the dev proxy. It rewrites only hosts known to serve a bot challenge, so
 * that a genuine CORS or permissions problem on any other host still surfaces in development
 * exactly as it would in production.
 *
 * See issue #440 and docs/adr/0001-dev-proxy-for-waf-protected-hosts.md.
 */
import { describe, test, expect } from 'vitest';
import { devMapUrl, targetFromProxyPath, PROXY_PREFIX } from "../dev-proxy/map-url.js";

const ENCODE_URL = "https://www.encodeproject.org/files/ENCFF718AWL/@@download/ENCFF718AWL.hic";
const HICFILES_URL = "https://hicfiles.s3.amazonaws.com/hiseq/gm12878/dilution/combined.hic";
const DNAZOO_URL = "https://dnazoo.s3.amazonaws.com/Phascolarctos_cinereus/phaCin_unsw_v4.1.rawchrom.hic";

describe("devMapUrl", function () {

    test("routes a challenged host through the proxy", function () {
        expect(devMapUrl(ENCODE_URL)).toBe(`${PROXY_PREFIX}${ENCODE_URL}`);
    });

    describe("routes both gates, not just the Origin one", function () {

        // These two refuse any browser: they gate on User-Agent, which the Fetch spec forbids a
        // browser from setting, so the value the client libraries ask for is silently dropped.
        const gated = {
            "a User-Agent-gated bucket": HICFILES_URL,
            "the assembly bucket behind the same gate": DNAZOO_URL,
        };

        for (const [label, url] of Object.entries(gated)) {
            test(label, function () {
                expect(devMapUrl(url)).toBe(`${PROXY_PREFIX}${url}`);
            });
        }

    });

    test("keeps the target URL whole, so the middleware can read it back", function () {
        expect(targetFromProxyPath(devMapUrl(ENCODE_URL))).toBe(ENCODE_URL);
    });

    test("preserves a query string on the target", function () {
        const withQuery = `${ENCODE_URL}?proxy=1`;

        expect(devMapUrl(withQuery)).toBe(`${PROXY_PREFIX}${withQuery}`);
    });

    test("is idempotent — an already-proxied URL is left alone", function () {
        const mapped = devMapUrl(ENCODE_URL);

        expect(devMapUrl(mapped)).toBe(mapped);
    });

    describe("leaves every other host fetching directly", function () {

        const untouched = [
            "https://4dn-open-data-public.s3.amazonaws.com/fourfront-webprod/x.hic",
            "https://ftp.ncbi.nlm.nih.gov/geo/samples/x.hic",
            "https://s3.us-east-1.wasabisys.com/x.hic",
            // Path-style addressing of the same gated bucket. Deliberately not claimed: the rule
            // is host-scoped, and s3.amazonaws.com is a shared endpoint serving every bucket that
            // has no vhost name. Claiming it would route strangers' data through the dev server.
            "https://s3.amazonaws.com/hicfiles/x.hic",
            "https://dl.dropboxusercontent.com/s/x.hic",
            "https://encodeproject.org.evil.example/x.hic",
            "https://www.encodeproject.org.evil.example/x.hic",
        ];

        for (const url of untouched) {
            test(url, function () {
                expect(devMapUrl(url)).toBe(url);
            });
        }

    });

    describe("passes through anything that is not an absolute http(s) URL", function () {

        const passThrough = {
            "a relative path": "/data/test.hic",
            "a bare filename": "test.hic",
            "a blob url": "blob:http://localhost:3000/8f1b-4c2e",
            "an empty string": "",
        };

        for (const [label, url] of Object.entries(passThrough)) {
            test(label, function () {
                expect(devMapUrl(url)).toBe(url);
            });
        }

        test("a non-string argument", function () {
            const file = { name: "test.hic" };

            expect(devMapUrl(file)).toBe(file);
        });

    });

});
