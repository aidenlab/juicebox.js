# Architectural Proposal: Simplifying the Event Chain

## The Problem

The current architecture has several issues that make it hard to reason about, debug, and integrate:

### 1. **Event Bus as "Black Holes"**
- Events are posted without knowing who's listening
- No way to trace what happens when an event fires
- Subscriptions scattered across codebase
- Dead subscriptions (components subscribe but events never posted)

### 2. **Mixed Communication Patterns**
- Direct method calls (`NotificationCoordinator` → components)
- Event bus subscriptions (components → eventBus)
- Direct event objects (NormalizationWidget receives event object directly)
- No clear pattern for when to use which approach

### 3. **Deep Call Chains**
```
loadHicFile()
  → setActiveDataset()
    → setState()
      → StateManager.setState()
        → update()
          → RenderCoordinator.update()
            → repaint()
              → contactMatrixView.update()
                → [rendering logic]
```

### 4. **Hard to Debug**
- Can't set breakpoints on "what happens when map loads"
- Must trace through multiple files
- Events fire asynchronously, hard to follow execution

### 5. **External Integration Challenges**
- External apps (like Spacewalk) need to hook into the system
- No clear API for "what happens when X occurs"
- Must understand internal event system to integrate

## Proposed Solutions

### Option 1: Explicit Coordinator Pattern (Recommended)

**Concept:** One coordinator class that explicitly knows about all components and orchestrates updates.

**Structure:**
```javascript
class BrowserCoordinator {
    constructor(browser) {
        // Explicit list of all components
        this.components = {
            contactMatrix: browser.contactMatrixView,
            chromosomeSelector: browser.ui.getComponent('chromosomeSelector'),
            rulers: {
                x: browser.layoutController.xAxisRuler,
                y: browser.layoutController.yAxisRuler
            },
            resolutionSelector: browser.ui.getComponent('resolutionSelector'),
            normalizationWidget: browser.ui.getComponent('normalization'),
            colorScaleWidget: browser.ui.getComponent('colorScaleWidget'),
            controlMapWidget: browser.ui.getComponent('controlMap')
        };
    }

    onMapLoaded(dataset, state) {
        // Explicit, traceable sequence
        this.components.contactMatrix.initializeForMap(dataset);
        this.components.chromosomeSelector.updateDataset(dataset);
        this.components.rulers.x.updateForDataset(dataset);
        this.components.rulers.y.updateForDataset(dataset);
        this.components.resolutionSelector.resetForNewMap();
        this.components.normalizationWidget.updateOptions(dataset);
        this.components.colorScaleWidget.updateBackground();
        this.components.controlMapWidget.hideIfNoControl();
    }

    onLocusChange(state, changes) {
        // Explicit locus change handling
        this.components.chromosomeSelector.updateSelection(state);
        this.components.rulers.x.updatePosition(state);
        this.components.rulers.y.updatePosition(state);
        this.components.resolutionSelector.updateSelection(state);
        // etc.
    }
}
```

**Benefits:**
- ✅ **Explicit:** Can see exactly what happens in one place
- ✅ **Traceable:** Easy to set breakpoints and debug
- ✅ **Testable:** Can mock components easily
- ✅ **External integration:** Clear API - `coordinator.onMapLoaded()`
- ✅ **No magic:** Everything is explicit, no hidden subscriptions

**Drawbacks:**
- ⚠️ Coordinator needs to know about all components (but that's actually good for clarity)
- ⚠️ Must update coordinator when adding components (but that's explicit and clear)

**Migration Path:**
1. Create `BrowserCoordinator` class
2. Move logic from `NotificationCoordinator` to coordinator
3. Replace `notifyMapLoaded()` calls with `coordinator.onMapLoaded()`
4. Remove event bus subscriptions for MapLoad
5. Keep event bus only for truly decoupled events (like cross-browser sync)

---

### Option 2: Observable State Pattern

**Concept:** State is observable, components subscribe to state changes explicitly.

**Structure:**
```javascript
class ObservableState {
    constructor() {
        this.state = null;
        this.observers = new Set();
    }

    subscribe(observer) {
        this.observers.add(observer);
        return () => this.observers.delete(observer); // unsubscribe function
    }

    setState(newState) {
        const oldState = this.state;
        this.state = newState;
        
        // Explicitly notify all observers
        for (const observer of this.observers) {
            observer.onStateChange(newState, oldState);
        }
    }

    getState() {
        return this.state;
    }
}

// Usage in components
class ChromosomeSelector {
    constructor(browser) {
        this.browser = browser;
        // Explicit subscription
        this.unsubscribe = browser.stateObservable.subscribe((newState, oldState) => {
            this.onStateChange(newState, oldState);
        });
    }

    onStateChange(newState, oldState) {
        if (newState.chr1 !== oldState?.chr1 || newState.chr2 !== oldState?.chr2) {
            this.updateSelection(newState);
        }
    }

    destroy() {
        this.unsubscribe(); // Clean up
    }
}
```

**Benefits:**
- ✅ **Explicit subscriptions:** Can see who's subscribed
- ✅ **Unsubscribe capability:** Can clean up subscriptions
- ✅ **State-centric:** Everything revolves around state changes
- ✅ **Debuggable:** Can log all state changes in one place

**Drawbacks:**
- ⚠️ Still has subscription pattern (though more explicit)
- ⚠️ Components need to check what changed (though this is explicit)

**Migration Path:**
1. Create `ObservableState` wrapper
2. Replace direct state access with observable
3. Components subscribe explicitly in constructor
4. Remove event bus for state-related events

---

### Option 3: Command Pattern with Explicit Handlers

**Concept:** Actions are commands, handlers are registered explicitly.

**Structure:**
```javascript
class CommandHandler {
    constructor() {
        this.handlers = new Map();
    }

    register(command, handler) {
        if (!this.handlers.has(command)) {
            this.handlers.set(command, []);
        }
        this.handlers.get(command).push(handler);
        return () => {
            // Unregister function
            const handlers = this.handlers.get(command);
            const index = handlers.indexOf(handler);
            if (index > -1) handlers.splice(index, 1);
        };
    }

    execute(command, data) {
        const handlers = this.handlers.get(command) || [];
        // Execute all handlers explicitly
        for (const handler of handlers) {
            handler(data);
        }
    }

    // Debug helper
    getHandlersFor(command) {
        return this.handlers.get(command) || [];
    }
}

// Usage
class BrowserCoordinator {
    constructor(browser) {
        this.commandHandler = new CommandHandler();
        
        // Explicit registration - can see all handlers in one place
        this.commandHandler.register('mapLoaded', (data) => {
            browser.contactMatrixView.initializeForMap(data.dataset);
        });
        
        this.commandHandler.register('mapLoaded', (data) => {
            browser.chromosomeSelector.updateDataset(data.dataset);
        });
        
        // etc.
    }

    onMapLoaded(dataset, state) {
        // Execute command - handlers are explicit
        this.commandHandler.execute('mapLoaded', { dataset, state });
    }
}
```

**Benefits:**
- ✅ **Explicit handlers:** Can see all handlers for a command
- ✅ **Debuggable:** Can log all command executions
- ✅ **Testable:** Can test handlers independently
- ✅ **External integration:** External apps can register handlers

**Drawbacks:**
- ⚠️ Still has indirection (though explicit)
- ⚠️ More boilerplate than direct calls

---

### Option 4: Hybrid: Coordinator + Explicit Callbacks

**Concept:** Coordinator for internal orchestration, explicit callbacks for external integration.

**Structure:**
```javascript
class BrowserCoordinator {
    constructor(browser) {
        this.browser = browser;
        this.externalCallbacks = {
            onMapLoaded: [],
            onLocusChange: [],
            onStateChange: []
        };
    }

    // Internal orchestration (explicit)
    onMapLoaded(dataset, state) {
        // Internal updates - explicit and traceable
        this.browser.contactMatrixView.initializeForMap(dataset);
        this.browser.chromosomeSelector.updateDataset(dataset);
        // ... etc

        // External callbacks - explicit registration
        for (const callback of this.externalCallbacks.onMapLoaded) {
            callback({ dataset, state, browser: this.browser });
        }
    }

    // External API
    addCallback(event, callback) {
        if (!this.externalCallbacks[event]) {
            throw new Error(`Unknown event: ${event}`);
        }
        this.externalCallbacks[event].push(callback);
        return () => {
            const index = this.externalCallbacks[event].indexOf(callback);
            if (index > -1) {
                this.externalCallbacks[event].splice(index, 1);
            }
        };
    }

    // Debug helper
    getCallbacksFor(event) {
        return this.externalCallbacks[event] || [];
    }
}

// External usage (e.g., Spacewalk)
const browser = await createBrowser(container, config);
browser.coordinator.addCallback('onMapLoaded', (data) => {
    console.log('Map loaded:', data.dataset.name);
    // Do something external
});
```

**Benefits:**
- ✅ **Internal:** Explicit, traceable orchestration
- ✅ **External:** Clear API for integration
- ✅ **Debuggable:** Can see all callbacks
- ✅ **No magic:** Everything is explicit

**Drawbacks:**
- ⚠️ Still has callback pattern (though explicit and limited)

---

## Recommended Approach: Coordinator Pattern

I recommend **Option 1 (Coordinator Pattern)** because:

1. **Simplicity:** Direct method calls are easiest to understand
2. **Traceability:** Can follow execution flow easily
3. **Debuggability:** Can set breakpoints and step through
4. **Explicitness:** Everything that happens is in one place
5. **External integration:** Clear API (`coordinator.onMapLoaded()`)

### Implementation Strategy

1. **Create `BrowserCoordinator` class**
   - Consolidates all orchestration logic
   - Explicit list of components
   - Clear methods: `onMapLoaded()`, `onLocusChange()`, etc.

2. **Replace `NotificationCoordinator`**
   - Move logic to `BrowserCoordinator`
   - Keep coordinator focused on orchestration

3. **Remove event bus for internal events**
   - Keep event bus only for cross-browser sync (truly decoupled)
   - Remove MapLoad/ControlMapLoad subscriptions

4. **Add external callback API**
   - For external apps to hook in
   - Explicit registration/unregistration

5. **Keep state management separate**
   - `StateManager` stays as-is (it's clean)
   - Coordinator calls state manager, then orchestrates updates

### Example Structure

```javascript
class BrowserCoordinator {
    constructor(browser) {
        this.browser = browser;
        this.components = this._initializeComponents();
        this.externalCallbacks = {
            onMapLoaded: [],
            onLocusChange: [],
            onStateChange: []
        };
    }

    _initializeComponents() {
        return {
            contactMatrix: this.browser.contactMatrixView,
            chromosomeSelector: this.browser.ui.getComponent('chromosomeSelector'),
            rulers: {
                x: this.browser.layoutController.xAxisRuler,
                y: this.browser.layoutController.yAxisRuler
            },
            resolutionSelector: this.browser.ui.getComponent('resolutionSelector'),
            normalizationWidget: this.browser.ui.getComponent('normalization'),
            colorScaleWidget: this.browser.ui.getComponent('colorScaleWidget'),
            controlMapWidget: this.browser.ui.getComponent('controlMap'),
            locusGoto: this.browser.ui.getComponent('locusGoto'),
            scrollbar: this.browser.ui.getComponent('scrollbar')
        };
    }

    // Map loading orchestration
    onMapLoaded(dataset, state, datasetType) {
        // 1. Initialize contact matrix
        if (!this.components.contactMatrix.mouseHandlersEnabled) {
            this.components.contactMatrix.addTouchHandlers(this.components.contactMatrix.viewportElement);
            this.components.contactMatrix.addMouseHandlers(this.components.contactMatrix.viewportElement);
            this.components.contactMatrix.mouseHandlersEnabled = true;
        }
        this.components.contactMatrix.clearImageCaches();
        this.components.contactMatrix.colorScaleThresholdCache = {};

        // 2. Update chromosome selector
        if (this.components.chromosomeSelector) {
            this.components.chromosomeSelector.respondToDataLoadWithDataset(dataset);
        }

        // 3. Update rulers
        if (this.components.rulers.x) {
            this.components.rulers.x.wholeGenomeLayout(
                this.components.rulers.x.axisElement,
                this.components.rulers.x.wholeGenomeContainerElement,
                this.components.rulers.x.axis,
                dataset
            );
            this.components.rulers.x.update();
        }
        if (this.components.rulers.y) {
            this.components.rulers.y.wholeGenomeLayout(
                this.components.rulers.y.axisElement,
                this.components.rulers.y.wholeGenomeContainerElement,
                this.components.rulers.y.axis,
                dataset
            );
            this.components.rulers.y.update();
        }

        // 4. Update normalization widget
        if (this.components.normalizationWidget) {
            this.components.normalizationWidget.receiveEvent({
                type: "MapLoad",
                data: { dataset, state, datasetType }
            });
        }

        // 5. Update resolution selector
        if (this.components.resolutionSelector) {
            this.browser.resolutionLocked = false;
            this.components.resolutionSelector.setResolutionLock(false);
            this.components.resolutionSelector.updateResolutions(this.browser.state.zoom);
        }

        // 6. Update color scale widget
        if (this.components.colorScaleWidget) {
            this.components.colorScaleWidget.updateMapBackgroundColor(
                this.browser.contactMatrixView.backgroundColor
            );
        }

        // 7. Update control map widget
        if (this.components.controlMapWidget && !this.browser.controlDataset) {
            this.components.controlMapWidget.hide();
        }

        // 8. Notify external callbacks
        for (const callback of this.externalCallbacks.onMapLoaded) {
            callback({ dataset, state, datasetType, browser: this.browser });
        }
    }

    // Locus change orchestration
    onLocusChange(state, changes) {
        const { resolutionChanged, chrChanged } = changes;

        // Update components based on what changed
        if (this.components.chromosomeSelector) {
            this.components.chromosomeSelector.respondToLocusChangeWithState(state);
        }

        if (this.components.scrollbar && !this.components.scrollbar.isDragging) {
            this.components.scrollbar.receiveEvent({
                type: "LocusChange",
                data: { state }
            });
        }

        if (this.components.resolutionSelector) {
            if (resolutionChanged) {
                this.browser.resolutionLocked = false;
                this.components.resolutionSelector.setResolutionLock(false);
            }
            if (chrChanged !== false) {
                const isWholeGenome = this.browser.dataset.isWholeGenome(state.chr1);
                this.components.resolutionSelector.updateLabelForWholeGenome(isWholeGenome);
                this.components.resolutionSelector.updateResolutions(state.zoom);
            } else {
                this.components.resolutionSelector.setSelectedResolution(state.zoom);
            }
        }

        if (this.components.locusGoto) {
            this.components.locusGoto.receiveEvent({
                type: "LocusChange",
                data: { state }
            });
        }

        // External callbacks
        for (const callback of this.externalCallbacks.onLocusChange) {
            callback({ state, changes, browser: this.browser });
        }
    }

    // External API
    addCallback(event, callback) {
        if (!this.externalCallbacks[event]) {
            throw new Error(`Unknown event: ${event}. Available: ${Object.keys(this.externalCallbacks).join(', ')}`);
        }
        this.externalCallbacks[event].push(callback);
        return () => {
            const index = this.externalCallbacks[event].indexOf(callback);
            if (index > -1) {
                this.externalCallbacks[event].splice(index, 1);
            }
        };
    }

    // Debug helpers
    getCallbacksFor(event) {
        return this.externalCallbacks[event] || [];
    }

    listComponents() {
        return Object.keys(this.components);
    }
}
```

## Migration Plan

### Phase 1: Create Coordinator (No Breaking Changes)
1. Create `BrowserCoordinator` class
2. Add coordinator to `HICBrowser` constructor
3. Keep existing `NotificationCoordinator` working
4. Test that nothing breaks

### Phase 2: Migrate Map Loading
1. Move `notifyMapLoaded()` logic to `coordinator.onMapLoaded()`
2. Update `DataLoader` to call `coordinator.onMapLoaded()`
3. Remove `NotificationCoordinator.notifyMapLoaded()`
4. Test map loading works

### Phase 3: Migrate Other Notifications
1. Move `notifyLocusChange()` to `coordinator.onLocusChange()`
2. Move other notification methods
3. Remove `NotificationCoordinator` class
4. Test all functionality

### Phase 4: Clean Up Event Bus
1. Remove dead `MapLoad`/`ControlMapLoad` subscriptions
2. Keep event bus only for cross-browser sync
3. Document what events are actually used

### Phase 5: Add External API
1. Add callback registration API
2. Document external integration
3. Update Spacewalk integration if needed

## Benefits Summary

### For Development
- ✅ **Easier to understand:** All orchestration in one place
- ✅ **Easier to debug:** Can set breakpoints and step through
- ✅ **Easier to test:** Can mock components easily
- ✅ **Easier to modify:** Change one place, affects all

### For External Integration
- ✅ **Clear API:** `browser.coordinator.onMapLoaded()` is obvious
- ✅ **Explicit callbacks:** Can see what callbacks are registered
- ✅ **Type-safe:** Can add TypeScript types easily
- ✅ **Documented:** Coordinator methods are self-documenting

### For Maintenance
- ✅ **No dead code:** Remove unused subscriptions
- ✅ **No magic:** Everything is explicit
- ✅ **Single source of truth:** Coordinator knows all components
- ✅ **Easy to extend:** Add new component? Add to coordinator

## Questions to Consider

1. **Do we need events at all?** 
   - For internal orchestration: No, coordinator is better
   - For cross-browser sync: Maybe, but could use coordinator too
   - For external integration: Callbacks are clearer

2. **What about async operations?**
   - Coordinator can handle async/await
   - Components can return promises
   - Still explicit and traceable

3. **What about performance?**
   - Direct calls are faster than events
   - Coordinator adds minimal overhead
   - Can batch updates if needed

4. **What about backward compatibility?**
   - Keep old API during migration
   - Deprecate gradually
   - Document migration path

## Next Steps

1. **Review this proposal** - Does this approach make sense?
2. **Discuss trade-offs** - Any concerns or alternatives?
3. **Plan implementation** - If approved, create detailed migration plan
4. **Prototype** - Create coordinator and test with one notification type
5. **Iterate** - Refine based on experience
