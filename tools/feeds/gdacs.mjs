/**
 * Tropical cyclones, floods and volcanic eruptions from GDACS, filtered to the
 * Orange/Red alert levels so only events big enough to disrupt freight carry.
 * Keyless.
 *
 * Radii are alert-level buckets rather than the real footprint — the list
 * endpoint gives a centroid, not a geometry.
 *
 * `modes` is what makes these useful: a cyclone is a sea problem, a flood is a
 * road and rail problem. Volcanoes carry no `modes` because ash closes the
 * site itself, which is also why they block civilian cargo outright.
 */
import { fetchJson } from "../lib/http.mjs";
import { round3 } from "../lib/sphere.mjs";

const FEED =
  "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC;FL;VO&alertlevel=Orange;Red";

export const TYPES = {
  TC: { kind: "cyclone", modes: ["sea"], radiusKm: { Orange: 300, Red: 500 }, surchargeUsdPerKm: 4, security: 25 },
  FL: { kind: "flood", modes: ["truck", "rail"], radiusKm: { Orange: 80, Red: 150 }, surchargeUsdPerKm: 3, security: 30 },
  VO: { kind: "volcano", modes: undefined, radiusKm: { Orange: 50, Red: 100 }, surchargeUsdPerKm: 5, security: 20 },
};

export async function fetchGdacsZones() {
  const geojson = await fetchJson(FEED);

  const zones = [];
  for (const feature of geojson.features ?? []) {
    const props = feature.properties ?? {};
    const spec = TYPES[props.eventtype];
    if (!spec) continue;
    // The search endpoint returns a rolling history, most of it long over.
    // GDACS's own `iscurrent` flag is the authority on what is still running —
    // an event's `todate` can be in the past while the situation continues.
    if (String(props.iscurrent) !== "true") continue;

    const [lon, lat] = feature.geometry?.coordinates ?? [];
    if (typeof lon !== "number" || typeof lat !== "number") continue;

    const zone = {
      id: `gdacs_${props.eventtype}_${props.eventid}`.toLowerCase(),
      label: `${props.name || props.description || spec.kind} (${props.alertlevel} alert)`,
      security: spec.security,
      access: "hazard",
      surchargeUsdPerKm: spec.surchargeUsdPerKm,
      tollUsd: 0,
      hazardKind: spec.kind,
      detectedAt: new Date(props.datemodified ?? props.fromdate ?? Date.now()).toISOString(),
      center: [round3(lon), round3(lat)],
      radiusKm: spec.radiusKm[props.alertlevel] ?? spec.radiusKm.Orange,
    };
    if (spec.modes) zone.modes = spec.modes;
    zones.push(zone);
  }
  return zones;
}
