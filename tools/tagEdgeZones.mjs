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

import { zonesOnEdge } from "./lib/geo.mjs";
import { readNodes } from "./lib/nodes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, "src/data", file), "utf8"));

const zones = read("zones.json");
const nodes = readNodes(ROOT);
const edges = read("edges.json");
const truckEdges = read("truckEdges.json");
const nodeById = new Map(nodes.map((n) => [n.id, n]));

let tagged = 0;
const apply = (list, fallbackMode) => {
  for (const edge of list) {
    const hit = zonesOnEdge(edge, edge.mode ?? fallbackMode, zones, nodeById);
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
