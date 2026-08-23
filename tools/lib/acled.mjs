/**
 * ACLED access: OAuth token, then paged event reads.
 *
 * ACLED issues three things and it is easy to reach for the wrong one:
 *
 *   email + password   only ever sent to /oauth/token with grant_type=password
 *   access_token       every data request, as `Authorization: Bearer <token>`
 *   refresh_token      only ever sent to /oauth/token with grant_type=refresh_token
 *
 * The refresh token is deliberately unused here. It exists so a long-lived
 * client can avoid re-sending a password, but this runs as a scheduled job
 * every few hours with nowhere durable to keep a rotating secret — persisting
 * it would mean committing it or writing back a repo secret, both worse than
 * the thing it avoids. An access token lasts 24 h, far longer than one run, so
 * each run just mints a fresh one and throws it away.
 */
import { fetchJson } from "./http.mjs";

const TOKEN_URL = "https://acleddata.com/oauth/token";
const READ_URL = "https://acleddata.com/api/acled/read";

/** ACLED's own fixed values for a password grant — not per-account settings. */
const CLIENT_ID = "acled";
const SCOPE = "authenticated";

export function acledCredentials() {
  const username = process.env.ACLED_USERNAME;
  const password = process.env.ACLED_PASSWORD;
  return username && password ? { username, password } : null;
}

export async function fetchAccessToken({ username, password }) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, grant_type: "password", client_id: CLIENT_ID, scope: SCOPE }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // invalid_grant here is about the email/password pair, not any token. The
    // usual cause is an account created through Google SSO, which never got a
    // local password for this grant to check: set one at
    // https://acleddata.com/user/password using the same address, and SSO keeps
    // working alongside it.
    throw new Error(`ACLED token request failed (${response.status}): ${body.error_description ?? body.error ?? "unknown"}`);
  }
  if (!body.access_token) throw new Error("ACLED token response contained no access_token");
  return body.access_token;
}

/**
 * One page of events. `filters` are ACLED's own query parameters — `country`,
 * `event_date`, `event_type`, `fields` and so on. Several values of one field
 * are OR-ed with `|`; a comparison other than the default `=` needs a
 * companion `<field>_where` (`BETWEEN`, `>`, `<`, `LIKE`).
 *
 * Note: ACLED has announced that offset pagination (`page`) is deprecated from
 * 1 October 2026 in favour of cursor-based paging, so this will need revisiting.
 */
export async function readEvents(token, filters, { limit = 5000, page = 1 } = {}) {
  const query = new URLSearchParams({ ...filters, _format: "json", limit: String(limit), page: String(page) });
  const data = await fetchJson(`${READ_URL}?${query}`, {
    attempts: 2,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (data.error) throw new Error(`ACLED read failed: ${JSON.stringify(data.error)}`);
  return data.data ?? [];
}
