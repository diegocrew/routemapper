/**
 * Surveys what the UCDP token actually reaches, so the conflict feed can be
 * designed against measurements rather than assumptions. Writes nothing.
 *
 * Three questions, each of which changes the feed:
 *
 *   how far behind is the newest data?   decides whether this is a live layer
 *                                        or a slowly-varying one
 *   what does one release cover?         candidate releases are increments, so
 *                                        a useful window may need several
 *                                        unioned
 *   how precisely are events located?    UCDP geocodes an event it cannot place
 *                                        to a country centroid, and clustering
 *                                        those would invent a war in the
 *                                        middle of Burkina Faso
 *
 * Costs on the order of 30 requests against a 5,000/day quota.
 *
 * Usage: npm run probe:ucdp
 *        UCDP_TOKEN comes from .env (gitignored) or the environment.
 */
import { loadLocalEnv } from "./lib/env.mjs";
import { fetchGedPage, findCandidates, releaseSpan, ucdpToken } from "./lib/ucdp.mjs";

loadLocalEnv();

const token = ucdpToken();
if (!token) {
  console.error("Set UCDP_TOKEN, in .env or the environment (CI reads it from the UCDP secret).");
  process.exit(1);
}

const STABLE = "26.1";
const CANDIDATES_TO_SURVEY = 6;

/** UCDP's own scale for how well an event's location is known. */
const PRECISION = {
  1: "exact site",
  2: "within 25 km",
  3: "ADM2 (second-order region)",
  4: "ADM1 (first-order region)",
  5: "country centroid",
  6: "international region",
  7: "unclear",
};

const lagDays = (iso) => (iso ? Math.round((Date.now() - Date.parse(iso)) / (24 * 3600 * 1000)) : null);
const line = (span) => `${span.total.toLocaleString().padStart(9)} events   ${span.oldest ?? "?"} … ${span.newest ?? "?"}`;

try {
  console.log(`token present (${token.length} chars).\n`);

  console.log(`stable ${STABLE}`);
  const stable = await releaseSpan(token, STABLE);
  console.log(`  ${line(stable)}   (${lagDays(stable.newest)} days behind)\n`);

  console.log(`candidate releases (newest ${CANDIDATES_TO_SURVEY}):`);
  const candidates = await findCandidates(token, { limit: CANDIDATES_TO_SURVEY });
  if (candidates.length === 0) {
    console.log("  none answered — a feed would be stuck on the stable release.");
    process.exit(0);
  }

  const spans = [];
  for (const { version } of candidates) {
    const span = await releaseSpan(token, version);
    spans.push({ version, ...span });
    console.log(`  ${version.padEnd(9)} ${line(span)}   (${lagDays(span.newest)} days behind)`);
  }
  const union = spans.reduce((sum, s) => sum + s.total, 0);
  console.log(`  → ${union.toLocaleString()} events across ${spans.length} releases, back to ${spans.at(-1).oldest ?? "?"}`);

  // Geoprecision decides whether clustering produces corridors or fictions.
  const newest = spans[0].version;
  console.log(`\ngeoprecision in ${newest}:`);
  const sample = await fetchGedPage(token, newest, { pagesize: 1000, page: 0 });
  const rows = sample.Result ?? [];
  const byPrecision = {};
  for (const event of rows) byPrecision[event.where_prec] = (byPrecision[event.where_prec] ?? 0) + 1;
  for (const [prec, count] of Object.entries(byPrecision).sort()) {
    const share = ((count / rows.length) * 100).toFixed(0);
    console.log(`  ${prec} ${String(PRECISION[prec] ?? "?").padEnd(28)} ${String(count).padStart(5)}  ${share}%`);
  }
  const usable = rows.filter((e) => Number(e.where_prec) <= 3).length;
  console.log(`  usable for routing (precision 1-3): ${usable}/${rows.length}`);

  console.log(`\nsample of ${newest}:`);
  for (const event of rows.slice(0, 5)) {
    console.log(
      `  ${event.date_start}  p${event.where_prec}  ${String(event.country).padEnd(16)} ` +
        `@${Number(event.latitude).toFixed(2)},${Number(event.longitude).toFixed(2)}  best=${event.best}  ` +
        `${String(event.where_coordinates ?? "").slice(0, 30)}`,
    );
  }

  console.log("\nToken works. Nothing was written.");
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}
