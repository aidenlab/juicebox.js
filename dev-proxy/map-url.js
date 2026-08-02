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
 * Hosts that answer a non-allowlisted Origin with a bot challenge. Adding a host here and nothing
 * else is the whole fix for the next one that starts challenging.
 */
const CHALLENGED_HOSTS = new Set(['www.encodeproject.org'])

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

    return parsed && CHALLENGED_HOSTS.has(parsed.host) ? toProxyPath(url) : url
}

export { devMapUrl, parseHttpUrl, toProxyPath, targetFromProxyPath, PROXY_PREFIX }
