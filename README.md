# juicebox.js

juicebox.js is an embeddable interactive contact map viewer for .hic files written in JavaScript and CSS. It is based 
on the desktop Juicebox visualization application. 

# Installation

Requirements:

* [Font Awesome CSS](https://fontawesome.com/) 

    ```<link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/font-awesome/4.2.0/css/font-awesome.min.css">```

* Juicebox CSS

    ``` <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/juicebox.js@3.6.2/dist/css/juicebox.css">```
    
* Juicebox javascript -- see below


To import juicebox as an ES6 module

```javascript
import juicebox from "https://cdn.jsdelivr.net/npm/juicebox.js@3.6.2/dist/juicebox.esm.js";
``` 

Or as a script include (defines the "juicebox" global)

```html
<script src="https://cdn.jsdelivr.net/npm/juicebox.js@3.6.2/dist/juicebox.min.js"></script>
```   
 
Alternatively you can install with npm  
 
 ```npm install juicebox```

and source the appropriate file for your module system (juicebox.min.js or juicebox.esm.js) in node_modules/juicebos.js/dist.  Or build from source (see Development section below).

# Usage

To create an juicebox instance call ```juicebox.init``` with a container div  and an initial configuration object as 
illustrated below.   

```javascript
   juicebox.init(container, config)
       .then(function (hicBrowser) {
            console.log("Juicebox loaded");
        })

```

`init` resolves to a single browser, or to an array of them when the
configuration is a session naming several.

Multiple juicebox instances can share a page, one per container div. Each
container owns a **browser registry**: its browsers, which of them is current,
and their sync group. Initializing a second container leaves the first one
alone. Call ```juicebox.initRegistry``` instead of ```juicebox.init``` to be
handed that registry rather than its browsers.

```javascript
   const registry = await juicebox.initRegistry(container, config)

   registry.browsers        // this embed's browsers
   registry.currentBrowser  // the one selected in this embed
```

A registry is also reachable from any browser as ```browser.registry```. The
zero-argument ```juicebox.getCurrentBrowser()``` and
```juicebox.getAllBrowsers()``` are page-wide conveniences that follow whichever
embed was most recently selected — with two embeds on a page, ask a registry.

Configuration ```config``` object examples follow

* A minimal juicebox config containing only a hic map with all default settings (see [examples/juicebox-minimal](https://github.com/igvteam/juicebox.js/blob/master/examples/juicebox-minimal.html)): 

```
   const config = {
       "url": "https://www.encodeproject.org/files/ENCFF718AWL/@@download/ENCFF718AWL.hic",    
   }

```




* Juicebox config with contact map, gene annotations, CTCF wig track, and 2D annotations (see [examples/juicebox.html](https://github.com/igvteam/juicebox.js/blob/master/examples/juicebox.html)):




```
   const config = {
            "url": "https://www.encodeproject.org/files/ENCFF718AWL/@@download/ENCFF718AWL.hic",
            "name": "GM12878 in situ combined",
            "locus": "18:28,504,357-29,748,974 18:28,504,357-29,748,974",
            "normalization": "VC_SQRT",
            "backgroundColor": "255,255,255",
            "colorScale": "60,255,0,0",
            "tracks": [
                {
                    "url": "https://www.encodeproject.org/files/ENCFF144KUK/@@download/ENCFF144KUK.bigWig",
                    "type": "wig",
                    "format": "bigwig",
                    "name": "Homo sapiens GM12878 CTCF",
                    "color": "green"
                },
                {
                    "url": "https://hgdownload.soe.ucsc.edu/goldenPath/hg19/database/ncbiRefSeq.txt.gz",
                    "type": "annotation",
                    "format": "refgene",
                    "name": "Refseq Genes",
                },
                {
                    "url": "https://raw.githubusercontent.com/igvteam/igv-data/refs/heads/main/data/test/bedpe/GM12878_loops.bedpe",
                    "name": "Rao & Huntley et al. | Cell 2014 | GM12878 loops",
                    "color": "#fffa03",
                    "displayMode": "upper"
                },
                {
                    "url": "https://raw.githubusercontent.com/igvteam/igv-data/refs/heads/main/data/test/bedpe/GSM1872886_GM12878_CTCF_PET.bedpe.txt",
                    "name": "Tang et al. | Cell 2015 | GM12878 CTCF ChIA-PET",
                    "color": "#000000",
                    "displayMode": "lower"
                }
            ]
        }
```



# API

The juicebox.init function returns a promise for a HICBrowser object.  This object exposes
functions for interacting with the viewer including

* loadHicFile({url: urlString, name: string})
* loadTracks([array of track configs...])

For a description of track configurations see the documentation for [igv.js](https://github.com/igvteam/igv.js/wiki).
Example of a basic track configuration object:

See [examples/juicebox-api.html](https://github.com/igvteam/juicebox.js/blob/master/examples/juicebox-api.html) 
for an example of using the API to load hicfiles and tracks.


# Development

## Requirements

Building juicebox.js requires Linux or MacOS, and  [node.js](https://nodejs.org/).

Other Unix environments will probably work but have not been tested.  Windows users can use [Windows Subsystem for Linux](https://docs.microsoft.com/en-us/windows/wsl/install-win10).

## Building

```
git clone https://github.com/igvteam/juicebox.js.git
cd juicebox.js
npm install
npm run build
```

## Dev Server & Dashboard

juicebox.js is designed to be embedded in a host application (e.g., [Juicebox-web](https://github.com/aidenlab/juicebox-web)), so it does not run standalone. To give developers a quick way to see the library in action and to aid in debugging, a lightweight Vite dev server is included with a launch dashboard.

```
npm run dev
```

This opens a dashboard at `http://localhost:3000` with links to all available pages, organized into two sections:

- **Examples** — Minimal, stripped-down pages that demonstrate juicebox.js features and API usage, giving developers a quick look and feel without the overhead of a full host application.
- **Dev Files** — Test harnesses for developing and debugging specific features such as live contact maps, 2D annotations, normalization, and bug reproductions.

Note: The Vite dev server is required because the source files use bare npm import specifiers and SCSS, which browsers cannot resolve from a plain static file server.

## Loading maps from hosts that refuse a browser

Some data hosts refuse the request a browser is able to make, so their maps cannot be loaded in development without help. One gate is live today:

- **A `User-Agent` allowlist** — `hicfiles.s3.amazonaws.com` and `dnazoo.s3.amazonaws.com` serve `403` unless the request carries an allowlisted `User-Agent`. No browser can comply: `User-Agent` is a forbidden header name in the Fetch spec, so the value the client libraries set is dropped before the request leaves.

`www.encodeproject.org` is also routed through the proxy, but as a precaution rather than a live need: as of 2026-08-05 it serves `@@download` reads to any origin, so ENCODE maps and tracks load in development either way. It stays in the table because AWS WAF rules there have been switched on before and the entry costs one line.

`dev-proxy/` is a **development-only** workaround: a Vite plugin that refetches the file from Node, where those headers are ours to set, plus the client-side rule that decides which hosts get routed that way. It is already wired into this repo's dev server — see `dev/encode-dev-proxy.html`. In a host application:

```js
// vite.config.js
import { devProxy } from 'juicebox.js/dev-proxy/plugin'

export default defineConfig({ plugins: [devProxy()] })
```

```js
// app startup
import hic from 'juicebox.js'
import { devMapUrl } from 'juicebox.js/dev-proxy/map-url'

if (import.meta.env.DEV) hic.setUrlMapper(devMapUrl)
```

`devProxy()` takes an `origin` option (default `https://aidenlab.org`) — the `Origin` the proxy claims for hosts whose gate keys on one. Set it to a domain you actually control.

Which hosts get routed, and what headers each is sent, are declared together in `CHALLENGED_HOSTS` in `dev-proxy/map-url.js`. Adding the next such host is an entry there and nothing else. Every other host keeps fetching directly, so a genuine CORS or permissions problem still surfaces in development exactly as it would in production.

For the `Origin`-challenged host the proxy hands the redirect back and the file streams to the browser from storage directly. The `User-Agent`-gated buckets serve their objects with no redirect to hand back, so for those the dev server relays the bytes.

`apply: 'serve'` means the plugin can never enter a production build, and `setUrlMapper` is unset by default: a host app that never calls it behaves exactly as before.

The mapper covers `.hic` reads through hic-straw, 2D annotations, and 1D tracks read by igv. A 1D track is the awkward one: igv reads it through its own bundled loaders, which juicebox cannot reach into, so the mapped URL has to go into the config igv is handed. It never escapes from there — `browser.toJSON()` serializes the original, so a session saved in development loads in production. Still uncovered: gene search and session-file reads. Details and measurements: `docs/adr/0001-dev-proxy-for-waf-protected-hosts.md`.

This creates a dist folder with the following files

* juicebox.js - ES5 compatible file.  A script include will define the "juicebox" global.
* juicebox.min.js - minified version of juicebox.js
* juicebox.esm.js --  ES6 module 
* css -- folder containing required css file **juicebox.css** and associated images


# Supported Browsers

juicebox.js require a modern web browser with support for Javascript ECMAScript 2015. 


# Juicebox-web

For an out-of-the box web application for viewing and sharing contact maps from .hic files see
[Juicebox-web](https://github.com/igvteam/juicebox-web), a web application embedding a juicebox.js viewer. 


# License


juicebox.js is [MIT](/LICENSE) licensed.


