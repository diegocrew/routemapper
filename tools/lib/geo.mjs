/**
 * Point-in-polygon test and edge/zone-crossing sampler shared by the offline
 * zone taggers (tagEdgeZones.mjs and fetchHazards.mjs).
 */
import { haversineKm, mercatorPoint } from "../landGrid.mjs";

const STEP_KM = 20;

export function contains(zone, lon, lat) {
  const ring = zone.polygon;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Walks an edge's polyline in fixed-length steps, testing each step's midpoint
 * against every zone applicable to `mode`, and returns the km spent inside
 * each zone hit (rounded), or null if the edge crosses none of them.
 */
export function zonesOnEdge(edge, mode, zones, nodeById, stepKm = STEP_KM) {
  const a = nodeById.get(edge.from);
  const b = nodeById.get(edge.to);
  if (!a || !b) return null;
  const applicable = zones.filter((z) => !z.modes || z.modes.includes(mode));
  if (applicable.length === 0) return null;

  const points = [a, ...(edge.via ?? []).map(([lon, lat]) => ({ lon, lat })), b];
  const km = {};

  for (let i = 0; i < points.length - 1; i++) {
    const segKm = haversineKm(points[i], points[i + 1]);
    const steps = Math.max(1, Math.ceil(segKm / stepKm));
    const stepKmActual = segKm / steps;
    for (let s = 0; s < steps; s++) {
      const p = mercatorPoint(points[i], points[i + 1], (s + 0.5) / steps);
      for (const zone of applicable) {
        if (contains(zone, p.lon, p.lat)) km[zone.id] = (km[zone.id] ?? 0) + stepKmActual;
      }
    }
  }

  const entries = Object.entries(km).sort(([x], [y]) => x.localeCompare(y));
  if (entries.length === 0) return null;
  return Object.fromEntries(entries.map(([id, value]) => [id, Math.round(value)]));
}
