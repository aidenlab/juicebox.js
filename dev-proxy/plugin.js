/**
 * The server-side half of the dev proxy: a Vite plugin that fetches a challenged data host from
 * Node, where the Origin header is ours to set.
 *
 *     import { devProxy } from 'juicebox.js/dev-proxy/plugin'
 *
 *     export default defineConfig({ plugins: [devProxy()] })
 *
 * `apply: 'serve'` so it can never enter a production build.
 *
 * The middleware is deliberately generic across hosts — targets arrive from session files and user
 * paste and cannot be enumerated. The decision about *which* hosts get proxied is the client-side
 * rule in map-url.js.
 *
 * See docs/adr/0001-dev-proxy-for-waf-protected-hosts.md.
 */

import { PROXY_PREFIX, parseHttpUrl, targetFromProxyPath, ruleForHost } from './map-url.js'

/**
 * The Origin the proxy claims. aidenlab.org is this project's own domain and its own entry on
 * ENCODE's allowlist, asserted by its own developers. The plugin option exists so that anyone
 * outside aidenlab has an honest path rather than silently asserting someone else's identity.
 */
const DEFAULT_ORIGIN = 'https://aidenlab.org'

/**
 * What every proxied request sends, whichever host it is for.
 *
 * The proxy identifies itself honestly rather than impersonating a browser. Measured against
 * ENCODE on 2026-08-02, correcting the ADR as written: `Origin` alone decides the challenge, and a
 * spoofed Chrome User-Agent is actively harmful. With an allowlisted Origin, an honest UA, a
 * Firefox UA and no UA at all all return 307; `Chrome/126.0.0.0` returns **502** from awselb, with
 * or without the sec-ch-ua hints. The bot challenge itself fires on a browser UA with a
 * non-allowlisted Origin — which is what made the header set look load-bearing.
 *
 * The Sec-Fetch-* trio is what a browser's own cross-origin fetch would send and is verified
 * harmless; it stays so the proxied request resembles the request being stood in for.
 *
 * A host whose gate wants something else overrides it in CHALLENGED_HOSTS, next to the rule that
 * decides the host is claimed at all. The two known gates want opposite User-Agents, so this can
 * never be one global set again.
 */
const REQUEST_HEADERS = {
    'User-Agent': 'juicebox.js-dev-proxy (+https://github.com/aidenlab/juicebox.js)',
    'Accept': '*/*',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty'
}

/**
 * The rule for a target the client-side mapper never claims. The middleware is generic — targets
 * arrive from session files and user paste — so an unknown host keeps the behaviour it had before
 * per-host rules existed: the shared header set, with an Origin claimed.
 */
const DEFAULT_RULE = { claimsOrigin: true }

/**
 * @param {URL} target
 * @param {string} origin - the Origin the proxy claims, for hosts whose gate keys on one.
 * @param {object} reqHeaders - the browser's own headers. Only Range is forwarded: its Origin is
 *        the very thing that gets challenged, and its Host and Cookie belong to the dev server.
 * @returns {Record<string, string>}
 */
function requestHeadersFor(target, origin, reqHeaders) {

    const rule = ruleForHost(target.host) || DEFAULT_RULE

    const headers = { ...REQUEST_HEADERS, ...rule.requestHeaders }

    if (rule.claimsOrigin) {
        headers.Origin = origin
    }

    if (reqHeaders?.range) {
        headers.Range = reqHeaders.range
    }

    return headers
}

/**
 * Headers that describe the hop rather than the payload. `fetch` has already decoded the body, so
 * relaying content-encoding or a content-length measured before decoding would describe a body the
 * browser is not going to receive.
 */
const HOP_BY_HOP = new Set([
    'connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length',
    'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer'
])

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * @param {object} [options]
 * @param {string} [options.origin] - the Origin the proxy claims.
 * @returns {(req, res, next) => Promise<void>} connect middleware.
 */
function createProxyMiddleware({ origin = DEFAULT_ORIGIN } = {}) {

    return async function hicProxy(req, res, next) {

        if (!req.url || !req.url.startsWith(PROXY_PREFIX)) {
            return next()
        }

        const target = targetFromProxyPath(req.url)
        const parsedTarget = parseHttpUrl(target)

        if (!parsedTarget) {
            return fail(res, 400, `hic dev proxy: not an absolute http(s) URL — ${target}`)
        }

        const headers = requestHeadersFor(parsedTarget, origin, req.headers)

        let response
        try {
            response = await fetch(target, { method: req.method || 'GET', headers, redirect: 'manual' })
        } catch (e) {
            return fail(res, 502, `hic dev proxy: ${e.message}`)
        }

        // Hand the redirect back rather than following it. The browser fetches the signed S3 URL
        // directly, so the map bytes never cross Node and nothing here can corrupt a
        // 206 Partial Content or its Content-Range — which would break .hic reading outright.
        if (REDIRECT_STATUSES.has(response.status)) {
            const location = response.headers.get('location')
            response.body?.cancel()
            if (!location) {
                return fail(res, 502, 'hic dev proxy: redirect without a Location header')
            }
            res.statusCode = response.status
            res.setHeader('Location', location)
            res.setHeader('Cache-Control', 'no-store')
            return res.end()
        }

        // Anything else is a small payload in practice — a bot challenge page or another error,
        // since the challenged hosts answer a successful read with a redirect. Buffering keeps the
        // relay simple and lets Node set an accurate Content-Length.
        let body
        try {
            body = Buffer.from(await response.arrayBuffer())
        } catch (e) {
            return fail(res, 502, `hic dev proxy: ${e.message}`)
        }
        relayHeaders(response, res)
        res.statusCode = response.status
        res.end(body)
    }
}

function relayHeaders(response, res) {
    for (const [name, value] of response.headers) {
        if (!HOP_BY_HOP.has(name.toLowerCase())) {
            res.setHeader(name, value)
        }
    }
    // The signal that names a bot challenge is a response header, and juicebox reads it off the
    // thrown error to report the failure in plain language. Vacuous when the page and the dev
    // server share an origin, which is the usual case; it costs nothing and covers the setup where
    // they do not.
    res.setHeader('Access-Control-Expose-Headers', '*')
    res.setHeader('Cache-Control', 'no-store')
}

function fail(res, statusCode, message) {
    res.statusCode = statusCode
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end(message)
}

/**
 * @param {object} [options]
 * @param {string} [options.origin] - the Origin the proxy claims. Defaults to https://aidenlab.org.
 * @returns {import('vite').Plugin}
 */
function devProxy(options = {}) {
    return {
        name: 'juicebox-hic-dev-proxy',
        apply: 'serve',
        configureServer(server) {
            server.middlewares.use(createProxyMiddleware(options))
        }
    }
}

export { devProxy, createProxyMiddleware, DEFAULT_ORIGIN }
export default devProxy
