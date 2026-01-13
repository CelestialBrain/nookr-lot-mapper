# Features Guide

## Map Controls

### Map Layers
- **Street** - OpenStreetMap tiles
- **Satellite** - Esri World Imagery
- **Dark** - Stadia Dark tiles for night use

### GPS Location
- **GPS Button** - Toggle location tracking
- Blue pulsing dot shows your position
- Arrow shows compass heading direction
- Auto-centers map on first activation

### Distance Ruler
When GPS is active and a lot is selected, a bottom bar shows:
- Distance to lot center (meters/km)
- Bearing direction (N/NE/E/SE/S/SW/W/NW)

---

## Lot Tools

### Select Tool (S)
- Click lots to view details
- Click empty area to deselect

### Draw Tool (D)
- Click to place vertices
- Double-click to complete polygon
- `Ctrl+Z` removes last vertex while drawing

### Edit Tool (E)
- Click a lot to enable editing
- Drag vertices to reshape
- Click away to save changes

### Delete Tool (X)
- Click any lot to delete
- Confirmation dialog prevents accidents

---

## Smart Lot Selection (Edge Detect)

The Edge Detect feature uses image processing to auto-detect lot boundaries:

1. Enable Edge Detect mode
2. Click inside a lot on the map
3. Algorithm detects edges and creates polygon
4. New lots snap to existing lot edges

---

## Lot Details

Click a lot to open the details panel:

| Field | Description |
|-------|-------------|
| Lot Number | Sequential number (auto-assigned) |
| Block Number | Block grouping |
| Owner | Property owner name |
| Status | Available, Sold, Reserved, Pending |
| Area | Calculated area (read-only) |
| Coordinates | Polygon vertices (read-only) |
| Notes | Additional notes |
| Areas/Groups | Assign lot to multiple areas |

### Share Link
Click **Share** to copy a URL that opens the map centered on this lot.

---

## Areas/Grouping

Organize lots into named groups:

1. Click **Areas** button in toolbar
2. Click **+ New Area** to create an area
3. Set name and color
4. Assign lots to areas via checkboxes in lot details
5. Toggle visibility to show/hide lots by area

---

## Origin Point

Set a project origin point (survey reference):

1. Click **Set Origin** button
2. Click anywhere on the map
3. Origin is saved to project (hidden from view)
4. Included in share codes for reference

---

## Data Management

### Export
- **JSON** - Full data with lot details
- **GeoJSON** - Standard GIS format
- **PDF** - Map with lot overlays

### Import
- Click **Import** to load previously exported data
- Supports JSON and share codes

### Share Codes
- Click **Share Code** to generate a compact shareable code
- Recipients can import via **Import Code**
- Includes lots, areas, and origin point

---

## Offline Support

### Automatic Caching
The app works offline automatically:
- App shell cached via Service Worker
- All lot data stored in IndexedDB
- Changes sync when back online

### Map Tile Caching
To use maps offline:
1. Click **Download Area**
2. Draw a rectangle on the map
3. Select zoom levels to cache
4. Wait for download to complete
5. Click **Show Cached** to view downloaded regions

### PWA Installation
Install as an app on your device:
1. Open the app in Chrome/Edge
2. Click the install icon in address bar
3. App works fully offline after installation

---

## Undo/Redo

| Action | Shortcut |
|--------|----------|
| Undo | `Ctrl+Z` / `Cmd+Z` |
| Redo | `Ctrl+Shift+Z` / `Ctrl+Y` |

Supports undoing:
- Lot creation
- Lot deletion
- Lot updates
- Vertex placement (while drawing)

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| S | Select tool |
| D | Draw tool |
| E | Edit tool |
| X | Delete tool |
| Escape | Cancel current action |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
