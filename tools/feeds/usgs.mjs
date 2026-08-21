/**
 * Earthquakes from the USGS 7-day feed. Keyless.
 *
 * Magnitude threshold and the radius-by-magnitude table are deliberate
 * approximations — a rough felt-shaking bucket table, not a seismological
 * model.
 */
import { fetchJson } from "../lib/http.mjs";
import { round3 } from "../lib/sphere.mjs";

const FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson";
const MIN_MAGNITUDE = 5.5; // below this, unlikely to disrupt a port/airport/rail hub
const SURCHARGE_USD_PER_KM = 5;

const RADIUS_KM = [
  { min: 5.5, max: 6.0, km: 60 },
  { min: 6.0, max: 7.0, km: 120 },
  { min: 7.0, max: 8.0, km: 220 },
  { min: 8.0, max: Infinity, km: 350 },
];

const radiusFor = (magnitude) =>
  RADIUS_KM.find((b) => magnitude >= b.min && magnitude < b.max)?.km ?? RADIUS_KM[RADIUS_KM.length - 1].km;

export async function fetchEarthquakeZones() {
  const geojson = await fetchJson(FEED);

  const zones = [];
  for (const feature of geojson.features ?? []) {
    const magnitude = feature.properties?.mag;
    if (typeof magnitude !== "number" || magnitude < MIN_MAGNITUDE) continue;
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    if (typeof lon !== "number" || typeof lat !== "number") continue;

    zones.push({
      id: `quake_${feature.id}`,
      label: `M${magnitude.toFixed(1)} earthquake — ${feature.properties.place ?? "location unknown"}`,
      security: 20,
      access: "hazard",
      surchargeUsdPerKm: SURCHARGE_USD_PER_KM,
      tollUsd: 0,
      hazardKind: "earthquake",
      detectedAt: new Date(feature.properties.time).toISOString(),
      center: [round3(lon), round3(lat)],
      radiusKm: radiusFor(magnitude),
    });
  }
  return zones;
}
