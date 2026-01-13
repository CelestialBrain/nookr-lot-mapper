# Nookr Lot Mapper

A mobile-friendly lot mapping tool for field surveying and HOA lot management.

## ✨ Features

### Core Mapping
- **Interactive Map** - Satellite, street, and dark mode tiles
- **Smart Lot Selection** - Click to auto-detect lot boundaries using edge detection
- **Manual Drawing** - Draw polygons with vertex snapping to edges
- **Lot Details** - Store lot number, block, owner, and notes

### Mobile Features
- **GPS Location** (📍) - Show your position with real-time compass heading
- **Distance Ruler** - See distance and bearing to selected lot
- **Quick Actions FAB** - Floating button for quick access to Draw, Edge Detect, GPS, Undo
- **Lot Search** - Find lots by number, owner, or notes
- **Share Link** - Copy URL to share lot location

### Data Management
- **Offline Support** - Download map tiles for offline use
- **Auto-Save** - Lots saved to IndexedDB automatically
- **Export** - JSON and GeoJSON formats
- **Import** - Load previously saved data
- **Undo/Redo** - Full action history (Ctrl+Z / Ctrl+Shift+Z)

## 🚀 Getting Started

```bash
npm install
npm run dev
```

## 📱 Mobile Usage

1. **Open the app** on your phone
2. **Tap GPS button** (📍) to see your location
3. **Tap the ✨ FAB** for quick actions
4. **Search lots** using the search box
5. **Share lots** using the 🔗 button in lot details

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| While drawing: `Ctrl+Z` | Remove last vertex |

## 📄 License

MIT
