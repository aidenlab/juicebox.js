# Spacewalk Integration Guide

## Overview

Spacewalk integrates with Juicebox using the **BrowserCoordinator** pattern for reliable, explicit integration. This approach isolates Spacewalk from Juicebox's internal event bus traffic and provides a clear, traceable API.

## Integration Pattern

### ✅ Use Coordinator Callbacks (Recommended)

The coordinator provides explicit callbacks for key browser events:

```javascript
// Register callback for map loading
const unsubscribe = browser.coordinator.addCallback('onMapLoaded', ({ dataset, state, datasetType }) => {
    console.log('Map loaded:', dataset.name);
    // Your Spacewalk-specific logic here
});

// Register callback for locus changes
browser.coordinator.addCallback('onLocusChange', ({ state, changes }) => {
    console.log('Locus changed:', state);
    // React to locus changes
});

// Later, unsubscribe if needed
unsubscribe();
```

### Available Coordinator Callbacks

- **`onMapLoaded`** - Called when a map is loaded
  - Parameters: `{ dataset, state, datasetType, browser }`
  
- **`onControlMapLoaded`** - Called when a control map is loaded
  - Parameters: `{ controlDataset, browser }`
  
- **`onLocusChange`** - Called when the locus changes
  - Parameters: `{ state, changes: { resolutionChanged, chrChanged }, browser }`

### ❌ Avoid Event Bus Subscriptions for Internal Events

**DO NOT** subscribe to these events (they are no longer posted):
- `MapLoad` - Use `coordinator.addCallback('onMapLoaded', ...)` instead
- `ControlMapLoad` - Use `coordinator.addCallback('onControlMapLoaded', ...)` instead
- `LocusChange` - Use `coordinator.addCallback('onLocusChange', ...)` instead

### ✅ Event Bus Events Still Available (For Cross-Browser Sync)

These events are still posted and can be subscribed to for cross-browser synchronization:
- `DidHideCrosshairs` - Posted when crosshairs are hidden
- `DidShowCrosshairs` - Posted when crosshairs are shown
- `DragStopped` - Posted when drag operation stops

**Note**: These are primarily for cross-browser sync. For Spacewalk integration, prefer coordinator callbacks.

## Example: Spacewalk Integration

```javascript
class JuiceboxPanel {
    attachMouseHandlersAndEventSubscribers() {
        // ✅ Use coordinator for map loading
        this.browser.coordinator.addCallback('onMapLoaded', async ({ dataset, state, datasetType }) => {
            const activeTabButton = this.container.querySelector('button.nav-link.active')
            tabAssessment(this.browser, activeTabButton, this)
            // Spacewalk-specific logic after map loads
        });

        // ✅ Still OK to subscribe to crosshairs events (they're still posted)
        this.browser.eventBus.subscribe('DidHideCrosshairs', ribbon)
        this.browser.eventBus.subscribe('DidHideCrosshairs', ballAndStick)
        
        // ❌ DON'T subscribe to MapLoad - it's no longer posted!
        // this.browser.eventBus.subscribe('MapLoad', ...) // This won't work!
    }
}
```

## Benefits

1. **Explicit Integration**: Can see exactly when callbacks fire
2. **Isolated from Event Bus**: No interference from internal Juicebox events
3. **Traceable**: Can set breakpoints and debug easily
4. **Type-Safe**: Clear parameter structure for callbacks
5. **Reliable**: Callbacks are guaranteed to fire (unlike dead event subscriptions)

## Migration Checklist

If you're updating existing Spacewalk code:

- [ ] Replace `eventBus.subscribe('MapLoad', ...)` with `coordinator.addCallback('onMapLoaded', ...)`
- [ ] Replace `eventBus.subscribe('ControlMapLoad', ...)` with `coordinator.addCallback('onControlMapLoaded', ...)`
- [ ] Replace `eventBus.subscribe('LocusChange', ...)` with `coordinator.addCallback('onLocusChange', ...)`
- [ ] Keep `eventBus.subscribe('DidHideCrosshairs', ...)` - still valid
- [ ] Test that callbacks fire correctly
- [ ] Remove any dead event subscriptions

## Debugging

To see what callbacks are registered:

```javascript
console.log(browser.coordinator.getCallbacksFor('onMapLoaded'));
```

To list all components managed by coordinator:

```javascript
console.log(browser.coordinator.listComponents());
```
