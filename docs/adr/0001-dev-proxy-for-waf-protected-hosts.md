# ADR-0001 — Dev-time proxy for data hosts that refuse a browser

**Status:** Accepted
**Last measured:** 2026-08-05
**Depends on:** hic-straw `docs/adr/0001-transport-extension-points.md`

This describes the current state. Earlier revisions carried a running history of
amendments and two premises that measurement later overturned; both are gone.
Anything not here is in the git history.

## Context

**`hicfiles.s3.amazonaws.com` and `dnazoo.s3.amazonaws.com`** refuse the request a
browser makes. They serve `403` unless
the `User-Agent` starts with `IGV` — a case-sensitive prefix match, measured
2026-08-03. `IGV`, `IGVX`, `IGV/2.19.1` and `IGV-dev-proxy` all pass; `igv`,
`Juicebox`, every browser value and an empty `User-Agent` are refused.

**A browser cannot satisfy that gate**, because it cannot set `User-Agent`.
Measured 2026-08-04: `fetch` and `XMLHttpRequest` both send the browser's own value
whatever the caller asks for. So there is no client-side fix — only a request made
from something that is not a browser.

**`www.encodeproject.org`** was the second gate, and is no longer one. It sits
behind AWS WAF, and a rule there once challenged browser-looking requests from
domains ENCODE had not approved, answering with a CAPTCHA page under a misleading
`405` and `X-Amzn-Waf-Action: captcha`. That rule is gone. Measured 2026-08-05 on
`@@download` reads of both `.bigWig` and `.hic` files: `307` to signed S3 —
followed, `206` — for `Origin: https://aidenlab.org`, for `http://localhost:3000`,
for a stranger's domain and for no `Origin`, under browser and non-browser
`User-Agent` alike. No CAPTCHA header, no `405`, from any combination.

ENCODE stays in `CHALLENGED_HOSTS` regardless. The entry is one line, the extra hop
is dev-only, and a WAF rule that was switched on once can be switched on again;
routing it costs nothing and means the next time it happens nothing breaks. The
CAPTCHA branch in `presentError` stays for the same reason.

One measurement is unresolved and not worth resolving: a spoofed Chrome
`User-Agent` draws `502` from awselb from *every* origin, including an approved
one, while spoofed Firefox and Safari values are served. Read as the WAF catching a
UA that contradicts its TLS fingerprint — curl claiming to be Chrome. Confirming
that would need a real browser at a real non-`localhost` origin. It does not change
anything here: development against ENCODE works, proxied or direct.

Ruled out during diagnosis, do not re-investigate: bucket permissions differing by
requester; CORS on the data hosts (all return `Access-Control-Allow-Origin: *`);
preflight failure; a juicebox.js regression.

That CORS finding covers the hosts serving `.hic` bytes, and only those. It does
not generalise to every host a consumer fetches from: `aidenlab.org`, which
served juicebox-web's contact-map menu, returned no `Access-Control-Allow-Origin`
at all — measured 2026-08-05, zone-wide, for every origin and every path, so the
menu was empty anywhere but production. That was juicebox.js#444, transferred to
juicebox-web#56 because nothing in this repo referenced the file, and fixed there
by serving the menu from the app rather than fetching it cross-origin. Check the
host in front of you rather than assuming this line covers it.

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

An honest `User-Agent` naming itself, and `IGV-juicebox.js-dev-proxy (+…)` for the
two buckets — the prefix satisfies the gate without claiming to *be* IGV.

**No `Origin` is claimed for any of the three.** It bought nothing even when
ENCODE's gate was live, and not claiming one means a developer outside aidenlab is
not made to assert aidenlab's identity from their own machine. `DEFAULT_RULE` still
claims one for a host with no rule of its own, which is unmeasured territory either
way.

Do not impersonate a browser: a spoofed Chrome `User-Agent` draws `502` from awselb
from every origin, approved or not.

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
  still cannot read the two buckets, and only an AWS-side change fixes that.
- ENCODE is no longer part of that story. Since the WAF rule lapsed, a deployed app
  on any domain reads ENCODE directly; the consumers no longer depend on being
  served from `aidenlab.org` for it.
- The list of proxied hosts must be maintained. The next host that starts refusing
  is a fresh mystery until someone adds it — mitigated by the legible error.

## Reversal

A **workaround with an expiry condition**, and half of it has already expired:
ENCODE's `@@download` endpoints are open again as of 2026-08-05. That alone does
not retire anything — ENCODE stays in `CHALLENGED_HOSTS` as a precaution, see
Context.

The live condition is the `IGV` prefix requirement on the two buckets. Those are
this project's own buckets, so lifting it needs AWS access rather than a commit.
When it is lifted, **delete `dev-proxy/` entirely** along with its `exports`
entries and both host apps' two lines.

`setUrlMapper` and the hic-straw extension points may stay; they are generic and
cost nothing. The legible-error change should outlive the reversal.

## Related

Issues #440 (proxy), #450 (track reads), #451 (per-host headers), #455 (the
`Origin` claim and the measurements above).
