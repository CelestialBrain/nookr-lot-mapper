/**
 * Simple Express API server for lot data
 * Connects to PostgreSQL database
 */

import express from 'express';
import cors from 'cors';
import pg from 'pg';

const { Pool } = pg;

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL connection pool
const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'lotmapper',
    password: process.env.PGPASSWORD || 'lotmapper_dev',
    database: process.env.PGDATABASE || 'lotmapper',
});

// ==================== HEALTH CHECK ====================

app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ==================== LOTS CRUD ====================

// Get all lots
app.get('/api/lots', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM lots ORDER BY created_at DESC'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching lots:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single lot
app.get('/api/lots/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM lots WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lot not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching lot:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create lot
app.post('/api/lots', async (req, res) => {
    try {
        const { id, lot_number, block_number, owner_name, notes, area_sqm, coordinates } = req.body;

        const result = await pool.query(
            `INSERT INTO lots (id, lot_number, block_number, owner_name, notes, area_sqm, coordinates, synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (id) DO UPDATE SET
                lot_number = EXCLUDED.lot_number,
                block_number = EXCLUDED.block_number,
                owner_name = EXCLUDED.owner_name,
                notes = EXCLUDED.notes,
                area_sqm = EXCLUDED.area_sqm,
                coordinates = EXCLUDED.coordinates,
                synced_at = NOW()
             RETURNING *`,
            [id, lot_number, block_number, owner_name, notes, area_sqm, JSON.stringify(coordinates)]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating lot:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update lot
app.put('/api/lots/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { lot_number, block_number, owner_name, notes, area_sqm, coordinates } = req.body;

        const result = await pool.query(
            `UPDATE lots SET
                lot_number = COALESCE($2, lot_number),
                block_number = COALESCE($3, block_number),
                owner_name = COALESCE($4, owner_name),
                notes = COALESCE($5, notes),
                area_sqm = COALESCE($6, area_sqm),
                coordinates = COALESCE($7, coordinates),
                synced_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [id, lot_number, block_number, owner_name, notes, area_sqm,
                coordinates ? JSON.stringify(coordinates) : null]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lot not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating lot:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete lot
app.delete('/api/lots/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM lots WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lot not found' });
        }

        res.json({ deleted: true, id });
    } catch (error) {
        console.error('Error deleting lot:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== SYNC ENDPOINTS ====================

// Get changes since timestamp
app.get('/api/sync', async (req, res) => {
    try {
        const { since } = req.query;

        let result;
        if (since) {
            result = await pool.query(
                'SELECT * FROM lots WHERE updated_at > $1 ORDER BY updated_at ASC',
                [since]
            );
        } else {
            result = await pool.query('SELECT * FROM lots ORDER BY created_at DESC');
        }

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching sync data:', error);
        res.status(500).json({ error: error.message });
    }
});

// Full sync - get all lots
app.get('/api/sync/full', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM lots ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (error) {
        console.error('Error during full sync:', error);
        res.status(500).json({ error: error.message });
    }
});

// Batch sync changes from client
app.post('/api/sync', async (req, res) => {
    try {
        const changes = req.body;
        const results = [];

        for (const change of changes) {
            const { action, data } = change;

            try {
                switch (action) {
                    case 'create':
                    case 'update':
                        await pool.query(
                            `INSERT INTO lots (id, lot_number, block_number, owner_name, notes, area_sqm, coordinates, synced_at)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                             ON CONFLICT (id) DO UPDATE SET
                                lot_number = EXCLUDED.lot_number,
                                block_number = EXCLUDED.block_number,
                                owner_name = EXCLUDED.owner_name,
                                notes = EXCLUDED.notes,
                                area_sqm = EXCLUDED.area_sqm,
                                coordinates = EXCLUDED.coordinates,
                                synced_at = NOW()`,
                            [data.id, data.lot_number, data.block_number, data.owner_name,
                            data.notes, data.area_sqm, JSON.stringify(data.coordinates)]
                        );
                        results.push({ id: data.id, success: true });
                        break;

                    case 'delete':
                        await pool.query('DELETE FROM lots WHERE id = $1', [data.id]);
                        results.push({ id: data.id, success: true });
                        break;

                    default:
                        results.push({ id: data.id, success: false, error: `Unknown action: ${action}` });
                }
            } catch (err) {
                results.push({ id: data.id, success: false, error: err.message });
            }
        }

        res.json({ results, synced: results.filter(r => r.success).length });
    } catch (error) {
        console.error('Error during batch sync:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
    console.log(`Lot Mapper API server running on http://localhost:${PORT}`);
    console.log('Endpoints:');
    console.log('  GET  /api/health     - Health check');
    console.log('  GET  /api/lots       - Get all lots');
    console.log('  POST /api/lots       - Create lot');
    console.log('  GET  /api/lots/:id   - Get lot by ID');
    console.log('  PUT  /api/lots/:id   - Update lot');
    console.log('  DELETE /api/lots/:id - Delete lot');
    console.log('  GET  /api/sync       - Get changes since timestamp');
    console.log('  POST /api/sync       - Batch sync changes');
});
