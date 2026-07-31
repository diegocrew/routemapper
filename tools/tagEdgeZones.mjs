/**
 * Stamps each curated and generated leg with the risk/access zones its drawn
 * geometry passes through, so the browser never has to test polygons at route
 * time. Air legs are generated at runtime and are not tagged — overflight bans
 * are a separate problem from surface chokepoints.
 *
 * Usage: node tools/tagEdgeZones.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { haversineKm, mercatorPoint } from "./landGrid.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, "src/data", file), "utf8"));

const zones = read("zones.json");
const nodes = read("nodes.json");
const edges = read("edges.json");
const truckEdges = read("truckEdges.json");
const nodeById = new Map(nodes.map((n) => [n.id, n]));

const STEP_KM = 20;

function contains(zone, lon, lat) {
  const ring = zone.polygon;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function zonesOnEdge(edge, mode) {
  const a = nodeById.get(edge.from);
  const b = nodeById.get(edge.to);
  if (!a || !b) return null;
  const applicable = zones.filter((z) => !z.modes || z.modes.includes(mode));
  if (applicable.length === 0) return null;

  const points = [a, ...(edge.via ?? []).map(([lon, lat]) => ({ lon, lat })), b];
  const km = {};

  for (let i = 0; i < points.length - 1; i++) {
    const segKm = haversineKm(points[i], points[i + 1]);
    const steps = Math.max(1, Math.ceil(segKm / STEP_KM));
    const stepKm = segKm / steps;
    for (let s = 0; s < steps; s++) {
      const p = mercatorPoint(points[i], points[i + 1], (s + 0.5) / steps);
      for (const zone of applicable) {
        if (contains(zone, p.lon, p.lat)) km[zone.id] = (km[zone.id] ?? 0) + stepKm;
      }
    }
  }

  const entries = Object.entries(km).sort(([x], [y]) => x.localeCompare(y));
  if (entries.length === 0) return null;
  return Object.fromEntries(entries.map(([id, value]) => [id, Math.round(value)]));
}

let tagged = 0;
const apply = (list, fallbackMode) => {
  for (const edge of list) {
    const hit = zonesOnEdge(edge, edge.mode ?? fallbackMode);
    if (hit) {
      edge.zones = hit;
      tagged++;
    } else {
      delete edge.zones;
    }
  }
};
apply(edges);
apply(truckEdges, "truck");

const field = (edge, key) => `"${key}": ${JSON.stringify(edge[key])}`;
const formatEdge = (edge) => {
  const parts = [field(edge, "from"), field(edge, "to")];
  if (edge.mode) parts.push(field(edge, "mode"));
  if (edge.via) parts.push(field(edge, "via"));
  if (edge.zones) parts.push(field(edge, "zones"));
  return `{ ${parts.join(", ")} }`;
};

fs.writeFileSync(
  path.join(ROOT, "src/data/edges.json"),
  `[\n  ${edges.map(formatEdge).join(",\n  ")}\n]\n`,
  "utf8",
);
fs.writeFileSync(
  path.join(ROOT, "src/data/truckEdges.json"),
  `[\n${truckEdges.map((e) => `  ${formatEdge(e)}`).join(",\n")}\n]\n`,
  "utf8",
);

const counts = {};
for (const edge of [...edges, ...truckEdges]) {
  for (const id of Object.keys(edge.zones ?? {})) counts[id] = (counts[id] ?? 0) + 1;
}
for (const zone of zones) console.log(`${(counts[zone.id] ?? 0).toString().padStart(4)} legs  ${zone.id}`);
console.log(`\nTagged ${tagged} legs.`);
