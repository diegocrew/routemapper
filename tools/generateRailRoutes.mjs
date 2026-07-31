/**
 * Fills in `via` geometry for rail edges whose straight line would run across
 * open water — the Gulf of Thailand, the Bay of Biscay, the Aegean and so on —
 * by routing them overland. Edges that genuinely cross water (Channel Tunnel,
 * Baltic train ferries) have no land path and are left alone.
 *
 * Usage: node tools/generateRailRoutes.mjs [path-to-ne_10m_land.geojson]
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
  longestWaterRunKm,
  overlandPath,
  snapToLand,
} from "./landGrid.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EDGES_PATH = path.join(ROOT, "src/data/edges.json");
const edges = JSON.parse(fs.readFileSync(EDGES_PATH, "utf8"));
const nodes = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/nodes.json"), "utf8"));
const nodeById = new Map(nodes.map((n) => [n.id, n]));

const WATER_TOLERANCE_KM = 25;
const landPath = await ensureLandGeojson(process.argv[2]);
const grid = buildLandGrid(landPath);
const isLand = exactLandTest(landPath);

let routed = 0;
for (const edge of edges) {
  if (edge.mode !== "rail") continue;
  const a = nodeById.get(edge.from);
  const b = nodeById.get(edge.to);
  if (!a || !b) continue;
  const current = [a, ...(edge.via ?? []).map(([lon, lat]) => ({ lon, lat })), b];
  if (longestWaterRunKm(isLand, current) <= WATER_TOLERANCE_KM) continue;

  const start = snapToLand(grid, a.lon, a.lat);
  const goal = snapToLand(grid, b.lon, b.lat);
  if (!start || !goal) continue;

  const straightKm = haversineKm(a, b);
  const found = overlandPath(grid, start, goal, straightKm * 2 + 500);
  if (!found) {
    console.log(`no land path for ${edge.from} -> ${edge.to}; leaving as a water crossing`);
    continue;
  }
  const corridor = corridorVia(isLand, a, b, found.cells, WATER_TOLERANCE_KM);
  if (corridor.length === 0) continue;
  edge.via = corridor;
  routed++;
  console.log(`routed ${edge.from} -> ${edge.to} overland via ${edge.via.length} points`);
}

const format = (edge) => {
  const fields = [
    `"from": ${JSON.stringify(edge.from)}`,
    `"to": ${JSON.stringify(edge.to)}`,
    `"mode": ${JSON.stringify(edge.mode)}`,
  ];
  if (edge.via) fields.push(`"via": ${JSON.stringify(edge.via)}`);
  return `{ ${fields.join(", ")} }`;
};
fs.writeFileSync(EDGES_PATH, `[\n  ${edges.map(format).join(",\n  ")}\n]\n`, "utf8");
console.log(`Routed ${routed} rail edges overland.`);
