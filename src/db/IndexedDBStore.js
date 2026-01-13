/**
 * IndexedDB Store for offline data persistence
 * Handles lots, map tiles, and sync queue
 */

const DB_NAME = 'nookr-lot-mapper';
const DB_VERSION = 4;  // Incremented for areas support

class IndexedDBStore {
    constructor() {
        this.db = null;
        this.MAX_TILE_CACHE_SIZE = 500 * 1024 * 1024; // 500MB
        // In-memory cache for fast tile access (avoid slow IndexedDB reads)
        this.memoryCache = new Map();
        this.MEMORY_CACHE_SIZE = 200; // Keep 200 most recent tiles in memory
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const oldVersion = event.oldVersion;

                // Projects store (new in v3)
                if (!db.objectStoreNames.contains('projects')) {
                    const projectsStore = db.createObjectStore('projects', { keyPath: 'id' });
                    projectsStore.createIndex('name', 'name', { unique: false });
                    projectsStore.createIndex('createdAt', 'createdAt', { unique: false });
                }

                // Lots store
                if (!db.objectStoreNames.contains('lots')) {
                    const lotsStore = db.createObjectStore('lots', { keyPath: 'id' });
                    lotsStore.createIndex('lotNumber', 'lotNumber', { unique: false });
                    lotsStore.createIndex('blockNumber', 'blockNumber', { unique: false });
                    lotsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                    lotsStore.createIndex('projectId', 'projectId', { unique: false });
                } else if (oldVersion < 3) {
                    // Add projectId index to existing lots store
                    const tx = event.target.transaction;
                    const lotsStore = tx.objectStore('lots');
                    if (!lotsStore.indexNames.contains('projectId')) {
                        lotsStore.createIndex('projectId', 'projectId', { unique: false });
                    }
                }

                // Areas store (new in v4) - for lot grouping
                if (!db.objectStoreNames.contains('areas')) {
                    const areasStore = db.createObjectStore('areas', { keyPath: 'id' });
                    areasStore.createIndex('projectId', 'projectId', { unique: false });
                    areasStore.createIndex('name', 'name', { unique: false });
                }

                // Tiles store for offline map caching
                if (!db.objectStoreNames.contains('tiles')) {
                    const tilesStore = db.createObjectStore('tiles', { keyPath: 'url' });
                    tilesStore.createIndex('zoom', 'zoom', { unique: false });
                    tilesStore.createIndex('accessedAt', 'accessedAt', { unique: false });
                }

                // Sync queue for offline changes
                if (!db.objectStoreNames.contains('syncQueue')) {
                    db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
                }

                // Download regions to track cached areas
                if (!db.objectStoreNames.contains('downloadRegions')) {
                    const regionsStore = db.createObjectStore('downloadRegions', { keyPath: 'id', autoIncrement: true });
                    regionsStore.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };
        });
    }

    // ==================== LOTS ====================

    async getAllLots() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('lots', 'readonly');
            const store = tx.objectStore('lots');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async getLot(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('lots', 'readonly');
            const store = tx.objectStore('lots');
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async saveLot(lot) {
        lot.updatedAt = new Date().toISOString();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('lots', 'readwrite');
            const store = tx.objectStore('lots');
            const request = store.put(lot);

            request.onsuccess = () => resolve(lot);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteLot(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('lots', 'readwrite');
            const store = tx.objectStore('lots');
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async clearAllLots() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('lots', 'readwrite');
            const store = tx.objectStore('lots');
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getLotsByProject(projectId) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('lots', 'readonly');
            const store = tx.objectStore('lots');
            const index = store.index('projectId');
            const request = index.getAll(projectId);

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteLotsByProject(projectId) {
        const lots = await this.getLotsByProject(projectId);
        const tx = this.db.transaction('lots', 'readwrite');
        const store = tx.objectStore('lots');

        for (const lot of lots) {
            store.delete(lot.id);
        }

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(lots.length);
            tx.onerror = () => reject(tx.error);
        });
    }

    // ==================== PROJECTS ====================

    async getAllProjects() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('projects', 'readonly');
            const store = tx.objectStore('projects');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async getProject(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('projects', 'readonly');
            const store = tx.objectStore('projects');
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async saveProject(project) {
        if (!project.createdAt) {
            project.createdAt = new Date().toISOString();
        }
        project.updatedAt = new Date().toISOString();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('projects', 'readwrite');
            const store = tx.objectStore('projects');
            const request = store.put(project);

            request.onsuccess = () => resolve(project);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteProject(id) {
        // First delete all lots in this project
        await this.deleteLotsByProject(id);

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('projects', 'readwrite');
            const store = tx.objectStore('projects');
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async createDefaultProject() {
        const projects = await this.getAllProjects();
        if (projects.length === 0) {
            const defaultProject = {
                id: 'default',
                name: 'Project 1',
                description: 'Default project',
                createdAt: new Date().toISOString()
            };
            await this.saveProject(defaultProject);

            // Migrate existing lots to default project
            const lots = await this.getAllLots();
            for (const lot of lots) {
                if (!lot.projectId) {
                    lot.projectId = 'default';
                    await this.saveLot(lot);
                }
            }

            return defaultProject;
        }
        return projects[0];
    }

    // ==================== AREAS ====================

    async getAreasByProject(projectId) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('areas', 'readonly');
            const store = tx.objectStore('areas');
            const index = store.index('projectId');
            const request = index.getAll(projectId);

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async getArea(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('areas', 'readonly');
            const store = tx.objectStore('areas');
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async saveArea(area) {
        if (!area.id) {
            area.id = crypto.randomUUID();
        }
        if (!area.createdAt) {
            area.createdAt = new Date().toISOString();
        }
        area.updatedAt = new Date().toISOString();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('areas', 'readwrite');
            const store = tx.objectStore('areas');
            const request = store.put(area);

            request.onsuccess = () => resolve(area);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteArea(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('areas', 'readwrite');
            const store = tx.objectStore('areas');
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async deleteAreasByProject(projectId) {
        const areas = await this.getAreasByProject(projectId);
        const tx = this.db.transaction('areas', 'readwrite');
        const store = tx.objectStore('areas');

        for (const area of areas) {
            store.delete(area.id);
        }

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(areas.length);
            tx.onerror = () => reject(tx.error);
        });
    }

    // ==================== TILES ====================

    async getTile(url) {
        // Check memory cache first (instant)
        if (this.memoryCache.has(url)) {
            const tile = this.memoryCache.get(url);
            // Move to end (most recently used)
            this.memoryCache.delete(url);
            this.memoryCache.set(url, tile);
            return tile;
        }

        // Fall back to IndexedDB
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('tiles', 'readonly');
            const store = tx.objectStore('tiles');
            const request = store.get(url);

            request.onsuccess = () => {
                const tile = request.result;
                if (tile) {
                    // Add to memory cache
                    this.addToMemoryCache(url, tile);
                }
                resolve(tile);
            };
            request.onerror = () => reject(request.error);
        });
    }

    addToMemoryCache(url, tile) {
        // Evict oldest if at capacity
        if (this.memoryCache.size >= this.MEMORY_CACHE_SIZE) {
            const oldest = this.memoryCache.keys().next().value;
            this.memoryCache.delete(oldest);
        }
        this.memoryCache.set(url, tile);
    }

    async saveTile(url, blob, zoom) {
        const tile = {
            url,
            blob,
            zoom,
            size: blob.size,
            accessedAt: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('tiles', 'readwrite');
            const store = tx.objectStore('tiles');
            const request = store.put(tile);

            request.onsuccess = () => {
                // Check cache size periodically
                this.checkCacheSize();
                resolve(tile);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async updateTileAccess(url) {
        try {
            const tx = this.db.transaction('tiles', 'readwrite');
            const store = tx.objectStore('tiles');
            const request = store.get(url);

            request.onsuccess = () => {
                if (request.result) {
                    const tile = request.result;
                    tile.accessedAt = new Date().toISOString();
                    store.put(tile);
                }
            };
        } catch (e) {
            // Ignore access update errors
        }
    }

    async getCacheSize() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('tiles', 'readonly');
            const store = tx.objectStore('tiles');
            const request = store.getAll();

            request.onsuccess = () => {
                const tiles = request.result || [];
                const totalSize = tiles.reduce((sum, tile) => sum + (tile.size || 0), 0);
                resolve({ count: tiles.length, size: totalSize });
            };
            request.onerror = () => reject(request.error);
        });
    }

    async checkCacheSize() {
        try {
            const { size } = await this.getCacheSize();

            if (size > this.MAX_TILE_CACHE_SIZE) {
                await this.evictOldTiles();
            }
        } catch (e) {
            console.warn('Cache size check failed:', e);
        }
    }

    async evictOldTiles() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('tiles', 'readwrite');
            const store = tx.objectStore('tiles');
            const index = store.index('accessedAt');
            const request = index.openCursor();

            let deletedCount = 0;
            const toDelete = Math.ceil(this.MAX_TILE_CACHE_SIZE * 0.2 / 50000); // Delete ~20% of cache

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && deletedCount < toDelete) {
                    cursor.delete();
                    deletedCount++;
                    cursor.continue();
                } else {
                    console.log(`Evicted ${deletedCount} old tiles from cache`);
                    resolve(deletedCount);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    // ==================== TILE DOWNLOAD ====================

    /**
     * Convert lat/lng to tile coordinates at a given zoom level
     */
    latLngToTile(lat, lng, zoom) {
        const x = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
        const latRad = lat * Math.PI / 180;
        const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, zoom));
        return { x, y, z: zoom };
    }

    /**
     * Get all tile URLs for a bounding box across zoom levels
     */
    getTileUrlsForBounds(bounds, minZoom, maxZoom, urlTemplate) {
        const urls = [];
        const subdomains = ['a', 'b', 'c'];

        for (let z = minZoom; z <= maxZoom; z++) {
            const nwTile = this.latLngToTile(bounds.north, bounds.west, z);
            const seTile = this.latLngToTile(bounds.south, bounds.east, z);

            const minX = Math.min(nwTile.x, seTile.x);
            const maxX = Math.max(nwTile.x, seTile.x);
            const minY = Math.min(nwTile.y, seTile.y);
            const maxY = Math.max(nwTile.y, seTile.y);

            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    const subdomain = subdomains[(x + y) % subdomains.length];
                    const url = urlTemplate
                        .replace('{s}', subdomain)
                        .replace('{z}', z)
                        .replace('{x}', x)
                        .replace('{y}', y);
                    urls.push({ url, zoom: z });
                }
            }
        }

        return urls;
    }

    /**
     * Download and cache tiles for an area
     */
    async downloadTilesForArea(bounds, minZoom, maxZoom, urlTemplate, onProgress, signal) {
        const tiles = this.getTileUrlsForBounds(bounds, minZoom, maxZoom, urlTemplate);
        const total = tiles.length;
        let downloaded = 0;
        let failed = 0;

        for (const tile of tiles) {
            // Check if cancelled
            if (signal && signal.aborted) {
                return { downloaded, failed, total, cancelled: true };
            }

            try {
                // Check if already cached
                const existing = await this.getTile(tile.url);
                if (existing && existing.blob) {
                    downloaded++;
                    if (onProgress) onProgress(downloaded, total, 'cached');
                    continue;
                }

                // Download tile
                const response = await fetch(tile.url);
                if (response.ok) {
                    const blob = await response.blob();
                    await this.saveTile(tile.url, blob, tile.zoom);
                    downloaded++;
                } else {
                    failed++;
                }
            } catch (error) {
                failed++;
            }

            if (onProgress) onProgress(downloaded, total, 'downloading');

            // Small delay to avoid overwhelming the server
            await new Promise(r => setTimeout(r, 50));
        }

        return { downloaded, failed, total, cancelled: false };
    }

    // ==================== DOWNLOAD REGIONS ====================

    async saveDownloadRegion(bounds, layer, tileCount) {
        const region = {
            bounds,
            layer,
            tileCount,
            createdAt: new Date().toISOString()
        };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('downloadRegions', 'readwrite');
            const store = tx.objectStore('downloadRegions');
            const request = store.add(region);

            request.onsuccess = () => {
                region.id = request.result;
                resolve(region);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getDownloadRegions() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('downloadRegions', 'readonly');
            const store = tx.objectStore('downloadRegions');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteDownloadRegion(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('downloadRegions', 'readwrite');
            const store = tx.objectStore('downloadRegions');
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async clearDownloadRegions() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('downloadRegions', 'readwrite');
            const store = tx.objectStore('downloadRegions');
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // ==================== SYNC QUEUE ====================

    async addToSyncQueue(action, data) {
        const item = {
            action,
            data,
            createdAt: new Date().toISOString()
        };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('syncQueue', 'readwrite');
            const store = tx.objectStore('syncQueue');
            const request = store.add(item);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getSyncQueue() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('syncQueue', 'readonly');
            const store = tx.objectStore('syncQueue');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async clearSyncQueue() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('syncQueue', 'readwrite');
            const store = tx.objectStore('syncQueue');
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // ==================== CACHE STATISTICS ====================

    /**
     * Get cache statistics (tile count, total size)
     * @returns {Promise<{tileCount: number, totalSize: number, sizeFormatted: string}>}
     */
    async getCacheStats() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('tiles', 'readonly');
            const store = tx.objectStore('tiles');
            const request = store.getAll();

            request.onsuccess = () => {
                const tiles = request.result || [];
                let totalSize = 0;

                for (const tile of tiles) {
                    if (tile.blob && tile.blob.size) {
                        totalSize += tile.blob.size;
                    }
                }

                // Format size
                let sizeFormatted;
                if (totalSize < 1024) {
                    sizeFormatted = `${totalSize} B`;
                } else if (totalSize < 1024 * 1024) {
                    sizeFormatted = `${(totalSize / 1024).toFixed(1)} KB`;
                } else if (totalSize < 1024 * 1024 * 1024) {
                    sizeFormatted = `${(totalSize / (1024 * 1024)).toFixed(1)} MB`;
                } else {
                    sizeFormatted = `${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB`;
                }

                resolve({
                    tileCount: tiles.length,
                    totalSize: totalSize,
                    sizeFormatted: sizeFormatted
                });
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Clear all cached tiles
     */
    async clearTileCache() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('tiles', 'readwrite');
            const store = tx.objectStore('tiles');
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

// Export singleton
export const db = new IndexedDBStore();
