/**
 * Drawing Tools for creating and editing lot polygons
 * Uses Leaflet.draw for polygon creation
 */

import { lotManager } from './LotManager.js';

class DrawingTools {
    constructor() {
        this.map = null;
        this.currentTool = 'select';
        this.drawControl = null;
        this.editHandler = null; // Deprecated global handler, kept for safety
        this.currentEditLayer = null; // Track single layer being edited
        this.originalLatLngs = null; // Store for cancel/undo
        this.deleteMode = false;
        this.onPolygonComplete = null;
        this.lotsLayer = null;
        this.edgeDetector = null; // Reference for edge snapping
    }

    init(map, lotsLayer) {
        this.map = map;
        this.lotsLayer = lotsLayer;

        // Configure draw options
        this.drawOptions = {
            draw: {
                polygon: {
                    allowIntersection: false,
                    showArea: true,
                    shapeOptions: {
                        color: '#10b981',
                        fillColor: '#10b981',
                        fillOpacity: 0.3,
                        weight: 3
                    }
                },
                polyline: false,
                rectangle: false,
                circle: false,
                marker: false,
                circlemarker: false
            },
            edit: false
        };

        // Create draw control (hidden, we use our own toolbar)
        this.drawControl = new L.Control.Draw(this.drawOptions);

        // Set up event listeners
        this.setupEventListeners();

        console.log('DrawingTools initialized');
    }

    setupEventListeners() {
        // Listen for polygon creation
        this.map.on(L.Draw.Event.CREATED, (e) => {
            const layer = e.layer;
            const latLngs = layer.getLatLngs()[0];

            // Convert to our coordinate format
            const coordinates = latLngs.map(ll => ({
                lat: ll.lat,
                lng: ll.lng
            }));

            // Trigger callback
            if (this.onPolygonComplete) {
                this.onPolygonComplete(coordinates);
            }

            // Deactivate draw mode
            this.setTool('select');
        });

        // Listen for draw cancel
        this.map.on('draw:drawstop', () => {
            this.updateCursor();
        });

        // Listen for clicks on lots layer for single editing
        if (this.lotsLayer) {
            this.lotsLayer.on('click', (e) => {
                this.handleLayerClick(e);
            });
        }

        // Listen for map clicks (background) to save/deselect
        this.map.on('click', (e) => {
            // If editing, save and stop (click away behavior)
            if (this.currentEditLayer) {
                this.saveAndDisableEdit();
            } else if (this.currentTool === 'select') {
                // If selecting, deselect current
                lotManager.selectLot(null);
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            const shortcuts = {
                's': 'select',
                'd': 'draw',
                'e': 'edit',
                'x': 'delete'
            };

            if (shortcuts[e.key.toLowerCase()]) {
                this.setTool(shortcuts[e.key.toLowerCase()]);
                this.updateToolbarUI(shortcuts[e.key.toLowerCase()]);
            }

            if (e.key === 'Escape') {
                if (this.currentEditLayer) {
                    this.cancelCurrentEdit();
                } else {
                    this.setTool('select');
                    this.updateToolbarUI('select');
                    lotManager.selectLot(null);
                }
            }
        });
    }

    async handleLayerClick(e) {
        // Only handle edit and delete modes here
        if (this.currentTool === 'edit') {
            L.DomEvent.stop(e);
            if (e.layer && e.layer.lotId) {
                this.enableEdit(e.layer);
            }
        } else if (this.currentTool === 'delete') {
            L.DomEvent.stop(e);

            if (e.layer && e.layer.lotId) {
                const lotId = e.layer.lotId;
                // Use custom modal instead of browser confirm
                const confirmed = await window.showConfirmModal(
                    'Delete Lot',
                    'Are you sure you want to delete this lot?'
                );
                if (confirmed) {
                    lotManager.deleteLot(lotId);
                    window.showToast?.('Lot deleted', 'success');
                }
            }
        }
        // Select mode is handled by polygon's own click handler
    }

    enableEdit(layer) {
        // If already editing another layer, save and disable it
        if (this.currentEditLayer && this.currentEditLayer !== layer) {
            this.saveAndDisableEdit();
        }

        if (this.currentEditLayer === layer) {
            return; // Already editing this layer
        }

        this.currentEditLayer = layer;

        // Deep copy coordinates for cancel
        const latLngs = layer.getLatLngs() || [];
        this.originalLatLngs = latLngs.map(ring => {
            if (Array.isArray(ring)) {
                return ring.map(ll => L.latLng(ll.lat, ll.lng));
            }
            return L.latLng(ring.lat, ring.lng);
        });

        // Use Leaflet.Edit.Poly directly
        if (layer.editing) {
            layer.editing.enable();
            if (layer.setStyle) {
                layer.setStyle({ color: '#fbbf24', dashArray: '5, 5' }); // Visual feedback
            }
        }
    }

    disableEdit(layer) {
        if (layer && layer.editing) {
            layer.editing.disable();
            if (layer.setStyle) {
                layer.setStyle({ color: '#62bce0', dashArray: null }); // Reset style
            }
        }
    }

    saveAndDisableEdit() {
        if (this.currentEditLayer) {
            const layer = this.currentEditLayer;

            // Get new coordinates
            const latLngs = layer.getLatLngs()[0] || layer.getLatLngs();
            const coordinates = latLngs.map(ll => ({
                lat: ll.lat,
                lng: ll.lng
            }));

            // Save via LotManager
            if (layer.lotId) {
                lotManager.updateLotCoordinates(layer.lotId, coordinates);
            }

            // Disable editing
            this.disableEdit(layer);
            this.currentEditLayer = null;
            this.originalLatLngs = null;
        }
    }

    cancelCurrentEdit() {
        if (this.currentEditLayer && this.originalLatLngs) {
            const layer = this.currentEditLayer;

            // Restore original coordinates
            layer.setLatLngs(this.originalLatLngs);

            // Disable editing
            this.disableEdit(layer);
            this.currentEditLayer = null;
            this.originalLatLngs = null;
        }
    }

    setTool(tool) {
        // If leaving edit mode, save pending edits
        if (this.currentTool === 'edit' && tool !== 'edit') {
            this.saveAndDisableEdit();
        }

        this.currentTool = tool;
        this.deleteMode = false;

        // Disable any active drawing
        if (this.drawHandler) {
            this.drawHandler.disable();
            this.drawHandler = null;
        }

        // Global edit handler is no longer used, but clear ensures safety
        if (this.editHandler) {
            this.editHandler.disable();
            this.editHandler = null;
        }

        switch (tool) {
            case 'draw':
                this.startDrawing();
                break;
            case 'edit':
                // Do nothing, wait for click
                break;
            case 'delete':
                this.deleteMode = true;
                break;
            case 'select':
            default:
                // Default select mode
                break;
        }

        this.updateCursor();
    }

    async startDrawing() {
        // Prepare edge detection for snapping
        if (this.edgeDetector) {
            await this.edgeDetector.prepareForSnapping();
            console.log('DrawingTools: Edge detection prepared for snapping');
        }

        // Create new polygon draw handler
        this.drawHandler = new L.Draw.Polygon(this.map, this.drawOptions.draw.polygon);

        // Vertices placed exactly where user clicks (no automatic snapping)
        this.drawHandler.enable();
    }

    // Deprecated global edit (kept empty or removed)
    startEditing() {
        // No-op: Wait for user to click a lot
    }

    /**
     * Undo the last vertex placed while drawing
     * @returns {boolean} True if vertex was removed
     */
    undoLastVertex() {
        if (this.drawHandler && this.currentTool === 'draw') {
            // Leaflet.draw polygon handler has deleteLastVertex method
            if (this.drawHandler.deleteLastVertex) {
                this.drawHandler.deleteLastVertex();
                console.log('DrawingTools: Removed last vertex');
                return true;
            }
        }
        return false;
    }

    /**
     * Check if we're currently drawing
     */
    isDrawing() {
        return this.currentTool === 'draw' && this.drawHandler && this.drawHandler._markers && this.drawHandler._markers.length > 0;
    }

    completeEditing() {
        this.saveAndDisableEdit();
    }

    updateCursor() {
        const cursors = {
            select: 'grab',
            draw: 'crosshair',
            edit: 'alias', // Indicates actionable click
            delete: 'pointer'
        };

        this.map.getContainer().style.cursor = cursors[this.currentTool] || 'grab';
    }

    updateToolbarUI(tool) {
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
    }

    isDeleteMode() {
        return this.deleteMode;
    }

    getCurrentTool() {
        return this.currentTool;
    }
}

export const drawingTools = new DrawingTools();
