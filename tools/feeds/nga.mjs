/**
 * NAVAREA broadcast navigational warnings from NGA, keyless — what mariners
 * are actually told to avoid.
 *
 * Most are routine (drilling-rig positions, buoy outages); only the ones that
 * close or endanger water are useful here. Positions come out of the free-text
 * message, so a warning listing points spread across an ocean is dropped
 * rather than turned into one implausible circle.
 */
import { fetchJson } from "../lib/http.mjs";
import { haversineKm, round3 } from "../lib/sphere.mjs";

const FEED = "https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=A";
const HAZARD_TERMS =
  /\b(firing|gunnery|missile|rocket|live fire|ordnance|unexploded|mine|minefield|piracy|pirate|naval exercise|military exercise|dangerous|prohibited|closed area|hazardous operations)\b/i;
const RADIUS_RANGE_KM = [25, 300];
/** A warning listing positions spread wider than this is a list of unrelated points, not one area. */
const MAX_SPREAD_KM = 600;
const SURCHARGE_USD_PER_KM = 3;

const DTG_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** NGA stamps warnings with a military date-time group: `081653Z MAY 2024`. */
function parseDtg(value) {
  const match = /^(\d{2})(\d{2})(\d{2})Z\s+([A-Z]{3})\s+(\d{4})$/i.exec(String(value ?? "").trim());
  if (!match) return null;
  const month = DTG_MONTHS.indexOf(match[4].toUpperCase());
  if (month < 0) return null;
  return new Date(Date.UTC(Number(match[5]), month, Number(match[1]), Number(match[2]), Number(match[3])));
}

/** NAVAREA text carries positions as `19-23.0N 092-03.1W` (degrees-minutes). */
function parsePositions(text) {
  const points = [];
  const pattern = /(\d{1,3})-(\d{1,2}(?:\.\d+)?)\s*([NS])\s+(\d{1,3})-(\d{1,2}(?:\.\d+)?)\s*([EW])/gi;
  for (const match of text.matchAll(pattern)) {
    const lat = (Number(match[1]) + Number(match[2]) / 60) * (match[3].toUpperCase() === "S" ? -1 : 1);
    const lon = (Number(match[4]) + Number(match[5]) / 60) * (match[6].toUpperCase() === "W" ? -1 : 1);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) points.push({ lat, lon });
  }
  return points;
}

export async function fetchNavWarningZones() {
  const warnings = (await fetchJson(FEED))["broadcast-warn"] ?? [];

  const zones = [];
  for (const warning of warnings) {
    const text = warning.text ?? "";
    if (!HAZARD_TERMS.test(text)) continue;

    const points = parsePositions(text);
    if (points.length === 0) continue;
    const center = {
      lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
      lon: points.reduce((s, p) => s + p.lon, 0) / points.length,
    };
    const spreadKm = Math.max(0, ...points.map((p) => haversineKm(p, center)));
    if (spreadKm > MAX_SPREAD_KM) continue;

    zones.push({
      id: `navwarn_${warning.navArea}_${warning.msgYear}_${warning.msgNumber}`.toLowerCase(),
      label: `NAVAREA ${warning.navArea} warning — ${text.replace(/\s+/g, " ").trim().slice(0, 90)}`,
      security: 35,
      access: "hazard",
      surchargeUsdPerKm: SURCHARGE_USD_PER_KM,
      tollUsd: 0,
      hazardKind: "navwarning",
      modes: ["sea"],
      detectedAt: (parseDtg(warning.issueDate) ?? new Date()).toISOString(),
      center: [round3(center.lon), round3(center.lat)],
      radiusKm: Math.round(Math.min(RADIUS_RANGE_KM[1], Math.max(RADIUS_RANGE_KM[0], spreadKm + 25))),
    });
  }
  return zones;
}
