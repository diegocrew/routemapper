/**
 * Loads .env for local runs, if there is one.
 *
 * The fetch tools read their credentials from process.env because that is what
 * GitHub Actions supplies from repository secrets. Locally there is no such
 * mechanism, and putting keys on the command line leaves them in shell history,
 * so a gitignored .env fills the same slots.
 *
 * In CI the file simply isn't there and this is a no-op — the secrets are
 * already in the environment, and nothing here can overwrite them.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env");

export function loadLocalEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  process.loadEnvFile(ENV_FILE);
  // Blank placeholders are how .env ships, and an empty string is not the same
  // as unset: it would satisfy a truthiness check and send an empty password.
  for (const [key, value] of Object.entries(process.env)) {
    if (value === "") delete process.env[key];
  }
}
