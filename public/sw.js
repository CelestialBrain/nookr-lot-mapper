/**
 * Nookr Lot Mapper - Service Worker
 * Provides offline capability for the app shell and static assets
 */

const CACHE_VERSION = 'v1.0.1';
const CACHE_NAME = `nookr-lot-mapper-${CACHE_VERSION}`;

// Static assets to cache for offline use
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/src/main.js',
    '/src/style.css',
    '/src/lots/LotManager.js',
    '/src/lots/DrawingTools.js',
    '/src/db/IndexedDBStore.js',
    '/src/db/SyncManager.js',
    '/src/db/api.js',
    '/src/map/EdgeDetector.js',
    '/src/map/TileCacheLayer.js',
    '/src/share/ShareCodeManager.js',
    '/public/nookr-icon.png',
    '/public/nookr-wordmark.png',
    '/public/favicon.ico'
];

// External CDN resources to cache
const CDN_ASSETS = [
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/lz-string@1.5.0/libs/lz-string.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('[SW] Installing Service Worker...');

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching static assets');
                // Cache static assets
                return Promise.all([
                    cache.addAll(STATIC_ASSETS.filter(url => !url.startsWith('http'))),
                    ...CDN_ASSETS.map(url =>
                        fetch(url).then(response => cache.put(url, response))
                            .catch(err => console.log('[SW] Failed to cache CDN:', url))
                    )
                ]);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating Service Worker...');

    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter(name => name.startsWith('nookr-lot-mapper-') && name !== CACHE_NAME)
                        .map(name => {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => self.clients.claim())
    );
});

// Fetch event - serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Skip chrome-extension and other non-http(s) requests
    if (!url.protocol.startsWith('http')) return;

    // Handle tile requests separately (they use IndexedDB caching)
    if (isTileRequest(url)) {
        // Let tile requests go through - they're handled by IndexedDB
        return;
    }

    // For app shell and static assets - cache first, network fallback
    // For app shell and static assets - cache first, network fallback
    event.respondWith(
        (async () => {
            // NETWORK FIRST for navigation requests (HTML)
            // This ensures we always get the latest version (fixing HMR/Vite issues)
            if (request.mode === 'navigate') {
                try {
                    const networkResponse = await fetch(request);
                    if (networkResponse.ok) {
                        const cache = await caches.open(CACHE_NAME);
                        cache.put(request, networkResponse.clone());
                        return networkResponse;
                    }
                } catch (error) {
                    // Start offline fallback
                    const cached = await caches.match(request);
                    if (cached) return cached;
                    return caches.match('/index.html');
                }
            }

            // CACHE FIRST for everything else (scripts, styles, images)
            const cachedResponse = await caches.match(request);
            if (cachedResponse) {
                return cachedResponse;
            }

            // Not in cache - fetch from network
            try {
                const networkResponse = await fetch(request);
                if (networkResponse.ok && shouldCache(url)) {
                    const cache = await caches.open(CACHE_NAME);
                    cache.put(request, networkResponse.clone());
                }
                return networkResponse;
            } catch (error) {
                // Network failed and not in cache
                if (request.mode === 'navigate') {
                    return caches.match('/index.html');
                }
                return new Response('Offline', { status: 503 });
            }
        })()
    );
});

// Check if URL is a map tile request
function isTileRequest(url) {
    const tilePatterns = [
        'tile.openstreetmap.org',
        'server.arcgisonline.com',
        'tiles.stadiamaps.com',
        'basemaps.cartocdn.com',
        'mt0.google.com',
        'mt1.google.com'
    ];
    return tilePatterns.some(pattern => url.hostname.includes(pattern));
}

// Check if response should be cached
function shouldCache(url) {
    // Cache same-origin requests and CDN assets
    return url.origin === self.location.origin ||
        CDN_ASSETS.some(cdn => url.href.startsWith(cdn));
}

// Message handler for cache management
self.addEventListener('message', (event) => {
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data.type === 'CLEAR_CACHE') {
        caches.delete(CACHE_NAME)
            .then(() => event.ports[0].postMessage({ success: true }));
    }
});
