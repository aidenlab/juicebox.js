## Recommended breakdown strategy (Fowler’s approach):

### Phase 4A: Extract Notification Coordinator (low risk)
- Move all `notify*()` methods to a `NotificationCoordinator`
- `HICBrowser` delegates to it
- **Benefit**: Isolates UI coordination logic

### Phase 4B: Extract State Manager (medium risk)
- Move state mutation methods (`setState`, `setZoom`, etc.) to `StateManager`
- `HICBrowser` becomes a facade that delegates
- **Benefit**: Centralizes state logic

### Phase 4C: Extract Data Loader (medium risk)
- Move `loadHicFile()`, `loadTracks()`, etc. to `DataLoader`
- **Benefit**: Separates I/O from coordination

### Phase 4D: Extract Rendering Coordinator (higher risk)
- Move `update()`, `repaint()`, rendering logic to `RenderingCoordinator`
- **Benefit**: Separates rendering from state management

### Phase 4E: Extract Interaction Handler (lower risk)
- Move user interaction methods (`goto()`, `shiftPixels()`, etc.) to `InteractionHandler`
- **Benefit**: Separates user input from business logic

## The Facade Pattern approach:

After extraction, `HICBrowser` becomes a Facade:

```javascript
class HICBrowser {
    constructor() {
        this.stateManager = new StateManager(this);
        this.dataLoader = new DataLoader(this);
        this.notificationCoordinator = new NotificationCoordinator(this);
        this.renderingCoordinator = new RenderingCoordinator(this);
        this.interactionHandler = new InteractionHandler(this);
        this.syncManager = new BrowserSyncManager(this);
    }
    
    // Public API - delegates to coordinators
    async loadHicFile(config) {
        await this.dataLoader.loadHicFile(config);
        this.notificationCoordinator.notifyMapLoaded(...);
        await this.renderingCoordinator.update();
    }
}
```

## Recommendation:

Start with Phase 4A (Notification Coordinator) because:
1. Low risk — notification methods are already isolated
2. Clear boundaries — UI coordination is distinct
3. Immediate benefit — reduces `HICBrowser` size
4. Sets a pattern for further extractions

Then proceed incrementally: State Manager → Data Loader → Rendering Coordinator → Interaction Handler.

Should I proceed with Phase 4A (Notification Coordinator), or would you prefer a different starting point?