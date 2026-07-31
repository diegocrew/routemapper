/**
 * Gives inland-waterway sea edges geometry that actually follows navigable water.
 *
 * Curated river/canal legs (Danube, Mississippi, Amazon, Paraná, Congo, Yangtze,
 * St. Lawrence, Seine…) were drawn with a handful of coarse `via` points, so the
 * rendered line cut straight across hundreds of kilometres of land. Ocean legs
 * are left to `generate:sea-routes`; only legs that start or end away from open
 * sea are re-routed here.
 *
 * Usage: node tools/generateInlandWaterRoutes.mjs [land.geojson] [rivers.geojson] [lakes.geojson]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildLandGrid,
  buildWaterGrid,
  cellOf,
  corridorVia,
  ensureLakesGeojson,
  ensureLandGeojson,
  ensureRiversGeojson,
  haversineKm,
  isLandCell,
  longestWaterRunKm,
  overlandPath,
  snapToLand,
} from "./landGrid.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EDGES_PATH = path.join(ROOT, "src/data/edges.json");
const edges = JSON.parse(fs.readFileSync(EDGES_PATH, "utf8"));
const nodes = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/nodes.json"), "utf8"));
const nodeById = new Map(nodes.map((n) => [n.id, n]));

const OFF_ROUTE_TOLERANCE_KM = 25;
const MAX_DETOUR_RATIO = 2;

/**
 * The curated legs that are barge routes up a river or canal rather than ocean
 * lanes. Everything else in edges.json is open-sea geometry owned by searoute,
 * and re-routing it over a 0.1-degree grid would only make it worse.
 */
const INLAND_LEGS = [
  ["bratislava", "vienna"],
  ["vienna", "budapest"],
  ["budapest", "belgrade"],
  ["belgrade", "constanta"],
  ["kyiv", "odesa"],
  ["amsterdam", "rotterdam"],
  ["paris", "le_havre"],
  ["chicago", "memphis"],
  ["memphis", "houston"],
  ["toronto", "montreal"],
  ["asuncion", "buenos_aires"],
  ["asuncion", "montevideo"],
  ["bangui", "brazzaville"],
  ["cairo", "alexandria"],
  ["dhaka", "kolkata"],
  ["nanjing", "shanghai"],
  ["phnom_penh", "ho_chi_minh_city"],
  ["kuala_lumpur", "port_klang"],
];
const inlandLegs = new Set(INLAND_LEGS.map((pair) => [...pair].sort().join("|")));

const landPath = await ensureLandGeojson(process.argv[2]);
const landGrid = buildLandGrid(landPath);
const water = buildWaterGrid(
  landGrid,
  await ensureRiversGeojson(process.argv[3]),
  await ensureLakesGeojson(process.argv[4]),
);
const isNavigable = (lon, lat) => {
  const { x, y } = cellOf(lon, lat);
  return isLandCell(water, x, y);
};

let routed = 0;
const unroutable = [];
for (const edge of edges) {
  if (edge.mode !== "sea") continue;
  if (!inlandLegs.has([edge.from, edge.to].sort().join("|"))) continue;
  const a = nodeById.get(edge.from);
  const b = nodeById.get(edge.to);
  if (!a || !b) continue;

  const points = [a, ...(edge.via ?? []).map(([lon, lat]) => ({ lon, lat })), b];
  if (longestWaterRunKm(isNavigable, points) <= OFF_ROUTE_TOLERANCE_KM) continue;

  const start = snapToLand(water, a.lon, a.lat, 5);
  const goal = snapToLand(water, b.lon, b.lat, 5);
  const straightKm = haversineKm(a, b);
  const budgetKm = straightKm * MAX_DETOUR_RATIO + 300;
  const found = start && goal ? overlandPath(water, start, goal, budgetKm) : null;
  if (!found) {
    unroutable.push(`${edge.from} -> ${edge.to}`);
    continue;
  }
  const via = corridorVia(isNavigable, a, b, found.cells, OFF_ROUTE_TOLERANCE_KM);
  if (via.length === 0) continue;
  edge.via = via;
  routed++;
  console.log(`routed ${edge.from} -> ${edge.to} along ${via.length} waterway points (${found.km.toFixed(0)} km)`);
}

if (unroutable.length > 0) {
  console.log("\nno navigable water path within range — geometry left as curated:");
  for (const pair of unroutable) console.log(`  ${pair}`);
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
console.log(`\nRouted ${routed} inland waterway legs.`);
