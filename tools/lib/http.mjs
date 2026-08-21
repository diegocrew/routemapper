/**
 * Every upstream here is a free public endpoint, and several of them
 * (GDELT especially) rate-limit or drop connections without warning. One
 * fetch helper so each collector gets the same timeout and backoff instead of
 * inventing its own.
 */
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_ATTEMPTS = 3;

export async function fetchWithRetry(url, { timeoutMs = DEFAULT_TIMEOUT_MS, attempts = DEFAULT_ATTEMPTS, headers } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "routemapper/1.0 (+https://github.com/diegocrew/routemapper)", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return response;
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
  }
  throw lastError ?? new Error("request failed");
}

export async function fetchJson(url, options) {
  return (await fetchWithRetry(url, options)).json();
}

export async function fetchText(url, options) {
  return (await fetchWithRetry(url, options)).text();
}
