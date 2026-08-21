/**
 * Point-in-zone test and edge/zone-crossing sampler shared by the offline
 * zone taggers (tagEdgeZones.mjs and fetchHazards.mjs).
 */
import { haversineKm, mercatorPoint } from "../landGrid.mjs";

const STEP_KM = 20;
const KM_PER_DEG_LAT = 111.32;
const CELL_DEG = 10;

/** Hand-drawn zones are rings; generated hazard zones are circles (`center` + `radiusKm`). */
export function contains(zone, lon, lat) {
  if (zone.center && zone.radiusKm !== undefined) {
    const [centerLon, centerLat] = zone.center;
    return haversineKm({ lon: centerLon, lat: centerLat }, { lon, lat }) <= zone.radiusKm;
  }
  const ring = zone.polygon;
  if (!ring) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function boundingBox(zone) {
  if (zone.center && zone.radiusKm !== undefined) {
    const [lon, lat] = zone.center;
    const dLat = zone.radiusKm / KM_PER_DEG_LAT;
    const dLon = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
    return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
  }
  const ring = zone.polygon ?? [];
  const lons = ring.map(([x]) => x);
  const lats = ring.map(([, y]) => y);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

/**
 * Bins zones into a coarse lon/lat grid. Sampling every leg against every zone
 * is O(legs x steps x zones), which is minutes of work once the wildfire feed
 * contributes thousands of zones; this makes each step test only its own cell.
 */
export function createZoneGrid(zones) {
  const grid = new Map();
  for (const zone of zones) {
    const [minLon, minLat, maxLon, maxLat] = boundingBox(zone);
    // A box spanning more than half the world is either genuinely global or wrapped across the antimeridian; index it across all longitudes rather than guessing which.
    const wraps = maxLon - minLon > 180;
    const lonStart = Math.floor((wraps ? -180 : minLon) / CELL_DEG);
    const lonEnd = Math.floor((wraps ? 180 : maxLon) / CELL_DEG);
    for (let lon = lonStart; lon <= lonEnd; lon++) {
      for (let lat = Math.floor(minLat / CELL_DEG); lat <= Math.floor(maxLat / CELL_DEG); lat++) {
        const key = lon * 1000 + lat;
        const bucket = grid.get(key);
        if (bucket) bucket.push(zone);
        else grid.set(key, [zone]);
      }
    }
  }
  return {
    at: (lon, lat) => grid.get(Math.floor(lon / CELL_DEG) * 1000 + Math.floor(lat / CELL_DEG)) ?? [],
  };
}

/**
 * Walks an edge's polyline in fixed-length steps, testing each step's midpoint
 * against every zone applicable to `mode`, and returns the km spent inside
 * each zone hit (rounded), or null if the edge crosses none of them.
 *
 * Pass a `grid` from createZoneGrid over the same zone list when tagging many
 * edges, so the index is built once rather than per edge.
 */
export function zonesOnEdge(edge, mode, zones, nodeById, { stepKm = STEP_KM, grid } = {}) {
  const a = nodeById.get(edge.from);
  const b = nodeById.get(edge.to);
  if (!a || !b) return null;
  if (zones.length === 0) return null;
  const zoneGrid = grid ?? createZoneGrid(zones);

  const points = [a, ...(edge.via ?? []).map(([lon, lat]) => ({ lon, lat })), b];
  const km = {};

  for (let i = 0; i < points.length - 1; i++) {
    const segKm = haversineKm(points[i], points[i + 1]);
    const steps = Math.max(1, Math.ceil(segKm / stepKm));
    const stepKmActual = segKm / steps;
    for (let s = 0; s < steps; s++) {
      const p = mercatorPoint(points[i], points[i + 1], (s + 0.5) / steps);
      for (const zone of zoneGrid.at(p.lon, p.lat)) {
        if (zone.modes && !zone.modes.includes(mode)) continue;
        if (contains(zone, p.lon, p.lat)) km[zone.id] = (km[zone.id] ?? 0) + stepKmActual;
      }
    }
  }

  const entries = Object.entries(km).sort(([x], [y]) => x.localeCompare(y));
  if (entries.length === 0) return null;
  return Object.fromEntries(entries.map(([id, value]) => [id, Math.round(value)]));
}
