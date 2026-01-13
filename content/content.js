/**
 * Main content script for HOA Lot Mapper
 * Injects the overlay UI and manages lot data
 */

(function () {
    'use strict';

    // Wait for Google Maps to fully load
    let initAttempts = 0;
    const maxAttempts = 30;

    function waitForMaps() {
        // Look for the Google Maps canvas or container
        const mapCanvas = document.querySelector('canvas.widget-scene-canvas')
            || document.querySelector('canvas[style*="cursor"]')
            || document.querySelector('#scene canvas');

        const mapContainer = mapCanvas?.parentElement
            || document.querySelector('[data-panhandler]')
            || document.querySelector('#scene')
            || document.querySelector('#content-container');

        if (mapContainer || initAttempts >= maxAttempts) {
            initLotMapper(mapContainer || document.body);
        } else {
            initAttempts++;
            setTimeout(waitForMaps, 500);
        }
    }

    /**
     * Main Lot Mapper class
     */
    const LotMapper = {
        lots: [],
        canvas: null,
        ctx: null,
        mapContainer: null,
        toolbar: null,
        detailsPanel: null,
        isActive: false,
        nextLotNumber: 1,
        lastMapState: null, // For detecting map panning

        /**
         * Initialize the lot mapper
         */
        init(mapContainer) {
            this.mapContainer = mapContainer;
            this.createOverlayCanvas();
            this.createToolbar();
            this.createDetailsPanel();
            this.loadLots();
            this.setupDrawingTools();
            this.setupMapChangeListener();
            this.startRenderLoop();

            console.log('HOA Lot Mapper initialized');
        },

        /**
         * Create the transparent canvas overlay
         */
        createOverlayCanvas() {
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'hoa-lot-canvas';
            // Start with pointer-events: none so map is draggable by default
            this.canvas.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 999;
        background: transparent !important;
        touch-action: none;
      `;
            document.body.appendChild(this.canvas);
            this.ctx = this.canvas.getContext('2d', { alpha: true });
            this.resizeCanvas();

            window.addEventListener('resize', () => this.resizeCanvas());
        },

        /**
         * Resize canvas to match window
         */
        resizeCanvas() {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        },

        /**
         * Setup listener for map pan/zoom changes
         */
        setupMapChangeListener() {
            // Monitor URL changes (Google Maps updates URL on pan/zoom)
            let lastUrl = window.location.href;

            const checkMapChange = () => {
                if (window.location.href !== lastUrl) {
                    lastUrl = window.location.href;
                    // Map moved - clear pixel cache so lots render at new positions
                    this.lots.forEach(lot => {
                        lot._pixelCache = null;
                    });
                }
            };

            // Check frequently for map changes
            setInterval(checkMapChange, 100);

            // Also listen for mouse events on document that might indicate map interaction
            document.addEventListener('mouseup', () => {
                // After mouse up, clear cache to recalculate positions
                setTimeout(() => {
                    this.lots.forEach(lot => {
                        lot._pixelCache = null;
                    });
                }, 50);
            });

            // Listen for wheel events (zoom)
            document.addEventListener('wheel', () => {
                this.lots.forEach(lot => {
                    lot._pixelCache = null;
                });
            }, { passive: true });
        },

        /**
         * Create the floating toolbar
         */
        createToolbar() {
            this.toolbar = document.createElement('div');
            this.toolbar.id = 'hoa-toolbar';
            this.toolbar.innerHTML = `
        <div class="hoa-toolbar-header">
          <span class="hoa-logo">🏘️</span>
          <span class="hoa-title">HOA Lot Mapper</span>
          <button class="hoa-toggle-btn" title="Toggle Tools">▼</button>
        </div>
        <div class="hoa-toolbar-content">
          <div class="hoa-tool-group">
            <button class="hoa-tool-btn" data-tool="select" title="Select Lot (S)">
              <span class="hoa-icon">👆</span>
              <span class="hoa-label">Select</span>
            </button>
            <button class="hoa-tool-btn" data-tool="draw" title="Draw Polygon (D)">
              <span class="hoa-icon">✏️</span>
              <span class="hoa-label">Draw</span>
            </button>
            <button class="hoa-tool-btn" data-tool="aiSelect" title="AI Select (A)">
              <span class="hoa-icon">🪄</span>
              <span class="hoa-label">AI Select</span>
            </button>
            <button class="hoa-tool-btn" data-tool="edit" title="Edit Vertices (E)">
              <span class="hoa-icon">🔧</span>
              <span class="hoa-label">Edit</span>
            </button>
            <button class="hoa-tool-btn" data-tool="delete" title="Delete Lot (X)">
              <span class="hoa-icon">🗑️</span>
              <span class="hoa-label">Delete</span>
            </button>
          </div>
          <div class="hoa-divider"></div>
          <div class="hoa-action-group">
            <button class="hoa-action-btn" id="hoa-export-json" title="Export to JSON">
              📄 Export JSON
            </button>
            <button class="hoa-action-btn" id="hoa-export-geojson" title="Export to GeoJSON">
              🗺️ Export GeoJSON
            </button>
            <button class="hoa-action-btn" id="hoa-import" title="Import Data">
              📥 Import
            </button>
            <button class="hoa-action-btn" id="hoa-clear-all" title="Clear All Lots">
              🗑️ Clear All
            </button>
          </div>
          <div class="hoa-divider"></div>
          <div class="hoa-stats">
            <span id="hoa-lot-count">Lots: 0</span>
          </div>
        </div>
        <input type="file" id="hoa-import-file" accept=".json" style="display: none;">
      `;
            document.body.appendChild(this.toolbar);

            this.setupToolbarEvents();
        },

        /**
         * Create the lot details panel
         */
        createDetailsPanel() {
            this.detailsPanel = document.createElement('div');
            this.detailsPanel.id = 'hoa-details-panel';
            this.detailsPanel.innerHTML = `
        <div class="hoa-panel-header">
          <span>Lot Details</span>
          <button class="hoa-close-btn" id="hoa-close-details">×</button>
        </div>
        <div class="hoa-panel-content">
          <div class="hoa-form-group">
            <label>Lot Number</label>
            <input type="text" id="hoa-lot-number" placeholder="e.g., 12">
          </div>
          <div class="hoa-form-group">
            <label>Block Number</label>
            <input type="text" id="hoa-block-number" placeholder="e.g., 3">
          </div>
          <div class="hoa-form-group">
            <label>Owner Name</label>
            <input type="text" id="hoa-owner-name" placeholder="e.g., Juan Dela Cruz">
          </div>
          <div class="hoa-form-group">
            <label>Area</label>
            <input type="text" id="hoa-lot-area" readonly>
          </div>
          <div class="hoa-form-group">
            <label>Coordinates</label>
            <textarea id="hoa-lot-coords" readonly rows="3"></textarea>
          </div>
          <div class="hoa-form-group">
            <label>Notes</label>
            <textarea id="hoa-lot-notes" rows="2" placeholder="Additional notes..."></textarea>
          </div>
          <button class="hoa-save-btn" id="hoa-save-lot">💾 Save Lot</button>
        </div>
      `;
            this.detailsPanel.style.display = 'none';
            document.body.appendChild(this.detailsPanel);

            this.setupDetailsPanelEvents();
        },

        /**
         * Set up toolbar event listeners
         */
        setupToolbarEvents() {
            // Tool buttons
            this.toolbar.querySelectorAll('.hoa-tool-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const tool = btn.dataset.tool;
                    this.setActiveTool(tool);
                    // Enable canvas interaction
                    this.canvas.style.pointerEvents = 'auto';
                    this.isActive = true;
                });
            });

            // Toggle button
            this.toolbar.querySelector('.hoa-toggle-btn').addEventListener('click', () => {
                const content = this.toolbar.querySelector('.hoa-toolbar-content');
                const btn = this.toolbar.querySelector('.hoa-toggle-btn');
                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    btn.textContent = '▼';
                } else {
                    content.style.display = 'none';
                    btn.textContent = '▲';
                }
            });

            // Export buttons
            document.getElementById('hoa-export-json').addEventListener('click', () => this.exportJSON());
            document.getElementById('hoa-export-geojson').addEventListener('click', () => this.exportGeoJSON());
            document.getElementById('hoa-import').addEventListener('click', () => {
                document.getElementById('hoa-import-file').click();
            });
            document.getElementById('hoa-import-file').addEventListener('change', (e) => this.importData(e));
            document.getElementById('hoa-clear-all').addEventListener('click', () => {
                if (confirm('Clear all lots? This cannot be undone.')) {
                    this.lots = [];
                    this.saveLots();
                    this.updateLotCount();
                }
            });

            // Keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

                const shortcuts = { s: 'select', d: 'draw', a: 'aiSelect', e: 'edit', x: 'delete' };
                if (shortcuts[e.key.toLowerCase()]) {
                    this.setActiveTool(shortcuts[e.key.toLowerCase()]);
                    this.canvas.style.pointerEvents = 'auto';
                    this.isActive = true;
                }

                if (e.key === 'Escape') {
                    this.canvas.style.pointerEvents = 'none';
                    this.isActive = false;
                    this.toolbar.querySelectorAll('.hoa-tool-btn').forEach(btn => btn.classList.remove('active'));
                    if (typeof DrawingTools !== 'undefined') {
                        DrawingTools.setTool('select');
                    }
                }
            });
        },

        /**
         * Set up details panel events
         */
        setupDetailsPanelEvents() {
            document.getElementById('hoa-close-details').addEventListener('click', () => {
                this.detailsPanel.style.display = 'none';
            });

            document.getElementById('hoa-save-lot').addEventListener('click', () => this.saveCurrentLot());
        },

        /**
         * Set the active drawing tool
         */
        setActiveTool(tool) {
            // Update UI
            this.toolbar.querySelectorAll('.hoa-tool-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tool === tool);
            });

            // Update drawing tools
            if (typeof DrawingTools !== 'undefined') {
                DrawingTools.setTool(tool);
            }
        },

        /**
         * Set up drawing tools callbacks
         */
        setupDrawingTools() {
            if (typeof DrawingTools === 'undefined') {
                console.warn('DrawingTools not loaded');
                return;
            }

            DrawingTools.init(this.canvas, this.mapContainer);

            DrawingTools.onPolygonComplete = (pixelCoords) => {
                this.createNewLot(pixelCoords);
            };

            DrawingTools.onLotSelect = (lot) => {
                this.showLotDetails(lot);
            };

            DrawingTools.onLotUpdate = (lotId, vertexIndex, newPos) => {
                const lot = this.lots.find(l => l.id === lotId);
                if (lot) {
                    // Update the geographic coordinate from the new pixel position
                    const newCoord = CoordinateUtils.pixelToLatLng(newPos.x, newPos.y, this.mapContainer);
                    lot.coordinates[vertexIndex] = newCoord;
                    lot._pixelCache = null; // Clear cache
                    lot.areaSqm = CoordinateUtils.calculatePolygonArea(lot.coordinates);
                    this.saveLots();
                }
            };
        },

        /**
         * Create a new lot from pixel coordinates
         */
        createNewLot(pixelCoords) {
            // Convert pixel coords to geographic coordinates immediately
            const coordinates = pixelCoords.map(p =>
                CoordinateUtils.pixelToLatLng(p.x, p.y, this.mapContainer)
            );

            const areaSqm = CoordinateUtils.calculatePolygonArea(coordinates);

            const lot = {
                id: `lot-${Date.now()}`,
                lotNumber: String(this.nextLotNumber++),
                blockNumber: '',
                owner: '',
                notes: '',
                coordinates: coordinates, // Store ONLY geographic coordinates
                areaSqm: areaSqm,
                createdAt: new Date().toISOString(),
                _pixelCache: null // Temporary cache, not saved
            };

            this.lots.push(lot);
            this.saveLots();
            this.updateLotCount();
            this.showLotDetails(lot);

            // Disable canvas interaction after creating lot
            this.canvas.style.pointerEvents = 'none';
            this.isActive = false;
        },

        /**
         * Delete a lot
         */
        deleteLot(lotId) {
            this.lots = this.lots.filter(l => l.id !== lotId);
            this.saveLots();
            this.updateLotCount();
            this.detailsPanel.style.display = 'none';
        },

        /**
         * Show lot details in panel
         */
        showLotDetails(lot) {
            document.getElementById('hoa-lot-number').value = lot.lotNumber;
            document.getElementById('hoa-block-number').value = lot.blockNumber;
            document.getElementById('hoa-owner-name').value = lot.owner;
            document.getElementById('hoa-lot-area').value = CoordinateUtils.formatArea(lot.areaSqm);
            document.getElementById('hoa-lot-coords').value = lot.coordinates
                .map(c => CoordinateUtils.formatCoordinates(c.lat, c.lng))
                .join('\n');
            document.getElementById('hoa-lot-notes').value = lot.notes;

            this.detailsPanel.dataset.lotId = lot.id;
            this.detailsPanel.style.display = 'block';
        },

        /**
         * Save current lot details
         */
        saveCurrentLot() {
            const lotId = this.detailsPanel.dataset.lotId;
            const lot = this.lots.find(l => l.id === lotId);

            if (lot) {
                lot.lotNumber = document.getElementById('hoa-lot-number').value;
                lot.blockNumber = document.getElementById('hoa-block-number').value;
                lot.owner = document.getElementById('hoa-owner-name').value;
                lot.notes = document.getElementById('hoa-lot-notes').value;
                this.saveLots();

                // Show confirmation
                const btn = document.getElementById('hoa-save-lot');
                btn.textContent = '✅ Saved!';
                setTimeout(() => btn.textContent = '💾 Save Lot', 1500);
            }
        },

        /**
         * Update lot count display
         */
        updateLotCount() {
            document.getElementById('hoa-lot-count').textContent = `Lots: ${this.lots.length}`;
        },

        /**
         * Save lots to localStorage (only save geographic coords, not pixel cache)
         */
        saveLots() {
            try {
                const toSave = this.lots.map(lot => ({
                    id: lot.id,
                    lotNumber: lot.lotNumber,
                    blockNumber: lot.blockNumber,
                    owner: lot.owner,
                    notes: lot.notes,
                    coordinates: lot.coordinates,
                    areaSqm: lot.areaSqm,
                    createdAt: lot.createdAt
                }));
                localStorage.setItem('hoaLotMapper_lots', JSON.stringify(toSave));
            } catch (e) {
                console.error('Error saving lots:', e);
            }
        },

        /**
         * Load lots from localStorage
         */
        loadLots() {
            try {
                const saved = localStorage.getItem('hoaLotMapper_lots');
                if (saved) {
                    this.lots = JSON.parse(saved).map(lot => ({
                        ...lot,
                        _pixelCache: null // Initialize cache
                    }));
                    this.nextLotNumber = Math.max(...this.lots.map(l => parseInt(l.lotNumber) || 0), 0) + 1;
                    this.updateLotCount();
                }
            } catch (e) {
                console.error('Error loading lots:', e);
            }
        },

        /**
         * Export lots to JSON
         */
        exportJSON() {
            const data = {
                subdivision: 'HOA Lot Export',
                exportDate: new Date().toISOString(),
                totalLots: this.lots.length,
                lots: this.lots.map(lot => ({
                    id: lot.id,
                    lotNumber: lot.lotNumber,
                    blockNumber: lot.blockNumber,
                    owner: lot.owner,
                    areaSqm: lot.areaSqm,
                    areaFormatted: CoordinateUtils.formatArea(lot.areaSqm),
                    coordinates: lot.coordinates,
                    notes: lot.notes,
                    createdAt: lot.createdAt
                }))
            };

            this.downloadFile(JSON.stringify(data, null, 2), 'hoa-lots.json', 'application/json');
        },

        /**
         * Export lots to GeoJSON
         */
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
                            [lot.coordinates[0].lng, lot.coordinates[0].lat] // Close the polygon
                        ]]
                    }
                }))
            };

            this.downloadFile(JSON.stringify(geojson, null, 2), 'hoa-lots.geojson', 'application/geo+json');
        },

        /**
         * Import data from file
         */
        importData(e) {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);

                    // Handle both JSON and GeoJSON formats
                    if (data.type === 'FeatureCollection') {
                        // GeoJSON format
                        data.features.forEach(feature => {
                            const coords = feature.geometry.coordinates[0].slice(0, -1); // Remove closing point
                            this.lots.push({
                                id: feature.properties.id || `lot-${Date.now()}-${Math.random()}`,
                                lotNumber: feature.properties.lotNumber || '',
                                blockNumber: feature.properties.blockNumber || '',
                                owner: feature.properties.owner || '',
                                notes: feature.properties.notes || '',
                                coordinates: coords.map(c => ({ lat: c[1], lng: c[0] })),
                                areaSqm: feature.properties.areaSqm || 0,
                                createdAt: new Date().toISOString(),
                                _pixelCache: null
                            });
                        });
                    } else if (data.lots) {
                        // Our JSON format
                        this.lots.push(...data.lots.map(lot => ({
                            ...lot,
                            _pixelCache: null
                        })));
                    }

                    this.saveLots();
                    this.updateLotCount();
                    alert(`Imported ${this.lots.length} lots successfully!`);
                } catch (error) {
                    console.error('Import error:', error);
                    alert('Error importing file. Please check the format.');
                }
            };
            reader.readAsText(file);
            e.target.value = ''; // Reset file input
        },

        /**
         * Download a file
         */
        downloadFile(content, filename, type) {
            const blob = new Blob([content], { type });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        },

        /**
         * Start the render loop
         */
        startRenderLoop() {
            const render = () => {
                this.render();
                requestAnimationFrame(render);
            };
            render();
        },

        /**
         * Render all lots and current drawing
         */
        render() {
            // Clear with transparent background
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            // Render all lots - ALWAYS recalculate pixel positions from geo coords
            this.lots.forEach(lot => {
                this.renderLot(lot, typeof DrawingTools !== 'undefined' && lot.id === DrawingTools.selectedLotId);
            });

            // Render current drawing
            if (typeof DrawingTools !== 'undefined') {
                const state = DrawingTools.getDrawingState();
                if (state.currentPolygon.length > 0) {
                    this.renderPolygon(state.currentPolygon, true);
                }
            }
        },

        /**
         * Render a single lot
         */
        renderLot(lot, isSelected) {
            if (!lot.coordinates || lot.coordinates.length < 3) return;

            // ALWAYS calculate pixel coords from geographic coordinates
            const coords = lot.coordinates.map(c =>
                CoordinateUtils.latLngToPixel(c.lat, c.lng, this.mapContainer)
            );

            if (coords.some(c => isNaN(c.x) || isNaN(c.y))) return;

            // Draw polygon fill
            this.ctx.beginPath();
            this.ctx.moveTo(coords[0].x, coords[0].y);
            coords.slice(1).forEach(p => this.ctx.lineTo(p.x, p.y));
            this.ctx.closePath();

            // Fill with semi-transparent color
            this.ctx.fillStyle = isSelected ? 'rgba(255, 193, 7, 0.35)' : 'rgba(33, 150, 243, 0.3)';
            this.ctx.fill();

            // Stroke
            this.ctx.strokeStyle = isSelected ? '#ffc107' : '#2196f3';
            this.ctx.lineWidth = isSelected ? 3 : 2;
            this.ctx.stroke();

            // Draw vertices
            coords.forEach((p, i) => {
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
                this.ctx.fillStyle = isSelected ? '#ffc107' : '#2196f3';
                this.ctx.fill();
                this.ctx.strokeStyle = '#fff';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            });

            // Draw lot number label
            const centroid = {
                x: coords.reduce((sum, p) => sum + p.x, 0) / coords.length,
                y: coords.reduce((sum, p) => sum + p.y, 0) / coords.length
            };

            this.ctx.font = 'bold 14px Arial, sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';

            const label = lot.lotNumber ? `Lot ${lot.lotNumber}` : lot.id.slice(-6);

            // Text shadow/outline for visibility
            this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
            this.ctx.lineWidth = 4;
            this.ctx.strokeText(label, centroid.x, centroid.y);

            this.ctx.fillStyle = '#fff';
            this.ctx.fillText(label, centroid.x, centroid.y);
        },

        /**
         * Render polygon being drawn
         */
        renderPolygon(points, isDrawing) {
            if (points.length === 0) return;

            this.ctx.beginPath();
            this.ctx.moveTo(points[0].x, points[0].y);
            points.slice(1).forEach(p => this.ctx.lineTo(p.x, p.y));

            if (!isDrawing && points.length >= 3) {
                this.ctx.closePath();
            }

            // Dashed stroke for in-progress polygon
            this.ctx.strokeStyle = '#4caf50';
            this.ctx.lineWidth = 3;
            this.ctx.setLineDash([8, 4]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);

            // Draw vertices
            points.forEach((p, i) => {
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
                this.ctx.fillStyle = i === 0 ? '#4caf50' : '#fff';
                this.ctx.fill();
                this.ctx.strokeStyle = '#4caf50';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            });

            // Draw instruction text
            if (points.length >= 1) {
                const lastPoint = points[points.length - 1];
                this.ctx.font = '12px Arial, sans-serif';
                this.ctx.fillStyle = '#4caf50';
                this.ctx.textAlign = 'left';
                this.ctx.fillText('Double-click to finish', lastPoint.x + 15, lastPoint.y);
            }
        }
    };

    /**
     * Initialize when DOM is ready
     */
    function initLotMapper(mapContainer) {
        window.LotMapper = LotMapper;
        LotMapper.init(mapContainer);
    }

    // Start initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitForMaps);
    } else {
        waitForMaps();
    }
})();
