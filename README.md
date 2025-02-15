# juicebox.js

juicebox.js is an embeddable interactive contact map viewer for .hic files written in JavaScript and CSS. It is based 
on the desktop Juicebox visualization application. 

# Installation

Requirements:

* [Font Awesome CSS](https://fontawesome.com/) 

    ```<link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/font-awesome/4.2.0/css/font-awesome.min.css">```

* Juicebox CSS

    ``` <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/juicebox.js@2.4.8/dist/css/juicebox.css">```
    
* Juicebox javascript -- see below


To import juicebox as an ES6 module

```javascript
import juicebox from "https://cdn.jsdelivr.net/npm/juicebox.js@2.4.8/dist/juicebox.esm.js";
``` 

Or as a script include (defines the "juicebox" global)

```html
<script src="https://cdn.jsdelivr.net/npm/juicebox.js@2.4.8/dist/juicebox.min.js"></script>
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

Configuration ```config``` object examples follow

* A minimal juicebox config containing only a hic map with all default settings (see [examples/juicebox-minimal](https://github.com/igvteam/juicebox.js/blob/master/examples/juicebox-minimal.html)): 

```
   const config = {
       "url": "https://hicfiles.s3.amazonaws.com/hiseq/gm12878/dilution/combined.hic",    
   }

```




* Juicebox config with contact map, gene annotations, CTCF wig track, and 2D annotations (see [examples/juicebox.html](https://github.com/igvteam/juicebox.js/blob/master/examples/juicebox.html)):




```
   const config = {
            "url": "https://hicfiles.s3.amazonaws.com/hiseq/gm12878/dilution/combined.hic",
            "name": "Combined",
            "locus": "18:28,504,357-29,748,974 18:28,504,357-29,748,974",
            "normalization": "VC_SQRT",
            "backgroundColor": "255,255,255",
            "colorScale": "60,255,0,0",
            "tracks": [
                {
                    "url": "https://www.encodeproject.org/files/ENCFF144KUK/@@download/ENCFF144KUK.bigWig",
                    "type": "wig",
                    "format": "bigwig",
                    "name": "Homo sapiens GM12878 CTCF "
                    "color": "green"
                },
                {
                    "url": "https://hgdownload.soe.ucsc.edu/goldenPath/hg19/database/ncbiRefSeq.txt.gz",
                    "type": "annotation",
                    "format": "refgene",
                    "name": "Refseq Genes",
                },
                {
                    "url": "https://hicfiles.s3.amazonaws.com/hiseq/gm12878/in-situ/combined_peaks.txt",
                    "name": "Rao & Huntley et al. | Cell 2014 | GM12878 combined loops"
                },
                {
                    "url": "https://hicfiles.s3.amazonaws.com/hiseq/hap1/in-situ/combined_peaks.txt",
                    "name": "Sanborn & Rao et al. | PNAS 2015 | Hap1 loops",
                    "color": "#fffa03",
                    "displayMode": "upper"
                },
                {
                    "url": "https://hicfiles.s3.amazonaws.com/external/mumbach/GSE80820_HiChIP_GM_cohesin_peaks.txt",
                    "name": "Mumbach Rubin Flynn et al. | Nature Methods 2016 | GM12878 cohesin combined loops",
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


