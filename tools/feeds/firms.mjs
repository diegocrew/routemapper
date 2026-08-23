/**
 * Wildfire hotspots from NASA FIRMS.
 *
 * Needs FIRMS_API_KEY (a free MAP_KEY). Confirmed against the live API: unlike
 * some NASA APIs, FIRMS's Area endpoint has no working keyless/demo tier, it
 * just 400s without a real key. A missing key skips wildfires for the run
 * rather than failing everything.
 *
 * Wildfires are scoped to `truck` and `rail`: aircraft overfly them, ships are
 * unaffected, and the forest a fire is burning through has no road or track
 * open in it. Without that scoping a fire inland was surcharging sea legs
 * passing tens of km offshore.
 */
import { fetchText } from "../lib/http.mjs";
import { round3 } from "../lib/sphere.mjs";
import { clusterPoints, clusterSpreadKm } from "../lib/cluster.mjs";

const SOURCE = "VIIRS_SNPP_NRT";
const DAY_RANGE = 4;
const MIN_CONFIDENCE = 50; // 0-100 scale; VIIRS "l/n/h" is mapped onto this below
// A global VIIRS window is hundreds of thousands of detections. Linking and
// minimum-size thresholds are set so fire-season smears collapse into a few
// thousand zones rather than tens of thousands of near-duplicates.
const CLUSTER_LINK_KM = 30; // detections within this of a cluster's centroid join it
const MIN_CLUSTER_POINTS = 8; // smaller clusters are treated as noise
const BUFFER_KM = 10; // added on top of the cluster's own spread
const RADIUS_RANGE_KM = [15, 75]; // clamp so one hotspot isn't a pinprick and a big fire isn't a continent
const SURCHARGE_USD_PER_KM = 2;
const MODES = ["truck", "rail"];

/** FIRMS confidence is "l"/"n"/"h" for VIIRS, 0-100 for MODIS; normalize to 0-100. */
function normalizeConfidence(raw) {
  if (raw === "l") return 30;
  if (raw === "n") return 60;
  if (raw === "h") return 90;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function parseCsv(csv) {
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
    if (normalizeConfidence(cols[confIdx]?.trim()) < MIN_CONFIDENCE) continue;
    points.push({ lat, lon, frp: Number(cols[frpIdx]) || 0 });
  }
  return points;
}

export async function fetchWildfireZones() {
  const mapKey = process.env.FIRMS_API_KEY;
  if (!mapKey) {
    console.log("FIRMS_API_KEY not set — skipping wildfire fetch (FIRMS has no working keyless tier).");
    return [];
  }

  const csv = await fetchText(
    `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/${SOURCE}/world/${DAY_RANGE}`,
  );
  const clusters = clusterPoints(parseCsv(csv), CLUSTER_LINK_KM).filter((c) => c.points.length >= MIN_CLUSTER_POINTS);
  const now = new Date().toISOString();

  return clusters.map((cluster, i) => {
    const spreadKm = clusterSpreadKm(cluster);
    const radiusKm = Math.min(RADIUS_RANGE_KM[1], Math.max(RADIUS_RANGE_KM[0], spreadKm + BUFFER_KM));
    return {
      id: `fire_${cluster.centroid.lat.toFixed(2)}_${cluster.centroid.lon.toFixed(2)}_${i}`,
      label: `Active wildfire (${cluster.points.length} detections) near ${cluster.centroid.lat.toFixed(1)}, ${cluster.centroid.lon.toFixed(1)}`,
      security: 20,
      access: "hazard",
      surchargeUsdPerKm: SURCHARGE_USD_PER_KM,
      tollUsd: 0,
      hazardKind: "wildfire",
      modes: MODES,
      detectedAt: now,
      center: [round3(cluster.centroid.lon), round3(cluster.centroid.lat)],
      radiusKm: Math.round(radiusKm),
    };
  });
}
