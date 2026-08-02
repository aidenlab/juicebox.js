/**
 * The URL mapper — the function juicebox hands to hic-straw as `config.mapUrl` to rewrite a .hic
 * URL before it is fetched.
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
 * Register the mapper applied to every subsequent .hic read. Called once at host-app startup.
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

export { setUrlMapper, getUrlMapper }
