# Contact Map Loading Flow Diagram

## Complete Event Chain Visualization

```
┌─────────────────────────────────────────────────────────────────┐
│                    DataLoader.loadHicFile()                     │
│                         (Entry Point)                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────┐
        │  1. Pre-load Setup                 │
        │  - clearSession()                  │
        │  - startSpinner()                  │
        │  - show userInteractionShield      │
        └────────────┬───────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │  2. Load Dataset                   │
        │  Dataset.loadDataset()             │
        │    → HiCDataset.init()             │
        │    → hicFile.init()                │
        └────────────┬───────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │  3. Create Genome                   │
        │  new Genome(dataset)                │
        │                                     │
        │  ⚡ POST EVENT:                    │
        │  EventBus.globalBus.post(           │
        │    "GenomeChange", genome.id)       │
        └────────────┬───────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │  4. Initialize State               │
        │  - Parse config.state or            │
        │    create default state             │
        │                                     │
        │  ⚠️ CRITICAL ORDER:                │
        │  setActiveDataset() FIRST           │
        │  (required by setState)             │
        └────────────┬───────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │  5. Set State                       │
        │  browser.setState(state)           │
        │    → StateManager.setState()       │
        │      - Clone state                 │
        │      - Adjust pixelSize            │
        │      - Configure locus              │
        │      - Return change flags         │
        └────────────┬───────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │  6. Render & Notify                │
        │  await browser.update()            │
        │    → RenderCoordinator.update()    │
        │      → repaint()                   │
        │                                     │
        │  browser.notifyLocusChange()       │
        │    ⚡ POST EVENT:                  │
        │    eventBus.post("LocusChange")    │
        └────────────┬───────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │  7. Notify Map Loaded              │
        │  browser.notifyMapLoaded()         │
        │    → NotificationCoordinator        │
        │                                     │
        │  ❌ DOES NOT POST EVENTS            │
        │  ✅ DIRECT METHOD CALLS ONLY        │
        └────────────┬───────────────────────┘
                     │
                     ├─────────────────────────────────────────────┐
                     │                                             │
                     ▼                                             ▼
        ┌──────────────────────────┐              ┌──────────────────────────┐
        │ Direct Method Calls      │              │ Event Subscriptions      │
        │ (ACTUALLY EXECUTED)      │              │ (NEVER RECEIVE EVENTS)   │
        └──────────────────────────┘              └──────────────────────────┘
                     │                                             │
        ┌────────────┼────────────┐              ┌───────────────┼───────────────┐
        │            │            │              │               │               │
        ▼            ▼            ▼              ▼               ▼               ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │Contact  │ │Chromosome│ │Rulers   │   │Contact   │  │Resolution│  │Normalize │
   │Matrix   │ │Selector  │ │         │   │Matrix    │  │Selector  │  │Widget    │
   │View     │ │          │ │         │   │View      │  │          │  │          │
   │         │ │          │ │         │   │          │  │          │  │          │
   │init()   │ │respond() │ │update() │   │subscribe │  │subscribe │  │subscribe │
   └─────────┘ └─────────┘ └─────────┘   │to MapLoad│  │to MapLoad│  │to MapLoad│
                                           │(dead)    │  │(dead)    │  │(dead)    │
                                           └──────────┘  └──────────┘  └──────────┘
        ┌─────────┐ ┌─────────┐ ┌─────────┐
        │Normalize│ │ColorScale│ │ControlMap│
        │Widget   │ │Widget    │ │Widget   │
        │         │ │          │ │         │
        │receive  │ │update()  │ │hide()   │
        │Event()  │ │          │ │         │
        └─────────┘ └─────────┘ └─────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │  8. Background Loading            │
        │  - Norm vector index (async)      │
        │  - Browser synchronization        │
        └────────────────────────────────────┘
```

## Event Flow Comparison

### What Actually Happens (Current State)

```
loadHicFile()
  │
  ├─→ Dataset.loadDataset() [async]
  │
  ├─→ setActiveDataset()
  │
  ├─→ setState()
  │   │
  │   ├─→ StateManager.setState()
  │   │
  │   └─→ update()
  │       │
  │       └─→ notifyLocusChange()
  │           │
  │           └─→ ⚡ eventBus.post("LocusChange")
  │               │
  │               └─→ [Subscribers receive event]
  │
  └─→ notifyMapLoaded()
      │
      └─→ Direct method calls (NO events posted)
          │
          ├─→ ContactMatrixView.init()
          ├─→ ChromosomeSelector.respond()
          ├─→ Rulers.update()
          ├─→ NormalizationWidget.receiveEvent() [direct event object]
          ├─→ ResolutionSelector.updateResolutions()
          ├─→ ColorScaleWidget.updateMapBackgroundColor()
          └─→ ControlMapWidget.hide()
```

### What Components Expect (But Never Happens)

```
Components subscribe to:
  - "MapLoad" event
  - "ControlMapLoad" event

But these events are NEVER posted to eventBus!

Subscribers:
  ✓ ContactMatrixView.subscribe("MapLoad")
  ✓ ResolutionSelector.subscribe("MapLoad")
  ✓ Ruler.subscribe("MapLoad")
  ✓ ChromosomeSelector.subscribe("MapLoad")
  ✓ NormalizationWidget.subscribe("MapLoad")
  ✓ ColorScaleWidget.subscribe("MapLoad")
  ✓ ControlMapWidget.subscribe("MapLoad", "ControlMapLoad")

All subscriptions are dead code!
```

## State Management Flow

```
setState(state)
  │
  ├─→ StateManager.setState()
  │   │
  │   ├─→ Clone state (avoid mutations)
  │   │
  │   ├─→ Adjust pixelSize
  │   │   └─→ browser.minPixelSize()
  │   │
  │   ├─→ Configure locus (if missing)
  │   │   └─→ state.configureLocus()
  │   │
  │   └─→ Return {chrChanged, resolutionChanged}
  │
  ├─→ browser.update()
  │   │
  │   └─→ RenderCoordinator.update()
  │       │
  │       ├─→ repaint()
  │       │   ├─→ Update rulers
  │       │   ├─→ Render tracks
  │       │   └─→ Render contact matrix
  │       │
  │       └─→ syncToOtherBrowsers() [if shouldSync]
  │
  └─→ notifyLocusChange()
      │
      └─→ ⚡ Posts "LocusChange" event
          │
          └─→ Subscribers:
              - ChromosomeSelector
              - ScrollbarWidget
              - ResolutionSelector
              - LocusGoto
```

## Notification Coordinator Flow

```
notifyMapLoaded(dataset, state, datasetType)
  │
  ├─→ _initializeContactMatrixViewForMapLoad()
  │   └─→ ContactMatrixView: enable handlers, clear caches
  │
  ├─→ _updateChromosomeSelectorForMapLoad()
  │   └─→ ChromosomeSelector.respondToDataLoadWithDataset()
  │
  ├─→ _updateRulersForMapLoad()
  │   └─→ Ruler.wholeGenomeLayout() + update()
  │
  ├─→ _updateNormalizationWidgetForMapLoad()
  │   └─→ NormalizationWidget.receiveEvent({type: "MapLoad", data})
  │       [Direct event object, NOT via eventBus]
  │
  ├─→ _updateResolutionSelectorForMapLoad()
  │   └─→ ResolutionSelector: unlock + updateResolutions()
  │
  ├─→ _updateColorScaleWidgetForMapLoad()
  │   └─→ ColorScaleWidget.updateMapBackgroundColor()
  │
  └─→ _updateControlMapWidgetForMapLoad()
      └─→ ControlMapWidget.hide() [if no control dataset]
```

## Key Timing Issues

### Critical Order Dependencies

1. **setActiveDataset() MUST be called before setState()**
   - Reason: `setState()` calls `minPixelSize()` which requires `activeDataset`
   - Location: `dataLoader.js:122, 134, 251`

2. **notifyMapLoaded() called AFTER setState()**
   - Reason: State must be configured before UI components update
   - Location: `dataLoader.js:138, 254`

3. **notifyLocusChange() called AFTER setState()**
   - Reason: Locus must be configured before notifying
   - Location: `hicBrowser.js:791`

### Race Conditions

1. **Normalization vector loading**
   - Started in background (line 158)
   - May complete after map is "loaded"
   - Triggers `notifyNormVectorIndexLoad()` when complete

2. **Browser synchronization**
   - Happens after map load
   - May trigger additional state changes
   - Location: `dataLoader.js:166-176`

## Summary

The map loading process involves:
- ✅ Direct method calls (working)
- ✅ Event posting for LocusChange (working)
- ✅ Event posting for GenomeChange (working)
- ❌ Event subscriptions for MapLoad (dead code)
- ❌ Event subscriptions for ControlMapLoad (dead code)

The system works despite the dead code because direct method calls handle all the necessary updates. However, the presence of event subscriptions that never receive events creates confusion and maintenance burden.
