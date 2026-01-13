/**
 * Sync Manager - Handles bidirectional sync between IndexedDB and PostgreSQL
 * Implements offline-first with background sync when online
 */

import { db } from './IndexedDBStore.js';
import { api } from './api.js';

class SyncManager {
    constructor() {
        this.isSyncing = false;
        this.syncInterval = null;
        this.lastSyncTime = null;
        this.onSyncStatusChange = null;
        this.onSyncError = null;
        this.onSyncComplete = null;
    }

    /**
     * Initialize sync manager and set up event listeners
     */
    init() {
        // Load last sync time from localStorage
        this.lastSyncTime = localStorage.getItem('lastSyncTime');

        // Listen for online/offline events
        window.addEventListener('online', () => this.onOnline());
        window.addEventListener('offline', () => this.onOffline());

        // Start sync interval if online
        if (navigator.onLine) {
            this.startSyncInterval();
        }

        console.log('SyncManager initialized');
    }

    /**
     * Called when browser goes online
     */
    async onOnline() {
        console.log('Back online - starting sync');
        this.startSyncInterval();

        // Trigger immediate sync
        await this.sync();
    }

    /**
     * Called when browser goes offline
     */
    onOffline() {
        console.log('Gone offline - stopping sync');
        this.stopSyncInterval();
    }

    /**
     * Start periodic sync
     */
    startSyncInterval() {
        if (this.syncInterval) return;

        // Sync every 30 seconds when online
        this.syncInterval = setInterval(() => {
            if (navigator.onLine && !this.isSyncing) {
                this.sync();
            }
        }, 30000);
    }

    /**
     * Stop periodic sync
     */
    stopSyncInterval() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    /**
     * Start periodic health check
     */
    startHealthCheckInterval() {
        if (this.healthCheckInterval) return;

        // Check server health every 10 seconds
        this.healthCheckInterval = setInterval(() => {
            this.checkHealth();
        }, 10000); // Reduced frequency to 10 seconds
    }

    /**
     * Stop periodic health check
     */
    stopHealthCheckInterval() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    /**
     * Check server health
     */
    async checkHealth() {
        if (!this.online) return;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); // 2-second timeout

            const response = await fetch(`${this.API_URL}/health`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok) {
                if (!this.serverReachable) {
                    console.log('Server is back online');
                    this.serverReachable = true;
                    // If server just became reachable, try to process any pending queue items
                    this.processSyncQueue();
                }
            } else {
                this.serverReachable = false;
                // console.warn('Server health check failed with status:', response.status);
            }
        } catch (error) {
            this.serverReachable = false;
            // distinct silence: don't spam console with connection refused
            // console.debug('Server not reachable, skipping sync (health check error):', error.message);
        }
    }

    /**
     * Main sync function - processes queue and fetches server changes
     */
    async sync() {
        if (this.isSyncing || !this.online) { // Use this.online
            return { success: false, reason: this.isSyncing ? 'Already syncing' : 'Offline' };
        }

        this.isSyncing = true;
        this.notifyStatus('syncing');

        try {
            // Check if server is reachable using the health check status
            if (!this.serverReachable) {
                console.log('Server not reachable, skipping sync');
                this.isSyncing = false;
                this.notifyStatus('server-unavailable');
                return { success: false, reason: 'Server unavailable' };
            }

            // Step 1: Push local changes to server
            const pushResult = await this.pushChanges();

            // Step 2: Pull server changes
            const pullResult = await this.pullChanges();

            // Update last sync time
            this.lastSyncTime = new Date().toISOString();
            localStorage.setItem('lastSyncTime', this.lastSyncTime);

            this.notifyStatus('synced');

            if (this.onSyncComplete) {
                this.onSyncComplete({ pushed: pushResult, pulled: pullResult });
            }

            return {
                success: true,
                pushed: pushResult.count,
                pulled: pullResult.count
            };

        } catch (error) {
            console.error('Sync failed:', error);
            this.notifyStatus('error');

            if (this.onSyncError) {
                this.onSyncError(error);
            }

            return { success: false, error: error.message };
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Push local changes from sync queue to server
     */
    async pushChanges() {
        const queue = await db.getSyncQueue();

        if (queue.length === 0) {
            return { count: 0, items: [] };
        }

        console.log(`Pushing ${queue.length} changes to server`);

        const results = [];
        const processedIds = [];

        for (const item of queue) {
            try {
                await this.processQueueItem(item);
                processedIds.push(item.id);
                results.push({ id: item.id, success: true });
            } catch (error) {
                console.error(`Failed to sync item ${item.id}:`, error);
                results.push({ id: item.id, success: false, error: error.message });
            }
        }

        // Clear successfully synced items from queue
        if (processedIds.length > 0) {
            await db.clearSyncQueue();
        }

        return { count: processedIds.length, items: results };
    }

    /**
     * Process a single queue item
     */
    async processQueueItem(item) {
        const { action, data } = item;

        switch (action) {
            case 'create':
                await api.createLot(data);
                break;
            case 'update':
                await api.updateLot(data.id, data);
                break;
            case 'delete':
                await api.deleteLot(data.id);
                break;
            default:
                console.warn(`Unknown sync action: ${action}`);
        }
    }

    /**
     * Pull changes from server
     */
    async pullChanges() {
        try {
            const serverLots = await api.getChangesSince(this.lastSyncTime);

            if (!serverLots || serverLots.length === 0) {
                return { count: 0, items: [] };
            }

            console.log(`Pulling ${serverLots.length} changes from server`);

            // Update local IndexedDB with server data
            for (const serverLot of serverLots) {
                const localLot = await db.getLot(serverLot.id);

                // Conflict resolution: server wins if more recent
                if (!localLot || new Date(serverLot.updatedAt) > new Date(localLot.updatedAt)) {
                    await db.saveLot(this.convertServerLot(serverLot));
                }
            }

            return { count: serverLots.length, items: serverLots };

        } catch (error) {
            console.error('Failed to pull changes:', error);
            throw error;
        }
    }

    /**
     * Convert server lot format to local format
     */
    convertServerLot(serverLot) {
        return {
            id: serverLot.id,
            lotNumber: serverLot.lot_number,
            blockNumber: serverLot.block_number,
            owner: serverLot.owner_name,
            notes: serverLot.notes,
            areaSqm: parseFloat(serverLot.area_sqm),
            coordinates: serverLot.coordinates,
            createdAt: serverLot.created_at,
            updatedAt: serverLot.updated_at,
            syncedAt: serverLot.synced_at
        };
    }

    /**
     * Convert local lot format to server format
     */
    convertLocalLot(localLot) {
        return {
            id: localLot.id,
            lot_number: localLot.lotNumber,
            block_number: localLot.blockNumber,
            owner_name: localLot.owner,
            notes: localLot.notes,
            area_sqm: localLot.areaSqm,
            coordinates: localLot.coordinates
        };
    }

    /**
     * Queue a lot for sync (called when lot is created/updated/deleted)
     */
    async queueForSync(action, lot) {
        const data = this.convertLocalLot(lot);
        await db.addToSyncQueue(action, data);

        // Trigger immediate sync if online
        if (navigator.onLine) {
            // Debounce sync to batch changes
            clearTimeout(this.syncDebounce);
            this.syncDebounce = setTimeout(() => this.sync(), 2000);
        }
    }

    /**
     * Force a full sync (re-download all data from server)
     */
    async fullSync() {
        if (!navigator.onLine) {
            return { success: false, reason: 'Offline' };
        }

        this.isSyncing = true;
        this.notifyStatus('syncing');

        try {
            const serverLots = await api.fullSync();

            // Clear local lots and replace with server data
            await db.clearAllLots();

            for (const serverLot of serverLots) {
                await db.saveLot(this.convertServerLot(serverLot));
            }

            this.lastSyncTime = new Date().toISOString();
            localStorage.setItem('lastSyncTime', this.lastSyncTime);

            this.notifyStatus('synced');
            return { success: true, count: serverLots.length };

        } catch (error) {
            console.error('Full sync failed:', error);
            this.notifyStatus('error');
            return { success: false, error: error.message };
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Get sync status info
     */
    getStatus() {
        return {
            isSyncing: this.isSyncing,
            lastSyncTime: this.lastSyncTime,
            isOnline: navigator.onLine
        };
    }

    /**
     * Notify status change
     */
    notifyStatus(status) {
        if (this.onSyncStatusChange) {
            this.onSyncStatusChange(status);
        }
    }
}

// Export singleton
export const syncManager = new SyncManager();
