/**
 * Conflict-related coverage per country from GDELT 2.0, keyless. Best-effort.
 *
 * GDELT's public API rate-limits at roughly one request per five seconds and
 * its GEO endpoint has been intermittently 404/timing out, so this is written
 * to contribute nothing rather than fail the run.
 *
 * Attribution matters here: the DOC API's `sourcecountry` is where an article
 * was *published*, not where the event happened, so aggregating on it simply
 * ranks countries by the size of their English-language press. This queries
 * `locationcc:` per country instead, which filters on the location an article
 * is *about*, and only over a watchlist so the request budget stays bounded.
 *
 * What it measures is still coverage volume, not verified events — a proxy,
 * capped so it can only nudge a curated score.
 */
import { fetchJson } from "../lib/http.mjs";

const QUERY = '("armed clash" OR "air strike" OR insurgency OR blockade OR "port closure")';
const REQUEST_SPACING_MS = 5500; // GDELT asks for one request per 5s
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RECORDS = 250;
/** When GDELT is down it is down for the whole run; without this, 24 timeouts would stall the job for minutes. */
const CONSECUTIVE_FAILURE_LIMIT = 3;

/** FIPS 10-4 country codes, which is what `locationcc:` expects. */
const WATCHLIST = {
  Ukraine: "UP",
  Russia: "RS",
  Israel: "IS",
  Lebanon: "LE",
  Syria: "SY",
  Iraq: "IZ",
  Iran: "IR",
  Yemen: "YM",
  Sudan: "SU",
  "South Sudan": "OD",
  Somalia: "SO",
  Mali: "ML",
  Niger: "NG",
  Nigeria: "NI",
  Libya: "LY",
  Myanmar: "BM",
  Afghanistan: "AF",
  Pakistan: "PK",
  "DR Congo": "CG",
  Ethiopia: "ET",
  Haiti: "HA",
  Venezuela: "VE",
  "North Korea": "KN",
  Taiwan: "TW",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchConflictMentions() {
  const byCountry = new Map();
  let failures = 0;
  let consecutiveFailures = 0;

  for (const [country, code] of Object.entries(WATCHLIST)) {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(
      `${QUERY} locationcc:${code}`,
    )}&mode=artlist&format=json&maxrecords=${MAX_RECORDS}&timespan=7d`;
    try {
      // One attempt each: retrying a throttled endpoint just burns the budget.
      const data = await fetchJson(url, { attempts: 1, timeoutMs: REQUEST_TIMEOUT_MS });
      byCountry.set(country, (data.articles ?? []).length);
      consecutiveFailures = 0;
    } catch {
      failures++;
      if (++consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        console.error(`GDELT unreachable after ${consecutiveFailures} consecutive failures — skipping the rest.`);
        break;
      }
    }
    await sleep(REQUEST_SPACING_MS);
  }

  if (failures > 0) console.error(`GDELT: ${failures}/${Object.keys(WATCHLIST).length} country queries failed.`);
  return byCountry;
}
