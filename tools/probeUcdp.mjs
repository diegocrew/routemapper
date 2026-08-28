/**
 * One-shot check that the UCDP token works, and a survey of what it reaches.
 * Writes nothing.
 *
 * Beyond "does the token authenticate", this answers the question that decides
 * whether a conflict layer is worth building on UCDP at all: how fresh is the
 * newest data actually available? The stable release is a year behind, the
 * candidate releases about a month, and the difference is what separates a live
 * disruption layer from a historical one.
 *
 * Costs on the order of a dozen requests against a 5,000/day quota.
 *
 * Usage: npm run probe:ucdp
 *        UCDP_TOKEN comes from .env (gitignored) or the environment.
 */
import { loadLocalEnv } from "./lib/env.mjs";
import { fetchGedPage, findLatestCandidate, ucdpToken } from "./lib/ucdp.mjs";

loadLocalEnv();

const token = ucdpToken();
if (!token) {
  console.error("Set UCDP_TOKEN, in .env or the environment (CI reads it from the UCDP secret).");
  process.exit(1);
}

const STABLE = "26.1";
const isoDay = (date) => date.toISOString().slice(0, 10);
const daysAgo = (n) => isoDay(new Date(Date.now() - n * 24 * 3600 * 1000));

/** Newest event in a release, which is the only honest measure of its lag. */
async function newestEvent(version) {
  const body = await fetchGedPage(token, version, { pagesize: 1, page: 0 });
  const total = body.TotalCount ?? 0;
  if (total === 0) return { total, latest: null };
  // The last page holds the highest ids, which track recency closely enough.
  const lastPage = Math.max(0, (body.TotalPages ?? 1) - 1);
  const tail = await fetchGedPage(token, version, { pagesize: 1, page: lastPage });
  const event = tail.Result?.[0];
  return { total, latest: event ? event.date_end ?? event.date_start : null };
}

try {
  console.log(`token present (${token.length} chars). Checking stable release ${STABLE}…`);
  const stable = await newestEvent(STABLE);
  console.log(`  ${STABLE}: ${stable.total.toLocaleString()} events, newest ${stable.latest ?? "unknown"}`);

  console.log("\nLooking for the newest candidate release…");
  const candidate = await findLatestCandidate(token);
  if (!candidate) {
    console.log("  none answered — the feed would have to fall back to the stable release.");
  } else {
    const fresh = await newestEvent(candidate.version);
    console.log(`  ${candidate.version}: ${fresh.total.toLocaleString()} events, newest ${fresh.latest ?? "unknown"}`);
    if (fresh.latest) {
      const lagDays = Math.round((Date.now() - Date.parse(fresh.latest)) / (24 * 3600 * 1000));
      console.log(`  lag: ${lagDays} days behind today`);
    }
  }

  // A window query is what the real feed would issue, so it is worth proving
  // the filter names work rather than assuming them.
  const version = candidate?.version ?? STABLE;
  const from = daysAgo(90);
  console.log(`\nSample window on ${version}: StartDate=${from} EndDate=${daysAgo(0)}`);
  const window = await fetchGedPage(token, version, {
    pagesize: 5,
    page: 0,
    StartDate: from,
    EndDate: daysAgo(0),
  });
  console.log(`  ${(window.TotalCount ?? 0).toLocaleString()} events in ${window.TotalPages ?? 0} page(s)`);
  for (const event of window.Result ?? []) {
    console.log(
      `    ${event.date_start}  ${String(event.country).padEnd(18)} ` +
        `${String(event.conflict_name ?? "").slice(0, 34).padEnd(34)} ` +
        `@${Number(event.latitude).toFixed(2)},${Number(event.longitude).toFixed(2)}  best=${event.best}`,
    );
  }
  if ((window.TotalCount ?? 0) === 0) {
    console.log("    (none — the token works, but this window is empty: check StartDate/EndDate handling)");
  }

  console.log("\nToken works. Nothing was written.");
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}
