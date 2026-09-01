/**
 * Every upstream here is a free public endpoint, and several of them
 * (GDELT especially) rate-limit or drop connections without warning. One
 * fetch helper so each collector gets the same timeout and backoff instead of
 * inventing its own.
 */
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchWithRetry(url, { timeoutMs = DEFAULT_TIMEOUT_MS, attempts = DEFAULT_ATTEMPTS, headers } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": "routemapper/1.0 (+https://github.com/diegocrew/routemapper)", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await sleep(attempt * 5000);
      continue;
    }
    if (response.ok) return response;

    // These upstreams nearly always explain a refusal in the body, and throwing
    // it away leaves a bare status code that several different causes share —
    // "403 Forbidden" reads the same whether credentials never arrived, or
    // arrived and bought nothing.
    const detail = (await response.text().catch(() => "")).trim().slice(0, 300);
    lastError = new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`);

    // A refusal is a refusal. Only rate limits and server faults change their
    // mind on a second ask; retrying a 401/403/404 just delays the error.
    if (response.status !== 429 && response.status < 500) break;
    if (attempt < attempts) await sleep(attempt * 5000);
  }
  throw lastError ?? new Error("request failed");
}

export async function fetchJson(url, options) {
  return (await fetchWithRetry(url, options)).json();
}

export async function fetchText(url, options) {
  return (await fetchWithRetry(url, options)).text();
}
