/**
 * API Client for PostgreSQL Backend
 * Handles communication with the database server for sync
 */

const API_BASE = 'http://localhost:3001/api';

class APIClient {
    constructor() {
        this.baseUrl = API_BASE;
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;

        try {
            const response = await fetch(url, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            if (!navigator.onLine) {
                throw new Error('OFFLINE');
            }
            throw error;
        }
    }

    // ==================== LOTS ====================

    async getAllLots() {
        return this.request('/lots');
    }

    async getLot(id) {
        return this.request(`/lots/${id}`);
    }

    async createLot(lot) {
        return this.request('/lots', {
            method: 'POST',
            body: JSON.stringify(lot)
        });
    }

    async updateLot(id, updates) {
        return this.request(`/lots/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates)
        });
    }

    async deleteLot(id) {
        return this.request(`/lots/${id}`, {
            method: 'DELETE'
        });
    }

    // ==================== SYNC ====================

    /**
     * Sync local changes to server
     * Sends a batch of changes (creates, updates, deletes)
     */
    async syncChanges(changes) {
        return this.request('/sync', {
            method: 'POST',
            body: JSON.stringify(changes)
        });
    }

    /**
     * Get server changes since a given timestamp
     */
    async getChangesSince(timestamp) {
        const query = timestamp ? `?since=${encodeURIComponent(timestamp)}` : '';
        return this.request(`/sync${query}`);
    }

    /**
     * Full sync - get all lots from server
     */
    async fullSync() {
        return this.request('/sync/full');
    }

    // ==================== HEALTH CHECK ====================

    async healthCheck() {
        try {
            const response = await fetch(`${this.baseUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(3000)
            });
            return response.ok;
        } catch {
            return false;
        }
    }
}

export const api = new APIClient();
