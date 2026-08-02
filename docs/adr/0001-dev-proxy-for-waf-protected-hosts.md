# ADR-0001 — Dev-time proxy for WAF-protected data hosts

**Status:** Accepted
**Date:** 2026-08-01
**Depends on:** hic-straw `docs/adr/0001-transport-extension-points.md`

## Context

ENCODE fronts `www.encodeproject.org` with AWS WAF. The WAF inspects the request's
`Origin` header and answers origins that are not on its allowlist with a **CAPTCHA
challenge page**. A background `fetch` cannot solve a CAPTCHA, so the load fails.

The failure surfaces as `405 Method Not Allowed`, which is misleading — it is not
a method problem. The tell is in the response headers:

```
X-Amzn-Waf-Action: captcha
Server: awselb/2.0
Content-Type: text/html          (a challenge page, not the .hic file)
```

Reproduction — same request throughout, varying only `Origin`. A browser-like
`User-Agent` is required to see the challenge at all; plain curl is not
challenged, which is what made this hard to find (but see the 2026-08-02
amendment below — the proxy must **not** send one):

| `Origin` | Result |
|---|---|
| `https://aidenlab.org` | 307 → file served |
| `https://igv.org` | 307 → file served |
| `http://localhost:5173` | 405 + `X-Amzn-Waf-Action: captcha` |
| `http://localhost:8080` | 405 + CAPTCHA |
| *(absent)* | 405 + CAPTCHA |

`Origin` is the deciding factor. `Referer` is irrelevant — an allowlisted
`Referer` with a localhost `Origin` is still challenged; an allowlisted `Origin`
with no `Referer` passes. Note that *absent* is also challenged: any client
speaking to ENCODE must send something.

**What this does and does not break.** `aidenlab.org` and `igv.org` are
allowlisted. Both production consumers — `aidenlab.org/juicebox/` and
`aidenlab.org/spacewalk/` — are served from an allowlisted domain and work today.
What is broken is **local development** (localhost is never allowlisted) and, in
principle, any third party embedding juicebox.js on their own domain. The latter
is not fixable from this repo; only ENCODE can fix it.

Ruled out during diagnosis, do not re-investigate: bucket permissions differing
by requester; CORS misconfiguration on the data hosts (every host returns
`Access-Control-Allow-Origin: *`); preflight failure (DevTools confirms `GET`,
not `OPTIONS`, and preflights return 200); a juicebox.js regression.

## Decision

Ship a **dev-only** proxy in this repo, built on the hic-straw extension points,
and make the production failure legible.

### Where it lives

`juicebox.js/dev-proxy/`, exposed through `package.json` `exports` and `files`:

```
dev-proxy/
  plugin.js    Vite plugin, apply: 'serve'
  map-url.js   the client-side URL rewrite
```

Not a separate package. juicebox-web and Spacewalk already depend on
juicebox.js, so adoption costs an import rather than a new repo, a new npm
release cadence and a third version to keep in step. `apply: 'serve'` means it
can never enter a production build.

### How it is switched on

The host application calls a one-time setter at startup:

```js
import hic from 'juicebox.js'
import { devMapUrl } from 'juicebox.js/dev-proxy/map-url'

if (import.meta.env.DEV) hic.setUrlMapper(devMapUrl)
```

juicebox.js cannot detect dev mode itself. Consumers install it from git, npm
runs `prepare` → `vite build`, and the resulting `dist/juicebox.esm.js` has
`import.meta.env.DEV` baked to `false` at *juicebox.js's* build time. A host
app's own dev mode cannot reach inside that artifact. The switch must be thrown
from outside.

`setUrlMapper` stores a module-scope mapper that `HiCDataset` passes to
`new Straw(config)` as `config.mapUrl`. Unset by default; production behaviour
is unchanged for anyone who never calls it.

### What gets rewritten

**Only hosts known to challenge** — `www.encodeproject.org` today. Every other
host keeps fetching directly, so a genuine CORS or permissions problem still
surfaces in development exactly as it would in production. Routing everything
through Node would hide precisely the class of bug this library exists to hit.

Note the distinction: the **middleware** is generic and unpacks arbitrary target
URLs, because targets arrive from session files and user paste and cannot be
enumerated. Only the **client-side rewrite rule** is host-scoped.

### What Origin the proxy claims

`https://aidenlab.org` by default, **configurable** via a plugin option. It is
this project's own domain and its own allowlist entry, asserted by its own
developers — materially different from borrowing `igv.org`. The option exists so
that anyone outside aidenlab has an honest path rather than silently asserting
someone else's identity, and so there is one place to change if ENCODE widens the
allowlist.

### How redirects are handled

ENCODE answers with a `307` to a signed S3 URL. The proxy **returns that redirect
to the browser** rather than following it server-side. Verified 2026-08-01:

```
GET <s3-target>   Origin: http://localhost:3000
HTTP/1.1 206 Partial Content
Access-Control-Allow-Origin: *
Content-Range: bytes 0-99/2616185406
```

and the signed URL carried `Expires` ≈ 36 hours out. So the browser can fetch S3
directly. Only the small redirect request crosses Node; the map bytes do not.
This keeps the real S3 range-request path under test in development, and removes
any risk of the proxy corrupting `206 Partial Content` or `Content-Range` — which
would break juicebox outright, since `.hic` reading is entirely byte-range based.

### Scope

`.hic` reads through hic-straw only. `igvxhr` (2D tracks, sessions, gene search)
and igv's own 1D track loaders are different transports with no equivalent seam;
covering them would need a second mechanism. Out of scope until it actually bites.

### Making the failure legible — ships to production

`presentError` (`js/utils.js`) already translates HTTP status into human text and
every load failure routes through it. It gains a check on `err.headers` for
`x-amzn-waf-action: captcha`, reporting that the data provider's bot protection
blocked the request and that the serving domain is likely not allowlisted. This
is the only part of this ADR that ships to users, and the only part that helps a
third-party embedder — it does not fix their problem, but it stops the failure
being a lie.

## Consequences

- Development against ENCODE-hosted maps works from localhost.
- Adoption is two lines per host app, in dev configuration only: the plugin in
  the Vite config, the `setUrlMapper` call at dev startup. Needed only in apps
  whose developers load ENCODE maps locally.
- Production behaviour is unchanged everywhere. Nothing about this makes a
  deployed app work that did not work before.
- Both production consumers' safety rests entirely on being served from
  `aidenlab.org`. **If Spacewalk or juicebox-web ever moved to another domain,
  they would start failing against ENCODE the day they moved**, with no code
  change to blame and no proxy to fall back on. That risk is recorded in the
  ENCODE outreach issue.
- The allowlist of proxied hosts must be maintained. The next host that starts
  challenging is a fresh mystery until someone adds it — mitigated by the
  legible error, which names the cause.

## Amendment, 2026-08-02 — the proxy sends an honest User-Agent

Implementing this (issue #440) turned up a measurement that contradicts the
header advice above. Sending an allowlisted `Origin` **and** a spoofed Chrome
`User-Agent` gets `502 Bad Gateway` from `awselb/2.0`. Reproduced with both curl
and Node `fetch`, against `ENCFF718AWL.hic`:

| `Origin` | `User-Agent` | Result |
|---|---|---|
| `https://aidenlab.org` | *(absent)* | 307 → file served |
| `https://aidenlab.org` | `juicebox.js-dev-proxy (+…)` | 307 → file served |
| `https://aidenlab.org` | `Mozilla/5.0 … Firefox/127.0` | 307 → file served |
| `https://aidenlab.org` | `Mozilla/5.0 … Chrome/126.0.0.0 …` | **502** |
| `https://aidenlab.org` | Chrome + `sec-ch-ua` hints | **502** |
| *(absent)* or `http://localhost:3000` | `Mozilla/5.0 … Chrome/126.0.0.0 …` | 405 + `X-Amzn-Waf-Action: captcha` |

So `Origin` alone decides the bot challenge, and the browser-like headers are not
load-bearing — they only made the challenge *visible* during diagnosis, because
the challenge fires on a browser `User-Agent` from a non-allowlisted origin.
Impersonating a specific browser version is the one thing that actively breaks.

The proxy therefore identifies itself as `juicebox.js-dev-proxy`. It keeps the
`Sec-Fetch-*` trio, which is what the browser's own cross-origin fetch would send
and is verified harmless. This also sits better with the reasoning about `Origin`
above: assert only your own identity.

Why the 502 rather than a challenge is a guess — most likely a WAF rule on a
Chrome `User-Agent` unaccompanied by the rest of a real Chrome fingerprint. It is
ENCODE's rule to change, so pin nothing to it beyond "do not impersonate".

## Reversal

This is a **workaround with an expiry condition**, unlike the hic-straw ADR it
depends on. If ENCODE exempts the `@@download` endpoints from the CAPTCHA rule,
or allowlists localhost origins, **delete `dev-proxy/` entirely** along with its
`exports` entries and both host apps' two lines. `setUrlMapper` and the hic-straw
extension points may stay — they are generic and cost nothing.

The legible-error change is not part of that reversal and should outlive it.
