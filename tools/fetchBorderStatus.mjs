/**
 * Refreshes src/data/borderStatus.json: land borders that are currently slow or
 * disrupted, as opposed to the ones closed by policy in restrictions.json.
 *
 * The split matters. restrictions.json is hand-curated and *blocks* a border —
 * a standing political fact that someone decided to record. Everything here is
 * fetched, provisional, and only ever adds delay and a warning. A feed cannot
 * be allowed to delete a corridor: a noisy week of reporting would silently
 * reroute the world, and nothing in these sources says "reopened" as reliably
 * as it says "closed".
 *
 * Sources fail soft and independently: a border with no data is simply a border
 * with no entry, which is also what an untroubled border looks like.
 *
 * Usage: node tools/fetchBorderStatus.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalEnv } from "./lib/env.mjs";
import { fetchBorderWaits } from "./feeds/cbp.mjs";
import { fetchReportedClosures } from "./feeds/reliefweb.mjs";
import { readNodes } from "./lib/nodes.mjs";

loadLocalEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src/data/borderStatus.json");

const detectedAt = new Date().toISOString();
const results = await Promise.all([fetchBorderWaits(), fetchReportedClosures()]);
const entries = results.flat().map((entry) => ({ ...entry, detectedAt }));

// A rule naming a country with no nodes can never match a leg, so it is dead
// weight in the bundle rather than a silent no-op waiting to be noticed.
const countries = new Set(readNodes(ROOT).map((n) => n.country));
const usable = entries.filter((entry) => {
  const known = entry.countries.every((country) => countries.has(country));
  if (!known) console.error(`dropping ${entry.id}: names a country with no nodes (${entry.countries.join(", ")})`);
  return known;
});

usable.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(OUT, usable.length === 0 ? "[]\n" : `[\n${usable.map((e) => JSON.stringify(e)).join(",\n")}\n]\n`, "utf8");

for (const entry of usable) console.log(`${entry.delayHours.toString().padStart(5)} h  ${entry.label}`);
console.log(`\n${usable.length} border(s) reporting disruption.`);
