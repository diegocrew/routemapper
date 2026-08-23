/**
 * Greedy single-pass point clustering, shared by the feeds that arrive as a
 * scatter of coordinates rather than as named events — wildfire hotspots and
 * conflict incidents both need thousands of points collapsed into a handful of
 * zones before anything can be tagged against them.
 */
import { haversineKm } from "./sphere.mjs";

const KM_PER_DEG_LAT = 111.32;

/**
 * A point joins the nearest cluster within `linkKm` of its centroid, else
 * starts a new one. Candidate clusters come from a coarse lon/lat grid keyed on
 * the link distance, so a global feed of hundreds of thousands of points stays
 * linear instead of comparing every point against every cluster found so far.
 * Good enough for turning a smear into a handful of zones — not a real spatial
 * index, and the result depends on input order.
 */
export function clusterPoints(points, linkKm) {
  const cellDeg = linkKm / KM_PER_DEG_LAT;
  const clusters = [];
  const grid = new Map();
  const keyOf = (x, y) => `${x}|${y}`;

  for (const point of points) {
    const cx = Math.floor(point.lon / cellDeg);
    const cy = Math.floor(point.lat / cellDeg);
    let best = null;
    let bestKm = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const cluster of grid.get(keyOf(cx + dx, cy + dy)) ?? []) {
          const km = haversineKm(point, cluster.centroid);
          if (km <= linkKm && km < bestKm) {
            best = cluster;
            bestKm = km;
          }
        }
      }
    }
    if (best) {
      best.points.push(point);
      const n = best.points.length;
      best.centroid = {
        lat: best.centroid.lat + (point.lat - best.centroid.lat) / n,
        lon: best.centroid.lon + (point.lon - best.centroid.lon) / n,
      };
    } else {
      const cluster = { centroid: { lat: point.lat, lon: point.lon }, points: [point] };
      clusters.push(cluster);
      const key = keyOf(cx, cy);
      const bucket = grid.get(key);
      if (bucket) bucket.push(cluster);
      else grid.set(key, [cluster]);
    }
  }
  return clusters;
}

/** How far the furthest point in a cluster sits from its centroid. */
export const clusterSpreadKm = (cluster) =>
  Math.max(0, ...cluster.points.map((p) => haversineKm(p, cluster.centroid)));
