/**
 * AI-assisted edge detection for automatic house/lot boundary detection
 * Uses canvas-based image processing similar to Photoshop's magic wand
 */

const EdgeDetection = {
    /**
     * Capture the current map view as an image
     * @param {HTMLElement} mapContainer 
     * @returns {Promise<ImageData>}
     */
    async captureMapImage(mapContainer) {
        return new Promise((resolve) => {
            // Create a canvas matching the map size
            const canvas = document.createElement('canvas');
            const rect = mapContainer.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;
            const ctx = canvas.getContext('2d');

            // Use html2canvas-like approach - capture visible content
            // For now, we'll work with the satellite imagery directly
            // by analyzing color differences

            // Try to get the map canvas if available
            const mapCanvas = mapContainer.querySelector('canvas');
            if (mapCanvas) {
                ctx.drawImage(mapCanvas, 0, 0);
                resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
            } else {
                // Fallback: create empty image data
                resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
            }
        });
    },

    /**
     * Apply Sobel edge detection to an image
     * @param {ImageData} imageData 
     * @returns {ImageData}
     */
    sobelEdgeDetection(imageData) {
        const width = imageData.width;
        const height = imageData.height;
        const src = imageData.data;

        // Create output image data
        const output = new ImageData(width, height);
        const dst = output.data;

        // Sobel kernels
        const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
        const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

        // Convert to grayscale and apply Sobel
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let gx = 0, gy = 0;

                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const idx = ((y + ky) * width + (x + kx)) * 4;
                        // Grayscale value
                        const gray = (src[idx] + src[idx + 1] + src[idx + 2]) / 3;

                        const ki = (ky + 1) * 3 + (kx + 1);
                        gx += gray * sobelX[ki];
                        gy += gray * sobelY[ki];
                    }
                }

                const magnitude = Math.sqrt(gx * gx + gy * gy);
                const idx = (y * width + x) * 4;

                dst[idx] = magnitude > 30 ? 255 : 0;     // R
                dst[idx + 1] = magnitude > 30 ? 255 : 0; // G
                dst[idx + 2] = magnitude > 30 ? 255 : 0; // B
                dst[idx + 3] = 255;                       // A
            }
        }

        return output;
    },

    /**
     * Magic wand selection - flood fill from a point to find similar colors
     * @param {ImageData} imageData 
     * @param {number} startX 
     * @param {number} startY 
     * @param {number} tolerance - Color tolerance (0-255)
     * @returns {Array} Array of {x, y} points in the selection
     */
    magicWandSelect(imageData, startX, startY, tolerance = 32) {
        const width = imageData.width;
        const height = imageData.height;
        const data = imageData.data;

        const startIdx = (startY * width + startX) * 4;
        const targetR = data[startIdx];
        const targetG = data[startIdx + 1];
        const targetB = data[startIdx + 2];

        const visited = new Set();
        const selected = [];
        const queue = [[startX, startY]];

        const colorMatch = (idx) => {
            const dr = Math.abs(data[idx] - targetR);
            const dg = Math.abs(data[idx + 1] - targetG);
            const db = Math.abs(data[idx + 2] - targetB);
            return (dr + dg + db) / 3 <= tolerance;
        };

        while (queue.length > 0) {
            const [x, y] = queue.shift();
            const key = `${x},${y}`;

            if (visited.has(key)) continue;
            if (x < 0 || x >= width || y < 0 || y >= height) continue;

            const idx = (y * width + x) * 4;
            if (!colorMatch(idx)) continue;

            visited.add(key);
            selected.push({ x, y });

            // Add neighbors
            queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }

        return selected;
    },

    /**
     * Find the boundary/contour of a selection
     * @param {Array} selection - Array of {x, y} points
     * @param {number} width - Image width
     * @param {number} height - Image height
     * @returns {Array} Array of boundary {x, y} points
     */
    findContour(selection, width, height) {
        if (selection.length === 0) return [];

        // Create a set for fast lookup
        const selectionSet = new Set(selection.map(p => `${p.x},${p.y}`));
        const boundary = [];

        // Find boundary points (points with at least one neighbor not in selection)
        for (const point of selection) {
            const neighbors = [
                { x: point.x + 1, y: point.y },
                { x: point.x - 1, y: point.y },
                { x: point.x, y: point.y + 1 },
                { x: point.x, y: point.y - 1 }
            ];

            const isBoundary = neighbors.some(n => !selectionSet.has(`${n.x},${n.y}`));
            if (isBoundary) {
                boundary.push(point);
            }
        }

        return boundary;
    },

    /**
     * Simplify a polygon using Douglas-Peucker algorithm
     * @param {Array} points - Array of {x, y} points
     * @param {number} epsilon - Simplification tolerance
     * @returns {Array} Simplified array of points
     */
    simplifyPolygon(points, epsilon = 5) {
        if (points.length <= 2) return points;

        // Find the point with max distance from line between first and last
        let maxDist = 0;
        let maxIdx = 0;
        const start = points[0];
        const end = points[points.length - 1];

        for (let i = 1; i < points.length - 1; i++) {
            const dist = this.perpendicularDistance(points[i], start, end);
            if (dist > maxDist) {
                maxDist = dist;
                maxIdx = i;
            }
        }

        // If max distance > epsilon, recursively simplify
        if (maxDist > epsilon) {
            const left = this.simplifyPolygon(points.slice(0, maxIdx + 1), epsilon);
            const right = this.simplifyPolygon(points.slice(maxIdx), epsilon);
            return [...left.slice(0, -1), ...right];
        } else {
            return [start, end];
        }
    },

    /**
     * Calculate perpendicular distance from point to line
     */
    perpendicularDistance(point, lineStart, lineEnd) {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;

        if (dx === 0 && dy === 0) {
            return Math.sqrt(Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2));
        }

        const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy);
        const nearestX = lineStart.x + t * dx;
        const nearestY = lineStart.y + t * dy;

        return Math.sqrt(Math.pow(point.x - nearestX, 2) + Math.pow(point.y - nearestY, 2));
    },

    /**
     * Order boundary points to form a proper polygon
     * @param {Array} boundaryPoints 
     * @returns {Array}
     */
    orderBoundaryPoints(boundaryPoints) {
        if (boundaryPoints.length <= 3) return boundaryPoints;

        // Find centroid
        const centroid = {
            x: boundaryPoints.reduce((sum, p) => sum + p.x, 0) / boundaryPoints.length,
            y: boundaryPoints.reduce((sum, p) => sum + p.y, 0) / boundaryPoints.length
        };

        // Sort by angle from centroid
        return [...boundaryPoints].sort((a, b) => {
            const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
            const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
            return angleA - angleB;
        });
    },

    /**
     * Main function: Detect house boundary from a click point
     * @param {HTMLElement} mapContainer 
     * @param {number} clickX - Click X coordinate relative to container
     * @param {number} clickY - Click Y coordinate relative to container
     * @param {number} tolerance - Color tolerance
     * @returns {Promise<Array>} Array of {x, y} polygon vertices
     */
    async detectHouseBoundary(mapContainer, clickX, clickY, tolerance = 25) {
        try {
            // Capture the map image
            const imageData = await this.captureMapImage(mapContainer);

            if (!imageData || imageData.data.length === 0) {
                console.warn('Could not capture map image, using fallback rectangle');
                return this.createFallbackRectangle(clickX, clickY, 50);
            }

            // Apply magic wand selection
            const selection = this.magicWandSelect(imageData, Math.round(clickX), Math.round(clickY), tolerance);

            if (selection.length < 10) {
                console.warn('Selection too small, using fallback rectangle');
                return this.createFallbackRectangle(clickX, clickY, 50);
            }

            // Find contour
            const boundary = this.findContour(selection, imageData.width, imageData.height);

            // Order and simplify
            const ordered = this.orderBoundaryPoints(boundary);
            const simplified = this.simplifyPolygon(ordered, 8);

            // Ensure we have at least 4 points for a proper polygon
            if (simplified.length < 4) {
                return this.createFallbackRectangle(clickX, clickY, 50);
            }

            return simplified;
        } catch (error) {
            console.error('Error in detectHouseBoundary:', error);
            return this.createFallbackRectangle(clickX, clickY, 50);
        }
    },

    /**
     * Create a fallback rectangle when detection fails
     */
    createFallbackRectangle(centerX, centerY, size) {
        return [
            { x: centerX - size, y: centerY - size },
            { x: centerX + size, y: centerY - size },
            { x: centerX + size, y: centerY + size },
            { x: centerX - size, y: centerY + size }
        ];
    }
};

// Make available globally
window.EdgeDetection = EdgeDetection;
