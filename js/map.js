/*
 * map.js — Leaflet 初期化・番号ピン・ポリライン・fitBounds。
 * L はグローバル（index.html で cdnjs から読み込み）。
 */

export const TILES = {
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  positron: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  },
};

/** 移動手段 → 線のスタイル（README「追加で決めたこと」） */
export function lineStyle(transport, color) {
  const base = { color, weight: 3, opacity: 0.9 };
  switch (transport) {
    case 'train': return { ...base, dashArray: '2 8', lineCap: 'round' };
    case 'walk':  return { ...base, dashArray: '8 6' };
    case 'plane':
    case 'ship':  return { ...base, weight: 2, dashArray: '10 5 2 5' };
    default:      return base;
  }
}

const JAPAN_CENTER = [36.2, 138.0];

/**
 * @param {HTMLElement} el
 * @param {{ style?: string, interactive?: boolean, onClick?: (latlng) => void, onMarkerClick?: (id) => void, color?: string }} opts
 */
export function createMap(el, opts = {}) {
  const interactive = opts.interactive !== false;
  const map = L.map(el, {
    zoomControl: interactive,
    dragging: interactive,
    scrollWheelZoom: interactive,
    doubleClickZoom: interactive,
    boxZoom: interactive,
    keyboard: interactive,
    touchZoom: interactive,
    attributionControl: true,
  }).setView(JAPAN_CENTER, 5);

  let tileLayer = null;
  let tilesLoaded = false;
  let tileErrors = 0;
  const loadWaiters = [];
  const layer = L.layerGroup().addTo(map);
  let color = opts.color || '#2f6f7a';
  let activeId = null;
  let markers = new Map();

  function setStyle(style) {
    const def = TILES[style] || TILES.positron;
    if (tileLayer) tileLayer.remove();
    tilesLoaded = false;
    tileErrors = 0;
    tileLayer = L.tileLayer(def.url, def).addTo(map);
    tileLayer.on('tileerror', () => { tileErrors++; });
    tileLayer.on('load', () => {
      tilesLoaded = true;
      loadWaiters.splice(0).forEach((r) => r());
    });
  }

  function pinIcon(n, active) {
    return L.divIcon({
      className: 'pin-wrap' + (active ? ' pin-wrap--active' : ''),
      html: `<span class="pin">${n}</span>`,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -28],
    });
  }

  function setVisits(visits, { fit = true } = {}) {
    layer.clearLayers();
    markers = new Map();
    const sorted = [...visits].sort((a, b) => a.order - b.order);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], lineStyle(b.transport, color)).addTo(layer);
    }
    sorted.forEach((v, i) => {
      const m = L.marker([v.lat, v.lng], { icon: pinIcon(i + 1, v.id === activeId), title: v.name });
      m.on('click', () => opts.onMarkerClick && opts.onMarkerClick(v.id));
      m.addTo(layer);
      markers.set(v.id, m);
    });
    if (fit) fitTo(sorted);
  }

  function fitTo(visits) {
    if (visits.length === 0) { map.setView(JAPAN_CENTER, 5); return; }
    if (visits.length === 1) { map.setView([visits[0].lat, visits[0].lng], 14); return; }
    map.fitBounds(visits.map((v) => [v.lat, v.lng]), { padding: [36, 36], maxZoom: 16 });
  }

  function setActive(id, { pan = true } = {}) {
    activeId = id;
    for (const [vid, m] of markers) {
      const n = m.options.icon.options.html.replace(/<[^>]+>/g, '');
      m.setIcon(pinIcon(n, vid === id));
    }
    const m = markers.get(id);
    if (pan && m) map.panTo(m.getLatLng());
  }

  function whenTilesLoaded() {
    return tilesLoaded ? Promise.resolve() : new Promise((r) => loadWaiters.push(r));
  }

  if (interactive && opts.onClick) {
    map.on('click', (e) => opts.onClick({ lat: e.latlng.lat, lng: e.latlng.lng }));
  }

  setStyle(opts.style || 'positron');

  return {
    leaflet: map,
    setVisits,
    setStyle,
    setActive,
    fitTo,
    whenTilesLoaded,
    tileErrorCount() { return tileErrors; },
    setColor(c) { color = c; },
    invalidate() { map.invalidateSize(); },
    destroy() { map.remove(); },
  };
}
