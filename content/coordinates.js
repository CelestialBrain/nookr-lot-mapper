/**
 * Coordinate utilities for extracting lat/lng from Google Maps
 * Uses MutationObserver and periodic URL checking for accuracy
 */

const CoordinateUtils = {
  EARTH_RADIUS: 6371000,

  // Current map state from URL
  _currentState: null,
  _lastUrl: '',
  _lastUrlChangeTime: 0,

  // Debounce rendering when map is moving
  _isMapStable: true,
  _stabilityCheckInterval: null,

  init() {
    // Poll URL frequently
    setInterval(() => this._checkUrl(), 50);
    this._checkUrl();

    // Listen for any interaction that might move the map
    this._setupInteractionListeners();

    console.log('CoordinateUtils initialized');
  },

  _setupInteractionListeners() {
    // When user interacts, mark map as potentially unstable
    const markUnstable = () => {
      this._isMapStable = false;
      this._scheduleStabilityCheck();
    };

    // Mouse events
    document.addEventListener('mousedown', markUnstable, true);
    document.addEventListener('wheel', markUnstable, { passive: true, capture: true });

    // Touch events
    document.addEventListener('touchstart', markUnstable, { passive: true, capture: true });
    document.addEventListener('touchmove', markUnstable, { passive: true, capture: true });

    // Keyboard events (arrow keys can pan)
    document.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-', '='].includes(e.key)) {
        markUnstable();
      }
    }, true);
  },

  _scheduleStabilityCheck() {
    // Clear any existing check
    if (this._stabilityCheckInterval) {
      clearTimeout(this._stabilityCheckInterval);
    }

    // Check stability after 200ms of no URL changes
    this._stabilityCheckInterval = setTimeout(() => {
      const timeSinceLastChange = Date.now() - this._lastUrlChangeTime;
      if (timeSinceLastChange > 150) {
        this._isMapStable = true;
      } else {
        // Keep checking
        this._scheduleStabilityCheck();
      }
    }, 200);
  },

  _checkUrl() {
    const url = window.location.href;
    if (url !== this._lastUrl) {
      this._lastUrl = url;
      this._lastUrlChangeTime = Date.now();
      this._currentState = this._parseUrl(url);
      this._isMapStable = false;
      this._scheduleStabilityCheck();
    }
  },

  _parseUrl(url) {
    // Pattern: @lat,lng,Nz or @lat,lng,Nm or @lat,lng,Na
    let match = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+\.?\d*)(z|m|a)/);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      const value = parseFloat(match[3]);
      const type = match[4];

      let zoom;
      if (type === 'z') {
        zoom = value;
      } else if (type === 'm') {
        // Meters: higher value = more zoomed out
        zoom = Math.max(1, Math.min(21, 20 - Math.log2(value / 10)));
      } else {
        zoom = 18; // 3D angle
      }

      return { center: { lat, lng }, zoom };
    }

    // Fallback: just lat,lng
    match = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (match) {
      return {
        center: { lat: parseFloat(match[1]), lng: parseFloat(match[2]) },
        zoom: 17
      };
    }

    return null;
  },

  getMapState() {
    return this._currentState;
  },

  isMapStable() {
    return this._isMapStable;
  },

  /**
   * Get meters per pixel at given latitude and zoom
   */
  getMetersPerPixel(lat, zoom) {
    // At zoom 0, world is 256px wide = 40075km at equator
    // Each zoom level halves the meters per pixel
    const equatorMpp = 40075016.686 / (256 * Math.pow(2, zoom));
    return equatorMpp * Math.cos(lat * Math.PI / 180);
  },

  /**
   * Get the visible map area (accounting for sidebar)
   */
  _getMapArea() {
    let left = 0;
    let width = window.innerWidth;
    const height = window.innerHeight;

    // Detect Google Maps sidebar
    const sidePanel = document.querySelector('.widget-pane-content-holder');
    if (sidePanel) {
      const rect = sidePanel.getBoundingClientRect();
      if (rect.width > 50 && rect.left === 0) {
        left = rect.width;
        width = window.innerWidth - rect.width;
      }
    }

    return { left, width, height };
  },

  pixelToLatLng(x, y, container) {
    const state = this._currentState;
    if (!state) return { lat: 0, lng: 0 };

    const area = this._getMapArea();
    const centerX = area.left + area.width / 2;
    const centerY = area.height / 2;

    const mpp = this.getMetersPerPixel(state.center.lat, state.zoom);
    const metersX = (x - centerX) * mpp;
    const metersY = (y - centerY) * mpp;

    // Convert meters to degrees
    const latOffset = -metersY / 111320;
    const lngOffset = metersX / (111320 * Math.cos(state.center.lat * Math.PI / 180));

    return {
      lat: state.center.lat + latOffset,
      lng: state.center.lng + lngOffset
    };
  },

  latLngToPixel(lat, lng, container) {
    const state = this._currentState;
    if (!state) return { x: -9999, y: -9999 };

    const area = this._getMapArea();
    const centerX = area.left + area.width / 2;
    const centerY = area.height / 2;

    // Convert degrees to meters
    const metersY = -(lat - state.center.lat) * 111320;
    const metersX = (lng - state.center.lng) * 111320 * Math.cos(state.center.lat * Math.PI / 180);

    // Convert meters to pixels
    const mpp = this.getMetersPerPixel(state.center.lat, state.zoom);

    return {
      x: centerX + metersX / mpp,
      y: centerY + metersY / mpp
    };
  },

  haversineDistance(p1, p2) {
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(p2.lat - p1.lat);
    const dLng = toRad(p2.lng - p1.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLng / 2) ** 2;
    return this.EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  calculatePolygonArea(coords) {
    if (!coords || coords.length < 3) return 0;
    if (coords.some(c => !c || (c.lat === 0 && c.lng === 0))) return 0;

    const centroid = this.getCentroid(coords);
    const planar = coords.map(c => ({
      x: this.haversineDistance({ lat: centroid.lat, lng: centroid.lng }, { lat: centroid.lat, lng: c.lng }) * (c.lng > centroid.lng ? 1 : -1),
      y: this.haversineDistance({ lat: centroid.lat, lng: centroid.lng }, { lat: c.lat, lng: centroid.lng }) * (c.lat > centroid.lat ? 1 : -1)
    }));

    let area = 0;
    for (let i = 0; i < planar.length; i++) {
      const j = (i + 1) % planar.length;
      area += planar[i].x * planar[j].y - planar[j].x * planar[i].y;
    }
    return Math.abs(area) / 2;
  },

  getCentroid(coords) {
    if (!coords?.length) return { lat: 0, lng: 0 };
    const sum = coords.reduce((a, c) => ({ lat: a.lat + c.lat, lng: a.lng + c.lng }), { lat: 0, lng: 0 });
    return { lat: sum.lat / coords.length, lng: sum.lng / coords.length };
  },

  formatCoordinates: (lat, lng, p = 6) => lat != null && lng != null ? `${lat.toFixed(p)}, ${lng.toFixed(p)}` : '0, 0',

  formatArea(sqm) {
    if (!sqm) return '0 m²';
    if (sqm < 1) return `${(sqm * 10000).toFixed(2)} cm²`;
    if (sqm < 10000) return `${sqm.toFixed(2)} m²`;
    return `${(sqm / 10000).toFixed(4)} hectares`;
  }
};

CoordinateUtils.init();
window.CoordinateUtils = CoordinateUtils;
