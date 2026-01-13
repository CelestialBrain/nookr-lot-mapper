/**
 * Lot Manager - Central state management for lots
 * Handles CRUD operations, Leaflet integration, and import/export
 */

import { db } from '../db/IndexedDBStore.js';
import { syncManager } from '../db/SyncManager.js';
import { drawingTools } from './DrawingTools.js';

// Lot status colors
const LOT_STATUS_COLORS = {
    available: { color: '#22c55e', fill: '#22c55e' },  // Green
    reserved: { color: '#eab308', fill: '#eab308' },  // Yellow
    sold: { color: '#ef4444', fill: '#ef4444' },  // Red
    default: { color: '#62bce0', fill: '#62bce0' }   // Blue (no status)
};

class LotManager {
    constructor() {
        this.map = null;
        this.lots = [];
        this.lotsLayer = null;
        this.selectedLotId = null;
        this.nextLotNumber = 1;
        this.currentProjectId = null; // Current active project
        this.onLotSelect = null;
        this.onLotCountChange = null;
        this.onProjectChange = null; // Callback when project changes
        this.undoStack = []; // { action: 'create'|'update'|'delete', lot: {...}, prevLot?: {...} }
        this.redoStack = []; // Same format as undoStack
        this.onUndoChange = null; // Callback when undo availability changes
    }

    async init(map) {
        this.map = map;

        // Create a feature group for lots
        this.lotsLayer = L.featureGroup().addTo(map);

        // Load lots from IndexedDB
        await this.loadLots();

        console.log('LotManager initialized with', this.lots.length, 'lots');
    }

    async loadLots() {
        try {
            // Ensure we have a default project
            if (!this.currentProjectId) {
                const defaultProject = await db.createDefaultProject();
                this.currentProjectId = defaultProject.id;
            }

            // Load only lots for current project
            this.lots = await db.getLotsByProject(this.currentProjectId);

            // Calculate next lot number
            const lotNumbers = this.lots
                .map(l => parseInt(l.lotNumber) || 0)
                .filter(n => !isNaN(n));
            this.nextLotNumber = lotNumbers.length > 0
                ? Math.max(...lotNumbers) + 1
                : 1;

            // Render all lots on map
            this.renderAllLots();
            this.updateLotCount();
        } catch (error) {
            console.error('Failed to load lots:', error);
            this.lots = [];
        }
    }

    async switchProject(projectId) {
        this.currentProjectId = projectId;
        this.selectedLotId = null;
        await this.loadLots();
        this.onProjectChange?.(projectId);
    }

    renderAllLots() {
        this.lotsLayer.clearLayers();

        this.lots.forEach(lot => {
            this.addLotToMap(lot);
        });
    }

    addLotToMap(lot) {
        if (!lot.coordinates || lot.coordinates.length < 3) return;

        // Normalize and validate coordinates - handle both array and object formats
        const latLngs = [];
        for (const c of lot.coordinates) {
            let lat, lng;

            // Handle object format {lat, lng}
            if (c && typeof c.lat === 'number' && typeof c.lng === 'number') {
                lat = c.lat;
                lng = c.lng;
            }
            // Handle array format [lat, lng]
            else if (Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
                lat = c[0];
                lng = c[1];
            }
            // Invalid coordinate - skip this lot
            else {
                console.warn('Invalid coordinate in lot', lot.id, ':', c);
                return;
            }

            // Validate range
            if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                console.warn('Out of range coordinate in lot', lot.id);
                return;
            }

            latLngs.push([lat, lng]);
        }

        if (latLngs.length < 3) return;

        try {
            // Get status-based colors
            const statusColors = LOT_STATUS_COLORS[lot.status] || LOT_STATUS_COLORS.default;

            const polygon = L.polygon(latLngs, {
                color: statusColors.color,
                fillColor: statusColors.fill,
                fillOpacity: 0.3,
                weight: 2,
                className: `lot-polygon lot-status-${lot.status || 'none'}`
            });

            // Store lot ID on polygon
            polygon.lotId = lot.id;

            // Simple click handler - just select the lot
            // Delete and edit modes are handled by the lotsLayer group click in DrawingTools
            polygon.on('click', () => {
                this.selectLot(lot.id);
            });

            // Add to layer
            polygon.addTo(this.lotsLayer);

            // Add label
            const center = polygon.getBounds().getCenter();
            const label = lot.lotNumber ? `Lot ${lot.lotNumber}` : lot.id.slice(-6);

            const icon = L.divIcon({
                className: 'lot-label',
                html: `<div style="
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
          ">${label}</div>`,
                iconSize: null
            });

            L.marker(center, { icon, interactive: false }).addTo(this.lotsLayer);
        } catch (err) {
            console.warn('Failed to add lot to map:', lot.id, err);
        }
    }

    async createLot(coordinates) {
        // Normalize coordinates to objects {lat, lng}
        const normalizedCoords = coordinates.map(c => {
            if (Array.isArray(c)) return { lat: c[0], lng: c[1] };
            if (c && typeof c.lat !== 'undefined') return c;
            return null;
        }).filter(c => c);

        if (normalizedCoords.length < 3) {
            console.warn('Invalid coordinates for new lot');
            return null;
        }

        // Check for overlaps with existing lots
        if (this.checkOverlap(normalizedCoords)) {
            throw new Error('This lot overlaps with an existing lot.');
        }

        const lot = {
            id: this.generateId(),
            projectId: this.currentProjectId, // Associate with current project
            lotNumber: String(this.nextLotNumber++),
            blockNumber: '',
            owner: '',
            status: 'available', // Default status: available, reserved, sold
            notes: '',
            coordinates: normalizedCoords,
            areaSqm: this.calculateArea(normalizedCoords),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Save to IndexedDB
        await db.saveLot(lot);

        // Queue for sync
        syncManager.queueForSync('create', lot);

        // Add to local array
        this.lots.push(lot);

        // Add to map
        this.addLotToMap(lot);

        // Push to undo stack
        this.pushUndo('create', lot);

        // Notify
        if (this.onLotCountChange) {
            this.onLotCountChange(this.lots.length);
        }

        // Select the new lot
        this.selectLot(lot.id);

        return lot;
    }

    editLot(id) {
        const lot = this.getLot(id);
        if (lot) {
            this.selectedLotId = id;
            if (this.onLotSelect) {
                this.onLotSelect(lot);
            }
        }
    }

    async updateLot(id, updates, skipUndo = false) {
        const index = this.lots.findIndex(l => l.id === id);
        if (index === -1) return null;

        // Save previous state for undo
        const prevLot = JSON.parse(JSON.stringify(this.lots[index]));

        // Update local
        this.lots[index] = { ...this.lots[index], ...updates };

        // Recalculate area if coordinates changed
        if (updates.coordinates) {
            this.lots[index].areaSqm = this.calculateArea(updates.coordinates);
        }

        // Push to undo stack
        if (!skipUndo) {
            this.pushUndo('update', this.lots[index], prevLot);
        }

        // Save to IndexedDB
        await db.saveLot(this.lots[index]);

        // Queue for sync
        syncManager.queueForSync('update', this.lots[index]);

        // Re-render on map
        this.renderAllLots();

        return this.lots[index];
    }

    async updateLotCoordinates(id, coordinates) {
        // Normalize coordinates
        const normalizedCoords = coordinates.map(c => {
            if (Array.isArray(c)) return { lat: c[0], lng: c[1] };
            if (c && typeof c.lat !== 'undefined') return c;
            return null;
        }).filter(c => c);

        if (normalizedCoords.length < 3) {
            console.warn('Invalid coordinates update');
            return null;
        }

        // Check for overlaps (excluding self)
        if (this.checkOverlap(normalizedCoords, id)) {
            throw new Error('This lot overlaps with an existing lot.');
        }

        return await this.updateLot(id, { coordinates: normalizedCoords });
    }

    async deleteLot(id, skipUndo = false) {
        // Get lot before deleting for sync and undo
        const lot = this.getLot(id);
        if (!lot) return;

        // Push to undo stack BEFORE deleting
        if (!skipUndo) {
            this.pushUndo('delete', JSON.parse(JSON.stringify(lot)));
        }

        // Remove from IndexedDB
        await db.deleteLot(id);

        // Queue for sync
        syncManager.queueForSync('delete', lot);

        // Remove from local array
        this.lots = this.lots.filter(l => l.id !== id);

        // Re-render map
        this.renderAllLots();

        // Update count
        this.updateLotCount();

        // Deselect
        if (this.selectedLotId === id) {
            this.selectedLotId = null;
        }
    }

    async clearAll() {
        await db.clearAllLots();
        this.lots = [];
        this.lotsLayer.clearLayers();
        this.selectedLotId = null;
        this.nextLotNumber = 1;
        this.undoStack = []; // Clear undo history too
        this.updateLotCount();
        this.notifyUndoChange();
    }

    // ==================== UNDO SYSTEM ====================

    pushUndo(action, lot, prevLot = null) {
        this.undoStack.push({ action, lot, prevLot });
        // Clear redo stack on new action
        this.redoStack = [];
        // Limit stack size to 50 actions
        if (this.undoStack.length > 50) {
            this.undoStack.shift();
        }
        this.notifyUndoChange();
    }

    canUndo() {
        return this.undoStack.length > 0;
    }

    async undo() {
        if (!this.canUndo()) return false;

        const entry = this.undoStack.pop();
        this.notifyUndoChange();

        try {
            switch (entry.action) {
                case 'create':
                    // Undo create = delete the lot
                    await this.deleteLot(entry.lot.id, true);
                    this.redoStack.push(entry);
                    break;
                case 'delete':
                    // Undo delete = recreate the lot
                    await db.saveLot(entry.lot);
                    this.lots.push(entry.lot);
                    this.addLotToMap(entry.lot);
                    this.updateLotCount();
                    this.redoStack.push(entry);
                    break;
                case 'update':
                    // Undo update = restore previous state
                    if (entry.prevLot) {
                        const index = this.lots.findIndex(l => l.id === entry.lot.id);
                        if (index !== -1) {
                            this.lots[index] = entry.prevLot;
                            await db.saveLot(entry.prevLot);
                            this.renderAllLots();
                            // Push inverse to redo
                            this.redoStack.push({ action: 'update', lot: entry.prevLot, prevLot: entry.lot });
                        }
                    }
                    break;
            }
            return true;
        } catch (error) {
            console.error('Undo failed:', error);
            return false;
        }
    }

    canRedo() {
        return this.redoStack.length > 0;
    }

    async redo() {
        if (!this.canRedo()) return false;

        const entry = this.redoStack.pop();

        try {
            switch (entry.action) {
                case 'create':
                    // Redo create = recreate the lot
                    await db.saveLot(entry.lot);
                    this.lots.push(entry.lot);
                    this.addLotToMap(entry.lot);
                    this.updateLotCount();
                    this.undoStack.push(entry); // Push back to undo
                    break;
                case 'delete':
                    // Redo delete = delete again
                    await this.deleteLot(entry.lot.id, true);
                    this.undoStack.push(entry); // Push back to undo
                    break;
                case 'update':
                    // Redo update = apply the update again
                    const index = this.lots.findIndex(l => l.id === entry.lot.id);
                    if (index !== -1) {
                        const currentState = JSON.parse(JSON.stringify(this.lots[index]));
                        this.lots[index] = entry.lot;
                        await db.saveLot(entry.lot);
                        this.renderAllLots();
                        this.undoStack.push({ action: 'update', lot: entry.lot, prevLot: currentState });
                    }
                    break;
            }
            this.notifyUndoChange();
            return true;
        } catch (error) {
            console.error('Redo failed:', error);
            return false;
        }
    }

    notifyUndoChange() {
        if (this.onUndoChange) {
            this.onUndoChange(this.canUndo());
        }
    }

    selectLot(id) {
        // Prevent showing details if we are in edit or delete mode
        if (drawingTools.getCurrentTool() === 'edit' || drawingTools.getCurrentTool() === 'delete') {
            return;
        }

        this.selectedLotId = id;

        // Update polygon styles
        this.lotsLayer.eachLayer(layer => {
            if (layer.lotId) {
                const isSelected = layer.lotId === id;
                layer.setStyle({
                    color: isSelected ? '#fbbf24' : '#62bce0',
                    fillColor: isSelected ? '#fbbf24' : '#62bce0',
                    fillOpacity: isSelected ? 0.4 : 0.3,
                    weight: isSelected ? 3 : 2
                });
            }
        });

        // Trigger callback
        const lot = this.getLot(id);
        if (lot && this.onLotSelect) {
            this.onLotSelect(lot);
        }
    }

    getLot(id) {
        return this.lots.find(l => l.id === id);
    }

    updateLotCount() {
        if (this.onLotCountChange) {
            this.onLotCountChange(this.lots.length);
        }
    }

    // ==================== EXPORT/IMPORT ====================

    exportJSON() {
        const data = {
            subdivision: 'Nookr Lot Export',
            exportDate: new Date().toISOString(),
            totalLots: this.lots.length,
            lots: this.lots.map(lot => ({
                id: lot.id,
                lotNumber: lot.lotNumber,
                blockNumber: lot.blockNumber,
                owner: lot.owner,
                areaSqm: lot.areaSqm,
                areaFormatted: this.formatArea(lot.areaSqm),
                coordinates: lot.coordinates,
                notes: lot.notes,
                createdAt: lot.createdAt
            }))
        };

        this.downloadFile(JSON.stringify(data, null, 2), 'lots.json', 'application/json');
    }

    exportGeoJSON() {
        const geojson = {
            type: 'FeatureCollection',
            features: this.lots.map(lot => ({
                type: 'Feature',
                properties: {
                    id: lot.id,
                    lotNumber: lot.lotNumber,
                    blockNumber: lot.blockNumber,
                    owner: lot.owner,
                    areaSqm: lot.areaSqm,
                    notes: lot.notes
                },
                geometry: {
                    type: 'Polygon',
                    coordinates: [[
                        ...lot.coordinates.map(c => [c.lng, c.lat]),
                        [lot.coordinates[0].lng, lot.coordinates[0].lat] // Close polygon
                    ]]
                }
            }))
        };

        this.downloadFile(JSON.stringify(geojson, null, 2), 'lots.geojson', 'application/geo+json');
    }

    async importData(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    let imported = 0;

                    if (data.type === 'FeatureCollection') {
                        // GeoJSON format
                        for (const feature of data.features) {
                            const coords = feature.geometry.coordinates[0].slice(0, -1);
                            const lot = {
                                id: feature.properties.id || this.generateId(),
                                lotNumber: feature.properties.lotNumber || '',
                                blockNumber: feature.properties.blockNumber || '',
                                owner: feature.properties.owner || '',
                                notes: feature.properties.notes || '',
                                coordinates: coords.map(c => ({ lat: c[1], lng: c[0] })),
                                areaSqm: feature.properties.areaSqm || 0,
                                createdAt: new Date().toISOString()
                            };

                            await db.saveLot(lot);
                            this.lots.push(lot);
                            imported++;
                        }
                    } else if (data.lots) {
                        // Our JSON format
                        for (const lot of data.lots) {
                            lot.id = lot.id || this.generateId();
                            await db.saveLot(lot);
                            this.lots.push(lot);
                            imported++;
                        }
                    }

                    this.renderAllLots();
                    this.updateLotCount();
                    resolve(imported);
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    }

    // ==================== UTILITIES ====================

    generateId() {
        return `lot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    calculateArea(coordinates) {
        if (!coordinates || coordinates.length < 3) return 0;

        const EARTH_RADIUS = 6371000;
        const toRad = d => d * Math.PI / 180;

        // Calculate centroid
        const centroid = {
            lat: coordinates.reduce((s, c) => s + c.lat, 0) / coordinates.length,
            lng: coordinates.reduce((s, c) => s + c.lng, 0) / coordinates.length
        };

        // Convert to planar coordinates (meters from centroid)
        const haversine = (p1, p2) => {
            const dLat = toRad(p2.lat - p1.lat);
            const dLng = toRad(p2.lng - p1.lng);
            const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) *
                Math.sin(dLng / 2) ** 2;
            return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        };

        const planar = coordinates.map(c => ({
            x: haversine({ lat: centroid.lat, lng: centroid.lng }, { lat: centroid.lat, lng: c.lng }) *
                (c.lng > centroid.lng ? 1 : -1),
            y: haversine({ lat: centroid.lat, lng: centroid.lng }, { lat: c.lat, lng: centroid.lng }) *
                (c.lat > centroid.lat ? 1 : -1)
        }));

        // Shoelace formula
        let area = 0;
        for (let i = 0; i < planar.length; i++) {
            const j = (i + 1) % planar.length;
            area += planar[i].x * planar[j].y - planar[j].x * planar[i].y;
        }

        return Math.abs(area) / 2;
    }

    formatArea(sqm) {
        if (!sqm) return '0 m²';
        if (sqm < 1) return `${(sqm * 10000).toFixed(2)} cm²`;
        if (sqm < 10000) return `${sqm.toFixed(2)} m²`;
        return `${(sqm / 10000).toFixed(4)} hectares`;
    }

    formatCoordinates(lat, lng, precision = 6) {
        return `${lat.toFixed(precision)}, ${lng.toFixed(precision)}`;
    }

    downloadFile(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
    /**
     * Snap coordinates to nearby existing lot edges
     * @param {Array} coords - Coordinates to snap
     * @param {number} snapDistance - Distance in degrees (~5m at equator)
     * @returns {Array} Snapped coordinates
     */
    snapToNearbyEdges(coords, snapDistance = 0.00005) {
        if (!coords || coords.length < 3 || this.lots.length === 0) return coords;

        // Collect all edge points from existing lots
        const existingPoints = [];
        for (const lot of this.lots) {
            if (!lot.coordinates) continue;
            for (const c of lot.coordinates) {
                const lat = c.lat !== undefined ? c.lat : c[0];
                const lng = c.lng !== undefined ? c.lng : c[1];
                existingPoints.push({ lat, lng });
            }
        }

        // Snap each coordinate
        return coords.map(coord => {
            const lat = coord.lat !== undefined ? coord.lat : coord[0];
            const lng = coord.lng !== undefined ? coord.lng : coord[1];

            let closestDist = Infinity;
            let snappedLat = lat;
            let snappedLng = lng;

            for (const ep of existingPoints) {
                const dist = Math.sqrt((lat - ep.lat) ** 2 + (lng - ep.lng) ** 2);
                if (dist < snapDistance && dist < closestDist) {
                    closestDist = dist;
                    snappedLat = ep.lat;
                    snappedLng = ep.lng;
                }
            }

            return { lat: snappedLat, lng: snappedLng };
        });
    }

    /**
     * Get the next lot number (for UI preview)
     */
    getNextLotNumber() {
        return this.nextLotNumber;
    }

    /**
     * Check if new polygon overlaps with any existing lots
     * Uses center-point inclusion check to detect substantial overlaps/duplicates
     * @param {Array} newCoords - New coordinates
     * @param {string} excludeId - ID to exclude from check (for updates)
     */
    checkOverlap(newCoords, excludeId = null) {
        const getCenter = (coords) => {
            let lat = 0, lng = 0;
            coords.forEach(c => {
                lat += (c.lat || c[0]);
                lng += (c.lng || c[1]);
            });
            return { lat: lat / coords.length, lng: lng / coords.length };
        };

        const isPointInPoly = (pt, poly) => {
            const x = pt.lat, y = pt.lng;
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const start = poly[i].lat !== undefined ? poly[i] : { lat: poly[i][0], lng: poly[i][1] };
                const end = poly[j].lat !== undefined ? poly[j] : { lat: poly[j][0], lng: poly[j][1] };

                const xi = start.lat, yi = start.lng;
                const xj = end.lat, yj = end.lng;

                const intersect = ((yi > y) !== (yj > y))
                    && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        };

        // Normalize inputs locally for checking
        const newCenter = getCenter(newCoords);

        for (const lot of this.lots) {
            if (lot.id === excludeId) continue;
            if (!lot.coordinates || lot.coordinates.length < 3) continue;

            // Check if center of new lot is inside existing lot
            if (isPointInPoly(newCenter, lot.coordinates)) return true;

            // Check if center of existing lot is inside new lot
            const lotCenter = getCenter(lot.coordinates);
            if (isPointInPoly(lotCenter, newCoords)) return true;
        }
        return false;
    }

    /**
     * Get Leaflet layer by lot ID
     */
    getLayerByLotId(lotId) {
        if (!this.lotsLayer) return null;
        return this.lotsLayer.getLayers().find(layer => layer.lotId === lotId);
    }
}

export const lotManager = new LotManager();
