# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Juicebox.js is an interactive contact map viewer for Hi-C (chromosome conformation capture) data visualization. It's a JavaScript/CSS library based on the desktop Juicebox application. It renders Hi-C contact matrices on canvas with support for gene annotations, CTCF tracks, 2D annotations, and multi-browser synchronization.

## Build & Development Commands

```bash
npm run dev        # Start Vite dev server (port 3000, opens dashboard.html)
npm run build      # Production build (ES module + UMD to dist/)
npm run preview    # Preview production build
npm test           # Run tests with Vitest (watch mode)
npm run test:run   # Run tests once (CI mode)
npm run test:ui    # Run tests with interactive UI
```

## Architecture

### Entry Points & Initialization
- `js/index.js` — Public API: `init`, `createBrowser`, `version`, `toJSON`, `restoreSession`, `compressedSession`
- `js/init.js` — `init(container, config)` bootstraps the viewer, parses URL config via `extractConfig()`
- `js/createBrowser.js` — Browser factory; manages global browser list and synchronization

### Core Classes
- `js/hicBrowser.js` — `HICBrowser` is the main component class. Recently refactored to extract concerns into:
  - `js/dataLoader.js` — Handles Hi-C file loading, track loading, normalization vectors
  - `js/renderCoordinator.js` — Coordinates rendering operations
  - `js/browserCoordinator.js` — Explicit component orchestration (coordinator pattern replacing event spaghetti)
  - `js/browserUIManager.js` — Central UI component management
- `js/contactMatrixView.js` — Canvas-based Hi-C matrix renderer with tile caching, pan/zoom, sweep zoom
- `js/hicState.js` — Immutable view state (chr1, chr2, zoom, x, y, pixelSize, normalization)
- `js/hicDataset.js` — Dataset/HiCDataset classes with known genome definitions (hg19, hg38, mm10)

### Event System
- `js/eventBus.js` — Publish/subscribe pattern (global + per-browser buses)
- Events: MapLoad, ControlMapLoad, LocusChange, DatasetChange, NormalizationChange, ColorChange, TrackLoad2D, TrackState2D
- The codebase is transitioning from event-driven updates to the BrowserCoordinator pattern

### Tracks
- 1D tracks via IGV integration (genes, coverage, etc.)
- `js/track2D.js` — 2D annotations (loops, domains)
- `js/trackPair.js` / `js/trackRenderer.js` — Track rendering

### UI Widgets (in `js/`)
Key widgets: `chromosomeSelector.js`, `hicLocusGoto.js`, `normalizationWidget.js`, `hicResolutionSelector.js`, `hicColorScaleWidget.js`, `annotationWidget.js`, `controlMapWidget.js`, `scrollbarWidget.js`

### URL & Session
- `js/urlUtils.js` — Encodes/decodes state in URL params (hicUrl, state, colorScale, tracks, session)
- `js/session.js` — Session save/restore/compression

## Build System

- **Vite** with custom `vite-plugin-version.js` that injects package version into `js/version.js` at build time
- Output: `dist/juicebox.esm.js` (ES module) and `dist/juicebox.min.js` (UMD, minified)
- CSS: SCSS (`css/juicebox.scss`) compiled to `dist/css/juicebox.css`
- ES modules throughout (`"type": "module"` in package.json); imports use bare specifiers

## Testing

- **Vitest** with Node.js environment; setup in `test/setup.js`
- Tests in `test/test*.js`; mocks/utilities in `test/utils/`
- Test data fixtures in `test/data/`

## Key Dependencies

- **hic-straw** (aidenlab, spacewalk-extensions branch) — Hi-C file parsing and live contact maps
- **igv** / **igv-ui** / **igv-utils** (igvteam) — Genome browser visualization components
- **google-utils** (igvteam) — Google Drive/Sheets integration

## Active Refactoring

The codebase is undergoing a refactoring to break down the HICBrowser "god object" pattern. Key changes:
- Extracting DataLoader, RenderCoordinator, BrowserCoordinator as separate classes
- Replacing event-driven updates with explicit coordinator orchestration
- Refactoring notes in `notes/hic-browser-refactor-0.md`

## Development Resources

- `dashboard.html` — Dev portal listing examples and test harnesses
- `dev/` — Test harnesses for features and bug reproduction
- `docs/url.md` — URL parameter format documentation
- `docs/EXTERNAL_PROJECT_INTEGRATION.md` — Multi-root workspace setup with Spacewalk
