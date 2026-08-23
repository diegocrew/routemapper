/**
 * Armed-conflict zones from ACLED.
 *
 * Needs ACLED_USERNAME and ACLED_PASSWORD (a myACLED login — see lib/acled.mjs
 * for why the OAuth refresh token is deliberately not used). Missing
 * credentials skip conflict zones for the run rather than failing everything,
 * the same as FIRMS.
 *
 * Only the event types that physically interdict freight: battles and remote
 * violence close roads, cut rail and shut airspace. Protests, riots and
 * strategic developments are left out — a demonstration is a real event and a
 * real risk signal, but it is not a reason to reroute a container, and folding
 * it in here would drown the corridors that are genuinely cut.
 *
 * This is the first hazard source that is neither weather nor geology, and it
 * behaves differently from both: a conflict does not age out of an upstream
 * window on its own the way a storm track or a hotspot does. The window below
 * is what stands in for expiry — an area with no reported violence in the last
 * fortnight stops producing a zone.
 */
import { clusterPoints, clusterSpreadKm } from "../lib/cluster.mjs";
import { round3 } from "../lib/sphere.mjs";
import { acledCredentials, fetchAccessToken, readEvents } from "../lib/acled.mjs";

/** What actually stops freight moving, in ACLED's own event_type vocabulary. */
const EVENT_TYPES = ["Battles", "Explosions/Remote violence"];
const WINDOW_DAYS = 14;
const PAGE_LIMIT = 5000;
const MAX_PAGES = 10; // a fortnight of battles is a few thousand events, not tens of thousands

const CLUSTER_LINK_KM = 40; // a front is wider than a wildfire
const MIN_CLUSTER_EVENTS = 3; // one incident is an incident; three in one place is a front
const BUFFER_KM = 15;
const RADIUS_RANGE_KM = [25, 120];

const SURCHARGE_USD_PER_KM = 4; // war-risk premium, above the wildfire rate
/**
 * Surface modes only. Sea is in because the coastal cases that matter — Odesa,
 * Hodeidah, Port Sudan — are exactly the ones where fighting reaches the berth.
 *
 * Air is deliberately out, and not because a battle spares the airport. Air
 * legs are generated at runtime and are not hazard-tagged at all, so listing
 * "air" here would look like it did something and do nothing. The air side of a
 * conflict is already modelled, better, as restricted airspace in
 * src/data/airspace.json — a whole FIR rather than a 100 km circle.
 */
const MODES = ["truck", "rail", "sea"];

/** Fatalities are the only intensity signal ACLED gives that needs no interpretation. */
function securityScore(events) {
  const fatalities = events.reduce((sum, e) => sum + (Number(e.fatalities) || 0), 0);
  if (fatalities >= 100) return 5;
  if (fatalities >= 25) return 10;
  if (fatalities >= 5) return 15;
  return 25;
}

export async function fetchConflictZones() {
  const credentials = acledCredentials();
  if (!credentials) {
    console.log("ACLED_USERNAME/ACLED_PASSWORD not set — skipping conflict zones.");
    return [];
  }

  const token = await fetchAccessToken(credentials);
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const events = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await readEvents(
      token,
      {
        event_date: since,
        event_date_where: ">=",
        event_type: EVENT_TYPES.join(":OR:event_type="),
        fields: "event_date|event_type|sub_event_type|country|latitude|longitude|fatalities",
      },
      { limit: PAGE_LIMIT, page },
    );
    events.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
    if (page === MAX_PAGES) console.error(`ACLED: stopped at ${MAX_PAGES} pages, results may be truncated.`);
  }

  const points = events
    .map((e) => ({
      lat: Number(e.latitude),
      lon: Number(e.longitude),
      fatalities: Number(e.fatalities) || 0,
      country: e.country,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  const clusters = clusterPoints(points, CLUSTER_LINK_KM).filter((c) => c.points.length >= MIN_CLUSTER_EVENTS);
  const now = new Date().toISOString();
  console.log(`ACLED: ${events.length} events since ${since} → ${clusters.length} conflict zones.`);

  return clusters.map((cluster, i) => {
    const radiusKm = Math.min(
      RADIUS_RANGE_KM[1],
      Math.max(RADIUS_RANGE_KM[0], clusterSpreadKm(cluster) + BUFFER_KM),
    );
    // The modal country in the cluster: a front on a border produces points
    // from both sides, and naming the busier one beats naming whichever
    // happened to be first.
    const byCountry = {};
    for (const p of cluster.points) byCountry[p.country] = (byCountry[p.country] ?? 0) + 1;
    const country = Object.keys(byCountry).sort((a, b) => byCountry[b] - byCountry[a])[0];
    const fatalities = cluster.points.reduce((sum, p) => sum + p.fatalities, 0);

    return {
      id: `conflict_${cluster.centroid.lat.toFixed(2)}_${cluster.centroid.lon.toFixed(2)}_${i}`,
      label:
        `Armed conflict in ${country} (${cluster.points.length} events` +
        `${fatalities > 0 ? `, ${fatalities} fatalities` : ""}, ${WINDOW_DAYS}d)`,
      security: securityScore(cluster.points),
      access: "hazard",
      surchargeUsdPerKm: SURCHARGE_USD_PER_KM,
      tollUsd: 0,
      hazardKind: "conflict",
      modes: MODES,
      detectedAt: now,
      center: [round3(cluster.centroid.lon), round3(cluster.centroid.lat)],
      radiusKm: Math.round(radiusKm),
    };
  });
}
