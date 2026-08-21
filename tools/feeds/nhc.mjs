/**
 * Active named storms from NOAA NHC, keyless.
 *
 * NHC publishes each storm's position, intensity and movement vector.
 * Extrapolating that vector forward is dead reckoning, NOT the official NHC
 * forecast cone (which is a shapefile encoding real track uncertainty), so the
 * forecast steps widen with lead time to stand in for that uncertainty and are
 * flagged `forecast: true`.
 */
import { fetchJson } from "../lib/http.mjs";
import { destinationPoint, round3 } from "../lib/sphere.mjs";
import { TYPES as GDACS_TYPES } from "./gdacs.mjs";

const FEED = "https://www.nhc.noaa.gov/CurrentStorms.json";
const FORECAST_STEPS_H = [0, 24, 48, 72];
const SPREAD_KM_PER_H = 1.6; // radius growth per hour of lead time
const KM_PER_KNOT = 1.852;

const RADIUS_KM = [
  { minKt: 0, km: 150 },
  { minKt: 64, km: 220 }, // hurricane force
  { minKt: 96, km: 300 }, // major
];

const radiusFor = (intensityKt) =>
  [...RADIUS_KM].reverse().find((b) => intensityKt >= b.minKt)?.km ?? RADIUS_KM[0].km;

export async function fetchStormZones() {
  const { activeStorms = [] } = await fetchJson(FEED);

  const zones = [];
  for (const storm of activeStorms) {
    const lat = Number(storm.latitudeNumeric);
    const lon = Number(storm.longitudeNumeric);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const intensityKt = Number(storm.intensity) || 0;
    const issued = Date.parse(storm.lastUpdate ?? Date.now());
    const baseKm = radiusFor(intensityKt);
    const speedKt = Number(storm.movementSpeed) || 0;
    const headingDeg = Number(storm.movementDir) || 0;

    FORECAST_STEPS_H.forEach((leadH, index) => {
      const travelledKm = speedKt * KM_PER_KNOT * leadH;
      const point = leadH === 0 ? { lon, lat } : destinationPoint({ lon, lat }, headingDeg, travelledKm);
      const nextH = FORECAST_STEPS_H[index + 1] ?? leadH + 24;
      zones.push({
        id: `storm_${storm.id}_${leadH}h`,
        label:
          leadH === 0
            ? `${storm.name} (${intensityKt} kt)`
            : `${storm.name} (${intensityKt} kt) — forecast +${leadH}h`,
        security: 20,
        access: "hazard",
        surchargeUsdPerKm: GDACS_TYPES.TC.surchargeUsdPerKm,
        tollUsd: 0,
        hazardKind: "cyclone",
        modes: ["sea"],
        detectedAt: new Date(issued).toISOString(),
        activeFrom: new Date(issued + leadH * 3600 * 1000).toISOString(),
        activeUntil: new Date(issued + nextH * 3600 * 1000).toISOString(),
        ...(leadH > 0 ? { forecast: true } : {}),
        center: [round3(point.lon), round3(point.lat)],
        radiusKm: Math.round(baseKm + leadH * SPREAD_KM_PER_H),
      });
    });
  }
  return zones;
}
