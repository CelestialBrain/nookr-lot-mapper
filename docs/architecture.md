# Architecture

## Project Structure

```
nookr-lot-mapper/
├── docs/                  # Documentation
├── public/
│   ├── sw.js             # Service Worker (PWA)
│   ├── manifest.json     # PWA manifest
│   └── icons/            # App icons
├── src/
│   ├── main.js           # App entry point, UI handlers
│   ├── style.css         # Global styles (Nookr Design System)
│   ├── lots/
│   │   ├── LotManager.js     # Lot CRUD, undo/redo
│   │   └── DrawingTools.js   # Leaflet.draw integration
│   ├── map/
│   │   ├── EdgeDetector.js   # Image processing, edge detection
│   │   └── TileCacheLayer.js # Cached tile layer
│   ├── db/
│   │   ├── IndexedDBStore.js # Persistent storage
│   │   └── SyncManager.js    # Sync queue management
│   └── share/
│       └── ShareCodeManager.js # Share code encoding/decoding
├── index.html            # Main HTML
└── package.json
```

## Core Modules

### LotManager
Manages all lot data and map visualization.

**Responsibilities:**
- CRUD operations for lots
- Undo/redo stack management
- Leaflet polygon rendering
- Edge snapping for new lots
- Area membership tracking

**Key Methods:**
- `createLot(coordinates)` - Create new lot
- `updateLot(id, updates)` - Update lot properties
- `deleteLot(id)` - Delete lot
- `undo()` / `redo()` - Action history

### DrawingTools
Handles user interactions for drawing and editing.

**Responsibilities:**
- Tool mode management (select/draw/edit/delete)
- Leaflet.draw handler integration
- Keyboard shortcuts
- Cursor management

### EdgeDetector
Smart lot selection using image processing.

**Algorithm:**
1. Capture map canvas as image
2. Apply Sobel edge detection
3. Color-based flood fill from click point
4. Convert filled region to polygon
5. Simplify polygon vertices

### IndexedDBStore
Persistent storage for lots, projects, areas, and tiles.

**Object Stores:**
| Store | Key | Description |
|-------|-----|-------------|
| lots | id | Lot polygons and metadata |
| projects | id | Project metadata, origin point |
| areas | id | Area/group definitions |
| tiles | key | Cached map tiles |
| syncQueue | id | Pending sync operations |

### ShareCodeManager
Encodes and decodes share codes for data transfer.

**Format:**
- LZ-String compressed JSON
- Checksum prefix for validation
- Includes lots, areas, origin point

## Offline Architecture

### Service Worker
Located at `/public/sw.js`:
- Caches app shell on install
- Network-first for API calls
- Cache-first for static assets
- Auto-updates on new deployment

### Data Persistence
```
Browser Storage
├── IndexedDB (primary)
│   ├── lots/projects/areas (app data)
│   └── tiles (map cache)
├── Cache API (via SW)
│   └── Static assets, CDN resources
└── LocalStorage
    └── User preferences
```

### Sync Flow
```
User Action → LotManager → IndexedDB
                              ↓
                         SyncQueue (if offline)
                              ↓
                         Server (when online)
```

## Data Flow

```
User Click → DrawingTools → LotManager → IndexedDB
                                 ↓
                           Map Render
```

## Technology Stack

| Component | Technology |
|-----------|------------|
| Map | Leaflet.js |
| Drawing | Leaflet.draw |
| Storage | IndexedDB |
| Offline | Service Worker + Cache API |
| Build | Vite |
| Styling | Vanilla CSS (Nookr Design System) |
| Compression | LZ-String |
| PDF Export | jsPDF + html2canvas |

## Design System

The app uses the "Nookr Industrial Swiss" design system:

- **Theme**: Light clinical white
- **Typography**: Inter font family
- **Corners**: Sharp (no border-radius)
- **Colors**: Grayscale primary, Nookr Cyan accent (#62bce0)
- **Icons**: Text-based (no emojis)
