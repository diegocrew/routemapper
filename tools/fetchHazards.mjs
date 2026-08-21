/**
 * Pulls live natural hazards and turns them into temporary "hazard" zones in
 * the same shape as src/data/zones.json, then tags which curated/truck legs
 * cross them. Sources, all keyless except FIRMS:
 *   USGS   - earthquakes
 *   FIRMS  - wildfire hotspots (NASA)
 *   GDACS  - tropical cyclones, floods and volcanic eruptions, filtered to the
 *            Orange/Red alert levels so only events big enough to disrupt
 *            freight are carried
 *
 * Run on a schedule by .github/workflows/hazards.yml — each run re-fetches the
 * current upstream window and overwrites the output files wholesale, so an
 * event "expires" simply by aging out of its source's own time bucket; there
 * is no separate delete/expiry step here.
 *
 * Usage: node tools/fetchHazards.mjs [--retag]
 *        --retag re-tags which legs cross the already-committed hazard zones
 *        without calling any API — needed after nodes or edges change,
 *        since stale leg keys fail validation.
 * Env:   FIRMS_API_KEY - required for the wildfire half (get a free MAP_KEY at
 *        https://firms.modaps.eosdis.nasa.gov/api/map_key/ — confirmed by
 *        testing against the live API: unlike some NASA APIs, FIRMS's Area API
 *        has no working keyless/demo tier, it just 400s without a real key).
 *        Missing the key skips the wildfire fetch for this run rather than
 *        failing the whole script. Every other source needs no key at all.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createZoneGrid, zonesOnEdge } from "./lib/geo.mjs";
import { readNodes } from "./lib/nodes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, "src/data", file), "utf8"));
const write = (file, data) =>
  fs.writeFileSync(path.join(ROOT, "src/data", file), `${JSON.stringify(data, null, 2)}\n`, "utf8");

// Thousands of hazard zones at two-space indentation is tens of MB of JSON
// shipped in the app bundle, so these are written one record per line instead:
// compact, but still a line-per-hazard diff when the bot refreshes them.
const writeCompactList = (file, list) =>
  fs.writeFileSync(
    path.join(ROOT, "src/data", file),
    list.length === 0 ? "[]\n" : `[\n${list.map((item) => JSON.stringify(item)).join(",\n")}\n]\n`,
    "utf8",
  );

// --- Tunable thresholds -----------------------------------------------------
// All approximate; adjust here rather than scattering magic numbers below.

const USGS_FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson";
const MIN_MAGNITUDE = 5.5; // below this, unlikely to disrupt a port/airport/rail hub

// Felt-shaking radius by magnitude — a rough, explicitly approximate bucket
// table, not a seismological model.
const QUAKE_RADIUS_KM = [
  { min: 5.5, max: 6.0, km: 60 },
  { min: 6.0, max: 7.0, km: 120 },
  { min: 7.0, max: 8.0, km: 220 },
  { min: 8.0, max: Infinity, km: 350 },
];

const FIRMS_SOURCE = "VIIRS_SNPP_NRT";
const FIRMS_DAY_RANGE = 4;
const FIRMS_MIN_CONFIDENCE = 50; // 0-100 scale; VIIRS "l/n/h" is mapped onto this below
// A global VIIRS window is hundreds of thousands of detections. Linking and
// minimum-size thresholds are set so seasonal fire season smears collapse into
// a few thousand zones rather than tens of thousands of near-duplicates.
const CLUSTER_LINK_KM = 30; // detections within this of a cluster's centroid join it
const MIN_CLUSTER_POINTS = 8; // smaller clusters are treated as noise
const FIRE_BUFFER_KM = 10; // added on top of the cluster's own spread
const FIRE_RADIUS_RANGE_KM = [15, 75]; // clamp so one hotspot isn't a pinprick and a big fire isn't a continent

// Cheapest/fastest routing only reacts to money and time, so a hazard needs a
// price to be routed around at all. Wildfires are passable but expensive;
// earthquakes are closed to civilian cargo outright and this is what military
// transit pays to cross anyway.
const WILDFIRE_SURCHARGE_USD_PER_KM = 2;
const QUAKE_SURCHARGE_USD_PER_KM = 5;

// GDACS carries every disaster type on one alert scale; only these three
// change how freight moves, and only at Orange/Red. Radii are alert-level
// buckets rather than the real footprint (the list endpoint gives a centroid,
// not a geometry), in the same explicitly-approximate spirit as the quake
// table above.
//
// `modes` is what makes these useful: a cyclone is a sea problem, a flood is a
// road and rail problem. Volcanoes carry no `modes` because ash closes the
// site itself, which is also why they block civilian cargo outright.
const GDACS_FEED =
  "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC;FL;VO&alertlevel=Orange;Red";
const GDACS_TYPES = {
  TC: { kind: "cyclone", modes: ["sea"], radiusKm: { Orange: 300, Red: 500 }, surchargeUsdPerKm: 4, security: 25 },
  FL: { kind: "flood", modes: ["truck", "rail"], radiusKm: { Orange: 80, Red: 150 }, surchargeUsdPerKm: 3, security: 30 },
  VO: { kind: "volcano", modes: undefined, radiusKm: { Orange: 50, Red: 100 }, surchargeUsdPerKm: 5, security: 20 },
};

const EARTH_RADIUS_KM = 6371;

// --- Geometry helpers --------------------------------------------------------

function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// --- Earthquakes -------------------------------------------------------------

function quakeRadiusKm(magnitude) {
  const bucket = QUAKE_RADIUS_KM.find((b) => magnitude >= b.min && magnitude < b.max);
  return bucket ? bucket.km : QUAKE_RADIUS_KM[QUAKE_RADIUS_KM.length - 1].km;
}

async function fetchEarthquakeZones() {
  const response = await fetch(USGS_FEED);
  if (!response.ok) throw new Error(`USGS feed request failed: ${response.status}`);
  const geojson = await response.json();

  const zones = [];
  for (const feature of geojson.features ?? []) {
    const magnitude = feature.properties?.mag;
    if (typeof magnitude !== "number" || magnitude < MIN_MAGNITUDE) continue;
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    if (typeof lon !== "number" || typeof lat !== "number") continue;

    const radiusKm = quakeRadiusKm(magnitude);
    const detectedAt = new Date(feature.properties.time).toISOString();
    zones.push({
      id: `quake_${feature.id}`,
      label: `M${magnitude.toFixed(1)} earthquake — ${feature.properties.place ?? "location unknown"}`,
      security: 20,
      access: "hazard",
      surchargeUsdPerKm: QUAKE_SURCHARGE_USD_PER_KM,
      tollUsd: 0,
      hazardKind: "earthquake",
      detectedAt,
      center: [Number(lon.toFixed(3)), Number(lat.toFixed(3))],
      radiusKm,
    });
  }
  return zones;
}

// --- Wildfires ----------------------------------------------------------------

/** FIRMS confidence is "l"/"n"/"h" for VIIRS, 0-100 for MODIS; normalize to 0-100. */
function normalizeConfidence(raw) {
  if (raw === "l") return 30;
  if (raw === "n") return 60;
  if (raw === "h") return 90;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function parseFirmsCsv(csv) {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const latIdx = header.indexOf("latitude");
  const lonIdx = header.indexOf("longitude");
  const confIdx = header.indexOf("confidence");
  const frpIdx = header.indexOf("frp");

  const points = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const lat = Number(cols[latIdx]);
    const lon = Number(cols[lonIdx]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const confidence = normalizeConfidence(cols[confIdx]?.trim());
    if (confidence < FIRMS_MIN_CONFIDENCE) continue;
    points.push({ lat, lon, frp: Number(cols[frpIdx]) || 0 });
  }
  return points;
}

/**
 * Greedy single-pass clustering: a point joins the nearest cluster within
 * CLUSTER_LINK_KM of its centroid, else starts a new one. Candidate clusters
 * come from a coarse lon/lat grid keyed on the link distance, so a global
 * feed of hundreds of thousands of detections stays linear instead of
 * comparing every point against every cluster found so far. Good enough for
 * turning a hotspot smear into a handful of zones — not a real spatial index.
 */
function clusterPoints(points) {
  const cellDeg = CLUSTER_LINK_KM / 111.32;
  const clusters = [];
  const grid = new Map();
  const cellOf = (p) => [Math.floor(p.lon / cellDeg), Math.floor(p.lat / cellDeg)];
  const keyOf = (x, y) => `${x}|${y}`;

  for (const point of points) {
    const [cx, cy] = cellOf(point);
    let best = null;
    let bestKm = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const cluster of grid.get(keyOf(cx + dx, cy + dy)) ?? []) {
          const km = haversineKm(point, cluster.centroid);
          if (km <= CLUSTER_LINK_KM && km < bestKm) {
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

async function fetchWildfireZones() {
  const mapKey = process.env.FIRMS_API_KEY;
  if (!mapKey) {
    console.log("FIRMS_API_KEY not set — skipping wildfire fetch (FIRMS has no working keyless tier).");
    return [];
  }
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/${FIRMS_SOURCE}/world/${FIRMS_DAY_RANGE}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`FIRMS request failed: ${response.status}`);
  const csv = await response.text();
  const points = parseFirmsCsv(csv);
  const clusters = clusterPoints(points).filter((c) => c.points.length >= MIN_CLUSTER_POINTS);

  const now = new Date().toISOString();
  return clusters.map((cluster, i) => {
    const spreadKm = Math.max(0, ...cluster.points.map((p) => haversineKm(p, cluster.centroid)));
    const radiusKm = Math.min(
      FIRE_RADIUS_RANGE_KM[1],
      Math.max(FIRE_RADIUS_RANGE_KM[0], spreadKm + FIRE_BUFFER_KM),
    );
    return {
      id: `fire_${cluster.centroid.lat.toFixed(2)}_${cluster.centroid.lon.toFixed(2)}_${i}`,
      label: `Active wildfire (${cluster.points.length} detections) near ${cluster.centroid.lat.toFixed(1)}, ${cluster.centroid.lon.toFixed(1)}`,
      security: 20,
      access: "hazard",
      surchargeUsdPerKm: WILDFIRE_SURCHARGE_USD_PER_KM,
      tollUsd: 0,
      hazardKind: "wildfire",
      detectedAt: now,
      center: [Number(cluster.centroid.lon.toFixed(3)), Number(cluster.centroid.lat.toFixed(3))],
      radiusKm: Math.round(radiusKm),
    };
  });
}

// --- Cyclones, floods and volcanoes (GDACS) -----------------------------------

async function fetchGdacsZones() {
  const response = await fetch(GDACS_FEED, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`GDACS request failed: ${response.status}`);
  const geojson = await response.json();

  const zones = [];
  for (const feature of geojson.features ?? []) {
    const props = feature.properties ?? {};
    const spec = GDACS_TYPES[props.eventtype];
    if (!spec) continue;
    // The search endpoint returns a rolling history, most of it long over.
    // GDACS's own `iscurrent` flag is the authority on what is still running —
    // an event's `todate` can be in the past while the situation continues.
    if (String(props.iscurrent) !== "true") continue;

    const [lon, lat] = feature.geometry?.coordinates ?? [];
    if (typeof lon !== "number" || typeof lat !== "number") continue;

    const radiusKm = spec.radiusKm[props.alertlevel] ?? spec.radiusKm.Orange;
    const zone = {
      id: `gdacs_${props.eventtype}_${props.eventid}`.toLowerCase(),
      label: `${props.name || props.description || spec.kind} (${props.alertlevel} alert)`,
      security: spec.security,
      access: "hazard",
      surchargeUsdPerKm: spec.surchargeUsdPerKm,
      tollUsd: 0,
      hazardKind: spec.kind,
      detectedAt: new Date(props.datemodified ?? props.fromdate ?? Date.now()).toISOString(),
      center: [Number(lon.toFixed(3)), Number(lat.toFixed(3))],
      radiusKm,
    };
    if (spec.modes) zone.modes = spec.modes;
    zones.push(zone);
  }
  return zones;
}

// --- Main ---------------------------------------------------------------------

const retagOnly = process.argv.includes("--retag");

let hazardZones;
if (retagOnly) {
  hazardZones = read("hazardZones.json");
  console.log(`Re-tagging ${hazardZones.length} committed hazard zones without fetching.`);
} else {
  const sources = [
    ["earthquake", fetchEarthquakeZones],
    ["wildfire", fetchWildfireZones],
    ["GDACS", fetchGdacsZones],
  ];
  const results = await Promise.all(
    sources.map(([name, fetchZones]) =>
      fetchZones().catch((err) => {
        // One dead upstream must not wipe the other sources' zones for this run.
        console.error(`${name} fetch failed, keeping no ${name} zones this run: ${err.message}`);
        return [];
      }),
    ),
  );
  hazardZones = results.flat().sort((a, b) => a.id.localeCompare(b.id));
  writeCompactList("hazardZones.json", hazardZones);

  const counts = {};
  for (const zone of hazardZones) counts[zone.hazardKind] = (counts[zone.hazardKind] ?? 0) + 1;
  console.log(`Hazard zones: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ")}.`);
}

const nodes = readNodes(ROOT);
const edges = read("edges.json");
const truckEdges = read("truckEdges.json");
const nodeById = new Map(nodes.map((n) => [n.id, n]));
const grid = createZoneGrid(hazardZones);

const hazardEdgeZones = {};
const tagList = (list, fallbackMode) => {
  for (const edge of list) {
    const mode = edge.mode ?? fallbackMode;
    const hit = zonesOnEdge(edge, mode, hazardZones, nodeById, { grid });
    if (hit) hazardEdgeZones[`${edge.from}|${edge.to}|${mode}`] = hit;
  }
};
tagList(edges);
tagList(truckEdges, "truck");
write("hazardEdgeZones.json", hazardEdgeZones);

console.log(`Tagged ${Object.keys(hazardEdgeZones).length} legs.`);
