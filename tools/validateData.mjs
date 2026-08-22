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

import { readNodes } from "./lib/nodes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, "src/data", file), "utf8"));

const nodes = readNodes(ROOT);
const edges = read("edges.json");
const seaEdges = read("seaEdges.json").map((e) => ({ ...e, mode: "sea" }));
const truckEdges = read("truckEdges.json");
const zones = read("zones.json");
const hazardZones = read("hazardZones.json");
const hazardEdgeZones = read("hazardEdgeZones.json");
const restrictions = read("restrictions.json");
const railGauge = read("railGauge.json");
const airspace = read("airspace.json");
const airEdgeZones = read("airEdgeZones.json");
const borderStatus = read("borderStatus.json");
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
for (const edge of [...edges, ...seaEdges]) {
  if (!nodeIds.has(edge.from)) fail(`edge ${edge.from} -> ${edge.to} references unknown node ${edge.from}`);
  if (!nodeIds.has(edge.to)) fail(`edge ${edge.from} -> ${edge.to} references unknown node ${edge.to}`);
  if (!modes.has(edge.mode)) fail(`edge ${edge.from} -> ${edge.to} has unknown mode ${edge.mode}`);
  const key = `${[edge.from, edge.to].sort().join("|")}|${edge.mode}`;
  if (seenEdges.has(key)) fail(`duplicate ${edge.mode} edge between ${edge.from} and ${edge.to}`);
  seenEdges.add(key);
}

// seaEdges.json, truckEdges.json and the zone tags are generated; all go stale
// when nodes move.
for (const [file, list] of [["seaEdges.json", seaEdges], ["truckEdges.json", truckEdges]]) {
  for (const edge of list) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      fail(`${file} is stale: ${edge.from} -> ${edge.to} references a node that no longer exists`);
    }
  }
}
const unshipped = nodes.filter((n) => n.kind === "seaport" && !seaEdges.some((e) => e.from === n.id || e.to === n.id));
if (unshipped.length > nodes.filter((n) => n.kind === "seaport").length / 2) {
  fail("seaEdges.json looks stale: most seaports have no generated lane — run npm run generate:sea-routes");
}
const untrucked = nodes.filter(
  (n) => n.kind !== "military" && !truckEdges.some((e) => e.from === n.id || e.to === n.id),
);
if (untrucked.length > nodes.length / 2) {
  fail("truckEdges.json looks stale: most nodes have no road link — run npm run generate:truck-edges");
}

// A country silently falling back to the 1435 mm default erases a real break of
// gauge — the Russian-gauge and Iberian-gauge borders are exactly the ones that
// cost a day of transshipment, so a missing entry is worse than a wrong one.
{
  const railCountries = new Set();
  for (const edge of edges) {
    if (edge.mode !== "rail") continue;
    for (const id of [edge.from, edge.to]) {
      const node = nodes.find((n) => n.id === id);
      if (node) railCountries.add(node.country);
    }
  }
  const missing = [...railCountries].filter((c) => railGauge.countries[c] === undefined).sort();
  if (missing.length > 0) {
    warn(`no railGauge.json entry for ${missing.join(", ")} — falling back to ${railGauge.default} mm`);
  }
  for (const country of Object.keys(railGauge.countries)) {
    if (!countriesWithNodes.has(country)) fail(`railGauge.json names "${country}", which matches no node`);
  }
  for (const id of Object.keys(railGauge.nodes)) {
    if (!nodeIds.has(id)) fail(`railGauge.json overrides unknown node ${id}`);
  }
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

for (const edge of [...edges, ...seaEdges, ...truckEdges]) {
  for (const id of Object.keys(edge.zones ?? {})) {
    if (!zoneIds.has(id)) fail(`edge ${edge.from} -> ${edge.to} is tagged with unknown zone ${id}`);
  }
}
for (const zone of zones) {
  const tagged = [...edges, ...seaEdges, ...truckEdges].some((e) => Object.keys(e.zones ?? {}).includes(zone.id));
  if (!tagged) warn(`zone ${zone.id} is tagged on no leg — it currently has no effect`);
}

// airEdgeZones.json stores which airspace an air leg crosses but not how far
// into it, since the air mesh is ~109k legs and the distances would quadruple
// the file. That only holds up while these zones charge nothing per km.
{
  for (const zone of airspace.zones) {
    if (zoneIds.has(zone.id)) fail(`airspace zone ${zone.id} collides with a zones.json id`);
    zoneIds.add(zone.id);
    if (!countriesWithNodes.has(zone.country)) {
      fail(`airspace zone ${zone.id} names country "${zone.country}", which matches no node`);
    }
    if (zone.surchargeUsdPerKm !== 0) {
      fail(`airspace zone ${zone.id} charges per km, but airEdgeZones.json stores no distance to charge it against`);
    }
    for (const country of zone.closedToCountries ?? []) {
      if (!countriesWithNodes.has(country)) {
        fail(`airspace zone ${zone.id} is closed to "${country}", which matches no node — the rule does nothing`);
      }
    }
    for (const mode of zone.modes ?? []) {
      if (!modes.has(mode)) fail(`airspace zone ${zone.id} lists unknown mode ${mode}`);
    }
  }
  const airspaceIds = new Set(airspace.zones.map((z) => z.id));
  for (const id of airEdgeZones.zones) {
    if (!airspaceIds.has(id)) fail(`airEdgeZones.json references unknown airspace zone ${id}`);
  }
  for (const [origin, destinations] of Object.entries(airEdgeZones.legs)) {
    if (!nodeIds.has(origin)) fail(`airEdgeZones.json is stale: unknown node ${origin}`);
    for (const destination of Object.keys(destinations)) {
      if (!nodeIds.has(destination)) fail(`airEdgeZones.json is stale: unknown node ${destination}`);
    }
  }
}

// borderStatus.json is fetched, so it is checked for the mistakes a feed can
// make rather than the ones a person can. The load-bearing one is the last: a
// generated entry that could close a border would let a noisy news week delete
// a corridor, which is why nothing here is allowed to.
{
  const seenBorders = new Set();
  for (const entry of borderStatus) {
    if (seenBorders.has(entry.id)) fail(`duplicate borderStatus id: ${entry.id}`);
    seenBorders.add(entry.id);
    if (entry.countries.length !== 2) fail(`borderStatus ${entry.id} must name exactly two countries`);
    for (const country of entry.countries) {
      if (!countriesWithNodes.has(country)) {
        fail(`borderStatus ${entry.id} names "${country}", which matches no node — the entry does nothing`);
      }
    }
    for (const mode of entry.modes) {
      if (!modes.has(mode)) fail(`borderStatus ${entry.id} lists unknown mode ${mode}`);
    }
    if (!(entry.delayHours >= 0)) fail(`borderStatus ${entry.id} has a negative or missing delayHours`);
    if (entry.delayHours > 72) {
      fail(`borderStatus ${entry.id} delays by ${entry.delayHours}h — a fetched entry may slow a border, never shut it`);
    }
  }
}

// hazardZones.json/hazardEdgeZones.json are refreshed by the scheduled
// tools/fetchHazards.mjs run rather than hand-curated, but still need to stay
// internally consistent and in sync with the current edges.
const HAZARD_KINDS = new Set(["earthquake", "wildfire", "cyclone", "flood", "volcano", "navwarning"]);
const hazardZoneIds = new Set();
for (const zone of hazardZones) {
  if (hazardZoneIds.has(zone.id)) fail(`duplicate hazard zone id: ${zone.id}`);
  hazardZoneIds.add(zone.id);
  if (zone.access !== "hazard") fail(`hazard zone ${zone.id} must have access "hazard"`);
  if (!HAZARD_KINDS.has(zone.hazardKind)) fail(`hazard zone ${zone.id} has unknown hazardKind ${zone.hazardKind}`);
  if (!Array.isArray(zone.center) || zone.center.length !== 2 || !(zone.radiusKm > 0)) {
    fail(`hazard zone ${zone.id} must have a [lon, lat] center and a positive radiusKm`);
  }
  for (const mode of zone.modes ?? []) {
    if (!modes.has(mode)) fail(`hazard zone ${zone.id} lists unknown mode ${mode}`);
  }
}
const edgeKeys = new Set([...edges, ...seaEdges, ...truckEdges].map((e) => `${e.from}|${e.to}|${e.mode ?? "truck"}`));
for (const [key, tags] of Object.entries(hazardEdgeZones)) {
  if (!edgeKeys.has(key)) fail(`hazardEdgeZones.json references unknown edge ${key}`);
  for (const id of Object.keys(tags)) {
    if (!hazardZoneIds.has(id)) fail(`hazardEdgeZones.json tags ${key} with unknown hazard zone ${id}`);
  }
}

// A pocket of sea lanes with no link to the main network still gets routed to,
// but only by trucking in from the nearest port, which produces nonsense legs.
{
  const neighbours = new Map();
  for (const edge of [...edges, ...seaEdges]) {
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
  console.log(`Data OK: ${nodes.length} nodes, ${edges.length} curated edges, ${seaEdges.length} generated sea edges, ${truckEdges.length} truck edges, ${zones.length} zones, ${hazardZones.length} hazard zones, ${restrictions.length} restrictions, ${borderStatus.length} live border alerts.`);
}
