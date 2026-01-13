# Offline Guide

Nookr Lot Mapper is designed to work fully offline - perfect for field surveys where internet connectivity is unreliable.

## How It Works

### Progressive Web App (PWA)

The app uses modern PWA technology:

1. **Service Worker** - Caches app shell and static assets
2. **IndexedDB** - Stores all lot data locally
3. **Cache API** - Stores map tiles for offline use

### What Works Offline

| Feature | Offline Support |
|---------|----------------|
| View/Edit Lots | Full |
| Create New Lots | Full |
| Search Lots | Full |
| GPS Location | Full (device GPS) |
| Drawing Tools | Full |
| Export JSON/GeoJSON | Full |
| Areas/Grouping | Full |
| Quick Add to Area | Full |
| Map Viewing | Cached tiles only |
| Edge Detection | Cached tiles only |
| Sync to Server | Queued until online |

---

## Installing the App

### Desktop (Chrome/Edge)

1. Visit the app URL
2. Click the **Install** icon in the address bar
3. Click **Install** in the prompt
4. App appears in your Start Menu/Applications

### Mobile (Android)

1. Open in Chrome
2. Tap the three-dot menu
3. Select **Add to Home Screen**
4. App icon appears on home screen

### Mobile (iOS)

1. Open in Safari
2. Tap the **Share** button
3. Select **Add to Home Screen**
4. App works like a native app

---

## Caching Map Tiles

### Optimistic Loading Strategy (New)
To ensure instant map loading, we use an **Optimistic Loading** strategy:
1.  **Network First (non-blocking)**: The app immediately requests tiles from the network.
2.  **Parallel Cache Check**: Simultaneously, it checks IndexedDB for a saved copy.
3.  **Instant Swap**: If a tile is found in the cache *before* the network responds (or if offline), it swaps to the local version instantly.
4.  **Background Save**: Successful network loads are saved to the cache in the background.

For maps to work offline, you must download tiles first:

### Download Process

1. Navigate to the area you want to cache
2. Click **Download Area** button
3. Draw a rectangle around the target area
4. Select zoom levels (more = larger download)
5. Wait for download to complete
6. Progress shown in status bar

### Automatic Tile Caching

Tiles you view are automatically cached:
- Every tile you pan to is saved
- Zoom in/out caches those levels
- Cache persists between sessions
- Works even without explicit download

### Cache Management

- Click **Show Cached** to see downloaded regions
- Cached regions shown as blue overlays
- Cache Manager in the menu shows storage usage
- Clear cache if storage is low

### Storage Limits

| Browser | Typical Limit |
|---------|---------------|
| Chrome | 60% of disk space |
| Firefox | 50% of disk space |
| Safari | 1GB |
| Edge | 60% of disk space |

---

## Offline Indicators

### Status Bar
- **ONLINE** (green) - Connected to internet
- **OFFLINE** (red) - No internet connection

### Sync Status
When offline, changes are queued:
- Data saved locally immediately
- Syncs automatically when back online
- No data loss if connection drops

---

## Areas Feature

### Create Areas
1. Click **Areas** in toolbar
2. Click **+ New Area**
3. Enter name and select color
4. Click **Save Area**

### Assign Lots to Areas
- In lot details panel, check area checkboxes
- Or use **Quick Add** for bulk assignment

### Quick Add to Area
1. Click **Quick Add** button
2. Click multiple lots to select (they highlight red)
3. Click **Confirm** when done
4. Select which area(s) to add to
5. Click **Add to Area**

---

## Best Practices

### Before Going to Field

1. Open the app while online
2. Download map tiles for your survey area
3. Browse around to cache extra tiles
4. Test offline mode (airplane mode)
5. Verify cached areas cover your needs

### During Field Work

1. Use GPS for accurate positioning
2. Save frequently (auto-saved anyway)
3. Don't worry about connectivity
4. All data stored locally
5. Use Quick Add for efficient lot grouping

### After Field Work

1. Connect to internet
2. App syncs automatically
3. Export data if needed
4. Clear old cache if storage is low

---

## Troubleshooting

### App Not Working Offline

1. Check if Service Worker is registered (DevTools > Application > Service Workers)
2. Ensure you visited while online first
3. Try clearing cache and revisiting

### Maps Not Showing Offline

1. Confirm you downloaded tiles for this area
2. Check if zoom level was cached
3. Zoom levels must match cached levels
4. Pan around area while online to cache tiles

### Data Not Syncing

1. Check internet connection
2. Look for sync errors in console
3. Data is safe - will sync when possible

---

## Technical Details

### Service Worker

Located at `/public/sw.js`:
- Caches app shell on install
- Uses network-first for API calls
- Uses cache-first for static assets
- Updates automatically when new version deployed

### IndexedDB Stores

| Store | Purpose |
|-------|---------|
| lots | Lot polygon data |
| projects | Project metadata |
| areas | Area/group definitions |
| tiles | Cached map tiles |
| syncQueue | Pending sync operations |

### Cache Version

Current cache version is tracked in the Service Worker. When updated:
1. New cache is created
2. Old cache is deleted on activation
3. Users get new version on next visit
