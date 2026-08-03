/**
 * The URL mapper — the function juicebox applies to a data URL before it is fetched: handed to
 * hic-straw as `config.mapUrl` for a .hic read, and applied here for track reads.
 *
 * It exists so development against an origin-restricted data host does not require patching global
 * fetch. juicebox.js cannot decide for itself whether it is running in development: consumers
 * install it from git, npm runs `prepare` -> `vite build`, and `import.meta.env.DEV` is baked to
 * false in the resulting dist at *juicebox.js's* build time. The switch has to be thrown from
 * outside, by the host app:
 *
 *     if (import.meta.env.DEV) hic.setUrlMapper(devMapUrl)
 *
 * Unset by default. A host app that never calls setUrlMapper behaves exactly as it did before this
 * seam existed. See docs/adr/0001-dev-proxy-for-waf-protected-hosts.md.
 */

let urlMapper

/**
 * Register the mapper applied to every subsequent data read. Called once at host-app startup.
 *
 * @param {(url: string) => string} [mapper] - synchronous, pure, URL in / URL out. Pass undefined
 *        to clear.
 */
function setUrlMapper(mapper) {
    urlMapper = mapper
}

/**
 * @returns {((url: string) => string) | undefined} the registered mapper, or undefined.
 */
function getUrlMapper() {
    return urlMapper
}

/**
 * Apply the registered mapper to a single URL. The place to reach for at a juicebox-owned fetch
 * site, where the mapped value is used and immediately discarded — nothing persists it.
 *
 * Non-string input (a `File`, an undefined `indexURL`) is returned untouched rather than handed to
 * the mapper, so a mapper only ever has to reason about URLs.
 *
 * @param {*} url
 * @returns {*} the mapped URL, or the input unchanged when no mapper is registered.
 */
function mapUrl(url) {
    const mapper = getUrlMapper()
    return mapper && typeof url === 'string' ? mapper(url) : url
}

/**
 * The field carrying a track config's pre-mapping URLs. igv.js reads a track's URLs from its config
 * and there is no seam inside its loaders (issue #450), so the only lever juicebox has over an igv
 * read is what it hands over. Those rewritten values must never escape into a saved session, so the
 * originals travel alongside them and `HICBrowser.toJSON` serializes those instead.
 *
 * Every URL the mapper rewrites is stashed, `indexURL` included — nothing serializes an `indexURL`
 * today, but a rewrite whose original cannot be recovered is exactly the leak this field exists to
 * prevent, and half an invariant is worse than none.
 */
const UNMAPPED_URLS = 'unmappedUrls'

/**
 * Map the URLs of a track config bound for igv, preserving the originals.
 *
 * Returns the config unchanged — the same object, not a copy — when no mapper is registered or when
 * the mapper claims neither URL, which keeps the no-mapper path (every production host app)
 * byte-for-byte what it was.
 *
 * @param {object} config - a 1D track config.
 * @returns {object} the config to hand to igv.
 */
function mapTrackConfig(config) {

    const url = mapUrl(config.url)
    const indexURL = mapUrl(config.indexURL)

    if (url === config.url && indexURL === config.indexURL) {
        return config
    }

    const mapped = {...config, url, [UNMAPPED_URLS]: {url: config.url, indexURL: config.indexURL}}

    // Assigned only when there was one to begin with — an `indexURL: undefined` key that the
    // caller never wrote is a change to the config igv sees, however inert it looks.
    if (indexURL !== config.indexURL) {
        mapped.indexURL = indexURL
    }

    return mapped
}

/**
 * The URL a track config should be serialized with: the original, whenever mapTrackConfig rewrote
 * one. Safe on any config, mapped or not.
 *
 * @param {object} config
 * @returns {*} the pre-mapping url.
 */
function unmappedUrl(config) {
    return Object.hasOwn(config, UNMAPPED_URLS) ? config[UNMAPPED_URLS].url : config.url
}

export { setUrlMapper, getUrlMapper, mapUrl, mapTrackConfig, unmappedUrl }
