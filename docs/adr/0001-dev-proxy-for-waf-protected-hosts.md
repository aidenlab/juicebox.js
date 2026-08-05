# ADR-0001 — Dev-time proxy for data hosts that refuse a browser

**Status:** Accepted
**Last measured:** 2026-08-04
**Depends on:** hic-straw `docs/adr/0001-transport-extension-points.md`

This describes the current state. Earlier revisions carried a running history of
amendments and two premises that measurement later overturned; both are gone.
Anything not here is in the git history.

## Context

Two data hosts refuse the request a browser makes, for different reasons.

**`www.encodeproject.org`** is behind AWS WAF. A request whose `User-Agent` looks
like a browser is checked against the domains ENCODE has approved — `aidenlab.org`
and `igv.org` are approved — and anything else gets a CAPTCHA page under a
misleading `405`, with `X-Amzn-Waf-Action: captcha` in the response headers. A
background `fetch` cannot solve a CAPTCHA, so the load fails.

**A request that does not claim to be a browser skips that check entirely** and is
served whatever domain it names. Measured 2026-08-04 with the proxy's own honest
`User-Agent`: `307` for `aidenlab.org`, for an unrelated domain, for `localhost`,
and for no `Origin` at all. That exemption is the whole mechanism of the proxy.

**`hicfiles.s3.amazonaws.com` and `dnazoo.s3.amazonaws.com`** serve `403` unless
the `User-Agent` starts with `IGV` — a case-sensitive prefix match, measured
2026-08-03. `IGV`, `IGVX`, `IGV/2.19.1` and `IGV-dev-proxy` all pass; `igv`,
`Juicebox`, every browser value and an empty `User-Agent` are refused.

**A browser cannot satisfy either gate**, because it cannot set `User-Agent`.
Measured 2026-08-04: `fetch` and `XMLHttpRequest` both send the browser's own value
whatever the caller asks for. So there is no client-side fix. The only options are
an approved domain, or a request made from something that is not a browser.

Ruled out during diagnosis, do not re-investigate: bucket permissions differing by
requester; CORS on the data hosts (all return `Access-Control-Allow-Origin: *`);
preflight failure; a juicebox.js regression.

## Decision

Ship a **dev-only** proxy in this repo, built on the hic-straw extension points,
and make the production failure legible.

### Where it lives, and how it is switched on

`dev-proxy/plugin.js` (a Vite plugin, `apply: 'serve'`) and `dev-proxy/map-url.js`
(the client-side rewrite), both exposed through `package.json`. Not a separate
package: juicebox-web and Spacewalk already depend on juicebox.js, so adoption
costs an import rather than a new repo and release cadence.

The host application throws the switch, because juicebox.js cannot detect dev mode
itself — consumers install a build whose `import.meta.env.DEV` was baked to `false`
at *juicebox.js's* build time:

```js
import hic from 'juicebox.js'
import { devMapUrl } from 'juicebox.js/dev-proxy/map-url'

if (import.meta.env.DEV) hic.setUrlMapper(devMapUrl)
```

### What gets rewritten

Only the three hosts above, declared in `CHALLENGED_HOSTS`. Everything else keeps
fetching directly, so a genuine CORS or permissions problem still surfaces in
development exactly as it would in production.

The **middleware** is generic and unpacks arbitrary targets, because targets arrive
from session files and user paste. Only the **client-side rule** is host-scoped.

Path-style addressing of the gated buckets (`s3.amazonaws.com/hicfiles/…`) is
deliberately left alone: that endpoint serves every bucket without a vhost name, so
claiming it would route strangers' data through the dev server.

### What the proxy sends

An honest `User-Agent` naming itself, which is what puts it in ENCODE's exempt
branch, and `IGV-juicebox.js-dev-proxy (+…)` for the two buckets — the prefix
satisfies the gate without claiming to *be* IGV.

**No `Origin` is claimed for any of the three.** It bought nothing, and not
claiming one means a developer outside aidenlab is not made to assert aidenlab's
identity from their own machine. `DEFAULT_RULE` still claims one for a host with no
rule of its own, which is unmeasured territory either way.

Do not impersonate a browser: a spoofed Chrome `User-Agent` draws `502` from awselb
even from an approved domain.

### How redirects are handled

ENCODE answers with a `307` to signed S3, and the proxy **returns that redirect to
the browser** rather than following it. The browser fetches S3 directly, so map
bytes never cross Node and nothing here can corrupt `206 Partial Content` or
`Content-Range` — which would break `.hic` reading outright.

The two buckets have no redirect to hand back. For them the dev server **is** the
data path, and every ranged read is relayed through it — `combined.hic` is 11.7 GB.
Accepted knowingly, dev-only. The relay must never buffer a whole object and must
preserve status and `Content-Range` exactly.

### Coverage

`.hic` reads via hic-straw's `config.mapUrl`; 2D annotations at our own fetch in
`Track2D.loadTrack2D`; 1D tracks by rewriting the `url` in the config handed to
igv, since igv reads those through its own bundled loaders that juicebox cannot
reach into.

The 1D path is the awkward one. A config-time rewrite would otherwise bake
`/__hic-proxy/…` into saved sessions, so `mapTrackConfig` writes mapped URLs onto a
**copy** and carries the originals in `unmappedUrls`; `toJSON` reads through
`unmappedUrl(config)`. With no mapper registered — every production host app — the
very same config object is returned.

Not covered: gene search and session-file loading. Neither was implicated.

### Making the failure legible — the only part that ships to users

`presentError` checks `err.headers` for `x-amzn-waf-action: captcha` and reports
that the data provider's bot protection blocked the request. It does not fix a
third-party embedder's problem, but it stops the failure being a lie.

## Consequences

- Development against these hosts works from localhost, for anyone, with no
  approval needed from ENCODE and nothing aidenlab-specific in the request.
- Adoption is two lines per host app, in dev configuration only.
- Production behaviour is unchanged. **Nothing here makes a deployed app work that
  did not work before** — a third party embedding juicebox.js on their own domain
  is still blocked, and only ENCODE can fix that.
- Both production consumers work *only* because they are served from
  `aidenlab.org`. If either moved domains they would start failing against ENCODE
  the day they moved. Measured, not predicted: a real browser at an unapproved
  domain is challenged exactly as a spoofed one is.
- The list of proxied hosts must be maintained. The next host that starts refusing
  is a fresh mystery until someone adds it — mitigated by the legible error.

## Reversal

A **workaround with an expiry condition**. If ENCODE exempts the `@@download`
endpoints or approves the domains in question, **and** the `IGV` prefix requirement
is lifted on the two buckets — those are this project's own buckets, so that half
needs AWS access rather than a commit — **delete `dev-proxy/` entirely** along with
its `exports` entries and both host apps' two lines. Either alone retires only its
own host from `CHALLENGED_HOSTS`.

`setUrlMapper` and the hic-straw extension points may stay; they are generic and
cost nothing. The legible-error change should outlive the reversal.

## Related

Issues #440 (proxy), #450 (track reads), #451 (per-host headers), #455 (the
`Origin` claim and the measurements above).
