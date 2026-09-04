/**
 * Inland waterway levels from PEGELONLINE, the German WSV gauge service.
 * Keyless, updated every 15 minutes.
 *
 * A barge on a low river is not stopped, it is *lightened*: draft limits cut
 * how much each hull can carry, so the same tonnage needs more trips and the
 * corridor slows. That is a delay factor, not a closure — which is why this
 * feeds zoneConditions rather than blocking anything.
 *
 * `danube_low_water` already encodes which months the Danube is *usually* low.
 * This measures whether it is low now, and the two multiply: a low reading in a
 * normally-low month is worse than either alone.
 *
 * Coverage caveat worth keeping in view: PEGELONLINE is a German service, but
 * it publishes the upper-Danube gauges past the border — Korneuburg sits at
 * Vienna and Thebnerstrassl at Bratislava, which is exactly the reach this
 * project's Danube legs run through. Downstream of Budapest there is no
 * coverage here, so a Hungarian or Romanian low that the upper river does not
 * share will be missed.
 */
import { fetchJson } from "../lib/http.mjs";

const API = "https://pegelonline.wsv.de/webservices/rest-api/v2";

/**
 * One entry per navigable reach this project actually routes on. Gauges are
 * chosen along the stretch rather than at one point, so a single local reading
 * cannot speak for the whole corridor.
 */
const REACHES = [
  {
    zoneId: "danube_low_water",
    label: "Danube",
    stations: ["HOFKIRCHEN", "KORNEUBURG", "WILDUNGSMAUER", "THEBNERSTRASSL"],
  },
];

/**
 * PEGELONLINE classifies each reading against the gauge's own long-run
 * statistics, which is what makes this comparable across stations with wholly
 * different bed levels — a raw centimetre reading means nothing on its own.
 */
const DELAY_BY_STATE = {
  low: 1.35,
  "very low": 1.8,
};

export async function fetchWaterLevelConditions() {
  const conditions = [];
  const detectedAt = new Date().toISOString();

  for (const reach of REACHES) {
    const readings = [];
    for (const station of reach.stations) {
      try {
        const measurement = await fetchJson(`${API}/stations/${station}/W/currentmeasurement.json`, { attempts: 2 });
        readings.push({ station, value: measurement.value, state: String(measurement.stateMnwMhw ?? "").toLowerCase() });
      } catch (error) {
        console.error(`PEGELONLINE: ${station} unavailable: ${error.message}`);
      }
    }
    if (readings.length === 0) continue;

    const low = readings.filter((r) => DELAY_BY_STATE[r.state]);
    if (low.length === 0) {
      console.log(`${reach.label}: ${readings.length} gauges, none low.`);
      continue;
    }

    // The worst reach governs: a barge cannot pass the shallowest point by
    // averaging it against a deeper one downstream.
    const worst = low.reduce((a, b) => (DELAY_BY_STATE[b.state] > DELAY_BY_STATE[a.state] ? b : a));
    conditions.push({
      zoneId: reach.zoneId,
      delayFactor: DELAY_BY_STATE[worst.state],
      label:
        `${reach.label} at ${worst.station.toLowerCase()} ${worst.value} cm — ${worst.state} water, ` +
        `${low.length} of ${readings.length} gauges below normal (reduced barge draft)`,
      source: "PEGELONLINE (WSV)",
      detectedAt,
    });
  }

  console.log(`Water levels: ${conditions.length} reach(es) below normal.`);
  return conditions;
}
