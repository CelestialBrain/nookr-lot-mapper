/**
 * Nookr Lot Mapper - Main Entry Point
 * Initializes the map, drawing tools, and UI
 */

import { db } from './db/IndexedDBStore.js';
import { syncManager } from './db/SyncManager.js';
import { lotManager } from './lots/LotManager.js';
import { drawingTools } from './lots/DrawingTools.js';
import { cachedTileLayer } from './map/TileCacheLayer.js';
import { EdgeDetector } from './map/EdgeDetector.js';
import { shareCodeManager } from './share/ShareCodeManager.js';
import './style.css';

// ==========================================
// SERVICE WORKER REGISTRATION (PWA)
// ==========================================

if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('/public/sw.js');
            console.log('[SW] Registered:', registration.scope);

            // Check for updates periodically
            setInterval(() => registration.update(), 60 * 60 * 1000); // Every hour
        } catch (error) {
            console.log('[SW] Registration failed:', error);
        }
    });
}

// ==========================================
// MAP INITIALIZATION
// ==========================================

let map = null;
let currentLayer = 'street';
let edgeDetector = null;

// GPS Location Tracking
let gpsMarker = null;
let gpsWatchId = null;
let gpsEnabled = false;
let compassHeading = 0; // Compass heading in degrees

const tileLayers = {
    street: {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        options: {
            attribution: 'Â© <a href="https://openstreetmap.org">OpenStreetMap</a>',
            maxZoom: 22,
            maxNativeZoom: 19
        }
    },
    clean: {
        // CartoDB Positron No Labels - great for edge detection
        url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
        options: {
            attribution: 'Â© <a href="https://carto.com/">CARTO</a>',
            maxZoom: 22,
            maxNativeZoom: 19,
            subdomains: 'abcd'
        }
    },
    satellite: {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: {
            attribution: 'Â© <a href="https://www.esri.com">Esri</a>',
            maxZoom: 22,
            maxNativeZoom: 19
        }
    },
    dark: {
        url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',
        options: {
            attribution: 'Â© <a href="https://stadiamaps.com/">Stadia Maps</a>',
            maxZoom: 22,
            maxNativeZoom: 20
        }
    }
};

async function initApp() {
    try {
        // Initialize IndexedDB
        await db.init();
        console.log('IndexedDB initialized');

        // Initialize sync manager
        syncManager.init();
        console.log('SyncManager initialized');

        // Initialize Leaflet map
        map = L.map('map', {
            center: [14.5995, 120.9842], // Manila, Philippines
            zoom: 17,
            zoomControl: true
        });

        // FIX: Force map resize calculation after load
        // This solves issues where map tiles don't load fully until resize
        setTimeout(() => {
            map.invalidateSize();
        }, 500);

        // Also invalidate on window resize to be safe
        window.addEventListener('resize', () => {
            map.invalidateSize();
        });

        // Add cached tile layer
        const layer = tileLayers[currentLayer];
        activeLayer = cachedTileLayer(layer.url, layer.options);
        activeLayer.addTo(map);

        // Initialize lot manager
        await lotManager.init(map);

        // Initialize drawing tools
        drawingTools.init(map, lotManager.lotsLayer);

        // Expose globally for LotManager polygon click handlers
        // This MUST happen after drawingTools.init but the reference is used by LotManager
        // so we expose immediately after init
        window.drawingTools = drawingTools;
        window.showToast = showToast;

        // Set up drawing callback
        drawingTools.onPolygonComplete = (coordinates) => {
            lotManager.createLot(coordinates);
        };

        // Set up lot manager callbacks
        lotManager.onLotSelect = (lot) => showLotDetails(lot);
        lotManager.onLotCountChange = (count) => updateLotCount(count);

        // Initialize edge detector with lot creation callback
        edgeDetector = new EdgeDetector(map, async (latlngs, error) => {
            if (error) {
                showToast(error, 'warning');
                return;
            }
            if (!latlngs) return;

            // Convert latlngs to coordinate pairs
            let coordinates = latlngs.map(ll => ({ lat: ll.lat, lng: ll.lng }));

            // Snap to nearby existing lot edges
            coordinates = lotManager.snapToNearbyEdges(coordinates);

            try {
                const lot = await lotManager.createLot(coordinates);
                edgeDetector.clearSelection();

                showToast(`Lot ${lot.lotNumber} created!`, 'success');

                // Switch to edit tool and enable editing for this lot
                const editBtn = document.querySelector('.tool-btn[data-tool="edit"]');
                if (editBtn) editBtn.click(); // Simulate click to handle UI state properly

                // Slight delay to ensure UI updates before enabling handlers
                setTimeout(() => {
                    const layer = lotManager.getLayerByLotId(lot.id);
                    if (layer) {
                        drawingTools.enableEdit(layer);
                    }
                }, 100);
            } catch (err) {
                showToast(err.message, 'error');
            }
        });

        // Expose for debugging
        window.edgeDetector = edgeDetector;

        // Connect edge detector to drawing tools for snapping
        drawingTools.edgeDetector = edgeDetector;

        // Set up UI event listeners
        setupUIEvents();

        // Set up online/offline detection
        setupNetworkStatus();

        console.log('Nookr Lot Mapper initialized');

    } catch (error) {
        console.error('Failed to initialize app:', error);
        showToast('Failed to initialize app', 'error');
    }
}

// ==========================================
// UI EVENTS
// ==========================================

function setupUIEvents() {
    // ==========================================
    // PROJECT MANAGEMENT
    // ==========================================
    const projectSelect = document.getElementById('project-select');
    const newProjectBtn = document.getElementById('new-project');
    const renameProjectBtn = document.getElementById('rename-project');
    const deleteProjectBtn = document.getElementById('delete-project');

    async function loadProjects() {
        const projects = await db.getAllProjects();
        projectSelect.innerHTML = '';

        projects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.id;
            option.textContent = project.name;
            if (project.id === lotManager.currentProjectId) {
                option.selected = true;
            }
            projectSelect.appendChild(option);
        });
    }

    // Load projects on init
    loadProjects();

    // Project change handler
    projectSelect.addEventListener('change', async () => {
        const projectId = projectSelect.value;
        if (projectId) {
            await lotManager.switchProject(projectId);
            showToast(`Switched to ${projectSelect.options[projectSelect.selectedIndex].text}`, 'info');
        }
    });

    // New project
    newProjectBtn.addEventListener('click', async () => {
        const projects = await db.getAllProjects();
        const newProject = {
            id: crypto.randomUUID(),
            name: `Project ${projects.length + 1}`,
            createdAt: new Date().toISOString()
        };
        await db.saveProject(newProject);
        await lotManager.switchProject(newProject.id);
        await loadProjects();
        showToast(`Created ${newProject.name}`, 'success');
    });

    // Rename project
    renameProjectBtn.addEventListener('click', async () => {
        const currentId = lotManager.currentProjectId;
        const project = await db.getProject(currentId);
        if (!project) return;

        const newName = prompt('Rename project:', project.name);
        if (newName && newName.trim()) {
            project.name = newName.trim();
            await db.saveProject(project);
            await loadProjects();
            showToast(`Renamed to ${project.name}`, 'success');
        }
    });

    // Delete project
    deleteProjectBtn.addEventListener('click', async () => {
        const projects = await db.getAllProjects();
        if (projects.length <= 1) {
            showToast('Cannot delete the only project', 'warning');
            return;
        }

        const currentId = lotManager.currentProjectId;
        const project = await db.getProject(currentId);

        const confirmed = await window.showConfirmModal(
            'Delete Project',
            `Delete "${project.name}" and all its lots? This cannot be undone.`
        );

        if (confirmed) {
            await db.deleteProject(currentId);
            const remainingProjects = await db.getAllProjects();
            await lotManager.switchProject(remainingProjects[0].id);
            await loadProjects();
            showToast('Project deleted', 'success');
        }
    });

    // ==========================================
    // TOOL BUTTONS
    // ==========================================

    // Tool buttons
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            // Auto-disable edge detection if active to prevent conflicts
            if (typeof edgeDetector !== 'undefined' && edgeDetector.isActive) {
                await toggleEdgeDetection();
            }

            const tool = btn.dataset.tool;
            console.log(`UI: Switching to tool '${tool}'`);
            drawingTools.setTool(tool);
            showToast(`Switched to ${tool} tool`, 'info');

            // Update active state
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Toggle toolbar
    document.getElementById('toggle-toolbar').addEventListener('click', () => {
        const content = document.getElementById('toolbar-content');
        const btn = document.getElementById('toggle-toolbar');
        const isCollapsed = content.classList.toggle('collapsed');
        btn.textContent = isCollapsed ? 'â–²' : 'â–¼';
    });

    // Export buttons
    document.getElementById('export-json').addEventListener('click', () => {
        lotManager.exportJSON();
        showToast('Downloaded lots.json', 'success');
    });

    document.getElementById('export-geojson').addEventListener('click', () => {
        lotManager.exportGeoJSON();
        showToast('Downloaded lots.geojson', 'success');
    });

    // Import
    document.getElementById('import-btn').addEventListener('click', () => {
        document.getElementById('import-file').click();
    });

    document.getElementById('import-file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const count = await lotManager.importData(file);
            showToast(`Imported ${count} lots`, 'success');
        } catch (error) {
            showToast('Failed to import file', 'error');
            console.error('Import error:', error);
        }

        e.target.value = '';
    });

    // Clear all
    document.getElementById('clear-all').addEventListener('click', async () => {
        if (confirm('Clear all lots? This cannot be undone.')) {
            await lotManager.clearAll();
            hideDetailsPanel();
            showToast('All lots cleared', 'success');
        }
    });

    // Layer toggle
    document.querySelectorAll('.layer-btn[data-layer]').forEach(btn => {
        btn.addEventListener('click', () => {
            const layer = btn.dataset.layer;
            switchLayer(layer);

            document.querySelectorAll('.layer-btn[data-layer]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // GPS Location button
    document.getElementById('gps-locate').addEventListener('click', () => {
        toggleGPS();
    });

    // Download area button - opens Cache Manager
    document.getElementById('download-area')?.addEventListener('click', () => {
        openCacheManager();
    });

    // Show cached areas toggle
    document.getElementById('show-cached-areas').addEventListener('click', () => {
        toggleCachedAreas();
    });

    // Edge detection toggle
    document.getElementById('edge-detect').addEventListener('click', async () => {
        await toggleEdgeDetection();
    });

    // Floating Action Button
    const fabToggle = document.getElementById('fab-toggle');
    const fabMenu = document.querySelector('.fab-menu');

    fabToggle.addEventListener('click', () => {
        fabToggle.classList.toggle('active');
        fabMenu.classList.toggle('hidden');
    });

    document.querySelectorAll('.fab-item').forEach(item => {
        item.addEventListener('click', async () => {
            const action = item.dataset.action;
            fabMenu.classList.add('hidden');
            fabToggle.classList.remove('active');

            switch (action) {
                case 'draw':
                    document.querySelector('.tool-btn[data-tool="draw"]')?.click();
                    break;
                case 'edge-detect':
                    await toggleEdgeDetection();
                    break;
                case 'gps':
                    toggleGPS();
                    break;
                case 'undo':
                    if (lotManager.canUndo()) {
                        await lotManager.undo();
                        showToast('Undone', 'success');
                    }
                    break;
            }
        });
    });

    // Undo button
    const undoBtn = document.getElementById('undo-btn');
    undoBtn.addEventListener('click', async () => {
        if (await lotManager.undo()) {
            showToast('Undone', 'success');
        }
    });

    // Set up undo availability callback
    lotManager.onUndoChange = (canUndo) => {
        undoBtn.disabled = !canUndo;
    };

    // Lot search
    const searchInput = document.getElementById('lot-search');
    const searchResults = document.getElementById('search-results');

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
            searchResults.classList.add('hidden');
            return;
        }

        const matches = lotManager.lots.filter(lot => {
            return lot.lotNumber.toLowerCase().includes(query) ||
                (lot.owner && lot.owner.toLowerCase().includes(query)) ||
                (lot.notes && lot.notes.toLowerCase().includes(query)) ||
                (lot.blockNumber && lot.blockNumber.toLowerCase().includes(query));
        }).slice(0, 10); // Max 10 results

        if (matches.length === 0) {
            searchResults.innerHTML = '<div class="search-result-item">No lots found</div>';
        } else {
            searchResults.innerHTML = matches.map(lot => `
                <div class="search-result-item" data-lot-id="${lot.id}">
                    <span class="lot-number">Lot ${lot.lotNumber}</span>
                    ${lot.owner ? ` - ${lot.owner}` : ''}
                </div>
            `).join('');
        }
        searchResults.classList.remove('hidden');
    });

    searchResults.addEventListener('click', (e) => {
        const item = e.target.closest('.search-result-item');
        if (item && item.dataset.lotId) {
            const lot = lotManager.getLot(item.dataset.lotId);
            if (lot) {
                // Zoom to lot
                const coords = lot.coordinates;
                const bounds = L.latLngBounds(coords.map(c => [c.lat, c.lng]));
                map.fitBounds(bounds, { padding: [50, 50] });

                // Select the lot
                lotManager.selectLot(lot.id);

                // Clear search
                searchInput.value = '';
                searchResults.classList.add('hidden');
            }
        }
    });

    // Close results on click outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-box')) {
            searchResults.classList.add('hidden');
        }
    });

    // Keyboard shortcuts for undo/redo
    document.addEventListener('keydown', (e) => {
        // Ctrl+Z or Cmd+Z for undo
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();

            // First check if we're drawing - undo vertex
            if (drawingTools.isDrawing()) {
                if (drawingTools.undoLastVertex()) {
                    showToast('Vertex removed', 'info');
                }
                return;
            }

            // Otherwise undo lot action
            if (lotManager.canUndo()) {
                lotManager.undo().then(() => showToast('Undone', 'success'));
            }
        }

        // Ctrl+Shift+Z or Cmd+Shift+Z for redo
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
            e.preventDefault();
            if (lotManager.canRedo()) {
                lotManager.redo().then(() => showToast('Redone', 'success'));
            }
        }

        // Also support Ctrl+Y for redo (Windows convention)
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
            e.preventDefault();
            if (lotManager.canRedo()) {
                lotManager.redo().then(() => showToast('Redone', 'success'));
            }
        }
    });

    // Details panel
    document.getElementById('close-details').addEventListener('click', hideDetailsPanel);
    document.getElementById('save-lot').addEventListener('click', saveCurrentLot);

    // Share lot link
    document.getElementById('share-lot').addEventListener('click', async () => {
        const lot = lotManager.getLot(lotManager.selectedLotId);
        if (!lot) return;

        // Calculate center of lot
        const coords = lot.coordinates;
        const centerLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
        const centerLng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;

        // Create shareable URL
        const url = `${window.location.origin}${window.location.pathname}#lot=${lot.id}&lat=${centerLat.toFixed(6)}&lng=${centerLng.toFixed(6)}&z=19`;

        try {
            await navigator.clipboard.writeText(url);
            showToast('Link copied to clipboard!', 'success');
        } catch (err) {
            // Fallback for older browsers
            showToast('Share URL: ' + url.substring(0, 50) + '...', 'info');
        }
    });

    // Click on map to deselect (when in select mode)
    map.on('click', (e) => {
        // Skip if edge detection is active - it handles its own clicks
        if (edgeDetector && edgeDetector.isActive) {
            return;
        }

        if (drawingTools.getCurrentTool() === 'select') {
            // Check if click was on a lot
            let clickedOnLot = false;
            lotManager.lotsLayer.eachLayer(layer => {
                try {
                    if (layer.getBounds && layer.getBounds().contains(e.latlng)) {
                        clickedOnLot = true;
                    }
                } catch (err) {
                    // Ignore layers with invalid bounds
                }
            });

            if (!clickedOnLot) {
                hideDetailsPanel();
                lotManager.selectedLotId = null;
                lotManager.renderAllLots();
            }
        }

        // Handle delete mode
        if (drawingTools.isDeleteMode()) {
            let deletedOne = false;
            lotManager.lotsLayer.eachLayer(layer => {
                if (deletedOne) return; // Only delete one at a time
                try {
                    // Use leaflet-pip style point-in-polygon check
                    if (layer.getLatLngs && layer.lotId) {
                        const latlngs = layer.getLatLngs()[0]; // Get the polygon ring
                        if (isPointInPolygon(e.latlng, latlngs)) {
                            if (confirm('Delete this lot?')) {
                                lotManager.deleteLot(layer.lotId);
                                hideDetailsPanel();
                                showToast('Lot deleted', 'success');
                                deletedOne = true;
                            }
                        }
                    }
                } catch (err) {
                    console.error('Delete check error:', err);
                }
            });
        }
    });

    // Point-in-polygon check using ray casting algorithm
    function isPointInPolygon(point, polygon) {
        let inside = false;
        const x = point.lat, y = point.lng;

        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].lat, yi = polygon[i].lng;
            const xj = polygon[j].lat, yj = polygon[j].lng;

            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }

        return inside;
    }

    // ==========================================
    // SHARE CODE FUNCTIONALITY
    // ==========================================
    const shareCodeBtn = document.getElementById('share-code');
    const importCodeBtn = document.getElementById('import-code');
    const shareModal = document.getElementById('share-modal');
    const importModal = document.getElementById('import-modal');

    // Generate share code
    shareCodeBtn?.addEventListener('click', async () => {
        try {
            const lots = lotManager.lots;
            if (lots.length === 0) {
                showToast('No lots to share', 'warning');
                return;
            }

            const project = await db.getProject(lotManager.currentProjectId);
            const areas = await db.getAreasByProject(lotManager.currentProjectId);

            const options = {
                areas: areas,
                originPoint: project?.originPoint || null
            };

            const code = shareCodeManager.generateWithChecksum(lots, project?.name || 'Shared Project', options);

            document.getElementById('share-code-output').value = code;
            shareModal.classList.remove('hidden');
            showToast(`Generated code for ${lots.length} lots`, 'success');
        } catch (error) {
            console.error('Failed to generate share code:', error);
            showToast('Failed to generate share code', 'error');
        }
    });

    // Copy share code to clipboard
    document.getElementById('copy-share-code')?.addEventListener('click', () => {
        const codeOutput = document.getElementById('share-code-output');
        codeOutput.select();
        navigator.clipboard.writeText(codeOutput.value);
        showToast('Copied to clipboard!', 'success');
    });

    // Close share modal
    document.getElementById('close-share-modal')?.addEventListener('click', () => {
        shareModal.classList.add('hidden');
    });

    // Import code button
    importCodeBtn?.addEventListener('click', () => {
        document.getElementById('import-code-input').value = '';
        importModal.classList.remove('hidden');
    });

    // Close import modal
    document.getElementById('close-import-modal')?.addEventListener('click', () => {
        importModal.classList.add('hidden');
    });

    // Submit import code
    document.getElementById('import-code-submit')?.addEventListener('click', async () => {
        try {
            const code = document.getElementById('import-code-input').value.trim();
            if (!code) {
                showToast('Please paste a share code', 'warning');
                return;
            }

            const { projectName, lots, areas, originPoint } = shareCodeManager.decodeWithChecksum(code);

            // Create new project for imported lots
            const newProject = {
                id: crypto.randomUUID(),
                name: projectName,
                originPoint: originPoint || null,
                createdAt: new Date().toISOString()
            };
            await db.saveProject(newProject);

            // Save areas to new project
            if (areas && areas.length > 0) {
                for (const area of areas) {
                    area.projectId = newProject.id;
                    await db.saveArea(area);
                }
            }

            // Save lots to new project
            for (const lot of lots) {
                lot.projectId = newProject.id;
                await db.saveLot(lot);
            }

            // Switch to new project
            await lotManager.switchProject(newProject.id);
            await loadProjects();

            importModal.classList.add('hidden');
            showToast(`Imported ${lots.length} lots as "${projectName}"`, 'success');
        } catch (error) {
            console.error('Failed to import share code:', error);
            showToast(error.message || 'Invalid share code', 'error');
        }
    });

    // Initialize Offline Cache Manager
    initCacheManager();

    // PDF Export
    document.getElementById('export-pdf')?.addEventListener('click', exportPDF);

    // Areas Manager
    initAreasManager();
}

// ==========================================
// LOT DETAILS PANEL
// ==========================================

function showLotDetails(lot) {
    document.getElementById('lot-number').value = lot.lotNumber || '';
    document.getElementById('block-number').value = lot.blockNumber || '';
    document.getElementById('owner-name').value = lot.owner || '';
    document.getElementById('lot-status').value = lot.status || 'available';
    document.getElementById('lot-area').value = lotManager.formatArea(lot.areaSqm);
    document.getElementById('lot-coords').value = lot.coordinates
        .map(c => lotManager.formatCoordinates(c.lat, c.lng))
        .join('\n');
    document.getElementById('lot-notes').value = lot.notes || '';

    // Update area checkboxes
    updateLotAreaCheckboxes(lot.id);

    const panel = document.getElementById('details-panel');
    panel.dataset.lotId = lot.id;
    panel.classList.remove('hidden');
}

function hideDetailsPanel() {
    document.getElementById('details-panel').classList.add('hidden');
}

async function saveCurrentLot() {
    const panel = document.getElementById('details-panel');
    const lotId = panel.dataset.lotId;

    if (!lotId) return;

    const updates = {
        lotNumber: document.getElementById('lot-number').value,
        blockNumber: document.getElementById('block-number').value,
        owner: document.getElementById('owner-name').value,
        status: document.getElementById('lot-status').value,
        notes: document.getElementById('lot-notes').value,
        areaIds: getSelectedAreaIds()
    };

    await lotManager.updateLot(lotId, updates);

    const btn = document.getElementById('save-lot');
    btn.textContent = 'Saved!';
    setTimeout(() => btn.textContent = 'Save', 1500);
}

// ==========================================
// LAYER SWITCHING
// ==========================================

let activeLayer = null;
let layerSwitchLocked = false;

function switchLayer(layerName) {
    // Prevent rapid layer switching that causes blob URL errors
    if (layerSwitchLocked) {
        console.log('Layer switch throttled - please wait');
        return;
    }

    const layerConfig = tileLayers[layerName];
    if (!layerConfig) return;

    // Lock layer switching for 500ms
    layerSwitchLocked = true;
    setTimeout(() => { layerSwitchLocked = false; }, 500);

    // Remove current layer
    if (activeLayer) {
        map.removeLayer(activeLayer);
    }

    // Add new cached layer
    activeLayer = cachedTileLayer(layerConfig.url, layerConfig.options);
    activeLayer.addTo(map);
    currentLayer = layerName;
}

// ==========================================
// NETWORK STATUS
// ==========================================

function setupNetworkStatus() {
    const updateStatus = () => {
        const badge = document.getElementById('offline-status');
        if (navigator.onLine) {
            badge.textContent = 'â— Online';
            badge.classList.remove('offline');
            badge.classList.add('online');
        } else {
            badge.textContent = 'â— Offline';
            badge.classList.remove('online');
            badge.classList.add('offline');
        }
    };

    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    updateStatus();
}

// ==========================================
// CONFIRM MODAL
// ==========================================

/**
 * Show a confirmation modal (replacement for browser confirm)
 * @param {string} title - Modal title
 * @param {string} message - Modal message
 * @returns {Promise<boolean>} - Resolves true if confirmed, false if cancelled
 */
function showConfirmModal(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const yesBtn = document.getElementById('confirm-yes');
        const noBtn = document.getElementById('confirm-no');

        titleEl.textContent = title;
        messageEl.textContent = message;
        modal.classList.remove('hidden');

        const cleanup = () => {
            modal.classList.add('hidden');
            yesBtn.removeEventListener('click', onYes);
            noBtn.removeEventListener('click', onNo);
        };

        const onYes = () => {
            cleanup();
            resolve(true);
        };

        const onNo = () => {
            cleanup();
            resolve(false);
        };

        yesBtn.addEventListener('click', onYes);
        noBtn.addEventListener('click', onNo);
    });
}

// Expose globally for other modules
window.showConfirmModal = showConfirmModal;

// ==========================================
// GPS LOCATION TRACKING
// ==========================================

function toggleGPS() {
    const btn = document.getElementById('gps-locate');

    if (!navigator.geolocation) {
        showToast('GPS not supported on this device', 'error');
        return;
    }

    if (gpsEnabled) {
        // Disable GPS
        if (gpsWatchId !== null) {
            navigator.geolocation.clearWatch(gpsWatchId);
            gpsWatchId = null;
        }
        if (gpsMarker) {
            map.removeLayer(gpsMarker);
            gpsMarker = null;
        }
        btn.classList.remove('gps-active');
        gpsEnabled = false;
        showToast('GPS tracking disabled', 'info');
    } else {
        // Enable GPS with high accuracy
        btn.classList.add('gps-active');
        gpsEnabled = true;
        showToast('Locating...', 'info');

        // Start compass listening
        startCompass();

        const gpsOptions = {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
        };

        // Watch position for continuous updates
        gpsWatchId = navigator.geolocation.watchPosition(
            (position) => {
                updateGPSMarker(position.coords.latitude, position.coords.longitude, position.coords.accuracy);
            },
            (error) => {
                console.error('GPS Error:', error);
                showToast(`GPS error: ${error.message}`, 'error');
                btn.classList.remove('gps-active');
                gpsEnabled = false;
            },
            gpsOptions
        );

        // Also get immediate position and fly to it
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                updateGPSMarker(lat, lng, position.coords.accuracy);
                map.flyTo([lat, lng], 19, { duration: 1.5 });
                showToast(`Location found (Â±${Math.round(position.coords.accuracy)}m)`, 'success');
            },
            (error) => {
                console.error('GPS Error:', error);
            },
            gpsOptions
        );
    }
}

function updateGPSMarker(lat, lng, accuracy) {
    if (!gpsMarker) {
        // Create the GPS dot marker with compass arrow
        const icon = L.divIcon({
            className: 'gps-marker',
            html: `<div class="gps-dot"><div class="gps-arrow" style="transform: rotate(${compassHeading}deg)"></div></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        gpsMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map);
    } else {
        gpsMarker.setLatLng([lat, lng]);
        // Update arrow rotation
        const arrowEl = gpsMarker.getElement()?.querySelector('.gps-arrow');
        if (arrowEl) {
            arrowEl.style.transform = `rotate(${compassHeading}deg)`;
        }
    }

    // Store position for distance calculation
    currentGPSPosition = { lat, lng };
    updateDistanceBar();
}

function updateCompassHeading(heading) {
    compassHeading = heading;
    // Update arrow if GPS marker exists
    const arrowEl = gpsMarker?.getElement()?.querySelector('.gps-arrow');
    if (arrowEl) {
        arrowEl.style.transform = `rotate(${heading}deg)`;
    }
}

// Start compass orientation listening
function startCompass() {
    if (window.DeviceOrientationEvent) {
        // For iOS 13+, need to request permission
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission()
                .then(response => {
                    if (response === 'granted') {
                        window.addEventListener('deviceorientation', handleOrientation);
                    }
                })
                .catch(console.error);
        } else {
            // Non-iOS or older iOS
            window.addEventListener('deviceorientation', handleOrientation);
        }
    }
}

function handleOrientation(event) {
    // webkitCompassHeading for iOS, alpha for Android
    let heading = event.webkitCompassHeading || (360 - event.alpha);
    if (heading !== null && !isNaN(heading)) {
        updateCompassHeading(Math.round(heading));
    }
}

// ==========================================
// DISTANCE RULER
// ==========================================

let currentGPSPosition = null;

// Haversine formula to calculate distance between two points
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) *
        Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}

// Calculate bearing between two points
function calculateBearing(lat1, lon1, lat2, lon2) {
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const y = Math.sin(deltaLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) -
        Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
    const theta = Math.atan2(y, x);

    return ((theta * 180 / Math.PI) + 360) % 360; // Bearing in degrees
}

function bearingToDirection(bearing) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(bearing / 45) % 8;
    return directions[index];
}

function updateDistanceBar() {
    const distanceBar = document.getElementById('distance-bar');
    const distanceValue = document.getElementById('distance-value');
    const distanceBearing = document.getElementById('distance-bearing');
    const distanceLabel = document.getElementById('distance-label');

    const selectedLot = lotManager.getLot(lotManager.selectedLotId);

    if (!currentGPSPosition || !selectedLot) {
        distanceBar.classList.add('hidden');
        return;
    }

    // Calculate center of selected lot
    const coords = selectedLot.coordinates;
    const centerLat = coords.reduce((sum, c) => sum + c.lat, 0) / coords.length;
    const centerLng = coords.reduce((sum, c) => sum + c.lng, 0) / coords.length;

    // Calculate distance and bearing
    const distance = haversineDistance(
        currentGPSPosition.lat,
        currentGPSPosition.lng,
        centerLat,
        centerLng
    );

    const bearing = calculateBearing(
        currentGPSPosition.lat,
        currentGPSPosition.lng,
        centerLat,
        centerLng
    );

    // Format distance
    let distanceStr;
    if (distance < 1000) {
        distanceStr = `${Math.round(distance)}m`;
    } else {
        distanceStr = `${(distance / 1000).toFixed(1)}km`;
    }

    distanceValue.textContent = distanceStr;
    distanceBearing.textContent = `${bearingToDirection(bearing)} (${Math.round(bearing)}Â°)`;
    distanceLabel.textContent = `to Lot ${selectedLot.lotNumber}`;
    distanceBar.classList.remove('hidden');
}

// ==========================================
// LOT COUNT
// ==========================================

function updateLotCount(count) {
    document.getElementById('lot-count').textContent = `Lots: ${count}`;
}

// ==========================================
// OFFLINE CACHE MANAGER
// ==========================================

let downloadAbortController = null;
let currentDownloadBounds = null;

function initCacheManager() {
    // Open modal handlers are in setupUIEvents

    // Close modal
    document.getElementById('close-cache-modal')?.addEventListener('click', () => {
        document.getElementById('cache-modal').classList.add('hidden');
    });

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Remove active class from all
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active', 'hidden'));

            // Add active to clicked
            e.target.classList.add('active');

            // Show content
            const tabId = e.target.dataset.tab;
            document.getElementById(`tab-${tabId}`).classList.add('active');

            if (tabId === 'regions') renderRegionsList();
        });
    });

    // Zoom level change
    document.getElementById('download-zoom-level')?.addEventListener('change', updateDownloadEstimate);

    // Actions
    document.getElementById('start-download')?.addEventListener('click', startActiveDownload);
    document.getElementById('cancel-download')?.addEventListener('click', cancelActiveDownload);
    document.getElementById('clear-cache-btn')?.addEventListener('click', clearAllCache);
}

async function openCacheManager() {
    const modal = document.getElementById('cache-modal');
    if (!modal) return;

    modal.classList.remove('hidden');

    // Switch to download tab by default
    document.querySelector('[data-tab="download"]').click();

    // Update stats
    updateCacheStats();

    // Set current bounds + buffer (20%)
    const bounds = map.getBounds();
    const pad = 0.2;
    currentDownloadBounds = bounds.pad(pad);

    // Update estimate
    updateDownloadEstimate();

    // Reset UI
    document.getElementById('download-progress-container').classList.add('hidden');
    document.getElementById('start-download').style.display = 'block';
    document.getElementById('cancel-download').style.display = 'none';
}

async function updateCacheStats() {
    try {
        const stats = await db.getCacheStats();
        document.getElementById('cache-tile-count').textContent = stats.tileCount.toLocaleString();
        document.getElementById('cache-storage-used').textContent = stats.sizeFormatted;
    } catch (e) {
        console.warn('Failed to get cache stats:', e);
    }
}

async function clearAllCache() {
    if (!confirm('Area you sure you want to clear all cached offline maps? This cannot be undone.')) return;

    try {
        await db.clearTileCache();
        showToast('Cache cleared successfully', 'success');
        updateCacheStats();
    } catch (e) {
        console.error('Failed to clear cache:', e);
        showToast('Failed to clear cache', 'error');
    }
}

function updateDownloadEstimate() {
    if (!currentDownloadBounds) return;

    const zoomSelect = document.getElementById('download-zoom-level');
    const quality = zoomSelect.value;

    let minZoom = 14;
    let maxZoom = 19; // med

    if (quality === 'high') maxZoom = 22;
    if (quality === 'low') maxZoom = 17;

    // Get URL template
    const layerConfig = tileLayers[currentLayer];
    const urlTemplate = layerConfig.url;

    // Estimate tile count
    const tiles = db.getTileUrlsForBounds({
        north: currentDownloadBounds.getNorth(),
        south: currentDownloadBounds.getSouth(),
        east: currentDownloadBounds.getEast(),
        west: currentDownloadBounds.getWest()
    }, minZoom, maxZoom, urlTemplate);

    const count = tiles.length;
    // Avg 25KB per tile
    const sizeMB = (count * 25) / 1024;

    document.getElementById('est-tile-count').textContent = count.toLocaleString();
    document.getElementById('est-size').textContent = `${sizeMB.toFixed(1)} MB`;
}

async function startActiveDownload() {
    if (!currentDownloadBounds) return;

    const zoomSelect = document.getElementById('download-zoom-level');
    const quality = zoomSelect.value;

    let minZoom = 14;
    let maxZoom = 19;

    if (quality === 'high') maxZoom = 22;
    if (quality === 'low') maxZoom = 17;

    // UI Updates
    const startBtn = document.getElementById('start-download');
    const cancelBtn = document.getElementById('cancel-download');
    const progressContainer = document.getElementById('download-progress-container');
    const progressFill = document.getElementById('download-progress');
    const statusText = document.getElementById('download-status');
    const countText = document.getElementById('download-count');

    startBtn.style.display = 'none';
    cancelBtn.style.display = 'block';
    progressContainer.classList.remove('hidden');
    progressFill.style.width = '0%';
    statusText.textContent = 'Starting...';
    countText.textContent = '0/0';

    downloadAbortController = new AbortController();

    try {
        const layerConfig = tileLayers[currentLayer];

        const result = await db.downloadTilesForArea(
            {
                north: currentDownloadBounds.getNorth(),
                south: currentDownloadBounds.getSouth(),
                east: currentDownloadBounds.getEast(),
                west: currentDownloadBounds.getWest()
            },
            minZoom,
            maxZoom,
            layerConfig.url,
            (downloaded, total, status) => {
                const percent = Math.round((downloaded / total) * 100);
                progressFill.style.width = `${percent}%`;
                statusText.textContent = status === 'cached' ? 'Checking cache...' : 'Downloading...';
                countText.textContent = `${downloaded} / ${total}`;
            },
            downloadAbortController.signal
        );

        if (result.cancelled) {
            statusText.textContent = 'Cancelled';
            showToast('Download cancelled', 'info');
        } else {
            statusText.textContent = 'Complete!';
            progressFill.style.width = '100%';
            showToast(`Downloaded ${result.downloaded} tiles`, 'success');

            // Save region
            await db.saveDownloadRegion({
                north: currentDownloadBounds.getNorth(),
                south: currentDownloadBounds.getSouth(),
                east: currentDownloadBounds.getEast(),
                west: currentDownloadBounds.getWest()
            }, currentLayer, result.total);

            updateCacheStats();
        }

    } catch (error) {
        console.error('Download error:', error);
        statusText.textContent = 'Error';
        showToast('Download failed', 'error');
    } finally {
        startBtn.style.display = 'block';
        cancelBtn.style.display = 'none';
        downloadAbortController = null;
    }
}

function cancelActiveDownload() {
    if (downloadAbortController) {
        downloadAbortController.abort();
    }
}

async function renderRegionsList() {
    const list = document.getElementById('regions-list');
    list.innerHTML = '<p class="empty-state">Loading...</p>';

    try {
        const regions = await db.getDownloadRegions();

        if (regions.length === 0) {
            list.innerHTML = '<p class="empty-state">No saved regions yet.</p>';
            return;
        }

        list.innerHTML = '';
        // Most recent first
        regions.reverse().forEach(region => {
            const item = document.createElement('div');
            item.className = 'region-item';

            const date = new Date(region.createdAt).toLocaleDateString();
            const tileCount = region.tileCount || 'Unknown';
            const layerName = region.layer || 'Map';

            item.innerHTML = `
                <div class="region-info">
                    <h4>Offline Region (${date})</h4>
                    <div class="region-meta">
                        ${layerName} â€¢ ${tileCount} tiles
                    </div>
                </div>
                <button class="action-btn danger small delete-region" data-id="${region.id}">ðŸ—‘ï¸</button>
            `;

            item.querySelector('.delete-region').addEventListener('click', async (e) => {
                if (confirm('Delete this saved region reference? (Tiles will remain in cache)')) {
                    await db.deleteDownloadRegion(parseInt(e.target.dataset.id));
                    renderRegionsList();
                }
            });

            list.appendChild(item);
        });

    } catch (e) {
        list.innerHTML = '<p class="empty-state">Error loading regions</p>';
    }
}

// ==========================================
// EDGE DETECTION
// ==========================================

async function toggleEdgeDetection() {
    const btn = document.getElementById('edge-detect');

    if (edgeDetector.isActive) {
        edgeDetector.hide();
        btn.classList.remove('active');
        showToast('Edge detection disabled', 'info');
    } else {
        try {
            // Disable drawing tools to prevent click conflicts
            drawingTools.setTool('select');
            drawingTools.updateToolbarUI('select');

            btn.classList.add('active');
            showToast('Click inside a lot to select it...', 'info');

            await edgeDetector.show();
            showToast('Click inside enclosed areas to create lots!', 'success');
        } catch (error) {
            console.error('Edge detection failed:', error);
            btn.classList.remove('active');
            showToast('Edge detection failed', 'error');
        }
    }
}

// ==========================================
// CACHED AREAS VISUALIZATION
// ==========================================

let cachedAreasLayer = null;
let showingCachedAreas = false;

async function toggleCachedAreas() {
    const btn = document.getElementById('show-cached-areas');

    if (showingCachedAreas) {
        // Hide cached areas
        if (cachedAreasLayer) {
            map.removeLayer(cachedAreasLayer);
            cachedAreasLayer = null;
        }
        btn.classList.remove('active');
        showingCachedAreas = false;
        showToast('Cached areas hidden', 'info');
    } else {
        // Show cached areas
        try {
            const regions = await db.getDownloadRegions();

            if (regions.length === 0) {
                showToast('No cached areas yet. Use "Download Area" first.', 'info');
                return;
            }

            // Create a layer group for the rectangles
            cachedAreasLayer = L.layerGroup();

            regions.forEach((region, index) => {
                const bounds = [
                    [region.bounds.south, region.bounds.west],
                    [region.bounds.north, region.bounds.east]
                ];

                const rect = L.rectangle(bounds, {
                    color: '#10b981',
                    weight: 2,
                    opacity: 0.8,
                    fillColor: '#10b981',
                    fillOpacity: 0.15,
                    dashArray: '5, 5'
                });

                // Add popup with info
                const date = new Date(region.createdAt).toLocaleDateString();
                rect.bindPopup(`
                    <strong>Cached Area #${index + 1}</strong><br>
                    Layer: ${region.layer}<br>
                    Tiles: ${region.tileCount}<br>
                    Downloaded: ${date}
                `);

                cachedAreasLayer.addLayer(rect);
            });

            cachedAreasLayer.addTo(map);
            btn.classList.add('active');
            showingCachedAreas = true;
            showToast(`Showing ${regions.length} cached area(s)`, 'success');
        } catch (error) {
            console.error('Failed to show cached areas:', error);
            showToast('Failed to load cached areas', 'error');
        }
    }
}

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================

function showToast(message, type = 'info') {
    // Create container if needed
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
    <span>${message}</span>
  `;

    container.appendChild(toast);

    // Auto remove
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==========================================
// INIT
// ==========================================

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// Register service worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => {
            console.log('Service worker registration failed:', err);
        });
    });
}

// ==========================================
// PDF EXPORT
// ==========================================

async function exportPDF() {
    showToast('Generating PDF... Please wait.', 'info');

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('landscape');

        // Header
        const project = document.getElementById('project-select');
        const projectName = project.options[project.selectedIndex]?.text || 'Subdivision Project';
        const date = new Date().toLocaleDateString();

        doc.setFontSize(18);
        doc.text(projectName, 14, 20);

        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Generated on ${date} by Nookr Lot Mapper`, 14, 28);

        // Map Capture
        // Hide UI elements that shouldn't be in PDF
        const mapEl = document.getElementById('map');
        const controls = document.querySelectorAll('.leaflet-control, .fab-container, .layer-control, .toolbar, .details-panel, .modal');
        controls.forEach(c => c.style.visibility = 'hidden');

        const canvas = await html2canvas(mapEl, {
            useCORS: true,
            logging: false,
            scale: 2 // Improve quality
        });

        // Restore UI
        controls.forEach(c => c.style.visibility = '');

        const imgData = canvas.toDataURL('image/png');
        const imgProps = doc.getImageProperties(imgData);
        const pdfWidth = doc.internal.pageSize.getWidth();
        const pdfHeight = doc.internal.pageSize.getHeight();

        // Calculate scaling to fit within margins
        const margin = 14;
        const maxImgWidth = pdfWidth - (margin * 2);
        const maxImgHeight = pdfHeight - 50 - margin; // 50 for header

        const ratio = Math.min(maxImgWidth / imgProps.width, maxImgHeight / imgProps.height);
        const imgW = imgProps.width * ratio;
        const imgH = imgProps.height * ratio;

        doc.addImage(imgData, 'PNG', margin, 35, imgW, imgH);

        // Stats Footer on map page
        doc.setFontSize(10);
        doc.setTextColor(50);
        const lotCount = lotManager.lots.length;
        const totalArea = lotManager.lots.reduce((sum, lot) => sum + (lot.areaSqm || 0), 0);
        const areaStr = lotManager.formatArea(totalArea);

        doc.text(`Total Lots: ${lotCount} | Total Area: ${areaStr}`, margin, pdfHeight - 10);

        // ==========================================
        // PAGE 2+: Lot Details Table
        // ==========================================
        if (lotManager.lots.length > 0) {
            doc.addPage();

            // Header
            doc.setFontSize(16);
            doc.setTextColor(0);
            doc.text('Lot Details', margin, 20);

            doc.setFontSize(9);
            doc.setTextColor(100);
            doc.text(`Project: ${projectName} | Generated: ${date}`, margin, 28);

            // Table setup
            const tableTop = 38;
            const rowHeight = 8;
            const colWidths = [25, 20, 45, 25, 30, pdfWidth - margin * 2 - 145]; // Lot, Block, Owner, Status, Area, Coords
            let y = tableTop;

            // Header row
            doc.setFillColor(240, 240, 240);
            doc.rect(margin, y - 5, pdfWidth - margin * 2, rowHeight, 'F');
            doc.setFontSize(8);
            doc.setTextColor(0);
            doc.setFont(undefined, 'bold');

            let x = margin + 2;
            doc.text('Lot #', x, y); x += colWidths[0];
            doc.text('Block', x, y); x += colWidths[1];
            doc.text('Owner', x, y); x += colWidths[2];
            doc.text('Status', x, y); x += colWidths[3];
            doc.text('Area', x, y); x += colWidths[4];
            doc.text('Coordinates (Sample)', x, y);

            y += rowHeight;
            doc.setFont(undefined, 'normal');

            // Status labels
            const statusLabels = {
                'available': 'Available',
                'reserved': 'Reserved',
                'sold': 'Sold'
            };

            // Lot rows
            for (const lot of lotManager.lots) {
                // Check if we need a new page
                if (y > pdfHeight - 20) {
                    doc.addPage();
                    y = 20;
                }

                x = margin + 2;
                doc.setFontSize(7);
                doc.setTextColor(30);

                doc.text(lot.lotNumber || '-', x, y); x += colWidths[0];
                doc.text(lot.blockNumber || '-', x, y); x += colWidths[1];
                doc.text((lot.owner || '-').substring(0, 20), x, y); x += colWidths[2];
                doc.text(statusLabels[lot.status] || 'Available', x, y); x += colWidths[3];
                doc.text(lotManager.formatArea(lot.areaSqm), x, y); x += colWidths[4];

                // Show first coordinate as sample
                if (lot.coordinates && lot.coordinates.length > 0) {
                    const firstCoord = lot.coordinates[0];
                    doc.text(`${firstCoord.lat.toFixed(6)}, ${firstCoord.lng.toFixed(6)} (+${lot.coordinates.length - 1} pts)`, x, y);
                }

                y += rowHeight;

                // Draw line separator
                doc.setDrawColor(220);
                doc.line(margin, y - 3, pdfWidth - margin, y - 3);
            }

            // Full Coordinates Page (optional - for detailed survey use)
            if (lotManager.lots.some(lot => lot.coordinates && lot.coordinates.length > 0)) {
                doc.addPage();

                doc.setFontSize(16);
                doc.setTextColor(0);
                doc.text('Full Coordinate Data', margin, 20);

                doc.setFontSize(7);
                doc.setTextColor(50);
                y = 30;

                for (const lot of lotManager.lots) {
                    if (y > pdfHeight - 30) {
                        doc.addPage();
                        y = 20;
                    }

                    doc.setFont(undefined, 'bold');
                    doc.text(`Lot ${lot.lotNumber || '?'} Block ${lot.blockNumber || '?'}:`, margin, y);
                    doc.setFont(undefined, 'normal');
                    y += 5;

                    if (lot.coordinates) {
                        const coordsText = lot.coordinates
                            .map((c, i) => `  ${i + 1}. ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`)
                            .join('\n');

                        const lines = doc.splitTextToSize(coordsText, pdfWidth - margin * 2);
                        doc.text(lines, margin, y);
                        y += lines.length * 3.5 + 5;
                    }
                }
            }
        }

        doc.save(`${projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_map.pdf`);
        showToast('PDF Exported Successfully', 'success');

    } catch (error) {
        console.error('PDF Export Error:', error);
        showToast('Failed to generate PDF. Check console.', 'error');
        // Ensure UI is restored
        const controls = document.querySelectorAll('.leaflet-control, .fab-container, .layer-control, .toolbar, .details-panel, .modal');
        controls.forEach(c => c.style.visibility = '');
    }
}

// ==========================================
// AREAS MANAGER
// ==========================================

let areasCache = [];
let editingAreaId = null;
let quickAddMode = false;
let quickAddSelectedLots = new Set();

// Initialize Areas Manager event listeners
function initAreasManager() {
    // Open Areas Modal
    document.getElementById('manage-areas')?.addEventListener('click', openAreasModal);

    // Close Areas Modal
    document.getElementById('close-areas-modal')?.addEventListener('click', closeAreasModal);

    // Create Area Button
    document.getElementById('create-area-btn')?.addEventListener('click', () => showAreaForm());

    // Cancel Area Form
    document.getElementById('cancel-area-form')?.addEventListener('click', hideAreaForm);

    // Save Area Button
    document.getElementById('save-area-btn')?.addEventListener('click', saveArea);

    // Color picker preview
    document.getElementById('area-color')?.addEventListener('input', (e) => {
        document.getElementById('area-color-preview').style.background = e.target.value;
    });

    // Search areas
    document.getElementById('area-search')?.addEventListener('input', (e) => {
        renderAreasList(e.target.value);
    });

    // Quick Add button
    document.getElementById('quick-add-area')?.addEventListener('click', toggleQuickAddMode);
}

async function openAreasModal() {
    await loadAreas();
    renderAreasList();
    document.getElementById('areas-modal')?.classList.remove('hidden');
}

function closeAreasModal() {
    document.getElementById('areas-modal')?.classList.add('hidden');
    hideAreaForm();
}

async function loadAreas() {
    try {
        areasCache = await db.getAreasByProject(lotManager.currentProjectId);
    } catch (error) {
        console.error('Failed to load areas:', error);
        areasCache = [];
    }
}

function renderAreasList(searchTerm = '') {
    const container = document.getElementById('areas-list');
    if (!container) return;

    const filtered = searchTerm
        ? areasCache.filter(a => a.name.toLowerCase().includes(searchTerm.toLowerCase()))
        : areasCache;

    if (filtered.length === 0) {
        container.innerHTML = `<p class="empty-state">${searchTerm ? 'No areas found.' : 'No areas created yet. Click "New Area" to create one.'}</p>`;
        return;
    }

    const lots = lotManager.lots;

    container.innerHTML = filtered.map(area => {
        const lotCount = lots.filter(lot => lot.areaIds?.includes(area.id)).length;
        const isHidden = area.visible === false;

        return `
            <div class="area-item" data-area-id="${area.id}">
                <span class="color-swatch" style="background: ${area.color || '#3498db'}"></span>
                <span class="area-name">${area.name}</span>
                <span class="area-count">${lotCount} lots</span>
                <button class="visibility-toggle ${isHidden ? 'hidden-area' : ''}" 
                        onclick="toggleAreaVisibility('${area.id}')" 
                        title="${isHidden ? 'Show' : 'Hide'} area">
                    ${isHidden ? 'â—‹' : 'â—'}
                </button>
                <button class="action-btn small" onclick="editArea('${area.id}')">Edit</button>
                <button class="action-btn small danger" onclick="deleteArea('${area.id}')">Delete</button>
            </div>
        `;
    }).join('');
}

function showAreaForm(area = null) {
    editingAreaId = area?.id || null;

    const form = document.getElementById('area-form');
    const nameInput = document.getElementById('area-name');
    const colorInput = document.getElementById('area-color');
    const colorPreview = document.getElementById('area-color-preview');

    nameInput.value = area?.name || '';
    colorInput.value = area?.color || '#3498db';
    colorPreview.style.background = area?.color || '#3498db';

    form?.classList.remove('hidden');
    nameInput?.focus();
}

function hideAreaForm() {
    editingAreaId = null;
    document.getElementById('area-form')?.classList.add('hidden');
    document.getElementById('area-name').value = '';
}

async function saveArea() {
    const nameInput = document.getElementById('area-name');
    const colorInput = document.getElementById('area-color');

    const name = nameInput?.value.trim();
    if (!name) {
        showToast('Please enter an area name', 'warning');
        return;
    }

    const areaData = {
        id: editingAreaId || crypto.randomUUID(),
        projectId: lotManager.currentProjectId,
        name: name,
        color: colorInput?.value || '#3498db',
        visible: true,
        createdAt: editingAreaId ? undefined : new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    try {
        await db.saveArea(areaData);
        await loadAreas();
        renderAreasList();
        hideAreaForm();
        updateLotAreaCheckboxes();
        showToast(editingAreaId ? 'Area updated' : 'Area created', 'success');
    } catch (error) {
        console.error('Failed to save area:', error);
        showToast('Failed to save area', 'error');
    }
}

window.editArea = function (areaId) {
    const area = areasCache.find(a => a.id === areaId);
    if (area) {
        showAreaForm(area);
    }
};

window.deleteArea = async function (areaId) {
    const area = areasCache.find(a => a.id === areaId);
    if (!area) return;

    const confirmed = await showConfirmModal(
        'Delete Area',
        `Are you sure you want to delete "${area.name}"? Lots will be removed from this area.`
    );

    if (!confirmed) return;

    try {
        // Remove areaId from all lots
        const lots = lotManager.lots.filter(lot => lot.areaIds?.includes(areaId));
        for (const lot of lots) {
            const newAreaIds = lot.areaIds.filter(id => id !== areaId);
            await lotManager.updateLot(lot.id, { areaIds: newAreaIds });
        }

        await db.deleteArea(areaId);
        await loadAreas();
        renderAreasList();
        updateLotAreaCheckboxes();
        showToast('Area deleted', 'success');
    } catch (error) {
        console.error('Failed to delete area:', error);
        showToast('Failed to delete area', 'error');
    }
};

window.toggleAreaVisibility = async function (areaId) {
    const area = areasCache.find(a => a.id === areaId);
    if (!area) return;

    area.visible = area.visible === false ? true : false;

    try {
        await db.saveArea(area);
        renderAreasList();

        // Update lot polygon opacity based on area visibility
        const lots = lotManager.lots.filter(lot => lot.areaIds?.includes(areaId));
        lots.forEach(lot => {
            const polygon = lotManager.polygons.get(lot.id);
            if (polygon) {
                polygon.setStyle({ opacity: area.visible ? 1 : 0.3, fillOpacity: area.visible ? 0.3 : 0.1 });
            }
        });
    } catch (error) {
        console.error('Failed to toggle area visibility:', error);
    }
};

// Update lot area checkboxes in the details panel
function updateLotAreaCheckboxes(lotId = null) {
    const container = document.getElementById('lot-areas-checkboxes');
    if (!container) return;

    if (areasCache.length === 0) {
        container.innerHTML = '<em class="text-muted">No areas created yet</em>';
        return;
    }

    const lot = lotId ? lotManager.lots.find(l => l.id === lotId) : null;
    const selectedAreaIds = lot?.areaIds || [];

    container.innerHTML = areasCache.map(area => `
        <label>
            <input type="checkbox" name="lot-area" value="${area.id}" 
                   ${selectedAreaIds.includes(area.id) ? 'checked' : ''}>
            <span class="color-swatch" style="background: ${area.color}"></span>
            ${area.name}
        </label>
    `).join('');
}

function getSelectedAreaIds() {
    const checkboxes = document.querySelectorAll('#lot-areas-checkboxes input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

// ==========================================
// QUICK ADD TO AREA
// ==========================================

function toggleQuickAddMode() {
    quickAddMode = !quickAddMode;
    const btn = document.getElementById('quick-add-area');

    if (quickAddMode) {
        btn?.classList.add('active');
        btn.textContent = `Confirm (${quickAddSelectedLots.size})`;
        showToast('Click lots to select, then click Confirm', 'info');

        // Add click handler for lot selection
        map.on('click', handleQuickAddClick);
    } else {
        if (quickAddSelectedLots.size > 0) {
            showQuickAddModal();
        } else {
            exitQuickAddMode();
        }
    }
}

function handleQuickAddClick(e) {
    if (!quickAddMode) return;

    // Find clicked lot
    const clickedLot = lotManager.lots.find(lot => {
        const polygon = lotManager.polygons.get(lot.id);
        if (polygon) {
            const bounds = polygon.getBounds();
            return bounds.contains(e.latlng);
        }
        return false;
    });

    if (clickedLot) {
        if (quickAddSelectedLots.has(clickedLot.id)) {
            quickAddSelectedLots.delete(clickedLot.id);
            highlightLot(clickedLot.id, false);
        } else {
            quickAddSelectedLots.add(clickedLot.id);
            highlightLot(clickedLot.id, true);
        }

        const btn = document.getElementById('quick-add-area');
        if (btn) {
            btn.textContent = `Confirm (${quickAddSelectedLots.size})`;
        }
    }
}

function highlightLot(lotId, highlight) {
    const polygon = lotManager.polygons.get(lotId);
    if (polygon) {
        if (highlight) {
            polygon.setStyle({ color: '#ff6b6b', weight: 3, fillColor: '#ff6b6b', fillOpacity: 0.4 });
        } else {
            polygon.setStyle({ color: '#62bce0', weight: 2, fillColor: '#62bce0', fillOpacity: 0.3 });
        }
    }
}

async function showQuickAddModal() {
    await loadAreas();

    if (areasCache.length === 0) {
        showToast('No areas created. Create an area first.', 'warning');
        exitQuickAddMode();
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'quick-add-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <span>Add ${quickAddSelectedLots.size} Lots to Area</span>
                <button class="close-btn" onclick="cancelQuickAdd()">Ã—</button>
            </div>
            <div class="modal-body">
                <p>Select area(s) to add the selected lots to:</p>
                <div class="checkbox-group" id="quick-add-areas">
                    ${areasCache.map(area => `
                        <label>
                            <input type="checkbox" name="quick-area" value="${area.id}">
                            <span class="color-swatch" style="background: ${area.color}"></span>
                            ${area.name}
                        </label>
                    `).join('')}
                </div>
            </div>
            <div class="modal-footer">
                <button class="action-btn" onclick="cancelQuickAdd()">Cancel</button>
                <button class="action-btn primary" onclick="confirmQuickAdd()">Add to Area</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

window.cancelQuickAdd = function () {
    document.getElementById('quick-add-modal')?.remove();
    exitQuickAddMode();
};

window.confirmQuickAdd = async function () {
    const checkboxes = document.querySelectorAll('#quick-add-areas input[type="checkbox"]:checked');
    const areaIds = Array.from(checkboxes).map(cb => cb.value);

    if (areaIds.length === 0) {
        showToast('Please select at least one area', 'warning');
        return;
    }

    // Save for undo
    const undoData = [];

    try {
        for (const lotId of quickAddSelectedLots) {
            const lot = lotManager.lots.find(l => l.id === lotId);
            if (lot) {
                const oldAreaIds = [...(lot.areaIds || [])];
                const newAreaIds = [...new Set([...oldAreaIds, ...areaIds])];

                undoData.push({ lotId, oldAreaIds, newAreaIds });
                await lotManager.updateLot(lotId, { areaIds: newAreaIds });
            }
        }

        // Add to undo stack
        lotManager.pushUndoState({
            type: 'quick-add-area',
            data: undoData
        });

        showToast(`Added ${quickAddSelectedLots.size} lots to ${areaIds.length} area(s)`, 'success');
    } catch (error) {
        console.error('Failed to add lots to area:', error);
        showToast('Failed to add lots to area', 'error');
    }

    document.getElementById('quick-add-modal')?.remove();
    exitQuickAddMode();
};

function exitQuickAddMode() {
    quickAddMode = false;

    // Reset button
    const btn = document.getElementById('quick-add-area');
    if (btn) {
        btn.classList.remove('active');
        btn.textContent = 'Quick Add';
    }

    // Reset lot highlights
    quickAddSelectedLots.forEach(lotId => highlightLot(lotId, false));
    quickAddSelectedLots.clear();

    // Remove click handler
    map.off('click', handleQuickAddClick);
}

// ==========================================
// ORIGIN POINT
// ==========================================

let settingOrigin = false;

function startSetOrigin() {
    settingOrigin = true;
    showToast('Click on the map to set origin point', 'info');
    map.once('click', async (e) => {
        settingOrigin = false;
        const project = await db.getProject(lotManager.currentProjectId);
        if (project) {
            project.originPoint = { lat: e.latlng.lat, lng: e.latlng.lng };
            await db.saveProject(project);
            showToast('Origin point set', 'success');
        }
    });
}

// Initialize on load
document.getElementById('set-origin')?.addEventListener('click', startSetOrigin);

// Make functions globally available
window.updateLotAreaCheckboxes = updateLotAreaCheckboxes;
window.getSelectedAreaIds = getSelectedAreaIds;

// Initialize areas manager when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAreasManager);
} else {
    initAreasManager();
}
