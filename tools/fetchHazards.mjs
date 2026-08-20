/**
 * Pulls live earthquakes (USGS) and wildfires (NASA FIRMS), turns them into
 * temporary "hazard" zones in the same shape as src/data/zones.json, and tags
 * which curated/truck legs cross them. Run on a schedule by
 * .github/workflows/hazards.yml — each run re-fetches the current upstream
 * window and overwrites the output files wholesale, so an event "expires"
 * simply by aging out of USGS/FIRMS's own time bucket; there is no separate
 * delete/expiry step here.
 *
 * Usage: node tools/fetchHazards.mjs
 * Env:   FIRMS_API_KEY - required for the wildfire half (get a free MAP_KEY at
 *        https://firms.modaps.eosdis.nasa.gov/api/map_key/ — confirmed by
 *        testing against the live API: unlike some NASA APIs, FIRMS's Area API
 *        has no working keyless/demo tier, it just 400s without a real key).
 *        Earthquakes (USGS) need no key at all. Missing the key skips the
 *        wildfire fetch for this run rather than failing the whole script.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { zonesOnEdge } from "./lib/geo.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, "src/data", file), "utf8"));
const write = (file, data) =>
  fs.writeFileSync(path.join(ROOT, "src/data", file), `${JSON.stringify(data, null, 2)}\n`, "utf8");

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
const CLUSTER_LINK_KM = 20; // detections within this of a cluster's centroid join it
const MIN_CLUSTER_POINTS = 4; // smaller clusters are treated as noise
const FIRE_BUFFER_KM = 10; // added on top of the cluster's own spread
const FIRE_RADIUS_RANGE_KM = [15, 75]; // clamp so one hotspot isn't a pinprick and a big fire isn't a continent

const EARTH_RADIUS_KM = 6371;
const CIRCLE_POINTS = 24;

// --- Geometry helpers --------------------------------------------------------

function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Destination point `distanceKm` from `center` along `bearingDeg` (0 = north). */
function destinationPoint(center, bearingDeg, distanceKm) {
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const delta = distanceKm / EARTH_RADIUS_KM;
  const theta = rad(bearingDeg);
  const lat1 = rad(center.lat);
  const lon1 = rad(center.lon);

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lon: deg(lon2), lat: deg(lat2) };
}

function circlePolygon(center, radiusKm, points = CIRCLE_POINTS) {
  const ring = [];
  for (let i = 0; i < points; i++) {
    const bearing = (360 * i) / points;
    const p = destinationPoint(center, bearing, radiusKm);
    ring.push([Number(p.lon.toFixed(3)), Number(p.lat.toFixed(3))]);
  }
  ring.push(ring[0]);
  return ring;
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
      surchargeUsdPerKm: 0,
      tollUsd: 0,
      hazardKind: "earthquake",
      detectedAt,
      polygon: circlePolygon({ lon, lat }, radiusKm),
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

/** Greedy single-pass clustering: a point joins the nearest cluster within CLUSTER_LINK_KM of its centroid, else starts a new one. Good enough for turning a hotspot smear into a handful of zones — not a real spatial index. */
function clusterPoints(points) {
  const clusters = [];
  for (const point of points) {
    let best = null;
    let bestKm = Infinity;
    for (const cluster of clusters) {
      const km = haversineKm(point, cluster.centroid);
      if (km <= CLUSTER_LINK_KM && km < bestKm) {
        best = cluster;
        bestKm = km;
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
      clusters.push({ centroid: { lat: point.lat, lon: point.lon }, points: [point] });
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
      surchargeUsdPerKm: 0,
      tollUsd: 0,
      hazardKind: "wildfire",
      detectedAt: now,
      polygon: circlePolygon(cluster.centroid, radiusKm),
    };
  });
}

// --- Main ---------------------------------------------------------------------

const [earthquakeZones, wildfireZones] = await Promise.all([
  fetchEarthquakeZones().catch((err) => {
    console.error(`earthquake fetch failed, keeping no earthquake zones this run: ${err.message}`);
    return [];
  }),
  fetchWildfireZones().catch((err) => {
    console.error(`wildfire fetch failed, keeping no wildfire zones this run: ${err.message}`);
    return [];
  }),
]);

const hazardZones = [...earthquakeZones, ...wildfireZones].sort((a, b) => a.id.localeCompare(b.id));
write("hazardZones.json", hazardZones);

const nodes = read("nodes.json");
const edges = read("edges.json");
const truckEdges = read("truckEdges.json");
const nodeById = new Map(nodes.map((n) => [n.id, n]));

const hazardEdgeZones = {};
const tagList = (list, fallbackMode) => {
  for (const edge of list) {
    const mode = edge.mode ?? fallbackMode;
    const hit = zonesOnEdge(edge, mode, hazardZones, nodeById);
    if (hit) hazardEdgeZones[`${edge.from}|${edge.to}|${mode}`] = hit;
  }
};
tagList(edges);
tagList(truckEdges, "truck");
write("hazardEdgeZones.json", hazardEdgeZones);

console.log(
  `Hazard zones: ${earthquakeZones.length} earthquake, ${wildfireZones.length} wildfire. Tagged ${Object.keys(hazardEdgeZones).length} legs.`,
);
