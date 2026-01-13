# API Reference

## LotManager

### Constructor
```javascript
const lotManager = new LotManager();
```

### Methods

#### `init(map)`
Initialize the lot manager with a Leaflet map instance.

```javascript
await lotManager.init(map);
```

#### `createLot(coordinates)`
Create a new lot polygon.

```javascript
const lot = await lotManager.createLot([
  { lat: 14.5995, lng: 120.9842 },
  { lat: 14.5998, lng: 120.9842 },
  { lat: 14.5998, lng: 120.9845 },
  { lat: 14.5995, lng: 120.9845 }
]);
```

**Returns:** `{ id, lotNumber, coordinates, area, ... }`

#### `updateLot(id, updates)`
Update lot properties.

```javascript
await lotManager.updateLot('lot-123', {
  owner: 'Juan Dela Cruz',
  notes: 'Corner lot'
});
```

#### `deleteLot(id)`
Delete a lot by ID.

```javascript
await lotManager.deleteLot('lot-123');
```

#### `getLot(id)`
Get lot by ID.

```javascript
const lot = lotManager.getLot('lot-123');
```

#### `undo()` / `redo()`
Undo or redo last action.

```javascript
await lotManager.undo();
await lotManager.redo();
```

#### `canUndo()` / `canRedo()`
Check if undo/redo is available.

```javascript
if (lotManager.canUndo()) {
  await lotManager.undo();
}
```

### Callbacks

```javascript
lotManager.onLotSelect = (lot) => { /* lot selected */ };
lotManager.onLotCountChange = (count) => { /* count changed */ };
lotManager.onUndoChange = (canUndo) => { /* undo state changed */ };
```

---

## DrawingTools

### Methods

#### `init(map, lotsLayer)`
Initialize drawing tools.

```javascript
drawingTools.init(map, lotManager.lotsLayer);
```

#### `setTool(tool)`
Set current tool mode.

```javascript
drawingTools.setTool('draw'); // 'select' | 'draw' | 'edit' | 'delete'
```

#### `getCurrentTool()`
Get current tool mode.

```javascript
const tool = drawingTools.getCurrentTool();
```

#### `undoLastVertex()`
Remove last vertex while drawing.

```javascript
drawingTools.undoLastVertex();
```

#### `isDrawing()`
Check if actively drawing.

```javascript
if (drawingTools.isDrawing()) {
  // user is placing vertices
}
```

---

## EdgeDetector

### Constructor
```javascript
const detector = new EdgeDetector(map, callback);
```

### Methods

#### `activate()` / `deactivate()`
Toggle edge detection mode.

```javascript
await detector.activate();
detector.deactivate();
```

#### `detectEdgesAt(latlng)`
Detect lot boundary at click point.

```javascript
const polygon = await detector.detectEdgesAt(latlng);
```

---

## IndexedDBStore

### Methods

#### `init()`
Initialize database.

```javascript
await db.init();
```

#### `saveLot(lot)` / `getAllLots()`
Store and retrieve lots.

```javascript
await db.saveLot(lot);
const lots = await db.getAllLots();
```

#### `deleteLot(id)`
Delete lot from storage.

```javascript
await db.deleteLot('lot-123');
```
