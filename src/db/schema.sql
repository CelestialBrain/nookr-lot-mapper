-- Nookr Lot Mapper - PostgreSQL Schema
-- Aligned with Nookr2 HOA Management System

-- Properties/Lots table (matches nookr2)
CREATE TABLE IF NOT EXISTS properties (
    property_id BIGSERIAL PRIMARY KEY,
    community_id BIGINT NOT NULL,

-- Identification
block_number VARCHAR(50),
lot_number VARCHAR(50),
unit_number VARCHAR(50),
property_reference VARCHAR(50) GENERATED ALWAYS AS (
    COALESCE('B' || block_number, '') || COALESCE('-L' || lot_number, '') || COALESCE('-U' || unit_number, '')
) STORED,

-- GIS/Map Data
geo_latitude NUMERIC(10, 7),
geo_longitude NUMERIC(10, 7),
geo_polygon JSONB, -- [[lat,lng], [lat,lng], ...]
area_sqm NUMERIC(12, 4),
map_layer TEXT, -- Phase/section grouping

-- Status
status VARCHAR(20) DEFAULT 'active',
property_type VARCHAR(50) DEFAULT 'residential',

-- Metadata
notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    synced_at TIMESTAMPTZ
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_properties_community ON properties (community_id);

CREATE INDEX IF NOT EXISTS idx_properties_block ON properties (block_number);

CREATE INDEX IF NOT EXISTS idx_properties_map_layer ON properties (map_layer);

CREATE INDEX IF NOT EXISTS idx_properties_geo ON properties (geo_latitude, geo_longitude);

-- Amenities table (common areas, facilities)
CREATE TABLE IF NOT EXISTS amenities (
    amenity_id BIGSERIAL PRIMARY KEY,
    community_id BIGINT NOT NULL,

-- Details
name VARCHAR(255) NOT NULL,
description TEXT,
amenity_type VARCHAR(50), -- pool, clubhouse, gym, park, court

-- GIS Data
geo_latitude NUMERIC(10, 7),
geo_longitude NUMERIC(10, 7),
geo_polygon JSONB,
map_icon TEXT, -- Icon identifier

-- Status
is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Community settings (map configuration)
CREATE TABLE IF NOT EXISTS communities (
    community_id BIGSERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE,
    name VARCHAR(255) NOT NULL,

-- Map Configuration
map_center_latitude NUMERIC(10,7),
    map_center_longitude NUMERIC(10,7),
    map_default_zoom INTEGER DEFAULT 16,
    map_style TEXT DEFAULT 'satellite',  -- satellite, streets, hybrid
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS properties_updated_at ON properties;

CREATE TRIGGER properties_updated_at
    BEFORE UPDATE ON properties
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Sync queue for offline changes
CREATE TABLE IF NOT EXISTS sync_queue (
    sync_id BIGSERIAL PRIMARY KEY,
    action VARCHAR(20) NOT NULL, -- create, update, delete
    entity_type VARCHAR(50) NOT NULL, -- property, amenity
    entity_id BIGINT,
    data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    synced_at TIMESTAMPTZ
);