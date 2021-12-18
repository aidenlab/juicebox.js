# juicebox.js

juicebox.js is an embeddable interactive contact map viewer for .hic files written in JavaScript and CSS. It is based 
on the desktop Juicebox visualization application. 

# Installation

Requirements:

* [Font Awesome CSS](https://fontawesome.com/) 

    ```<link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/font-awesome/4.2.0/css/font-awesome.min.css">```

* Juicebox CSS

    ``` <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/juicebox.js@2.2.0/dist/css/juicebox.css">```
    
* Juicebox javascript -- see below


To import juicebox as an ES6 module

```javascript
import juicebox from "https://cdn.jsdelivr.net/npm/juicebox.js@2.2.0/dist/juicebox.esm.js";
``` 

Or as a script include (defines the "juicebox" global)

```html
<script src="https://cdn.jsdelivr.net/npm/juicebox.js@2.2.0/dist/juicebox.min.js"></script>
```   
 
Alternatively you can install with npm  
 
 ```npm install juicebox```

and source the appropriate file for your module system (juicebox.min.js or juicebox.esm.js) in node_modules/juicebos.js/dist.  Or build from source (see Development section below).

# Usage

To create an juicebox instance call ```juicebox.init``` with a container div  and an initial configuration object as 
illustrated below.  See also [examples/juicebox.html](https://github.com/igvteam/juicebox.js/blob/master/examples/juicebox.html) and [examples/juicebox-es6.html](https://github.com/igvteam/juicebox.js/blob/master/examples/juicebox-es6.html).  

```
   const config = {
        url: "https://www.encodeproject.org/files/ENCFF718AWL/@@download/ENCFF718AWL.hic",
        name: "GM12878",
        //locus: "22:33,319,567-36,009,566",   // <= optional initial locus
        tracks: [
            {
                url: "https://www.encodeproject.org/files/ENCFF000ARJ/@@download/ENCFF000ARJ.bigWig",
                name: "CTCF",
                min: 0,
                max: 25,
                color: "#ff8802"
            }
        ]
    }
    const container = document.getElementById("app-container");
    juicebox.init(container, config)
        .then(function (hicBrowser) {
            console.log("Juicebox loaded");
        })

```


The juicebox.init function returns a promise for a HICBrowser object.  This object exposes functions for interacting
with the viewer including

* loadHicFile({url: urlString, name: string})
* loadTracks([array of track configs...])

See [examples/juicebox-api.html](https://github.com/igvteam/juicebox.js/blob/master/examples/juicebox-api.html) for a working example.

For a description of track configurations see the documentation for [igv.js](https://github.com/igvteam/igv.js/wiki). 
Example of a basic track configuration object: 

```
{
   url: "https://www.encodeproject.org/files/ENCFF000ARJ/@@download/ENCFF000ARJ.bigWig",
   name: "CTCF
}
```

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


