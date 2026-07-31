/**
 * Regenerates src/data/truckEdges.json.
 *
 * Truck legs used to be generated in the browser from straight-line proximity
 * alone, which produced lorries "driving" across the Taiwan Strait, the Gulf of
 * Thailand, the Caribbean and so on. Drivability needs real coastlines, so the
 * pairs are resolved offline against Natural Earth land polygons: both hubs must
 * sit on the same landmass, and there must be an overland path within road range.
 * Legs whose straight line would cut across water carry a routed `via` corridor.
 *
 * Usage: node tools/generateTruckEdges.mjs [path-to-ne_10m_land.geojson]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildLandGrid,
  corridorVia,
  ensureLandGeojson,
  exactLandTest,
  haversineKm,
  labelLandmasses,
  longestWaterRunKm,
  overlandPath,
  snapToLand,
} from "./landGrid.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodes = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/nodes.json"), "utf8"));
const costs = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/costs.config.json"), "utf8"));
const landPath = await ensureLandGeojson(process.argv[2]);

const { maxLegKm, maxNeighbors } = costs.truck;
const STRAIGHT_WATER_TOLERANCE_KM = 25; // bridges, causeways and coast-hugging roads, not sea crossings
const MAX_DETOUR_RATIO = 2.5;

console.log("rasterizing land…");
const grid = buildLandGrid(landPath);
const labels = labelLandmasses(grid);
const isLand = exactLandTest(landPath);
const NX = 3600;

const placed = new Map();
for (const node of nodes) {
  const cell = snapToLand(grid, node.lon, node.lat);
  if (!cell) continue;
  placed.set(node.id, { node, cell, landmass: labels[cell.y * NX + cell.x] });
}
const stranded = nodes.filter((n) => !placed.has(n.id));
if (stranded.length > 0) console.log(`no land cell within range for: ${stranded.map((n) => n.id).join(", ")}`);

console.log("routing candidate legs…");
const viable = new Map(); // pairKey -> { from, to, roadKm, via }
for (let i = 0; i < nodes.length; i++) {
  for (let j = i + 1; j < nodes.length; j++) {
    const a = placed.get(nodes[i].id);
    const b = placed.get(nodes[j].id);
    if (!a || !b) continue;
    if (a.landmass !== b.landmass) continue;

    const straightKm = haversineKm(a.node, b.node);
    if (straightKm > maxLegKm) continue;

    const found = overlandPath(grid, a.cell, b.cell, Math.min(maxLegKm, straightKm * MAX_DETOUR_RATIO));
    if (!found) continue;

    const endpoints = [
      { lat: a.node.lat, lon: a.node.lon },
      { lat: b.node.lat, lon: b.node.lon },
    ];
    const entry = { from: a.node.id, to: b.node.id, roadKm: Math.max(found.km, straightKm) };
    if (longestWaterRunKm(isLand, endpoints) > STRAIGHT_WATER_TOLERANCE_KM) {
      const via = corridorVia(isLand, endpoints[0], endpoints[1], found.cells, STRAIGHT_WATER_TOLERANCE_KM);
      if (via.length > 0) entry.via = via;
    }
    viable.set(`${a.node.id}|${b.node.id}`, entry);
  }
}

// Same "nearest N neighbours" cap as before, but ranked by road distance.
const byNode = new Map();
for (const entry of viable.values()) {
  for (const id of [entry.from, entry.to]) {
    if (!byNode.has(id)) byNode.set(id, []);
    byNode.get(id).push(entry);
  }
}
const kept = new Set();
for (const [, entries] of byNode) {
  entries.sort((x, y) => x.roadKm - y.roadKm);
  for (const entry of entries.slice(0, maxNeighbors)) kept.add(entry);
}

const edges = [...kept].sort((x, y) => `${x.from}|${x.to}`.localeCompare(`${y.from}|${y.to}`));
const body = edges
  .map((e) => {
    const fields = [`"from": ${JSON.stringify(e.from)}`, `"to": ${JSON.stringify(e.to)}`];
    if (e.via) fields.push(`"via": ${JSON.stringify(e.via)}`);
    return `  { ${fields.join(", ")} }`;
  })
  .join(",\n");
fs.writeFileSync(path.join(ROOT, "src/data/truckEdges.json"), `[\n${body}\n]\n`, "utf8");

const withVia = edges.filter((e) => e.via).length;
console.log(`wrote ${edges.length} truck edges (${withVia} with a routed land corridor).`);
