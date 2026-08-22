/**
 * Regenerates src/data/airEdgeZones.json: which air legs cross which restricted
 * airspace.
 *
 * Overflight bans were previously modelled by matching the countries at the two
 * ends of a flight, which gets the common cases wrong in both directions —
 * Helsinki–Tokyo was banned outright even though neither end is Russia, while
 * Dubai–Tokyo was scored as if it never went near Siberia. What matters is the
 * geometry: whether the great circle actually crosses the airspace.
 *
 * Air legs are generated at runtime (see engine/airEdges.ts) and there are
 * ~109k of them, far too many to test against country outlines in the browser.
 * They are deterministic from the node list, though, so the crossings are
 * resolved here instead and committed as tags, like hazardEdgeZones. Only the
 * civilian-usable legs that hit something are stored — see below.
 *
 * Usage: node tools/generateAirspaceZones.mjs [path-to-ne_110m_admin_0_countries.geojson]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureCountriesGeojson, greatCirclePoint, haversineKm } from "./landGrid.mjs";
import { readCuratedNodes, readNodes } from "./lib/nodes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, "src/data", file), "utf8"));

const STEP_KM = 50; // an FIR is hundreds of km across; 50 km steps resolve one comfortably

/** Natural Earth's own names for countries this dataset spells differently. */
const NE_ALIASES = {
  "North Korea": ["Dem. Rep. Korea", "North Korea"],
  "DR Congo": ["Dem. Rep. Congo"],
  Czechia: ["Czechia", "Czech Rep."],
};

const airspace = read("airspace.json").zones;
const nodes = readNodes(ROOT);
const curatedIds = new Set(readCuratedNodes(ROOT).map((n) => n.id));

const countriesPath = await ensureCountriesGeojson(process.argv[2]);
const countries = JSON.parse(fs.readFileSync(countriesPath, "utf8"));

/** One entry per restricted airspace: its zone id and the rings that make up the country. */
const shapes = [];
for (const zone of airspace) {
  const names = NE_ALIASES[zone.country] ?? [zone.country];
  const feature = countries.features.find((f) => {
    const props = f.properties;
    return names.some((n) => props.ADMIN === n || props.NAME === n || props.SOVEREIGNT === n);
  });
  if (!feature) {
    console.error(`no Natural Earth outline for ${zone.country} (${zone.id}) — its airspace will never be tagged`);
    continue;
  }
  // A country is one or many polygons, each an outer ring plus optional holes.
  const polygons =
    feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates : [feature.geometry.coordinates];
  for (const rings of polygons) {
    const outer = rings[0];
    const lons = outer.map(([lon]) => lon);
    const lats = outer.map(([, lat]) => lat);
    shapes.push({
      id: zone.id,
      bit: 1 << airspace.indexOf(zone),
      rings,
      box: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    });
  }
}
console.log(`${shapes.length} outline parts across ${airspace.length} restricted airspaces.`);

function inRing(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and outside every hole. */
function inShape(shape, lon, lat) {
  const [minLon, minLat, maxLon, maxLat] = shape.box;
  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return false;
  if (!inRing(shape.rings[0], lon, lat)) return false;
  for (let i = 1; i < shape.rings.length; i++) {
    if (inRing(shape.rings[i], lon, lat)) return false;
  }
  return true;
}

// --- the air legs these tags can ever apply to -------------------------------
// engine/airEdges.ts full-meshes the curated hubs and hangs the imported
// installations off their three nearest. Only part of that mesh is worth
// tagging: an airspace restriction is only ever consulted for civilian cargo
// (defense cargo ignores closures the same way it ignores closed borders), and
// civilian cargo cannot touch a military node at all. So every leg with a
// military end — the spokes, and 37k of the hub pairs — is dead weight here.
const hubs = nodes.filter((n) => curatedIds.has(n.id) && n.kind !== "military");
const airEdges = [];
for (let i = 0; i < hubs.length; i++) {
  for (let j = i + 1; j < hubs.length; j++) airEdges.push([hubs[i], hubs[j]]);
}
console.log(`sampling ${airEdges.length} civilian air legs…`);

// Half the mesh crosses something, so the obvious `"from|to|air": {zone: km}`
// shape came to 3.3 MB — as much again as the whole rest of the dataset. Legs
// are grouped under their origin so its id is written once rather than once per
// destination, and the zones a leg crosses are a bitmask over the `zones` array
// rather than named. The km inside is deliberately dropped: a restricted
// airspace lengthens the leg by a flat factor rather than charging per km, and
// validate:data enforces that these zones carry no per-km charge.
const byOrigin = {};
let tagged = 0;
for (const [a, b] of airEdges) {
  const legKm = haversineKm(a, b);
  const steps = Math.max(1, Math.ceil(legKm / STEP_KM));
  let mask = 0;
  for (let s = 0; s < steps; s++) {
    const p = greatCirclePoint(a, b, (s + 0.5) / steps);
    for (const shape of shapes) {
      if ((mask & shape.bit) === 0 && inShape(shape, p.lon, p.lat)) mask |= shape.bit;
    }
  }
  if (mask === 0) continue;
  (byOrigin[a.id] ??= {})[b.id] = mask;
  tagged++;
}

const body = Object.keys(byOrigin)
  .sort()
  .map((origin) => `    ${JSON.stringify(origin)}: ${JSON.stringify(byOrigin[origin])}`)
  .join(",\n");
fs.writeFileSync(
  path.join(ROOT, "src/data/airEdgeZones.json"),
  `{\n  "zones": ${JSON.stringify(airspace.map((zone) => zone.id))},\n  "legs": {\n${body}\n  }\n}\n`,
  "utf8",
);

const perZone = {};
for (const destinations of Object.values(byOrigin)) {
  for (const mask of Object.values(destinations)) {
    airspace.forEach((zone, i) => {
      if (mask & (1 << i)) perZone[zone.id] = (perZone[zone.id] ?? 0) + 1;
    });
  }
}
for (const zone of airspace) console.log(`${(perZone[zone.id] ?? 0).toString().padStart(6)} legs  ${zone.id}`);
console.log(`\nTagged ${tagged} of ${airEdges.length} air legs.`);
