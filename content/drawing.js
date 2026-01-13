/**
 * Drawing tools for creating and editing lot polygons
 * Properly handles mouse events to allow map panning when not drawing
 */

const DrawingTools = {
    // Current state
    currentTool: 'select', // 'select', 'draw', 'edit', 'aiSelect', 'delete'
    isDrawing: false,
    currentPolygon: [],
    selectedLotId: null,
    draggedVertexIndex: null,
    isDragging: false,
    mouseDownPos: null,

    // Callbacks
    onPolygonComplete: null,
    onLotSelect: null,
    onLotUpdate: null,

    /**
     * Initialize drawing tools
     * @param {HTMLCanvasElement} canvas 
     * @param {HTMLElement} mapContainer 
     */
    init(canvas, mapContainer) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.mapContainer = mapContainer;

        this.setupEventListeners();
        console.log('DrawingTools initialized');
    },

    /**
     * Set up mouse event listeners
     */
    setupEventListeners() {
        // Use capture phase and check if we should handle the event
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this), false);
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this), false);
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this), false);
        this.canvas.addEventListener('dblclick', this.handleDoubleClick.bind(this), false);
        this.canvas.addEventListener('contextmenu', this.handleRightClick.bind(this), false);

        // Keyboard shortcuts
        document.addEventListener('keydown', this.handleKeyDown.bind(this), false);
    },

    /**
     * Set the active tool
     * @param {string} tool 
     */
    setTool(tool) {
        this.currentTool = tool;
        this.currentPolygon = [];
        this.isDrawing = false;
        this.isDragging = false;
        this.draggedVertexIndex = null;

        // Update cursor based on tool
        const cursors = {
            select: 'pointer',
            draw: 'crosshair',
            edit: 'move',
            aiSelect: 'cell',
            delete: 'pointer'
        };
        this.canvas.style.cursor = cursors[tool] || 'default';

        console.log('Tool set to:', tool);
    },

    /**
     * Handle mouse down event
     */
    handleMouseDown(e) {
        // Don't interfere with UI elements
        if (e.target !== this.canvas) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        this.mouseDownPos = { x, y };
        this.isDragging = false;

        // Only process on left click
        if (e.button !== 0) return;

        switch (this.currentTool) {
            case 'draw':
                // Don't prevent default yet - wait to see if it's a click or drag
                this.pendingDrawClick = { x, y };
                break;
            case 'edit':
                if (this.handleEditStart(x, y)) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                break;
            case 'select':
                // Let the click through if not on a lot
                break;
            case 'aiSelect':
                this.pendingAISelect = { x, y };
                break;
            case 'delete':
                // Handle on mouseup for better UX
                break;
        }
    },

    /**
     * Handle mouse move
     */
    handleMouseMove(e) {
        if (!this.mouseDownPos) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const dx = x - this.mouseDownPos.x;
        const dy = y - this.mouseDownPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If moved more than 5 pixels, it's a drag not a click
        if (distance > 5) {
            this.isDragging = true;
            this.pendingDrawClick = null;
            this.pendingAISelect = null;
        }

        // Handle vertex dragging in edit mode
        if (this.currentTool === 'edit' && this.draggedVertexIndex !== null && this.selectedLotId) {
            e.preventDefault();
            e.stopPropagation();

            if (this.onLotUpdate) {
                this.onLotUpdate(this.selectedLotId, this.draggedVertexIndex, { x, y });
            }
        }
    },

    /**
     * Handle mouse up
     */
    handleMouseUp(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Only process clicks (not drags) for most tools
        if (!this.isDragging) {
            switch (this.currentTool) {
                case 'draw':
                    if (this.pendingDrawClick) {
                        this.handleDrawClick(this.pendingDrawClick.x, this.pendingDrawClick.y);
                        e.preventDefault();
                        e.stopPropagation();
                    }
                    break;
                case 'select':
                    this.handleSelectClick(x, y);
                    break;
                case 'aiSelect':
                    if (this.pendingAISelect) {
                        this.handleAISelectClick(this.pendingAISelect.x, this.pendingAISelect.y);
                        e.preventDefault();
                        e.stopPropagation();
                    }
                    break;
                case 'delete':
                    this.handleDeleteClick(x, y);
                    break;
            }
        }

        // Reset state
        this.mouseDownPos = null;
        this.isDragging = false;
        this.draggedVertexIndex = null;
        this.pendingDrawClick = null;
        this.pendingAISelect = null;
    },

    /**
     * Handle double click to complete polygon
     */
    handleDoubleClick(e) {
        if (this.currentTool === 'draw' && this.currentPolygon.length >= 3) {
            e.preventDefault();
            e.stopPropagation();
            this.completePolygon();
        }
    },

    /**
     * Handle right click to cancel/delete
     */
    handleRightClick(e) {
        e.preventDefault();

        if (this.currentTool === 'draw' && this.currentPolygon.length > 0) {
            // Remove last point
            this.currentPolygon.pop();
        }
    },

    /**
     * Handle keyboard shortcuts
     */
    handleKeyDown(e) {
        // Don't handle if in input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.key === 'Escape') {
            this.currentPolygon = [];
            this.isDrawing = false;
            this.selectedLotId = null;
        } else if (e.key === 'Enter' && this.currentTool === 'draw' && this.currentPolygon.length >= 3) {
            this.completePolygon();
        }
    },

    /**
     * Handle click in draw mode
     */
    handleDrawClick(x, y) {
        this.isDrawing = true;
        this.currentPolygon.push({ x, y });
        console.log('Added point:', x, y, 'Total points:', this.currentPolygon.length);
    },

    /**
     * Handle click in edit mode - returns true if a vertex was found
     */
    handleEditStart(x, y) {
        const lots = window.LotMapper?.lots || [];

        for (const lot of lots) {
            // Calculate current pixel positions for this lot
            const pixelCoords = lot.coordinates.map(c =>
                CoordinateUtils.latLngToPixel(c.lat, c.lng, this.mapContainer)
            );

            for (let i = 0; i < pixelCoords.length; i++) {
                const vertex = pixelCoords[i];
                const dist = Math.sqrt(Math.pow(x - vertex.x, 2) + Math.pow(y - vertex.y, 2));

                if (dist < 15) { // 15px hit area
                    this.selectedLotId = lot.id;
                    this.draggedVertexIndex = i;
                    return true;
                }
            }
        }
        return false;
    },

    /**
     * Handle click in select mode
     */
    handleSelectClick(x, y) {
        const lots = window.LotMapper?.lots || [];

        for (const lot of lots) {
            const pixelCoords = lot.coordinates.map(c =>
                CoordinateUtils.latLngToPixel(c.lat, c.lng, this.mapContainer)
            );

            if (this.isPointInPolygon({ x, y }, pixelCoords)) {
                this.selectedLotId = lot.id;
                if (this.onLotSelect) {
                    this.onLotSelect(lot);
                }
                return;
            }
        }

        this.selectedLotId = null;
    },

    /**
     * Handle AI select click - detect house boundary
     */
    async handleAISelectClick(x, y) {
        try {
            console.log('AI Select at:', x, y);
            this.canvas.style.cursor = 'wait';

            // For now, create a simple rectangle as fallback
            // The edge detection is complex and may not work on all satellite imagery
            const size = 40;
            const boundary = [
                { x: x - size, y: y - size },
                { x: x + size, y: y - size },
                { x: x + size, y: y + size },
                { x: x - size, y: y + size }
            ];

            this.currentPolygon = boundary;
            this.completePolygon();

            this.canvas.style.cursor = 'cell';
        } catch (error) {
            console.error('AI select error:', error);
            this.canvas.style.cursor = 'cell';
        }
    },

    /**
     * Handle click in delete mode
     */
    handleDeleteClick(x, y) {
        const lots = window.LotMapper?.lots || [];

        for (let i = 0; i < lots.length; i++) {
            const pixelCoords = lots[i].coordinates.map(c =>
                CoordinateUtils.latLngToPixel(c.lat, c.lng, this.mapContainer)
            );

            if (this.isPointInPolygon({ x, y }, pixelCoords)) {
                if (window.LotMapper?.deleteLot) {
                    window.LotMapper.deleteLot(lots[i].id);
                }
                return;
            }
        }
    },

    /**
     * Complete the current polygon and trigger callback
     */
    completePolygon() {
        if (this.currentPolygon.length >= 3 && this.onPolygonComplete) {
            console.log('Completing polygon with', this.currentPolygon.length, 'points');
            this.onPolygonComplete([...this.currentPolygon]);
        }
        this.currentPolygon = [];
        this.isDrawing = false;
    },

    /**
     * Check if point is inside polygon using ray casting
     */
    isPointInPolygon(point, polygon) {
        if (!polygon || polygon.length < 3) return false;

        let inside = false;
        const n = polygon.length;

        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;

            if (((yi > point.y) !== (yj > point.y)) &&
                (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }

        return inside;
    },

    /**
     * Get current drawing state for rendering
     */
    getDrawingState() {
        return {
            currentPolygon: this.currentPolygon,
            selectedLotId: this.selectedLotId,
            currentTool: this.currentTool,
            isDrawing: this.isDrawing
        };
    }
};

// Make available globally
window.DrawingTools = DrawingTools;
