/**
 * Armed-conflict zones from UCDP's Georeferenced Event Dataset.
 *
 * Needs UCDP_TOKEN. Missing token skips conflict zones for the run rather than
 * failing everything, the same as FIRMS and ACLED.
 *
 * Three things the probe (npm run probe:ucdp) established, each of which this
 * file is shaped around:
 *
 * 1. The stable annual release runs a year behind, so only the monthly
 *    "candidate" releases are recent enough to describe a corridor's current
 *    state — and even those sit ~50 days back. This is a slowly-varying layer,
 *    not a live one, which is fine: wars move on a scale of months, and a
 *    corridor that was dangerous in June is a fair guide to August.
 *
 * 2. A candidate release is an *increment*, not a rolling window — one holds a
 *    couple of thousand events covering a month or two. Several are unioned to
 *    cover a useful period, and their version strings move monthly, so they are
 *    discovered rather than hardcoded.
 *
 * 3. UCDP geocodes an event it cannot place precisely to the centroid of a
 *    region or country, flagged in `where_prec`. Clustering those unfiltered
 *    invents a dense conflict exactly at the middle of Burkina Faso, Nigeria
 *    and Syria — plausible-looking and entirely fictional. Only events located
 *    to an actual site or district are kept.
 */
import { clusterPoints, clusterSpreadKm } from "../lib/cluster.mjs";
import { round3 } from "../lib/sphere.mjs";
import { findCandidates, readGedEvents, ucdpToken } from "../lib/ucdp.mjs";

const WINDOW_DAYS = 90; // wide enough to be useful given the ~50-day lag
const MAX_RELEASES = 6; // candidate releases unioned to cover the window
/** UCDP's `where_prec`: 1 exact site, 2 within 25 km, 3 ADM2. 4+ is a region or country centroid. */
const MAX_LOCATION_PRECISION = 3;

const CLUSTER_LINK_KM = 40; // a front is wider than a wildfire
const MIN_CLUSTER_EVENTS = 3; // one incident is an incident; three in one place is a front
const BUFFER_KM = 15;
const RADIUS_RANGE_KM = [25, 120];

const SURCHARGE_USD_PER_KM = 4; // war-risk premium, above the wildfire rate
/**
 * Surface modes only. Sea is in because the coastal cases that matter — Odesa,
 * Hodeidah, Port Sudan — are where fighting reaches the berth. Air is out
 * because air legs are not hazard-tagged at all, and the air side of a conflict
 * is modelled better as restricted airspace in src/data/airspace.json.
 */
const MODES = ["truck", "rail", "sea"];

/** Deaths are the intensity signal that needs no interpretation. */
function securityScore(deaths) {
  if (deaths >= 100) return 5;
  if (deaths >= 25) return 10;
  if (deaths >= 5) return 15;
  return 25;
}

export async function fetchUcdpConflictZones() {
  const token = ucdpToken();
  if (!token) {
    console.log("UCDP_TOKEN not set — skipping conflict zones.");
    return [];
  }

  const releases = await findCandidates(token, { limit: MAX_RELEASES });
  if (releases.length === 0) {
    console.error("UCDP: no candidate release answered; skipping conflict zones rather than using year-old data.");
    return [];
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const events = [];
  let requests = 0;
  for (const { version } of releases) {
    const page = await readGedEvents(token, version, { StartDate: since }, { pagesize: 1000 });
    requests += page.requests;
    events.push(...page.events);
    if (page.truncated) console.error(`UCDP: ${version} paging hit the cap; some events not read.`);
  }

  // Releases overlap at the edges, and the same event can appear in two of them.
  const byId = new Map(events.map((event) => [event.id, event]));
  const points = [];
  let imprecise = 0;
  for (const event of byId.values()) {
    if (Number(event.where_prec) > MAX_LOCATION_PRECISION) {
      imprecise++;
      continue;
    }
    const lat = Number(event.latitude);
    const lon = Number(event.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    points.push({ lat, lon, deaths: Number(event.best) || 0, country: event.country });
  }

  const clusters = clusterPoints(points, CLUSTER_LINK_KM).filter((c) => c.points.length >= MIN_CLUSTER_EVENTS);
  const now = new Date().toISOString();
  console.log(
    `UCDP: ${releases.length} release(s) in ${requests} requests → ${byId.size} events since ${since}, ` +
      `${imprecise} dropped as imprecisely located, ${clusters.length} conflict zones.`,
  );

  return clusters.map((cluster, i) => {
    const radiusKm = Math.min(
      RADIUS_RANGE_KM[1],
      Math.max(RADIUS_RANGE_KM[0], clusterSpreadKm(cluster) + BUFFER_KM),
    );
    // The modal country: a front on a border produces points from both sides,
    // and naming the busier one beats naming whichever happened to come first.
    const byCountry = {};
    for (const p of cluster.points) byCountry[p.country] = (byCountry[p.country] ?? 0) + 1;
    const country = Object.keys(byCountry).sort((a, b) => byCountry[b] - byCountry[a])[0];
    const deaths = cluster.points.reduce((sum, p) => sum + p.deaths, 0);

    return {
      id: `conflict_${cluster.centroid.lat.toFixed(2)}_${cluster.centroid.lon.toFixed(2)}_${i}`,
      label:
        `Armed conflict in ${country} (${cluster.points.length} events` +
        `${deaths > 0 ? `, ${deaths} deaths` : ""}, ${WINDOW_DAYS}d to ${since})`,
      security: securityScore(deaths),
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
