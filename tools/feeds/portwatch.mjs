/**
 * Chokepoint throughput from IMF PortWatch, which estimates daily transits from
 * the AIS signals of ~90,000 ships. Keyless.
 *
 * The zones in zones.json price a chokepoint as a constant: Suez costs its toll
 * whether the canal is running normally or at half rate. This measures whether
 * it is running normally, by comparing the last week of transits against the
 * same chokepoint's own trailing median.
 *
 * What "below normal" means is genuinely ambiguous, and worth stating rather
 * than dressing up. Panama in the 2023-24 drought was a *capacity* restriction:
 * ships queued. Suez after 2023 is *avoidance*: ships went round the Cape
 * instead. Throughput alone cannot tell those apart. But both are reasons to
 * prefer another routing, so the model treats a chokepoint well below its own
 * normal as friction without claiming to know which kind — the comparison is
 * against its own history, so no cross-chokepoint calibration is implied
 * either.
 */
import { fetchJson } from "../lib/http.mjs";

const SERVICE =
  "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";

/** PortWatch's chokepoint names, against the zone each one corresponds to. */
const CHOKEPOINTS = {
  "Suez Canal": "suez_canal",
  "Panama Canal": "panama_canal",
  "Bab el-Mandeb Strait": "bab_el_mandeb",
  "Strait of Hormuz": "hormuz",
  "Malacca Strait": "malacca",
  "Bosporus Strait": "black_sea",
  "Taiwan Strait": "taiwan_strait",
};

const RECENT_DAYS = 7;
const BASELINE_DAYS = 180;
/** Below this share of its own median, a chokepoint is not operating normally. */
const DISRUPTED_BELOW = 0.8;
/** However bad the ratio looks, one chokepoint should not triple a voyage on its own. */
const MAX_DELAY_FACTOR = 2;
/**
 * A chokepoint this quiet cannot support a ratio worth acting on: at three
 * transits a day, one ship either way reads as a 33% collapse. Hormuz produced
 * exactly that on `n_cargo`, which counts only non-tanker cargo and so sees
 * almost nothing of a strait that is overwhelmingly tankers — hence `n_total`
 * below, and this floor for the genuinely quiet ones.
 */
const MIN_BASELINE_TRANSITS = 10;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[sorted.length >> 1];
};

export async function fetchChokepointConditions() {
  const conditions = [];
  const detectedAt = new Date().toISOString();

  for (const [portname, zoneId] of Object.entries(CHOKEPOINTS)) {
    const query = new URLSearchParams({
      f: "json",
      where: `portname='${portname.replace(/'/g, "''")}'`,
      outFields: "date,n_total",
      orderByFields: "date DESC",
      resultRecordCount: String(BASELINE_DAYS),
    });

    let body;
    try {
      body = await fetchJson(`${SERVICE}?${query}`, { attempts: 2 });
    } catch (error) {
      console.error(`PortWatch: ${portname} unavailable: ${error.message}`);
      continue;
    }
    if (body.error) {
      console.error(`PortWatch: ${portname} query rejected: ${JSON.stringify(body.error).slice(0, 120)}`);
      continue;
    }

    // Newest first, so the head is the recent window and the whole run is the
    // baseline. A chokepoint compared only against the last month would call a
    // months-long diversion the new normal and stop flagging it.
    const series = (body.features ?? []).map((f) => Number(f.attributes.n_total)).filter(Number.isFinite);
    if (series.length < RECENT_DAYS * 3) {
      console.error(`PortWatch: ${portname} returned only ${series.length} days, skipping.`);
      continue;
    }

    const recent = median(series.slice(0, RECENT_DAYS));
    const baseline = median(series);
    if (baseline < MIN_BASELINE_TRANSITS) {
      console.error(`PortWatch: ${portname} baseline is only ${baseline}/day, too quiet to read a ratio from.`);
      continue;
    }

    const share = recent / baseline;
    if (share >= DISRUPTED_BELOW) continue;

    // Time scales as the inverse of throughput: half the transits, twice the wait.
    const delayFactor = Math.min(MAX_DELAY_FACTOR, Number((1 / Math.max(share, 0.1)).toFixed(2)));
    conditions.push({
      zoneId,
      delayFactor,
      label:
        `${portname}: ${recent} transits/day against a ${baseline}/day baseline ` +
        `(${Math.round((1 - share) * 100)}% below normal)`,
      source: "IMF PortWatch",
      detectedAt,
    });
  }

  console.log(`PortWatch: ${conditions.length} of ${Object.keys(CHOKEPOINTS).length} chokepoints below normal.`);
  return conditions;
}
