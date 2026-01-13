/**
 * Custom Leaflet tile layer with IndexedDB caching
 * Caches tiles for offline use with LRU eviction
 */

import { db } from '../db/IndexedDBStore.js';

export class CachedTileLayer extends L.TileLayer {
    constructor(url, options = {}) {
        super(url, options);
        this.cacheEnabled = true;
        // Keep blob URLs in memory for instant access
        this.blobUrlCache = new Map();
        this.BLOB_CACHE_SIZE = 150;
    }

    createTile(coords, done) {
        const tile = document.createElement('img');
        const url = this.getTileUrl(coords);

        tile.alt = '';
        tile.setAttribute('role', 'presentation');

        // Check if we have a blob URL in memory for instant load
        if (this.blobUrlCache.has(url)) {
            tile.src = this.blobUrlCache.get(url);
            // Still need to signal done after load
            tile.onload = () => done(null, tile);
            tile.onerror = () => {
                this.blobUrlCache.delete(url);
                this.loadTile(tile, url, coords.z, done);
            };
            return tile;
        }

        // Load from cache/network
        this.loadTile(tile, url, coords.z, done);
        return tile;
    }

    async loadTile(tile, url, zoom, done) {
        // Short URL for cleaner logs (z/x/y)
        const debugUrl = url.split('/').slice(-3).join('/');
        // console.log(`[Tile Start] ${debugUrl}`);

        let isDone = false;

        // Helper to finish exactly once
        const finish = (err, resultTile) => {
            if (!isDone) {
                isDone = true;
                done(err, resultTile);
            }
        };

        // 1. Trigger Network Request (set src immediately)
        tile.src = url;

        const onNetworkLoad = () => {
            // console.log(`[Tile Net OK] ${debugUrl}`);
            finish(null, tile);
            this.cacheTileInBackground(url, zoom);
        };

        const onNetworkError = () => {
            // console.warn(`[Tile Net Fail] ${debugUrl}`);
            // Network failed. Wait for IDB check if it hasn't finished yet.
            if (idbCheckFinished && !foundInIdb) {
                console.error(`[Tile Fail] ${debugUrl} (Net + IDB both failed)`);
                finish(new Error('Failed to load tile'), tile);
            }
        };

        tile.onload = onNetworkLoad;
        tile.onerror = onNetworkError;

        // 2. Check IndexedDB in parallel
        let foundInIdb = false;
        let idbCheckFinished = false;

        db.getTile(url).then(cached => {
            idbCheckFinished = true;

            if (cached && cached.blob) {
                foundInIdb = true;

                // If we haven't finished yet (network is still pending or failed),
                // switch to the cached blob
                if (!isDone) {
                    console.log(`[Tile IDB Hit] ${debugUrl} - Swapping to cached blob`);
                    const blobUrl = URL.createObjectURL(cached.blob);
                    this.cacheBlobUrl(url, blobUrl);

                    // Reset handlers for the new source
                    tile.onload = () => finish(null, tile);
                    tile.onerror = () => finish(new Error('Failed to load blob'), tile);

                    tile.src = blobUrl;
                } else {
                    // console.log(`[Tile IDB Hit] ${debugUrl} - But network already finished`);
                }
            } else {
                // Not in DB. If network already failed, we are done.
                if (tile.complete && tile.naturalWidth === 0) { // Simple check for error state
                    // console.warn(`[Tile IDB Miss] ${debugUrl} - And network previously failed`);
                    finish(new Error('Failed to load tile'), tile);
                }
            }
        }).catch(err => {
            idbCheckFinished = true;
            // IDB Error. If network already failed, we are done.
            if (tile.complete && tile.naturalWidth === 0) {
                finish(err, tile);
            }
        });
    }

    async cacheTileInBackground(url, zoom) {
        if (!this.cacheEnabled) return;

        try {
            // Check if we already have it to avoid redundant fetches
            // (Optional optimization: rely on browser cache to make this fetch cheap)
            const exists = await db.getTile(url);
            if (exists) return;

            const response = await fetch(url);
            if (response.ok) {
                const blob = await response.blob();
                await db.saveTile(url, blob, zoom);
            }
        } catch (e) {
            // Ignore background caching errors
        }
    }

    cacheBlobUrl(url, blobUrl) {
        // Evict oldest if at capacity
        if (this.blobUrlCache.size >= this.BLOB_CACHE_SIZE) {
            const oldest = this.blobUrlCache.keys().next().value;
            const oldUrl = this.blobUrlCache.get(oldest);
            URL.revokeObjectURL(oldUrl);
            this.blobUrlCache.delete(oldest);
        }
        this.blobUrlCache.set(url, blobUrl);
    }


}

// Factory function
export function cachedTileLayer(url, options) {
    return new CachedTileLayer(url, options);
}
