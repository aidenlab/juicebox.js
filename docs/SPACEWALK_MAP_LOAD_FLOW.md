# Control Flow: Loading Hi-C Map in Spacewalk

## Overview

This document traces the exact control flow when Spacewalk loads a Hi-C map, specifically focusing on how the locus is determined.

## Flow Diagram

```
Spacewalk.loadHicFile(url, name, mapType)
    │
    ├─→ Creates config: { url, name, isControl }
    │
    └─→ browser.loadHicFile(config)
            │
            └─→ DataLoader.loadHicFile(config)
                    │
                    ├─→ Dataset.loadDataset(config)  [Loads .hic file]
                    │
                    ├─→ Creates genome from dataset
                    │
                    ├─→ DECISION POINT: How to create state?
                    │   │
                    │   ├─→ If config.locus exists:
                    │   │   └─→ State.default(config)
                    │   │       └─→ parseGotoInput(config.locus)  [Sets locus from config]
                    │   │
                    │   ├─→ If config.state exists:
                    │   │   └─→ Use provided state (may have locus)
                    │   │
                    │   ├─→ If config.synchState exists:
                    │   │   └─→ syncState(config.synchState)  [Syncs from another browser]
                    │   │
                    │   └─→ ELSE (Spacewalk's case):
                    │       ├─→ state = State.default(config)
                    │       │   └─→ Creates: new State(0, 0, undefined, 0, 0, 1, "NONE")
                    │       │       └─→ locus = undefined
                    │       │
                    │       ├─→ setActiveDataset(dataset, state)
                    │       │
                    │       └─→ setState(state)
                    │           │
                    │           └─→ IF state.locus === undefined:
                    │               └─→ configureLocus(dataset, viewDimensions)
                    │                   └─→ Derives locus from:
                    │                       • x = 0, y = 0 (current position)
                    │                       • viewport width/height
                    │                       • chromosome sizes
                    │                       • Creates: { x: {chr, start, end}, y: {chr, start, end} }
                    │                       ⚠️ THIS IS JUICEBOX'S DEFAULT LOCUS
                    │
                    └─→ notifyMapLoaded(dataset, state, datasetType)
                            │
                            └─→ coordinator.onMapLoaded(dataset, state, datasetType)
                                    │
                                    ├─→ Updates internal components
                                    │   (contactMatrix, chromosomeSelector, rulers, etc.)
                                    │
                                    └─→ Calls external callbacks
                                            │
                                            └─→ Spacewalk's callback
                                                    │
                                                    └─→ IF ensembleManager.locus exists:
                                                        └─→ parseGotoInput(`${chr}:${start}-${end}`)
                                                            │
                                                            └─→ interactionHandler.parseGotoInput()
                                                                │
                                                                ├─→ Parses locus string
                                                                ├─→ Creates new state with Spacewalk's locus
                                                                ├─→ Calls setState(newState)
                                                                └─→ ✅ SPACEWALK'S LOCUS IS NOW SET
```

## Detailed Step-by-Step Flow

### Step 1: Spacewalk Initiates Load
**File**: `spacewalk/js/juicebox/juiceboxPanel.js:387`
```javascript
async loadHicFile(url, name, mapType) {
    const config = { url, name, isControl }
    await this.browser.loadHicFile(config)  // No locus in config!
}
```

**Key Point**: Spacewalk does NOT pass a locus in the config. This means Juicebox will need to derive one.

---

### Step 2: Juicebox DataLoader Processes Config
**File**: `juicebox.js/js/dataLoader.js:70-136`

Since Spacewalk's config has:
- ❌ No `config.locus`
- ❌ No `config.state`  
- ❌ No `config.synchState`

It falls into the **ELSE branch** (line 131-136):

```javascript
else {
    state = State.default(config);  // Creates default state
    this.browser.setActiveDataset(dataset, state);
    await this.browser.setState(state);  // ⚠️ This will configure locus!
}
```

---

### Step 3: State.default() Creates Initial State
**File**: `juicebox.js/js/hicState.js:432`
```javascript
static default(configOrUndefined) {
    const state = new State(0, 0, undefined, 0, 0, 1, "NONE")
    return state
}
```

**Result**: 
- `chr1 = 0` (whole genome)
- `chr2 = 0` (whole genome)
- `locus = undefined` ⚠️ **No locus yet!**
- `x = 0, y = 0` (top-left corner)
- `zoom = 0` (lowest resolution)

---

### Step 4: setState() Derives Default Locus
**File**: `juicebox.js/js/stateManager.js:88-116`

```javascript
async setState(state) {
    this.activeState = state.clone();
    
    // ⚠️ CRITICAL: If no locus, derive one from viewport
    if (undefined === state.locus) {
        const viewDimensions = this.browser.contactMatrixView.getViewDimensions();
        this.activeState.configureLocus(
            this.activeDataset, 
            viewDimensions
        );
    }
    // ...
}
```

**File**: `juicebox.js/js/hicState.js:239-254`
```javascript
configureLocus(dataset, viewDimensions) {
    const bpPerBin = dataset.bpResolutions[this.zoom];
    
    // Uses current x=0, y=0 position
    const startBP1 = Math.round(this.x * bpPerBin);  // = 0
    const startBP2 = Math.round(this.y * bpPerBin);  // = 0
    
    const chr1 = dataset.chromosomes[this.chr1];  // Whole genome (chr1=0)
    const chr2 = dataset.chromosomes[this.chr2];  // Whole genome (chr2=0)
    
    // Calculates end based on viewport size
    const endBP1 = Math.min(chr1.size, Math.round(((viewDimensions.width / pixelsPerBin) * bpPerBin)) + startBP1);
    const endBP2 = Math.min(chr2.size, Math.round(((viewDimensions.height / pixelsPerBin) * bpPerBin)) + startBP2);
    
    // ⚠️ Creates Juicebox's default locus
    this.locus = {
        x: { chr: chr1.name, start: startBP1, end: endBP1 },
        y: { chr: chr2.name, start: startBP2, end: endBP2 }
    };
}
```

**Result**: Juicebox has now set a **default locus** based on:
- Starting at position (0, 0) - top-left corner
- Viewport dimensions
- Whole genome view (chr1=0, chr2=0)

---

### Step 5: notifyMapLoaded() Triggers Coordinator
**File**: `juicebox.js/js/dataLoader.js:138`
```javascript
this.browser.notifyMapLoaded(dataset, state, dataset.datasetType);
```

**File**: `juicebox.js/js/hicBrowser.js:369`
```javascript
notifyMapLoaded(dataset, state, datasetType) {
    this.coordinator.onMapLoaded(dataset, state, datasetType);
}
```

---

### Step 6: Coordinator Updates Components
**File**: `juicebox.js/js/browserCoordinator.js:89-154`

The coordinator:
1. Initializes contact matrix view
2. Updates chromosome selector
3. Updates rulers
4. Updates normalization widget
5. Updates resolution selector
6. Updates color scale widget
7. Updates control map widget
8. **Calls external callbacks** ← Spacewalk's callback fires here

---

### Step 7: Spacewalk's Callback Sets Locus
**File**: `spacewalk/js/juicebox/juiceboxPanel.js:277-288`

```javascript
this.browser.coordinator.addCallback('onMapLoaded', async ({ dataset, state, datasetType }) => {
    // ✅ Apply Spacewalk locus IMMEDIATELY after map load
    if (ensembleManager && ensembleManager.locus && datasetType !== 'livemap') {
        const { chr, genomicStart, genomicEnd } = ensembleManager.locus
        await this.browser.parseGotoInput(`${chr}:${genomicStart}-${genomicEnd}`)
    }
    // ... rest of callback
})
```

**File**: `juicebox.js/js/interactionHandler.js:350+` (parseGotoInput)
```javascript
async parseGotoInput(input) {
    // Parses locus string: "chr1:1000-2000"
    // Creates new state with Spacewalk's locus
    // Calls setState(newState)
    // ✅ SPACEWALK'S LOCUS IS NOW THE ACTIVE LOCUS
}
```

---

## Locus Decision Summary

### Timeline of Locus Values

| Step | Locus Source | Locus Value |
|------|-------------|-------------|
| **1** | Initial state | `undefined` |
| **2** | `State.default()` | `undefined` (no locus in state) |
| **3** | `setState()` → `configureLocus()` | **Juicebox default locus** (derived from viewport) |
| **4** | `notifyMapLoaded()` | Juicebox default locus (still active) |
| **5** | Spacewalk callback → `parseGotoInput()` | **Spacewalk locus** (overrides default) |

### Key Points

1. **Juicebox sets a default locus** during `setState()` if none is provided
   - This happens BEFORE `notifyMapLoaded()` is called
   - The default locus is based on viewport dimensions and starting at (0,0)

2. **Spacewalk's locus is applied AFTER map load** via coordinator callback
   - The callback fires immediately after `notifyMapLoaded()`
   - Spacewalk's `parseGotoInput()` creates a new state with the correct locus
   - This new state replaces Juicebox's default locus

3. **The coordinator callback ensures proper timing**
   - It fires at the right moment: after map load but before rendering
   - Spacewalk's locus override happens synchronously in the callback
   - No race conditions or timing issues

## Potential Issues & Solutions

### ✅ Current Solution (Working)

The coordinator callback approach ensures:
- Spacewalk's locus is applied immediately after map load
- It overrides any default locus Juicebox may have set
- The timing is correct (after dataset load, before rendering)

### ⚠️ Alternative Approach (Not Used)

Spacewalk could pass the locus in the config:
```javascript
const config = { 
    url, 
    name, 
    isControl,
    locus: `${chr}:${genomicStart}-${genomicEnd}`  // ← Pass locus upfront
}
```

**Why not used**: 
- Spacewalk's locus might change dynamically
- Coordinator callback provides more flexibility
- Ensures locus is always up-to-date from Spacewalk's single source of truth

## Conclusion

**Spacewalk's locus is the single source of truth** and is properly applied via the coordinator callback. The flow ensures:

1. Map loads with Juicebox's default locus (necessary for initialization)
2. Coordinator callback fires immediately after load
3. Spacewalk's locus is applied, overriding the default
4. Final state uses Spacewalk's locus

The coordinator pattern provides the perfect hook point for Spacewalk to inject its locus at the right moment in the loading process.
