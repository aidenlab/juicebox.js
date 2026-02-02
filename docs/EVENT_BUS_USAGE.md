# Event Bus Usage Documentation

## Overview

After migrating to the BrowserCoordinator pattern, the event bus is now used primarily for **cross-browser synchronization** and a few specific component-to-component communications. Internal orchestration is handled explicitly by `BrowserCoordinator`.

## Events Still Posted to Event Bus

### Cross-Browser Synchronization Events

These events are posted to `EventBus.globalBus` for synchronizing multiple browser instances:

- **`GenomeChange`** - Posted when genome changes (in `dataLoader.js`)
- **`TrackXYPairLoad`** - Posted when track pairs are loaded (in `layoutController.js`)
- **`TrackXYPairRemoval`** - Posted when track pairs are removed (in `layoutController.js`)
- **`BrowserSelect`** - Posted when a browser is selected (in `createBrowser.js`)

### Component Communication Events

These events are posted to individual browser's `eventBus` for component-to-component communication:

- **`NormalizationChange`** - Posted for cross-browser sync of normalization changes
- **`TrackLoad2D`** - Posted for cross-browser sync of 2D track loading
- **`TrackState2D`** - Posted for cross-browser sync of 2D track state changes
- **`ColorChange`** - Posted for cross-browser sync of color changes
- **`UpdateContactMapMousePosition`** - Posted for cross-browser sync of mouse position
- **`NormVectorIndexLoad`** - Posted for cross-browser sync of normalization vector index loading
- **`NormalizationFileLoad`** - Posted for cross-browser sync of normalization file load status
- **`NormalizationExternalChange`** - Posted for cross-browser sync of external normalization changes
- **`ColorScale`** - Posted for cross-browser sync of color scale changes
- **`DisplayMode`** - Posted for cross-browser sync of display mode changes
- **`DragStopped`** - Posted when drag operation stops (in `contactMatrixView.js`)
- **`DidShowCrosshairs`** - Posted when crosshairs are shown (in `contactMatrixView.js`)
- **`DidHideCrosshairs`** - Posted when crosshairs are hidden (in `contactMatrixView.js`)

## Events Removed (Now Handled by Coordinator)

These events are **no longer posted** to the event bus. Components are updated directly via `BrowserCoordinator`:

- **`MapLoad`** - Removed. Use `coordinator.onMapLoaded()` instead
- **`ControlMapLoad`** - Removed. Use `coordinator.onControlMapLoaded()` instead
- **`LocusChange`** - Removed. Use `coordinator.onLocusChange()` instead

## Migration Notes

### Before (Event Bus Pattern)
```javascript
// Component subscribes to event
this.browser.eventBus.subscribe("MapLoad", this);

// Event posted somewhere
this.browser.eventBus.post(HICEvent("MapLoad", data));
```

### After (Coordinator Pattern)
```javascript
// Coordinator explicitly calls component methods
coordinator.onMapLoaded(dataset, state, datasetType) {
    this.components.contactMatrix.initializeForMap(dataset);
    // ... explicit updates
}
```

## Component Subscriptions

### Active Subscriptions (Still Used)

- **`contactMatrixView.js`**: `NormalizationChange`, `TrackLoad2D`, `TrackState2D`, `ColorChange`
- **`normalizationWidget.js`**: `NormVectorIndexLoad`, `NormalizationFileLoad`, `NormalizationExternalChange`
- **`hicColorScaleWidget.js`**: `ColorScale`, `DisplayMode`
- **`controlMapWidget.js`**: `DisplayMode`
- **`ruler.js`**: `UpdateContactMapMousePosition`

### Removed Subscriptions (Now Handled by Coordinator)

- **`contactMatrixView.js`**: `MapLoad`, `ControlMapLoad` ❌
- **`chromosomeSelector.js`**: `MapLoad`, `LocusChange` ❌
- **`ruler.js`**: `MapLoad` ❌
- **`normalizationWidget.js`**: `MapLoad` ❌
- **`hicResolutionSelector.js`**: `MapLoad`, `ControlMapLoad`, `LocusChange` ❌
- **`hicColorScaleWidget.js`**: `MapLoad` ❌
- **`controlMapWidget.js`**: `MapLoad`, `ControlMapLoad` ❌
- **`scrollbarWidget.js`**: `LocusChange` ❌
- **`hicLocusGoto.js`**: `LocusChange` ❌

## Benefits of This Approach

1. **Explicit Orchestration**: All component updates are visible in one place (`BrowserCoordinator`)
2. **No Dead Code**: Removed unused event subscriptions
3. **Easier Debugging**: Can set breakpoints and trace execution flow
4. **Clear API**: External apps can use `coordinator.addCallback()` for integration
5. **Event Bus Focus**: Event bus now only used for truly decoupled cross-browser sync

## External Integration

For external applications (e.g., Spacewalk), use the coordinator's callback API:

```javascript
// Register callback for map loading
const unsubscribe = browser.coordinator.addCallback('onMapLoaded', (data) => {
    console.log('Map loaded:', data.dataset.name);
    // Do something with the loaded map
});

// Register callback for locus changes
browser.coordinator.addCallback('onLocusChange', (data) => {
    console.log('Locus changed:', data.state);
    // React to locus changes
});

// Later, unsubscribe if needed
unsubscribe();
```

## Future Considerations

- Consider migrating remaining event bus subscriptions to coordinator pattern if they're not needed for cross-browser sync
- Document which events are truly needed for cross-browser synchronization
- Consider creating a separate sync coordinator if cross-browser sync becomes more complex
