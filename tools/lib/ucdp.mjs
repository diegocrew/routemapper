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
 * Candidate release version strings, newest first, as they would be named.
 *
 * UCDP publishes candidate data monthly under a new version, so a hardcoded one
 * quietly goes stale and serves month-old data forever. These are probed rather
 * than assumed; a miss 404s, which costs one request out of 5,000.
 */
export function candidateVersions({
  year = new Date().getUTCFullYear() % 100,
  month = new Date().getUTCMonth() + 1,
} = {}) {
  const versions = [];
  for (let m = month; m >= 1; m--) versions.push(`${year}.0.${m}`);
  for (let m = 12; m >= 1; m--) versions.push(`${year - 1}.0.${m}`);
  return versions;
}

/** The candidate releases that actually answer, newest first, at most `limit`. */
export async function findCandidates(token, { limit = 1, ...options } = {}) {
  const found = [];
  for (const version of candidateVersions(options)) {
    if (found.length >= limit) break;
    try {
      const body = await fetchGedPage(token, version, { pagesize: 1, page: 0 });
      if (Array.isArray(body.Result)) found.push({ version, totalCount: body.TotalCount ?? 0 });
    } catch {
      // A version that does not exist 404s: that is the probe working, not failing.
    }
  }
  return found;
}

/**
 * What a release actually covers. Results come back in id order, which tracks
 * ingestion and therefore date closely enough for this — so the first row of
 * the first page and the first row of the last page bracket the release.
 */
export async function releaseSpan(token, version) {
  const head = await fetchGedPage(token, version, { pagesize: 1, page: 0 });
  const total = head.TotalCount ?? 0;
  if (total === 0) return { total, oldest: null, newest: null };
  const tail = await fetchGedPage(token, version, { pagesize: 1, page: Math.max(0, (head.TotalPages ?? 1) - 1) });
  const dateOf = (event) => (event ? (event.date_end ?? event.date_start) : null);
  return { total, oldest: dateOf(head.Result?.[0]), newest: dateOf(tail.Result?.[0]) };
}
