# Contact Map Loading Event Chain Analysis

## Overview

This document traces the complete chain of events that occurs when a contact map file is loaded, identifying the complex interactions between method calls, direct notifications, and event bus subscriptions.

## Key Issue Identified

**There is a mismatch between event subscriptions and event posting:**
- Multiple components subscribe to `"MapLoad"` and `"ControlMapLoad"` events via `eventBus.subscribe()`
- However, `notifyMapLoaded()` does **NOT** post events to the event bus
- Instead, it directly calls methods on components
- This creates a confusing dual system where some components receive direct method calls while others expect events that never arrive

## Loading Flow: Main Map (.hic file)

### Entry Point: `DataLoader.loadHicFile()`

**Location:** `js/dataLoader.js:70`

**Sequence:**

1. **Pre-load setup** (lines 76-88)
   - `browser.clearSession()` - clears previous state
   - Starts spinner: `contactMatrixView.startSpinner()`
   - Shows user interaction shield
   - Extracts and sets map name

2. **Dataset loading** (line 95)
   - `Dataset.loadDataset(config)` - async, loads the .hic file
   - Creates `HiCDataset` instance
   - Calls `dataset.init()` which initializes the hicFile

3. **Genome setup** (lines 98-103)
   - Creates new `Genome` instance from dataset
   - **Posts global event:** `EventBus.globalBus.post(HICEvent("GenomeChange", genome.id))`
   - This is one of the few events actually posted!

4. **State initialization** (lines 105-136)
   - Determines state from config (locus, state string, synchState, or default)
   - **Critical:** `browser.setActiveDataset(dataset, state)` - sets dataset BEFORE setState
   - **Critical:** `await browser.setState(state)` - this triggers important side effects

5. **Map loaded notification** (line 138)
   - `browser.notifyMapLoaded(dataset, state, dataset.datasetType)`
   - **NOTE:** This does NOT post an event to eventBus!

6. **Normalization vector loading** (lines 140-164)
   - Loads norm vector index (may be async/background)
   - Calls `browser.notifyNormVectorIndexLoad(dataset)` when complete

7. **Browser synchronization** (lines 166-176)
   - `syncBrowsers()` - syncs all browsers
   - May sync state with compatible browsers

8. **Cleanup** (lines 184-189)
   - Stops spinner
   - Hides user interaction shield

### State Management: `setState()`

**Location:** `js/hicBrowser.js:782`

**Sequence:**

1. Delegates to `stateManager.setState(state)` (line 783)
2. StateManager operations (`js/stateManager.js:88`):
   - Clones state to avoid mutations
   - Adjusts pixel size based on minimum requirements
   - Configures locus if not present
   - Returns change flags: `{chrChanged, resolutionChanged}`

3. **After setState completes:**
   - `await browser.update()` - triggers rendering
   - `browser.notifyLocusChange(eventData)` - notifies UI components of locus change
   - **This posts to eventBus:** Components subscribe to "LocusChange"

### Notification: `notifyMapLoaded()`

**Location:** `js/notificationCoordinator.js:142`

**This method directly calls methods - does NOT post events:**

1. `_initializeContactMatrixViewForMapLoad()` (line 145)
   - Enables mouse handlers if not already enabled
   - Clears image caches
   - Clears color scale threshold cache

2. `_updateChromosomeSelectorForMapLoad(dataset)` (line 146)
   - Calls `chromosomeSelector.respondToDataLoadWithDataset(dataset)`
   - **BUT:** ChromosomeSelector also subscribes to "MapLoad" event (line 57)
   - **ISSUE:** This event is never posted, so the subscription is dead code

3. `_updateRulersForMapLoad(dataset)` (line 147)
   - Directly calls `ruler.wholeGenomeLayout()` and `ruler.update()`
   - **BUT:** Ruler also subscribes to "MapLoad" event (line 50)
   - **ISSUE:** This event is never posted

4. `_updateNormalizationWidgetForMapLoad(data)` (line 148)
   - Creates event object: `{ type: "MapLoad", data }`
   - Calls `normalizationWidget.receiveEvent(event)` directly
   - **BUT:** NormalizationWidget also subscribes to "MapLoad" event (line 55)
   - **ISSUE:** The subscription never receives events

5. `_updateResolutionSelectorForMapLoad()` (line 149)
   - Directly sets `browser.resolutionLocked = false`
   - Calls `resolutionSelector.setResolutionLock(false)`
   - Calls `resolutionSelector.updateResolutions()`
   - **BUT:** ResolutionSelector subscribes to "MapLoad" event (line 73)
   - **ISSUE:** The subscription's `receiveEvent()` method handles "MapLoad" but never receives it

6. `_updateColorScaleWidgetForMapLoad()` (line 150)
   - Calls `colorScaleWidget.updateMapBackgroundColor()` directly
   - **BUT:** ColorScaleWidget subscribes to "MapLoad" event (line 104)
   - **ISSUE:** Subscription callback never executes

7. `_updateControlMapWidgetForMapLoad()` (line 151)
   - Calls `controlMapWidget.hide()` if no control dataset
   - **BUT:** ControlMapWidget subscribes to "MapLoad" event (line 57)
   - **ISSUE:** Subscription callback never executes

### Rendering: `update()` → `repaint()`

**Location:** `js/renderCoordinator.js:100`

**Sequence:**

1. Queues update if one is in progress
2. Calls `repaint()` (line 110)
3. `repaint()` operations:
   - Updates rulers with pseudo-event
   - Renders all tracks in parallel
   - Renders contact matrix view

4. Syncs to other browsers (if `shouldSync = true`)

## Components Subscribing to MapLoad Events (That Never Arrive)

### 1. ContactMatrixView
**Location:** `js/contactMatrixView.js:77-78`
```javascript
this.browser.eventBus.subscribe("MapLoad", this);
this.browser.eventBus.subscribe("ControlMapLoad", this);
```
**Handler:** `receiveEvent()` at line 188
- Enables mouse handlers
- Clears image caches
- **Current behavior:** Receives direct initialization via `_initializeContactMatrixViewForMapLoad()`

### 2. ResolutionSelector
**Location:** `js/hicResolutionSelector.js:73-74`
```javascript
this.browser.eventBus.subscribe("MapLoad", this);
this.browser.eventBus.subscribe("ControlMapLoad", this);
```
**Handler:** `receiveEvent()` at line 82
- Handles "MapLoad" at line 101
- **Current behavior:** Receives direct method calls via `_updateResolutionSelectorForMapLoad()`

### 3. Ruler
**Location:** `js/ruler.js:50`
```javascript
browser.eventBus.subscribe('MapLoad', this);
```
**Handler:** `receiveEvent()` at line 186
- Handles "MapLoad" at line 189
- **Current behavior:** Receives direct method calls via `_updateRulersForMapLoad()`

### 4. ChromosomeSelector
**Location:** `js/chromosomeSelector.js:57`
```javascript
this.browser.eventBus.subscribe("MapLoad", (event) => {
    const dataset = event.data.dataset || event.data;
    this.respondToDataLoadWithDataset(dataset);
});
```
**Current behavior:** Receives direct method call via `_updateChromosomeSelectorForMapLoad()`

### 5. NormalizationWidget
**Location:** `js/normalizationWidget.js:55`
```javascript
this.browser.eventBus.subscribe("MapLoad", this);
```
**Handler:** `receiveEvent()` at line 71
- **Current behavior:** Receives direct event object via `_updateNormalizationWidgetForMapLoad()` (but not through eventBus)

### 6. ColorScaleWidget
**Location:** `js/hicColorScaleWidget.js:104`
```javascript
browser.eventBus.subscribe("MapLoad", () => {
    paintSwatch(this.mapBackgroundColorpickerButton, browser.contactMatrixView.backgroundColor);
});
```
**Current behavior:** Receives direct method call via `_updateColorScaleWidgetForMapLoad()`

### 7. ControlMapWidget
**Location:** `js/controlMapWidget.js:52, 57`
```javascript
browser.eventBus.subscribe("ControlMapLoad", () => { ... });
browser.eventBus.subscribe("MapLoad", () => { ... });
```
**Current behavior:** Receives direct method calls via `_updateControlMapWidgetForMapLoad()`

## Control Map Loading Flow

**Location:** `js/dataLoader.js:278`

Similar to main map but:
1. Loads control dataset
2. Checks compatibility with main dataset
3. Calls `browser.notifyControlMapLoaded(controlDataset)` (line 307)
4. **NOTE:** This also does NOT post events to eventBus

## Events Actually Posted

### 1. GenomeChange
**Location:** `js/dataLoader.js:102, 229`
```javascript
EventBus.globalBus.post(HICEvent("GenomeChange", this.browser.genome.id));
```
- Posted when genome changes during map load
- Uses **globalBus**, not browser's eventBus

### 2. LocusChange
**Location:** `js/hicBrowser.js:791`
```javascript
this.notifyLocusChange(eventData);
```
- Posted via `NotificationCoordinator.notifyLocusChange()`
- Actually triggers event bus subscriptions
- Called after `setState()` completes

### 3. Other Events (not related to map loading)
- `DragStopped` - from ContactMatrixView
- `DidShowCrosshairs` / `DidHideCrosshairs` - from ContactMatrixView
- `TrackXYPairLoad` / `TrackXYPairRemoval` - from LayoutController
- `BrowserSelect` - from createBrowser

## Problems Identified

### 1. Dual Notification System
- **Direct method calls:** `NotificationCoordinator` directly calls component methods
- **Event subscriptions:** Components subscribe to events that are never posted
- **Result:** Confusing codebase where it's unclear which mechanism is used

### 2. Dead Code
- All `MapLoad` and `ControlMapLoad` event subscriptions are effectively dead code
- These subscriptions never receive events
- The code suggests an event-driven architecture that doesn't exist

### 3. Inconsistent Patterns
- Some components receive direct method calls
- Some components receive direct event objects (NormalizationWidget)
- Some components subscribe to events that never arrive
- No clear pattern for when to use which approach

### 4. Maintenance Burden
- Adding a new component requires understanding both systems
- Debugging requires checking both direct calls and event subscriptions
- Easy to introduce bugs by using the wrong mechanism

## Recommendations

### Option 1: Post Events to EventBus (Recommended)
Modify `notifyMapLoaded()` to post events:

```javascript
notifyMapLoaded(dataset, state, datasetType) {
    const data = { dataset, state, datasetType };
    
    // Post event to eventBus so all subscribers receive it
    this.browser.eventBus.post(HICEvent("MapLoad", data));
    
    // Keep direct calls for components that don't subscribe
    // OR remove direct calls and let all components subscribe
}
```

**Pros:**
- Uses existing event infrastructure
- Components already subscribe, just need events posted
- More consistent with other events (LocusChange, etc.)

**Cons:**
- Need to ensure all components handle events properly
- May need to refactor some direct calls

### Option 2: Remove Event Subscriptions
Remove all `MapLoad` and `ControlMapLoad` subscriptions and rely solely on direct method calls.

**Pros:**
- Simpler, more explicit
- No dead code

**Cons:**
- Loses benefits of event-driven architecture
- Less flexible for future extensions

### Option 3: Hybrid Approach
Keep direct calls for critical initialization, post events for UI updates.

**Pros:**
- Best of both worlds
- Clear separation of concerns

**Cons:**
- Still maintains dual system
- More complex

## Current State Summary

1. **Map loading triggers:**
   - Direct method calls via `NotificationCoordinator`
   - State management via `StateManager`
   - Rendering via `RenderCoordinator`
   - Event posting for `LocusChange` (after setState)

2. **Components receive updates via:**
   - Direct method calls (primary mechanism)
   - Direct event objects (NormalizationWidget only)
   - Event bus subscriptions (for LocusChange and other events)
   - **NOT** via MapLoad/ControlMapLoad events (subscribed but never posted)

3. **The chain is:**
   ```
   loadHicFile()
     → Dataset.loadDataset()
     → setActiveDataset()
     → setState()
       → update()
       → notifyLocusChange() [posts event]
     → notifyMapLoaded() [direct calls, NO events]
     → Background: norm vector loading
     → Browser sync
   ```

## Debugging Tips

When debugging map loading issues:

1. **Check direct method calls** in `NotificationCoordinator.notifyMapLoaded()`
2. **Check state management** in `StateManager.setState()`
3. **Check rendering** in `RenderCoordinator.update()`
4. **Check event subscriptions** - but remember MapLoad events are never posted
5. **Check LocusChange events** - these ARE posted and subscribed to
6. **Check globalBus** for GenomeChange events

## Related Files

- `js/dataLoader.js` - Loading logic
- `js/stateManager.js` - State management
- `js/notificationCoordinator.js` - UI notifications (direct calls)
- `js/renderCoordinator.js` - Rendering coordination
- `js/eventBus.js` - Event infrastructure
- `js/hicBrowser.js` - Main browser class
- `js/contactMatrixView.js` - Matrix view (subscribes but never receives MapLoad)
- `js/hicResolutionSelector.js` - Resolution selector (subscribes but never receives MapLoad)
- `js/ruler.js` - Rulers (subscribes but never receives MapLoad)
- `js/chromosomeSelector.js` - Chromosome selector (subscribes but never receives MapLoad)
- `js/normalizationWidget.js` - Normalization widget (subscribes but receives direct event object)
- `js/hicColorScaleWidget.js` - Color scale widget (subscribes but never receives MapLoad)
- `js/controlMapWidget.js` - Control map widget (subscribes but never receives MapLoad)
