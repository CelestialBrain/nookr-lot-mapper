/**
 * Share Code Manager - Advanced Compression Edition
 * Uses LZ-String compression + delta encoding for maximum compression
 * Produces URL-safe shareable codes that work completely offline
 */

import LZString from 'lz-string';

class ShareCodeManager {
    constructor() {
        // Base62 characters for checksums
        this.BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    }

    /**
     * Encode a project's lots into a shareable code
     * Uses delta encoding + LZ-String for maximum compression
     * @param {Array} lots - Array of lot objects
     * @param {string} projectName - Name of the project
     * @param {Object} options - { areas, originPoint }
     * @returns {string} - Encoded share code
     */
    encode(lots, projectName = 'Shared Project', options = {}) {
        if (!lots || lots.length === 0) {
            throw new Error('No lots to encode');
        }

        // Step 1: Compress lot data with delta encoding for coordinates
        const compressedData = {
            n: projectName.substring(0, 100), // Limit project name
            l: lots.map(lot => this.compressLot(lot))
        };

        // Include areas if provided
        if (options.areas && options.areas.length > 0) {
            compressedData.a = options.areas.map(area => ({
                i: area.id,
                n: area.name,
                c: area.color
            }));
        }

        // Include origin point if provided
        if (options.originPoint) {
            compressedData.o = [
                Math.round(options.originPoint.lat * 1e6),
                Math.round(options.originPoint.lng * 1e6)
            ];
        }

        // Step 2: Convert to compact JSON
        const json = JSON.stringify(compressedData);

        // Step 3: Compress with LZ-String (URI-safe encoding)
        const compressed = LZString.compressToEncodedURIComponent(json);

        return compressed;
    }

    /**
     * Compress a single lot using delta encoding for coordinates
     */
    compressLot(lot) {
        const coords = lot.coordinates || [];

        // Delta encode coordinates for better compression
        // First point is absolute, subsequent points are deltas
        const deltaCoords = [];
        let prevLat = 0, prevLng = 0;

        for (const coord of coords) {
            const lat = Math.round(coord.lat * 1e6); // microDegrees
            const lng = Math.round(coord.lng * 1e6);

            if (deltaCoords.length === 0) {
                // First point is absolute
                deltaCoords.push([lat, lng]);
            } else {
                // Subsequent points are deltas (much smaller numbers = better compression)
                deltaCoords.push([lat - prevLat, lng - prevLng]);
            }

            prevLat = lat;
            prevLng = lng;
        }

        return {
            // Use single-letter keys for smaller JSON
            l: lot.lotNumber || '',
            b: lot.blockNumber || '',
            o: (lot.owner || '').substring(0, 50),
            s: lot.status || 'available', // Status: available, reserved, sold
            a: lot.areaIds || [], // Area IDs
            n: (lot.notes || '').substring(0, 100),
            c: deltaCoords
        };
    }

    /**
     * Decode a share code back into lots
     * @param {string} code - Share code to decode
     * @returns {Object} - { projectName, lots, areas, originPoint }
     */
    decode(code) {
        try {
            // Step 1: Decompress with LZ-String
            const json = LZString.decompressFromEncodedURIComponent(code);

            if (!json) {
                throw new Error('Failed to decompress');
            }

            // Step 2: Parse JSON
            const data = JSON.parse(json);

            // Step 3: Expand lot data with delta decoding
            const lots = data.l.map((lot, index) => this.expandLot(lot, index));

            // Decode areas
            const areas = (data.a || []).map(a => ({
                id: a.i,
                name: a.n,
                color: a.c,
                visible: true
            }));

            // Decode origin point
            let originPoint = null;
            if (data.o) {
                originPoint = {
                    lat: data.o[0] / 1e6,
                    lng: data.o[1] / 1e6
                };
            }

            return {
                projectName: data.n || 'Imported Project',
                lots,
                areas,
                originPoint
            };
        } catch (error) {
            console.error('Failed to decode share code:', error);
            throw new Error('Invalid share code');
        }
    }

    /**
     * Expand a compressed lot, reversing delta encoding
     */
    expandLot(compressedLot, index) {
        // Delta decode coordinates
        const coords = [];
        let currentLat = 0, currentLng = 0;

        for (const delta of compressedLot.c || []) {
            if (coords.length === 0) {
                // First point is absolute
                currentLat = delta[0];
                currentLng = delta[1];
            } else {
                // Add delta to get actual coordinates
                currentLat += delta[0];
                currentLng += delta[1];
            }

            coords.push({
                lat: currentLat / 1e6,
                lng: currentLng / 1e6
            });
        }

        return {
            id: crypto.randomUUID(),
            lotNumber: compressedLot.l || String(index + 1),
            blockNumber: compressedLot.b || '',
            owner: compressedLot.o || '',
            status: compressedLot.s || 'available',
            areaIds: compressedLot.a || [],
            notes: compressedLot.n || '',
            coordinates: coords,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    /**
     * Generate code with checksum prefix for validation
     */
    generateWithChecksum(lots, projectName, options = {}) {
        const encoded = this.encode(lots, projectName, options);
        const checksum = this.hash(encoded).substring(0, 3);
        return `${checksum}.${encoded}`;
    }

    /**
     * Decode with checksum verification
     */
    decodeWithChecksum(code) {
        const dotIndex = code.indexOf('.');
        if (dotIndex === -1 || dotIndex !== 3) {
            throw new Error('Invalid code format');
        }

        const checksum = code.substring(0, 3);
        const encoded = code.substring(4);

        const expectedChecksum = this.hash(encoded).substring(0, 3);
        if (checksum !== expectedChecksum) {
            throw new Error('Invalid checksum - code may be corrupted');
        }

        return this.decode(encoded);
    }

    /**
     * Simple hash function for checksum
     */
    hash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }

        const absHash = Math.abs(hash);
        let result = '';
        let num = absHash;
        while (num > 0) {
            result = this.BASE62[num % 62] + result;
            num = Math.floor(num / 62);
        }
        return result.padStart(3, '0');
    }

    /**
     * Estimate the compression ratio
     */
    getStats(lots, projectName) {
        const uncompressedJSON = JSON.stringify({ projectName, lots });
        const compressed = this.encode(lots, projectName);

        return {
            originalSize: uncompressedJSON.length,
            compressedSize: compressed.length,
            ratio: ((1 - compressed.length / uncompressedJSON.length) * 100).toFixed(1) + '%',
            lotsCount: lots.length,
            vertices: lots.reduce((sum, lot) => sum + (lot.coordinates?.length || 0), 0)
        };
    }
}

export const shareCodeManager = new ShareCodeManager();
