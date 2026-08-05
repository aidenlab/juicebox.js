/**
 * The client-side half of the dev proxy: the URL mapper a host app registers in development.
 *
 *     import hic from 'juicebox.js'
 *     import { devMapUrl } from 'juicebox.js/dev-proxy/map-url'
 *
 *     if (import.meta.env.DEV) hic.setUrlMapper(devMapUrl)
 *
 * Only hosts known to answer with a bot challenge are rewritten. Every other host keeps fetching
 * directly, so a genuine CORS or permissions problem still surfaces in development exactly as it
 * would in production — routing everything through Node would hide precisely the class of bug this
 * library exists to hit.
 *
 * Note the asymmetry with the middleware in plugin.js, which is generic: proxy targets arrive from
 * session files and user paste and cannot be enumerated. Only this rule is host-scoped.
 *
 * See docs/adr/0001-dev-proxy-for-waf-protected-hosts.md.
 */

/**
 * The User-Agent the gated buckets accept. Their allowlist is a case-sensitive **prefix** match,
 * measured 2026-08-03: `IGV`, `IGVX` and `IGV-dev-proxy` are all served, while `igv`, `Juicebox`,
 * every browser value and an empty User-Agent are refused. The prefix is what the gate reads; the
 * rest is there so the request still says who is really asking. See issue #451.
 */
const IGV_PREFIXED_USER_AGENT = 'IGV-juicebox.js-dev-proxy (+https://github.com/aidenlab/juicebox.js)'

/**
 * What the proxy must do differently for one host.
 *
 * @typedef {object} HostRule
 * @property {boolean} [claimsOrigin] - assert the proxy's configured Origin, for a gate that keys
 *           on one. The value itself is the plugin's to supply, not this module's.
 * @property {Record<string, string>} [requestHeaders] - headers that override the shared set.
 */

/**
 * Hosts that refuse the request a browser is able to make, and what the proxy must do differently
 * for each. Adding a host here and nothing else is the whole fix for the next one.
 *
 * Two gates are known, and they want opposite things — which is why the header set is a property
 * of the host rather than one constant for every target:
 *
 *   ENCODE           AWS WAF challenging browser traffic from a domain ENCODE has not approved.
 *                    Nothing to override: a request that does not claim to be a browser skips that
 *                    check and is served whatever domain it names. The shared header set already
 *                    identifies the proxy honestly, which is the whole of what this host needs.
 *
 *                    Measured 2026-08-04: with the honest User-Agent below, ENCODE returns 307 for
 *                    `Origin: https://aidenlab.org`, for a stranger's domain, for localhost and for
 *                    no Origin at all. So `claimsOrigin` is not set here — it bought nothing, and
 *                    not setting it means a developer outside aidenlab is not made to claim
 *                    aidenlab's identity from their own machine.
 *
 *   `claimsOrigin`   assert the plugin's `origin` option. No host needs it today; it remains for
 *                    DEFAULT_RULE and for a gate that reads `Origin` whatever the caller claims.
 *
 *   `requestHeaders` a `User-Agent` allowlist. `User-Agent` is a forbidden header name in the
 *                    Fetch spec, so no browser can satisfy it however the client library asks;
 *                    Node can. These hosts are not Origin-sensitive, so none is claimed for them.
 *
 * Note the asymmetry with the two gates' response shapes, which matters to the middleware: the
 * Origin-challenged host answers with a redirect to signed storage, so its payload never crosses
 * Node. These buckets serve the object directly, so for them the dev server really is the data
 * path. Ranged reads are relayed as they arrive. See docs/adr/0001.
 */
const CHALLENGED_HOSTS = {
    'www.encodeproject.org': {},
    'hicfiles.s3.amazonaws.com': { requestHeaders: { 'User-Agent': IGV_PREFIXED_USER_AGENT } },
    'dnazoo.s3.amazonaws.com': { requestHeaders: { 'User-Agent': IGV_PREFIXED_USER_AGENT } }
}

/**
 * Host-scoped by design. Path-style addressing of the same gated buckets — `s3.amazonaws.com/
 * hicfiles/…` — is deliberately left alone: that endpoint serves every bucket without a vhost
 * name, so claiming it would route strangers' data through the dev server.
 *
 * `Object.hasOwn` rather than a plain lookup so that a host named after something on
 * `Object.prototype` — `constructor`, `toString` — cannot match a rule that was never declared.
 *
 * @param {string} host
 * @returns {HostRule | undefined}
 */
function ruleForHost(host) {
    return Object.hasOwn(CHALLENGED_HOSTS, host) ? CHALLENGED_HOSTS[host] : undefined
}

/**
 * The middleware's mount point. The target follows it verbatim, so a proxied read is legible in
 * devtools and the middleware can read the target back with a slice.
 */
const PROXY_PREFIX = '/__hic-proxy/'

/**
 * @param {string} url
 * @returns {URL | undefined} the parsed URL, or undefined when it is not an absolute http(s) one —
 *          a relative path, a bare filename, a blob: URL, or something that is not a string at all.
 */
function parseHttpUrl(url) {
    if (typeof url !== 'string') {
        return undefined
    }
    try {
        const parsed = new URL(url)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : undefined
    } catch (e) {
        return undefined
    }
}

/**
 * The one place a proxy path is built, paired with targetFromProxyPath below.
 *
 * @param {string} url - an absolute http(s) URL.
 * @returns {string} the path the dev server's middleware answers on.
 */
function toProxyPath(url) {
    return `${PROXY_PREFIX}${url}`
}

/**
 * @param {string} path - a request path known to start with PROXY_PREFIX.
 * @returns {string} the target URL it names, still to be validated by the caller.
 */
function targetFromProxyPath(path) {
    return path.slice(PROXY_PREFIX.length)
}

/**
 * @param {string} url - the URL hic-straw is about to fetch, after its own default rewrites.
 * @returns {string} the same URL, or a proxy path when the host is known to challenge.
 */
function devMapUrl(url) {

    if (typeof url !== 'string' || url.startsWith(PROXY_PREFIX)) {
        return url
    }

    const parsed = parseHttpUrl(url)

    return parsed && ruleForHost(parsed.host) ? toProxyPath(url) : url
}

export { devMapUrl, parseHttpUrl, toProxyPath, targetFromProxyPath, ruleForHost, PROXY_PREFIX }
