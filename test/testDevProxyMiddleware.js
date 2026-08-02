/**
 * The server-side half of the dev proxy. Unlike the client-side rewrite it is generic across
 * hosts, because targets arrive from session files and user paste and cannot be enumerated.
 *
 * The behaviour that matters most: it returns ENCODE's 307 to the browser rather than following it
 * server-side, so the map bytes never cross Node and there is no way for the proxy to corrupt
 * Content-Range. See issue #440 and docs/adr/0001-dev-proxy-for-waf-protected-hosts.md.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProxyMiddleware, DEFAULT_ORIGIN } from "../dev-proxy/plugin.js";
import { PROXY_PREFIX } from "../dev-proxy/map-url.js";

const ENCODE_URL = "https://www.encodeproject.org/files/ENCFF718AWL/@@download/ENCFF718AWL.hic";
const S3_URL = "https://encode-public.s3.amazonaws.com/2020/x.hic?X-Amz-Signature=abc";

let fetched;

function fakeRes() {
    return {
        statusCode: undefined,
        headers: {},
        body: undefined,
        ended: false,
        setHeader(name, value) {
            this.headers[name.toLowerCase()] = value;
        },
        end(body) {
            this.body = body;
            this.ended = true;
        }
    };
}

function stubFetch(response) {
    global.fetch = vi.fn(async (url, init) => {
        fetched.push({ url, init });
        return typeof response === 'function' ? response() : response;
    });
}

/** A Response whose body must not be read — reading it means Node saw the map bytes. */
function redirectResponse(location) {
    return new Response(null, { status: 307, headers: { location } });
}

async function run(req, { origin } = {}) {
    const res = fakeRes();
    const next = vi.fn();
    await createProxyMiddleware({ origin })(req, res, next);
    return { res, next };
}

const proxyReq = (target, headers = {}) => ({ url: `${PROXY_PREFIX}${target}`, method: 'GET', headers });

describe("dev proxy middleware", function () {

    beforeEach(() => {
        fetched = [];
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete global.fetch;
    });

    describe("routing", function () {

        test("passes an unrelated request straight through", async function () {
            stubFetch(new Response("never"));

            const { res, next } = await run({ url: "/dashboard.html", method: 'GET', headers: {} });

            expect(next).toHaveBeenCalled();
            expect(res.ended).toBe(false);
            expect(fetched).toHaveLength(0);
        });

        test("fetches the target named in the path", async function () {
            stubFetch(redirectResponse(S3_URL));

            await run(proxyReq(ENCODE_URL));

            expect(fetched[0].url).toBe(ENCODE_URL);
        });

        test("keeps a query string on the target", async function () {
            stubFetch(redirectResponse(S3_URL));

            await run(proxyReq(`${ENCODE_URL}?token=abc`));

            expect(fetched[0].url).toBe(`${ENCODE_URL}?token=abc`);
        });

        test("is generic — it proxies a host the client-side rule never rewrites", async function () {
            stubFetch(redirectResponse(S3_URL));

            await run(proxyReq("https://example.org/x.hic"));

            expect(fetched[0].url).toBe("https://example.org/x.hic");
        });

    });

    describe("the request it makes", function () {

        beforeEach(() => stubFetch(redirectResponse(S3_URL)));

        test("claims an allowlisted Origin", async function () {
            await run(proxyReq(ENCODE_URL));

            expect(fetched[0].init.headers.Origin).toBe(DEFAULT_ORIGIN);
            expect(DEFAULT_ORIGIN).toBe("https://aidenlab.org");
        });

        test("honours a configured Origin", async function () {
            await run(proxyReq(ENCODE_URL), { origin: "https://igv.org" });

            expect(fetched[0].init.headers.Origin).toBe("https://igv.org");
        });

        // ENCODE returns 502 to an allowlisted Origin carrying a spoofed Chrome UA — measured
        // 2026-08-02, see the note on REQUEST_HEADERS. Origin alone decides the challenge.
        test("identifies itself honestly rather than impersonating a browser", async function () {
            await run(proxyReq(ENCODE_URL));

            const { headers } = fetched[0].init;
            expect(headers['User-Agent']).toContain("juicebox.js-dev-proxy");
            expect(headers['User-Agent']).not.toMatch(/Mozilla|Chrome|Safari|Gecko/);
        });

        test("sends the Sec-Fetch trio a browser's own cross-origin fetch would send", async function () {
            await run(proxyReq(ENCODE_URL));

            const { headers } = fetched[0].init;
            expect(headers['Sec-Fetch-Site']).toBe("cross-site");
            expect(headers['Sec-Fetch-Mode']).toBe("cors");
            expect(headers['Sec-Fetch-Dest']).toBe("empty");
        });

        test("forwards the Range header — .hic reading is entirely byte-range based", async function () {
            await run(proxyReq(ENCODE_URL, { range: "bytes=0-99" }));

            expect(fetched[0].init.headers.Range).toBe("bytes=0-99");
        });

        test("does not forward the browser's own Origin, Host or Cookie", async function () {
            await run(proxyReq(ENCODE_URL, {
                origin: "http://localhost:3000",
                host: "localhost:3000",
                cookie: "session=secret"
            }));

            const { headers } = fetched[0].init;
            expect(headers.Origin).toBe(DEFAULT_ORIGIN);
            expect(headers.Host).toBeUndefined();
            expect(headers.Cookie).toBeUndefined();
        });

        test("does not follow redirects itself", async function () {
            await run(proxyReq(ENCODE_URL));

            expect(fetched[0].init.redirect).toBe("manual");
        });

    });

    describe("the redirect", function () {

        test("is handed to the browser, which fetches S3 directly", async function () {
            stubFetch(redirectResponse(S3_URL));

            const { res } = await run(proxyReq(ENCODE_URL));

            expect(res.statusCode).toBe(307);
            expect(res.headers.location).toBe(S3_URL);
            expect(res.body).toBeUndefined();
        });

        test("leaves the redirect body unread, so no map bytes cross Node", async function () {
            const response = redirectResponse(S3_URL);
            stubFetch(response);

            await run(proxyReq(ENCODE_URL));

            expect(response.bodyUsed).toBe(false);
        });

        test("relays every redirect status, not just 307", async function () {
            stubFetch(new Response(null, { status: 302, headers: { location: S3_URL } }));

            const { res } = await run(proxyReq(ENCODE_URL));

            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe(S3_URL);
        });

    });

    describe("a non-redirect response", function () {

        test("relays status and body", async function () {
            stubFetch(new Response("map bytes", { status: 206, headers: { 'content-range': 'bytes 0-8/100' } }));

            const { res } = await run(proxyReq(ENCODE_URL));

            expect(res.statusCode).toBe(206);
            expect(res.headers['content-range']).toBe("bytes 0-8/100");
            expect(Buffer.from(res.body).toString()).toBe("map bytes");
        });

        test("relays the bot-challenge headers, so presentError can still read them", async function () {
            stubFetch(new Response("<html>captcha</html>", {
                status: 405,
                headers: { 'x-amzn-waf-action': 'captcha', 'content-type': 'text/html' }
            }));

            const { res } = await run(proxyReq(ENCODE_URL));

            expect(res.statusCode).toBe(405);
            expect(res.headers['x-amzn-waf-action']).toBe("captcha");
            expect(res.headers['access-control-expose-headers']).toBe("*");
        });

        test("drops hop-by-hop headers that would describe the wrong body", async function () {
            stubFetch(new Response("body", {
                status: 200,
                headers: { 'content-encoding': 'gzip', 'transfer-encoding': 'chunked', 'connection': 'keep-alive' }
            }));

            const { res } = await run(proxyReq(ENCODE_URL));

            expect(res.headers['content-encoding']).toBeUndefined();
            expect(res.headers['transfer-encoding']).toBeUndefined();
            expect(res.headers['connection']).toBeUndefined();
        });

    });

    describe("failure", function () {

        test("rejects a target that is not an absolute URL", async function () {
            stubFetch(new Response("never"));

            const { res } = await run({ url: `${PROXY_PREFIX}not-a-url`, method: 'GET', headers: {} });

            expect(res.statusCode).toBe(400);
            expect(fetched).toHaveLength(0);
        });

        test("rejects a non-http protocol", async function () {
            stubFetch(new Response("never"));

            const { res } = await run(proxyReq("file:///etc/passwd"));

            expect(res.statusCode).toBe(400);
            expect(fetched).toHaveLength(0);
        });

        test("rejects an empty target", async function () {
            stubFetch(new Response("never"));

            const { res } = await run({ url: PROXY_PREFIX, method: 'GET', headers: {} });

            expect(res.statusCode).toBe(400);
            expect(fetched).toHaveLength(0);
        });

        test("reports a failed fetch as a bad gateway", async function () {
            global.fetch = vi.fn(async () => { throw new Error("getaddrinfo ENOTFOUND"); });

            const { res } = await run(proxyReq(ENCODE_URL));

            expect(res.statusCode).toBe(502);
            expect(String(res.body)).toContain("ENOTFOUND");
        });

    });

});
