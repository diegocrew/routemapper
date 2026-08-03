/**
 * Fails the build on data that would otherwise break silently: a typo'd country
 * in restrictions.json just leaves a border open, an unknown country in
 * indices.json quietly falls back to mid-range scores, and a stale generated
 * file keeps routing against nodes that no longer exist.
 *
 * Usage: node tools/validateData.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, "src/data", file), "utf8"));

const nodes = read("nodes.json");
const edges = read("edges.json");
const truckEdges = read("truckEdges.json");
const zones = read("zones.json");
const restrictions = read("restrictions.json");
const indices = read("indices.json");
const costs = read("costs.config.json");

const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);

const nodeIds = new Set();
for (const node of nodes) {
  if (nodeIds.has(node.id)) fail(`duplicate node id: ${node.id}`);
  nodeIds.add(node.id);
  if (Math.abs(node.lat) > 90 || Math.abs(node.lon) > 180) fail(`node ${node.id} has out-of-range coordinates`);
}

const countriesWithNodes = new Set(nodes.map((n) => n.country));
const modes = new Set(Object.keys(costs.modes));

const seenEdges = new Set();
for (const edge of edges) {
  if (!nodeIds.has(edge.from)) fail(`edge ${edge.from} -> ${edge.to} references unknown node ${edge.from}`);
  if (!nodeIds.has(edge.to)) fail(`edge ${edge.from} -> ${edge.to} references unknown node ${edge.to}`);
  if (!modes.has(edge.mode)) fail(`edge ${edge.from} -> ${edge.to} has unknown mode ${edge.mode}`);
  const key = `${[edge.from, edge.to].sort().join("|")}|${edge.mode}`;
  if (seenEdges.has(key)) fail(`duplicate ${edge.mode} edge between ${edge.from} and ${edge.to}`);
  seenEdges.add(key);
}

// truckEdges.json and the zone tags are generated; both go stale when nodes move.
for (const edge of truckEdges) {
  if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
    fail(`truckEdges.json is stale: ${edge.from} -> ${edge.to} references a node that no longer exists`);
  }
}
const untrucked = nodes.filter(
  (n) => n.kind !== "military" && !truckEdges.some((e) => e.from === n.id || e.to === n.id),
);
if (untrucked.length > nodes.length / 2) {
  fail("truckEdges.json looks stale: most nodes have no road link — run npm run generate:truck-edges");
}

const zoneIds = new Set();
for (const zone of zones) {
  if (zoneIds.has(zone.id)) fail(`duplicate zone id: ${zone.id}`);
  zoneIds.add(zone.id);
  if (zone.polygon.length < 3) fail(`zone ${zone.id} has fewer than 3 polygon points`);
  for (const month of [...(zone.closedMonths ?? []), ...(zone.delayMonths ?? [])]) {
    if (month < 1 || month > 12) fail(`zone ${zone.id} has an out-of-range month: ${month}`);
  }
  if (zone.delayMonths?.length && zone.delayFactor === undefined) {
    fail(`zone ${zone.id} declares delayMonths but no delayFactor`);
  }
  for (const mode of zone.modes ?? []) {
    if (!modes.has(mode)) fail(`zone ${zone.id} lists unknown mode ${mode}`);
  }
}

for (const edge of [...edges, ...truckEdges]) {
  for (const id of Object.keys(edge.zones ?? {})) {
    if (!zoneIds.has(id)) fail(`edge ${edge.from} -> ${edge.to} is tagged with unknown zone ${id}`);
  }
}
for (const zone of zones) {
  const tagged = [...edges, ...truckEdges].some((e) => Object.keys(e.zones ?? {}).includes(zone.id));
  if (!tagged) warn(`zone ${zone.id} is tagged on no leg — it currently has no effect`);
}

// A pocket of sea lanes with no link to the main network still gets routed to,
// but only by trucking in from the nearest port, which produces nonsense legs.
{
  const neighbours = new Map();
  for (const edge of edges) {
    if (edge.mode !== "sea") continue;
    for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      if (!neighbours.has(a)) neighbours.set(a, []);
      neighbours.get(a).push(b);
    }
  }
  const seen = new Set();
  const components = [];
  for (const start of neighbours.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    const component = [];
    seen.add(start);
    while (stack.length > 0) {
      const id = stack.pop();
      component.push(id);
      for (const next of neighbours.get(id)) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    components.push(component);
  }
  components.sort((a, b) => b.length - a.length);
  for (const component of components.slice(1)) {
    warn(`sea lanes for ${component.join(", ")} are cut off from the main maritime network`);
  }
}

for (const rule of restrictions) {
  for (const country of [...rule.countries, ...(rule.pairsWith ?? [])]) {
    if (!countriesWithNodes.has(country)) {
      fail(`restriction ${rule.id} names "${country}", which matches no node — the rule does nothing`);
    }
  }
  for (const mode of rule.modes) {
    if (!modes.has(mode)) fail(`restriction ${rule.id} lists unknown mode ${mode}`);
  }
}

for (const country of countriesWithNodes) {
  if (!indices.countries[country]) fail(`no index entry for ${country}, which has nodes`);
}
for (const [id, score] of Object.entries(indices.nodeSecurity)) {
  if (!nodeIds.has(id)) fail(`nodeSecurity references unknown node ${id}`);
  if (score < 0 || score > 100) fail(`nodeSecurity for ${id} is out of range: ${score}`);
}
for (const id of Object.keys(indices.cityEconomicBonus)) {
  if (!nodeIds.has(id)) fail(`cityEconomicBonus references unknown node ${id}`);
}

for (const warning of warnings) console.warn(`warning: ${warning}`);
if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`);
  console.error(`\n${errors.length} data problem(s).`);
  process.exitCode = 1;
} else {
  console.log(`Data OK: ${nodes.length} nodes, ${edges.length} curated edges, ${truckEdges.length} truck edges, ${zones.length} zones, ${restrictions.length} restrictions.`);
}
