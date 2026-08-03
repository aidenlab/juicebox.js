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

*(Superseded by the 2026-08-03 amendment on track reads, below — it bit.)*

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

## Amendment, 2026-08-03 — a second gate, and the proxy becomes a data path

Issue #451. Adopting the proxy across `dev/` turned up hosts that refuse a
browser for an entirely different reason, and accommodating them changes one of
the properties claimed above.

### The gate

`hicfiles.s3.amazonaws.com` and `dnazoo.s3.amazonaws.com` gate on `User-Agent`.
It is an allowlist matched **case-sensitively against the start of the string**,
measured 2026-08-03 against `combined_peaks.txt`, every value probed twice:

| `User-Agent` | Result |
|---|---|
| `IGV`, `IGVX`, `IGV/2.19.1`, `IGV-dev-proxy` | 200 |
| `python-requests`, `python-requests/2.31`, `python-requests/9.9` | 200 |
| `igv` (lowercase), `IG`, `aIGV`, `python`, `requests` | 403 |
| `Juicebox`, `juicebox.js-dev-proxy IGV`, `foo`, `x` | 403 |
| `Mozilla/5.0`, `Mozilla`, `AppleWebKit`, `Safari`, `curl/8.7.1` | 403 |
| *(absent)* | 403 |

No browser can satisfy this: `User-Agent` is a forbidden header name in the Fetch
spec, so the `IGV` value hic-straw and igv.js set is silently dropped. curl and
Node succeed; the browser cannot. Upstream: aidenlab/hic-straw#46.

CORS is **not** a factor here and should not be re-investigated — with an
`Origin` present these buckets return `Access-Control-Allow-Origin: *` on both
200 and 206, for `localhost:3000` and `aidenlab.org` alike. This is unrelated to
#444, which concerns `hicfiles.json` on a different host.

### What changed

Request headers are now a **per-host** property, declared in `CHALLENGED_HOSTS`
next to the rule that decides a host is claimed at all. This had to stop being
one global set: the two gates want opposite things, and the `IGV` prefix that
fixes these buckets would sit alongside an `Origin` the other gate reads. An
unclaimed host keeps the original header set unchanged.

The proxy sends `IGV-juicebox.js-dev-proxy (+…)`. The prefix is what the gate
reads; the remainder keeps faith with "assert only your own identity" above —
the proxy satisfies the allowlist without claiming to *be* IGV, which the
measurements show is unnecessary.

### The property this costs

**"Only the small redirect request crosses Node; the map bytes do not" is no
longer true for every host.** It remains true for ENCODE, which answers with a
`307` to signed S3. These buckets serve the object **directly** — `206`,
`Content-Range`, no `Location`. There is nothing to redirect to, so for them the
dev server really is the data path and every ranged read is relayed through it.
`combined.hic` there is 11.7 GB; a session touches only ranges of it, but all of
them cross Node.

Accepted knowingly, dev-only, and preferred over the alternative: these are the
project's own buckets, so the honest fix is to loosen the gate at the host — but
that needs AWS admin access rather than a commit, and would not help anyone
running an older juicebox. The relay must therefore never buffer a whole object,
and must preserve status and `Content-Range` exactly.

### Not claimed

Path-style addressing of the same buckets (`s3.amazonaws.com/hicfiles/…`) is
left fetching directly. The rule is host-scoped, and that endpoint serves every
bucket without a vhost name; claiming it would route strangers' data through the
dev server. A fixture using the path-style form stays unreachable in development
— repoint it at the vhost form.

## Amendment, 2026-08-03 — the mapper reaches track reads

Issue #450. The scope above — `.hic` only — did not survive first contact: an
ENCODE-hosted map loads while an ENCODE-hosted 1D track from the same session
does not. The proxy middleware was never the problem; it is host-generic and
already serves a bigWig correctly. Nothing routed track reads into it.

The two track transports need different treatment, and the difference is the
whole substance of this amendment.

**2D annotations** are read by juicebox itself, at `Track2D.loadTrack2D`. Our
call site, so the mapper is applied **at the fetch**: the mapped URL is used and
discarded, `config.url` stays original, and `toJSON` needs no change at all.

**1D tracks** are handed to `igv.createTrack` and read by igv's own bundled
`igvxhr`, whose URL rewriting is a module-private function — `igv.esm.js` ships
three copies of it, so patching the `igv-utils` dependency does not reach them.
`igv.setCORSProxy` cannot substitute: its retry is gated on `xhr.status === 0`
or `onerror`, and ENCODE's `405` carries valid CORS headers, so `onload` runs and
goes straight to the error path. The retry is never reached.

That leaves exactly one lever — **the `url` in the config igv is handed**. So for
1D tracks the rewrite is config-time, which is the thing the `.hic` path was able
to avoid.

### The constraint that shapes it

`HiCBrowser.toJSON` copies `config.url` verbatim. A config-time rewrite with no
counterpart would therefore bake `/__hic-proxy/…` into **saved sessions** —
a session saved in development would not load in production, and would name a
machine that is not there. Any config-time mapping owes a matching un-map on
serialization.

`mapTrackConfig` writes the mapped URLs onto a **copy** of the config and carries
the original in `unmappedUrl` alongside; `toJSON` reads through `unmappedUrl`.
When no mapper is registered, or the mapper claims neither URL, the very same
config object is returned — the no-mapper path, which is every production host
app, is unchanged rather than merely equivalent.

### Not done here

Gene search and session-file loading also read through juicebox's own `igvxhr`
and would take the same one-line treatment as the 2D path. Neither was implicated,
so neither was touched.

The honest fix is upstream: a pre-fetch URL mapper in igv.js, composed on top of
its built-in rewrites, filed as igvteam/igv.js#2088. If that lands, the 1D half
here collapses into registering the same mapper with igv and deleting the config
stash and the `toJSON` un-map. The 2D half stays either way — that call site is
ours.

## Reversal

This is a **workaround with an expiry condition**, unlike the hic-straw ADR it
depends on. If ENCODE exempts the `@@download` endpoints from the CAPTCHA rule,
or allowlists localhost origins, **delete `dev-proxy/` entirely** along with its
`exports` entries and both host apps' two lines. `setUrlMapper` and the hic-straw
extension points may stay — they are generic and cost nothing.

The legible-error change is not part of that reversal and should outlive it.
