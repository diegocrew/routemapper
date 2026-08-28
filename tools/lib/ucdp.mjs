/**
 * UCDP Georeferenced Event Dataset access.
 *
 * Free of charge — the token exists to protect service stability rather than to
 * gate the data — but the quota is 5,000 requests a day and *every* paginated
 * request counts, including ones that return errors. That clause shapes this
 * client: pages are large, refusals are never retried (fetchWithRetry already
 * stops on 4xx), and nothing polls speculatively.
 *
 * Two flavours of the same dataset matter here:
 *
 *   stable    e.g. "26.1"   — the annual release, complete but a year behind
 *   candidate e.g. "26.0.7" — monthly, roughly a month behind
 *
 * Candidate is the only one recent enough to describe a corridor's current
 * state, and its version string moves every month, so nothing should hardcode
 * one — see findLatestCandidate().
 */
import { fetchJson } from "./http.mjs";

const API = "https://ucdpapi.pcr.uu.se/api";

export const ucdpToken = () => process.env.UCDP_TOKEN || null;

/**
 * One page of events. Returns UCDP's envelope as-is: `TotalCount`,
 * `TotalPages`, `NextPageUrl`, `PreviousPageUrl`, `Result`.
 */
export async function fetchGedPage(token, version, { pagesize = 1000, page = 0, ...filters } = {}) {
  const query = new URLSearchParams({ ...filters, pagesize: String(pagesize), page: String(page) });
  return fetchJson(`${API}/gedevents/${version}?${query}`, {
    attempts: 2,
    headers: { "x-ucdp-access-token": token },
  });
}

/**
 * Walks every page of a query. `maxPages` is a quota guard rather than a
 * correctness one: without it a bad filter could spend the day's budget in a
 * loop, and the caller would rather see a truncation warning than a 429.
 */
export async function readGedEvents(token, version, filters, { pagesize = 1000, maxPages = 20 } = {}) {
  const events = [];
  let requests = 0;
  let truncated = false;

  for (let page = 0; page < maxPages; page++) {
    const body = await fetchGedPage(token, version, { ...filters, pagesize, page });
    requests++;
    events.push(...(body.Result ?? []));
    if (page + 1 >= (body.TotalPages ?? 1)) break;
    if (page + 1 === maxPages) truncated = true;
  }
  return { events, requests, truncated };
}

/**
 * The newest candidate release that answers, tried newest-first.
 *
 * UCDP publishes candidate data monthly as a new version string, so a
 * hardcoded one quietly goes stale and starts serving month-old data forever.
 * Probing costs one request per miss — negligible against 5,000/day, and far
 * cheaper than not noticing. Returns null when none of them answer.
 */
export async function findLatestCandidate(token, { year = new Date().getUTCFullYear() % 100, month = new Date().getUTCMonth() + 1 } = {}) {
  const candidates = [];
  // Walk back through this year's monthly releases, then last year's tail.
  for (let m = month; m >= 1; m--) candidates.push(`${year}.0.${m}`);
  for (let m = 12; m >= month; m--) candidates.push(`${year - 1}.0.${m}`);

  for (const version of candidates) {
    try {
      const body = await fetchGedPage(token, version, { pagesize: 1, page: 0 });
      if (Array.isArray(body.Result)) return { version, totalCount: body.TotalCount };
    } catch {
      // A version that does not exist 404s; that is the probe working, not failing.
    }
  }
  return null;
}
