/**
 * Edge Detection Module for Lot Boundary Identification
 * Uses color-based flood fill for smart lot selection
 * Works with both satellite imagery and OSM street map view
 */

export class EdgeDetector {
    constructor(map, onLotSelected) {
        this.map = map;
        this.onLotSelected = onLotSelected;
        this.overlay = null;
        this.selectionPolygon = null;
        this.isActive = false;
        this.selectionMode = false;

        // Store captured image data for selection
        this.imageData = null;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        this.bounds = null;

        // Color tolerance for flood fill (CIELAB Delta E)
        this.colorTolerance = 10;
        // Edge threshold - stop fill if gradient magnitude exceeds this
        this.edgeThreshold = 40;
        // Dark line threshold - stop fill if pixel luminance is below this (for OSM boundary detection)
        // OSM boundaries are typically L < 50, building fills are L > 80
        this.darkLineThreshold = 80;

        // Debug mode
        this.debugMode = false;
        this.debugCanvas = null;

        // Bind handlers
        this.handleMapClick = this.handleMapClick.bind(this);
        this.refresh = this.refresh.bind(this);
    }

    /**
     * Capture visible map tiles to a canvas
     */
    async captureMapToCanvas() {
        const container = this.map.getContainer();
        const size = this.map.getSize();

        const canvas = document.createElement('canvas');
        canvas.width = size.x;
        canvas.height = size.y;
        const ctx = canvas.getContext('2d');

        // Fill with white background first
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const tiles = container.querySelectorAll('.leaflet-tile-pane img');

        const promises = Array.from(tiles).map(tile => {
            return new Promise((resolve) => {
                if (!tile.complete) {
                    tile.onload = () => resolve(tile);
                    tile.onerror = () => resolve(null);
                } else {
                    resolve(tile);
                }
            });
        });

        await Promise.all(promises);

        tiles.forEach(tile => {
            if (!tile.naturalWidth) return;

            const rect = tile.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();

            const x = rect.left - containerRect.left;
            const y = rect.top - containerRect.top;

            try {
                ctx.drawImage(tile, x, y, rect.width, rect.height);
            } catch (e) {
                // CORS issues - ignore
            }
        });

        return canvas;
    }

    /**
     * Store image data for color-based selection
     */
    prepareForSelection(canvas) {
        // Create a temporary canvas for blurring (reduces noise in satellite imagery)
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');

        // Apply very slight blur to reduce noise but preserve dark boundary lines
        tempCtx.filter = 'blur(0.5px)';
        tempCtx.drawImage(canvas, 0, 0);

        this.imageData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
        this.canvasWidth = canvas.width;
        this.canvasHeight = canvas.height;
        this.bounds = this.map.getBounds();

        console.log('EdgeDetector: Image processed (blurred) for selection');

        if (this.debugMode) {
            this.renderGradientMap();
        }
    }

    /**
     * Toggle debug mode to visualize how the algorithm "sees"
     */
    toggleDebug() {
        this.debugMode = !this.debugMode;
        console.log('EdgeDetector: Debug mode', this.debugMode ? 'ENABLED' : 'DISABLED');

        if (this.debugMode) {
            // Create debug canvas if needed
            if (!this.debugCanvas) {
                this.debugCanvas = document.createElement('canvas');
                this.debugCanvas.style.position = 'absolute';
                this.debugCanvas.style.top = '0';
                this.debugCanvas.style.left = '0';
                this.debugCanvas.style.pointerEvents = 'none'; // Click through
                this.debugCanvas.style.zIndex = '9999';
                this.map.getContainer().appendChild(this.debugCanvas);
            }
            this.debugCanvas.style.display = 'block';
            if (this.imageData) this.renderGradientMap();
        } else {
            if (this.debugCanvas) this.debugCanvas.style.display = 'none';
        }
    }

    /**
     * Visualize the gradient map (Edge Barriers)
     */
    renderGradientMap() {
        if (!this.imageData || !this.debugCanvas) return;

        this.debugCanvas.width = this.canvasWidth;
        this.debugCanvas.height = this.canvasHeight;
        const ctx = this.debugCanvas.getContext('2d');

        // Create an image buffer
        const img = ctx.createImageData(this.canvasWidth, this.canvasHeight);
        const data = img.data;

        for (let y = 0; y < this.canvasHeight; y++) {
            for (let x = 0; x < this.canvasWidth; x++) {
                const idx = (y * this.canvasWidth + x) * 4;
                const mag = this.calculateGradientMagnitude(x, y);

                // Render edges as white, flat areas as black
                // Threshold visualization: simple scaling
                const val = Math.min(255, mag * 2); // Boost visibility

                data[idx] = val;     // R
                data[idx + 1] = val;   // G
                data[idx + 2] = val;   // B
                data[idx + 3] = 200;   // Alpha (semi-transparent)

                // Highlight strong edges (barriers) in Red
                if (mag > this.edgeThreshold) {
                    data[idx] = 255;
                    data[idx + 1] = 0;
                    data[idx + 2] = 0;
                    data[idx + 3] = 255;
                }
            }
        }

        ctx.putImageData(img, 0, 0);
        console.log('EdgeDetector: Debug overlay updated');
    }

    /**
     * Get pixel color at position
     */
    getPixelColor(x, y) {
        const idx = (y * this.canvasWidth + x) * 4;
        return {
            r: this.imageData.data[idx],
            g: this.imageData.data[idx + 1],
            b: this.imageData.data[idx + 2]
        };
    }

    /**
     * Convert RGB to CIELAB
     * @param {number} r Red (0-255)
     * @param {number} g Green (0-255)
     * @param {number} b Blue (0-255)
     * @returns {Object} {l, a, b}
     */
    rgbToLab(r, g, b) {
        let r_ = r / 255, g_ = g / 255, b_ = b / 255;

        if (r_ > 0.04045) r_ = Math.pow((r_ + 0.055) / 1.055, 2.4);
        else r_ = r_ / 12.92;
        if (g_ > 0.04045) g_ = Math.pow((g_ + 0.055) / 1.055, 2.4);
        else g_ = g_ / 12.92;
        if (b_ > 0.04045) b_ = Math.pow((b_ + 0.055) / 1.055, 2.4);
        else b_ = b_ / 12.92;

        let x = (r_ * 0.4124 + g_ * 0.3576 + b_ * 0.1805) / 0.95047;
        let y = (r_ * 0.2126 + g_ * 0.7152 + b_ * 0.0722) / 1.00000;
        let z = (r_ * 0.0193 + g_ * 0.1192 + b_ * 0.9505) / 1.08883;

        if (x > 0.008856) x = Math.pow(x, 1 / 3);
        else x = (7.787 * x) + 16 / 116;
        if (y > 0.008856) y = Math.pow(y, 1 / 3);
        else y = (7.787 * y) + 16 / 116;
        if (z > 0.008856) z = Math.pow(z, 1 / 3);
        else z = (7.787 * z) + 16 / 116;

        return {
            l: (116 * y) - 16,
            a: 500 * (x - y),
            b: 200 * (y - z)
        };
    }

    /**
     * Calculate Delta E (CIE76)
     */
    calculateDeltaE(lab1, lab2) {
        return Math.sqrt(
            Math.pow(lab1.l - lab2.l, 2) +
            Math.pow(lab1.a - lab2.a, 2) +
            Math.pow(lab1.b - lab2.b, 2)
        );
    }

    /**
     * Get pixel luminance for edge detection
     */
    getPixelLuminance(x, y) {
        if (x < 0 || x >= this.canvasWidth || y < 0 || y >= this.canvasHeight) return 0;
        const idx = (y * this.canvasWidth + x) * 4;
        const r = this.imageData.data[idx];
        const g = this.imageData.data[idx + 1];
        const b = this.imageData.data[idx + 2];
        // Rec. 709 luminance
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    /**
     * Calculate gradient magnitude using Sobel operator
     */
    calculateGradientMagnitude(x, y) {
        // Gx and Gy kernels
        const tl = this.getPixelLuminance(x - 1, y - 1);
        const tm = this.getPixelLuminance(x, y - 1);
        const tr = this.getPixelLuminance(x + 1, y - 1);
        const ml = this.getPixelLuminance(x - 1, y);
        const mr = this.getPixelLuminance(x + 1, y);
        const bl = this.getPixelLuminance(x - 1, y + 1);
        const bm = this.getPixelLuminance(x, y + 1);
        const br = this.getPixelLuminance(x + 1, y + 1);

        const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
        const gy = (bl + 2 * bm + br) - (tl + 2 * tm + tr);

        return Math.sqrt(gx * gx + gy * gy);
    }

    /**
     * Smart flood fill with CIELAB color matching and Edge barriers
     */
    colorFloodFill(startX, startY) {
        if (!this.imageData) return null;

        const width = this.canvasWidth;
        const height = this.canvasHeight;

        // Get the target color at click point
        const targetRgb = this.getPixelColor(startX, startY);
        const targetLab = this.rgbToLab(targetRgb.r, targetRgb.g, targetRgb.b);

        console.log('EdgeDetector: Target LAB at click:', targetLab);

        const visited = new Uint8Array(width * height);
        const region = [];
        const stack = [[startX, startY]];

        // Limit region size (increased to 40% of 1920x1080 approx)
        const MAX_REGION_SIZE = 800000;
        const MIN_REGION_SIZE = 50;

        // Use strict tolerance
        const tolerance = this.colorTolerance;
        const edgeTheshold = this.edgeThreshold;

        // Maximum radius (Increased to cover larger screen areas)
        const MAX_RADIUS = 1000;
        const MAX_RADIUS_SQ = MAX_RADIUS * MAX_RADIUS;

        while (stack.length > 0 && region.length < MAX_REGION_SIZE) {
            const [x, y] = stack.pop();

            if (x < 0 || x >= width || y < 0 || y >= height) continue;

            const idx = y * width + x;
            if (visited[idx]) continue;

            // Check distance from start
            const distSq = (x - startX) ** 2 + (y - startY) ** 2;
            if (distSq > MAX_RADIUS_SQ) continue;

            // 1. Color Similarity Check (CIELAB)
            const pixelRgb = this.getPixelColor(x, y);
            const pixelLab = this.rgbToLab(pixelRgb.r, pixelRgb.g, pixelRgb.b);
            const deltaE = this.calculateDeltaE(pixelLab, targetLab);

            if (deltaE > tolerance) continue;

            // 2. Dark Line Barrier Check (for OSM boundary lines)
            // OSM renders lot boundaries as dark strokes. Stop at dark pixels.
            const luminance = this.getPixelLuminance(x, y);
            if (luminance < this.darkLineThreshold) {
                // It's a dark line (boundary). Mark as visited so we don't recheck.
                visited[idx] = 1;
                continue;
            }

            // 3. Edge Barrier Check (Sobel Gradient) - secondary check for other edges
            const gradient = this.calculateGradientMagnitude(x, y);
            if (gradient > edgeTheshold) {
                visited[idx] = 1;
                continue;
            }

            visited[idx] = 1;
            region.push({ x, y });

            // 4-connected flood fill
            stack.push([x + 1, y]);
            stack.push([x - 1, y]);
            stack.push([x, y + 1]);
            stack.push([x, y - 1]);
        }

        if (this.debugMode) {
            this.renderFloodFill(region);
        }

        console.log('EdgeDetector: Flood fill found', region.length, 'pixels');

        if (region.length < MIN_REGION_SIZE) {
            console.log('EdgeDetector: Region too small');
            return null;
        }
        if (region.length >= MAX_REGION_SIZE) {
            console.log('EdgeDetector: Region too large (likely background spill)');
            return null;
        }

        return { region, visited };
    }

    /**
     * Extract contour from filled region
     */
    traceContour(visited, width, height) {
        const contour = [];

        // Find starting point on boundary
        let startX = -1, startY = -1;
        outer: for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (visited[y * width + x] &&
                    (x === 0 || !visited[y * width + (x - 1)])) {
                    startX = x;
                    startY = y;
                    break outer;
                }
            }
        }

        if (startX < 0) return [];

        // Trace boundary clockwise
        const directions = [
            [1, 0], [1, 1], [0, 1], [-1, 1],
            [-1, 0], [-1, -1], [0, -1], [1, -1]
        ];

        let x = startX, y = startY;
        let dir = 0;
        const maxSteps = width * height;
        let steps = 0;

        do {
            contour.push({ x, y });

            let found = false;
            for (let i = 0; i < 8; i++) {
                const newDir = (dir + 5 + i) % 8;
                const [dx, dy] = directions[newDir];
                const nx = x + dx;
                const ny = y + dy;

                if (nx >= 0 && nx < width && ny >= 0 && ny < height &&
                    visited[ny * width + nx]) {
                    const isBoundary =
                        nx === 0 || nx === width - 1 ||
                        ny === 0 || ny === height - 1 ||
                        !visited[ny * width + (nx - 1)] ||
                        !visited[ny * width + (nx + 1)] ||
                        !visited[(ny - 1) * width + nx] ||
                        !visited[(ny + 1) * width + nx];

                    if (isBoundary) {
                        x = nx;
                        y = ny;
                        dir = newDir;
                        found = true;
                        break;
                    }
                }
            }

            if (!found) break;
            steps++;
        } while ((x !== startX || y !== startY) && steps < maxSteps);

        return contour;
    }

    /**
     * Simplify contour using Douglas-Peucker algorithm
     */
    simplifyContour(points, tolerance = 3) {
        if (points.length < 3) return points;

        const pointToLineDistance = (point, lineStart, lineEnd) => {
            const A = point.x - lineStart.x;
            const B = point.y - lineStart.y;
            const C = lineEnd.x - lineStart.x;
            const D = lineEnd.y - lineStart.y;

            const dot = A * C + B * D;
            const lenSq = C * C + D * D;
            let param = lenSq !== 0 ? dot / lenSq : -1;

            let xx, yy;
            if (param < 0) {
                xx = lineStart.x;
                yy = lineStart.y;
            } else if (param > 1) {
                xx = lineEnd.x;
                yy = lineEnd.y;
            } else {
                xx = lineStart.x + param * C;
                yy = lineStart.y + param * D;
            }

            return Math.sqrt((point.x - xx) ** 2 + (point.y - yy) ** 2);
        };

        const simplify = (start, end) => {
            let maxDist = 0;
            let maxIdx = 0;

            for (let i = start + 1; i < end; i++) {
                const dist = pointToLineDistance(points[i], points[start], points[end]);
                if (dist > maxDist) {
                    maxDist = dist;
                    maxIdx = i;
                }
            }

            if (maxDist > tolerance) {
                const left = simplify(start, maxIdx);
                const right = simplify(maxIdx, end);
                return [...left.slice(0, -1), ...right];
            }

            return [points[start], points[end]];
        };

        return simplify(0, points.length - 1);
    }

    /**
     * Convert pixel coordinates to lat/lng
     */
    pixelToLatLng(x, y) {
        const bounds = this.bounds;
        const width = this.canvasWidth;
        const height = this.canvasHeight;

        const lng = bounds.getWest() + (x / width) * (bounds.getEast() - bounds.getWest());
        const lat = bounds.getNorth() - (y / height) * (bounds.getNorth() - bounds.getSouth());

        return L.latLng(lat, lng);
    }

    /**
     * Handle map click for lot selection
     */
    handleMapClick(e) {
        console.log('EdgeDetector: Map clicked!');

        if (!this.selectionMode || !this.imageData) {
            console.log('EdgeDetector: Not ready (selectionMode:', this.selectionMode, ', hasImageData:', !!this.imageData, ')');
            return;
        }

        const bounds = this.bounds;
        const latlng = e.latlng;

        // Convert lat/lng to pixel coordinates
        const x = Math.round(((latlng.lng - bounds.getWest()) / (bounds.getEast() - bounds.getWest())) * this.canvasWidth);
        const y = Math.round(((bounds.getNorth() - latlng.lat) / (bounds.getNorth() - bounds.getSouth())) * this.canvasHeight);

        console.log('EdgeDetector: Click at pixel', { x, y });

        // Check bounds
        if (x < 0 || x >= this.canvasWidth || y < 0 || y >= this.canvasHeight) {
            console.log('EdgeDetector: Click outside canvas bounds');
            return;
        }

        // Color-based flood fill
        const result = this.colorFloodFill(x, y);
        if (!result) {
            return;
        }

        // Trace contour
        const contour = this.traceContour(result.visited, this.canvasWidth, this.canvasHeight);
        console.log('EdgeDetector: Contour has', contour.length, 'points');

        if (contour.length < 10) {
            console.log('EdgeDetector: Contour too small');
            return;
        }

        // Simplify contour - use dynamic tolerance to reduce vertex count
        // Start with a reasonable tolerance and strictness
        let tolerance = 5;
        let simplified = this.simplifyContour(contour, tolerance);

        // If result is still too complex (too many sides), simplify more aggressively
        // Relaxed vertex limit to keep detail
        const MAX_VERTICES = 50;
        while (simplified.length > MAX_VERTICES && tolerance < 20) {
            tolerance += 3;
            simplified = this.simplifyContour(contour, tolerance);
            console.log(`EdgeDetector: Enhancing simplification (tol: ${tolerance}, points: ${simplified.length})`);
        }

        console.log('EdgeDetector: Final shape has', simplified.length, 'points');

        // Validation
        const validation = this.validateShape(simplified);
        if (!validation.valid) {
            console.warn('EdgeDetector: Shape rejected:', validation.reason);
            // Optional: Notify via callback with error
            if (this.onLotSelected) {
                this.onLotSelected(null, validation.reason);
            }
            return;
        }

        // Convert to lat/lng
        const latlngs = simplified.map(p => this.pixelToLatLng(p.x, p.y));

        // Show selection preview
        this.showSelection(latlngs);

        // Call callback to create lot
        if (this.onLotSelected) {
            console.log('EdgeDetector: Creating lot!');
            this.onLotSelected(latlngs);
        }
    }

    /**
     * Validate shape geometry to reject artifacts (roads, noise)
     */
    validateShape(points) {
        if (points.length < 3) return { valid: false, reason: 'Too few points' };

        // Calculate bounds
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        points.forEach(p => {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        });

        const width = maxX - minX;
        const height = maxY - minY;
        const maxDim = Math.max(width, height);
        const minDim = Math.min(width, height);

        // Check Aspect Ratio (Reject long thin shapes like roads)
        if (minDim > 0 && maxDim / minDim > 4.5) {
            return { valid: false, reason: 'Shape too elongated (likely a road)' };
        }

        // Check Max Dimension (Reject huge areas)
        // Increased to 3000 to allow full screen selections on high res
        if (maxDim > 3000) {
            return { valid: false, reason: 'Area too large' };
        }

        return { valid: true };
    }

    /**
     * Show selection preview polygon
     */
    showSelection(latlngs) {
        if (this.selectionPolygon) {
            this.map.removeLayer(this.selectionPolygon);
        }

        this.selectionPolygon = L.polygon(latlngs, {
            color: '#fbbf24',
            weight: 3,
            fillColor: '#fbbf24',
            fillOpacity: 0.3,
            dashArray: '5, 5'
        }).addTo(this.map);
    }

    /**
     * Clear selection preview
     */
    clearSelection() {
        if (this.selectionPolygon) {
            this.map.removeLayer(this.selectionPolygon);
            this.selectionPolygon = null;
        }
    }

    /**
     * Enable selection mode
     */
    enableSelection() {
        console.log('EdgeDetector: Enabling selection mode');
        this.selectionMode = true;
        this.map.on('click', this.handleMapClick);
        this.map.on('moveend', this.refresh); // Auto-refresh on pan/zoom
        this.map.getContainer().style.cursor = 'crosshair';
    }

    /**
     * Disable selection mode
     */
    disableSelection() {
        this.selectionMode = false;
        this.map.off('click', this.handleMapClick);
        this.map.off('moveend', this.refresh);
        this.map.getContainer().style.cursor = '';
        this.clearSelection();
    }

    /**
     * Show smart selection mode (no edge overlay, just capture image for color selection)
     */
    async show() {
        try {
            console.log('EdgeDetector: Capturing map...');
            const canvas = await this.captureMapToCanvas();
            this.prepareForSelection(canvas);
            this.enableSelection();
            this.isActive = true;
            console.log('EdgeDetector: Ready! Click on a building to select it.');
        } catch (error) {
            console.error('EdgeDetector: Failed:', error);
            throw error;
        }
    }

    /**
     * Hide and disable selection
     */
    hide() {
        if (this.overlay) {
            this.map.removeLayer(this.overlay);
            this.overlay = null;
        }
        this.disableSelection();
        this.imageData = null;
        this.isActive = false;
    }

    /**
     * Toggle on/off
     */
    async toggle() {
        if (this.isActive) {
            this.hide();
            return false;
        } else {
            await this.show();
            return true;
        }
    }

    /**
     * Set color tolerance (0-255)
     */
    setColorTolerance(value) {
        this.colorTolerance = Math.max(0, Math.min(255, value));
    }

    /**
     * Refresh capture
     */
    async refresh() {
        if (this.isActive) {
            await this.show();
        }
    }

    /**
     * Find the nearest edge point to a given lat/lng for snapping
     * @param {L.LatLng} latlng - The click location
     * @param {number} snapRadiusPx - Search radius in pixels
     * @returns {L.LatLng|null} - Snapped location or null if no edge nearby
     */
    findNearestEdgePoint(latlng, snapRadiusPx = 20) {
        if (!this.imageData || !this.bounds) return null;

        // Convert latlng to pixel coordinates
        const bounds = this.bounds;
        const x = Math.round(((latlng.lng - bounds.getWest()) / (bounds.getEast() - bounds.getWest())) * this.canvasWidth);
        const y = Math.round(((bounds.getNorth() - latlng.lat) / (bounds.getNorth() - bounds.getSouth())) * this.canvasHeight);

        // Search within radius for highest gradient point
        let bestX = x, bestY = y;
        let bestGradient = 0;
        const threshold = this.edgeThreshold;

        for (let dy = -snapRadiusPx; dy <= snapRadiusPx; dy++) {
            for (let dx = -snapRadiusPx; dx <= snapRadiusPx; dx++) {
                const px = x + dx;
                const py = y + dy;

                if (px < 0 || px >= this.canvasWidth || py < 0 || py >= this.canvasHeight) continue;

                // Check if within circular radius
                if (dx * dx + dy * dy > snapRadiusPx * snapRadiusPx) continue;

                const gradient = this.calculateGradientMagnitude(px, py);
                if (gradient > threshold && gradient > bestGradient) {
                    bestGradient = gradient;
                    bestX = px;
                    bestY = py;
                }
            }
        }

        // If we found an edge point, return it as latlng
        if (bestGradient > threshold) {
            return this.pixelToLatLng(bestX, bestY);
        }

        return null;
    }

    /**
     * Prepare edge detection data for snapping (call when draw mode starts)
     */
    async prepareForSnapping() {
        if (!this.imageData) {
            const canvas = await this.captureMapToCanvas();
            this.prepareForSelection(canvas);
        }
    }

    /**
     * Debug: Visualize the flood fill result
     */
    renderFloodFill(region) {
        if (!this.debugCanvas) return;
        const ctx = this.debugCanvas.getContext('2d');
        const img = ctx.getImageData(0, 0, this.canvasWidth, this.canvasHeight); // Get current (edge map)

        // Overlay green for selected region
        for (const p of region) {
            const idx = (p.y * this.canvasWidth + p.x) * 4;
            img.data[idx] = 0;     // R
            img.data[idx + 1] = 255; // G (Green)
            img.data[idx + 2] = 0;   // B
            img.data[idx + 3] = 255; // Alpha (Solid)
        }

        ctx.putImageData(img, 0, 0);
    }
}
