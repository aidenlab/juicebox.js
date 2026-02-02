# Context Summary: Map Loading Architecture Discussion

**Date:** January 30, 2026  
**Topic:** Simplifying the contact map loading event chain and architecture

## Quick Links

- **[ARCHITECTURE_PROPOSAL.md](./ARCHITECTURE_PROPOSAL.md)** - Complete architectural proposal with solutions
- **[MAP_LOADING_EVENT_CHAIN.md](./MAP_LOADING_EVENT_CHAIN.md)** - Detailed analysis of current event chain
- **[MAP_LOADING_FLOW_DIAGRAM.md](./MAP_LOADING_FLOW_DIAGRAM.md)** - Visual flow diagrams

## What We Discovered

### The Core Problem

The current architecture has a **fundamental mismatch**:

1. **Components subscribe to events that never fire**
   - 7+ components subscribe to `"MapLoad"` and `"ControlMapLoad"` events
   - But `notifyMapLoaded()` does NOT post these events
   - Instead, it directly calls component methods
   - Result: Dead code and confusion

2. **Events are "black holes"**
   - Can't see who's listening to events
   - Can't trace what happens when events fire
   - Hard to debug and reason about
   - External apps (like Spacewalk) struggle to integrate

3. **Mixed communication patterns**
   - Direct method calls (`NotificationCoordinator` → components)
   - Event bus subscriptions (components → eventBus, but events never posted)
   - Direct event objects (NormalizationWidget receives event object directly)
   - No clear pattern for when to use which approach

4. **Deep, hard-to-follow call chains**
   ```
   loadHicFile() → setActiveDataset() → setState() → StateManager.setState() 
   → update() → RenderCoordinator.update() → repaint() → contactMatrixView.update()
   ```

## Current State

### What Actually Works
- Direct method calls via `NotificationCoordinator` (working)
- State management via `StateManager` (working)
- Rendering via `RenderCoordinator` (working)
- Event posting for `LocusChange` (working, actually posts events)

### What's Broken/Confusing
- Event subscriptions for `MapLoad`/`ControlMapLoad` (dead code - events never posted)
- Mixed patterns make it unclear how to add new components
- Hard to debug - can't easily trace execution flow
- External integration unclear - no clear API

## Proposed Solution: Coordinator Pattern

### The Idea

Replace the event bus (for internal orchestration) with an **explicit coordinator** that:

1. **Knows all components explicitly** - no hidden subscriptions
2. **Orchestrates updates directly** - can see exactly what happens
3. **Provides clear external API** - for Spacewalk integration
4. **Is easy to debug** - can set breakpoints and step through

### Example

**Instead of:**
```javascript
eventBus.post("MapLoad") // Who knows what happens?
```

**You get:**
```javascript
coordinator.onMapLoaded(dataset, state) {
    // Can see EXACTLY what happens:
    this.components.contactMatrix.initialize(dataset);
    this.components.chromosomeSelector.update(dataset);
    this.components.rulers.x.update(dataset);
    // ... all explicit, traceable
}
```

### Benefits

- ✅ **Explicit** - Everything in one place
- ✅ **Traceable** - Can set breakpoints and step through
- ✅ **Debuggable** - No "black holes"
- ✅ **External-friendly** - Clear API: `browser.coordinator.onMapLoaded()`
- ✅ **No magic** - No hidden subscriptions

## Key Files Analyzed

### Core Loading Logic
- `js/dataLoader.js` - Entry point: `loadHicFile()`
- `js/stateManager.js` - State management
- `js/notificationCoordinator.js` - Current notification system (direct calls)
- `js/renderCoordinator.js` - Rendering coordination

### Components with Dead Subscriptions
- `js/contactMatrixView.js` - Subscribes to MapLoad (never receives)
- `js/hicResolutionSelector.js` - Subscribes to MapLoad (never receives)
- `js/ruler.js` - Subscribes to MapLoad (never receives)
- `js/chromosomeSelector.js` - Subscribes to MapLoad (never receives)
- `js/normalizationWidget.js` - Subscribes to MapLoad (never receives)
- `js/hicColorScaleWidget.js` - Subscribes to MapLoad (never receives)
- `js/controlMapWidget.js` - Subscribes to MapLoad/ControlMapLoad (never receives)

### Event Infrastructure
- `js/eventBus.js` - Event bus implementation
- `js/hicEvent.js` - Event factory

## Migration Strategy

### Phase 1: Create Coordinator (No Breaking Changes)
- Create `BrowserCoordinator` class
- Add to `HICBrowser` constructor
- Keep existing `NotificationCoordinator` working
- Test that nothing breaks

### Phase 2: Migrate Map Loading
- Move `notifyMapLoaded()` logic to `coordinator.onMapLoaded()`
- Update `DataLoader` to call coordinator
- Remove `NotificationCoordinator.notifyMapLoaded()`
- Test map loading works

### Phase 3: Migrate Other Notifications
- Move `notifyLocusChange()` to coordinator
- Move other notification methods
- Remove `NotificationCoordinator` class
- Test all functionality

### Phase 4: Clean Up Event Bus
- Remove dead `MapLoad`/`ControlMapLoad` subscriptions
- Keep event bus only for cross-browser sync
- Document what events are actually used

### Phase 5: Add External API
- Add callback registration API
- Document external integration
- Update Spacewalk integration if needed

## For Spacewalk Integration

### Current Problem
- Spacewalk needs to hook into map loading
- No clear API - must understand internal event system
- Events are "black holes" - hard to know what's available

### Proposed Solution
```javascript
// Clear, explicit API
const browser = await createBrowser(container, config);

// Register callback explicitly
const unsubscribe = browser.coordinator.addCallback('onMapLoaded', (data) => {
    console.log('Map loaded:', data.dataset.name);
    // data.dataset, data.state - clear structure
    // Do Spacewalk-specific stuff
});

// Can see what callbacks are registered
console.log(browser.coordinator.getCallbacksFor('onMapLoaded'));
```

## Next Steps

1. **Review the architecture proposal** - See `ARCHITECTURE_PROPOSAL.md` for complete details
2. **Discuss approach** - Confirm coordinator pattern works for your needs
3. **Plan implementation** - Create detailed migration plan
4. **Prototype** - Start with one notification type (map loading)
5. **Iterate** - Refine based on experience

## Questions to Consider

1. Does the coordinator pattern address the "black holes" concern?
2. Is the explicit approach clear enough, or prefer different pattern?
3. Are there specific Spacewalk integration needs to consider?
4. Should we prototype with one notification type first?

## Key Insights

1. **The system works despite dead code** - Direct method calls handle everything
2. **Event bus is overkill for internal orchestration** - Better for truly decoupled systems
3. **Explicit is better than implicit** - Especially for debugging and integration
4. **Coordinator pattern is well-established** - Used in many frameworks (React, Vue, etc.)

## Documentation Created

All documentation is in the `docs/` folder:

1. **ARCHITECTURE_PROPOSAL.md** - Complete proposal with 4 options and recommendation
2. **MAP_LOADING_EVENT_CHAIN.md** - Detailed analysis of current system
3. **MAP_LOADING_FLOW_DIAGRAM.md** - Visual diagrams of flow
4. **CONTEXT_SUMMARY.md** - This file (quick reference)

## How to Use This Context

When working in the `juicebox-with-spacewalk.code-workspace`:

1. **Reference the architecture proposal** when discussing design decisions
2. **Use the event chain analysis** to understand current behavior
3. **Use the flow diagrams** to visualize the system
4. **Use this summary** as a quick reference

All files are in the `juicebox.js` project's `docs/` folder, so they'll be visible in the workspace.
