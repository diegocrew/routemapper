/**
 * Border closures reported to ReliefWeb, for the borders CBP doesn't cover —
 * which is most of them.
 *
 * ReliefWeb's v2 API needs an approved `appname`, requested (free) from
 * https://apidoc.reliefweb.int/parameters#appname. Without RELIEFWEB_APPNAME
 * this contributes nothing rather than failing the run, exactly like FIRMS.
 *
 * What comes back is humanitarian *reporting*, not a border authority's status
 * page: an article saying a crossing shut is evidence, not a fact, and it does
 * not un-say itself when the crossing reopens. So entries from here only ever
 * add delay and a warning — nothing generated closes a border outright. That
 * stays a curated decision in restrictions.json.
 */
import { fetchJson } from "../lib/http.mjs";

const ENDPOINT = "https://api.reliefweb.int/v2/reports";
/** Long enough to catch a slow-moving closure, short enough that a reopened crossing ages out. */
const WINDOW_DAYS = 21;
const MIN_REPORTS = 2; // one article is an anecdote

/** Borders worth asking about, and the countries whose legs a hit applies to. */
const WATCHLIST = [
  { id: "poland_ukraine", countries: ["Poland", "Ukraine"], terms: "Poland Ukraine border crossing blockade" },
  { id: "poland_belarus", countries: ["Poland", "Belarus"], terms: "Poland Belarus border crossing closed" },
  { id: "finland_russia", countries: ["Finland", "Russia"], terms: "Finland Russia border crossing closed" },
  { id: "chad_sudan", countries: ["Chad", "Sudan"], terms: "Chad Sudan border crossing closed" },
  { id: "egypt_libya", countries: ["Egypt", "Libya"], terms: "Egypt Libya border crossing closed" },
  { id: "iran_afghanistan", countries: ["Iran", "Afghanistan"], terms: "Iran Afghanistan border crossing closed" },
  { id: "pakistan_afghanistan", countries: ["Pakistan", "Afghanistan"], terms: "Pakistan Afghanistan Torkham border closed" },
  { id: "kenya_somalia", countries: ["Kenya", "Somalia"], terms: "Kenya Somalia border crossing closed" },
  { id: "niger_nigeria", countries: ["Niger", "Nigeria"], terms: "Niger Nigeria border crossing closed" },
  { id: "colombia_venezuela", countries: ["Colombia", "Venezuela"], terms: "Colombia Venezuela border crossing closed" },
];

/** Reported disruption is a signal of friction, not a measured queue — one flat, modest penalty. */
const REPORTED_DELAY_HOURS = 12;

export async function fetchReportedClosures() {
  const appname = process.env.RELIEFWEB_APPNAME;
  if (!appname) {
    console.log("RELIEFWEB_APPNAME not set — skipping reported border closures (v2 needs an approved appname).");
    return [];
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const entries = [];
  for (const border of WATCHLIST) {
    const url =
      `${ENDPOINT}?appname=${encodeURIComponent(appname)}` +
      `&query[value]=${encodeURIComponent(border.terms)}&query[operator]=AND` +
      `&filter[field]=date.created&filter[value][from]=${since}T00:00:00%2B00:00` +
      `&fields[include][]=title&limit=10&sort[]=date.created:desc`;
    try {
      const data = await fetchJson(url, { attempts: 1, timeoutMs: 20000 });
      const reports = data.data ?? [];
      if (reports.length < MIN_REPORTS) continue;
      entries.push({
        id: `reliefweb_${border.id}`,
        countries: border.countries,
        modes: ["truck", "rail"],
        label: `${border.countries.join("–")} border: ${reports.length} disruption reports in ${WINDOW_DAYS} days`,
        delayHours: REPORTED_DELAY_HOURS,
        source: "ReliefWeb",
        headline: reports[0].fields?.title,
      });
    } catch (error) {
      console.error(`ReliefWeb query failed for ${border.id}: ${error.message}`);
    }
  }
  return entries;
}
