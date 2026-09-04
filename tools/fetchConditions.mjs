/**
 * Refreshes src/data/zoneConditions.json: how the corridors in zones.json are
 * running right now, as opposed to how they usually run.
 *
 * The zones themselves are static — a chokepoint's toll, a river's usual
 * seasonal low. This is the measured overlay: Suez transits against Suez's own
 * baseline, Danube gauges against their own long-run statistics. Nothing here
 * creates or closes a zone; it only makes crossing one slower, which is why a
 * failed fetch costs accuracy rather than correctness.
 *
 * Its own pipeline because of cadence. PortWatch republishes weekly and the
 * river gauges every fifteen minutes, so daily sits sensibly between the two:
 * often enough to catch a river dropping, rare enough not to hammer a weekly
 * dataset. Natural hazards need six-hourly and conflict needs monthly; this
 * belongs with neither.
 *
 * Usage: node tools/fetchConditions.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalEnv } from "./lib/env.mjs";
import { fetchChokepointConditions } from "./feeds/portwatch.mjs";
import { fetchWaterLevelConditions } from "./feeds/waterLevels.mjs";

loadLocalEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, "src/data", file), "utf8"));

const results = await Promise.all([
  fetchChokepointConditions().catch((error) => {
    console.error(`chokepoint conditions failed: ${error.message}`);
    return [];
  }),
  fetchWaterLevelConditions().catch((error) => {
    console.error(`water level conditions failed: ${error.message}`);
    return [];
  }),
]);

// A condition on a zone that does not exist can never apply, and would fail
// validation later with a much less obvious message than this one.
const zoneIds = new Set(read("zones.json").map((z) => z.id));
const conditions = results.flat().filter((c) => {
  if (zoneIds.has(c.zoneId)) return true;
  console.error(`dropping condition for unknown zone ${c.zoneId}`);
  return false;
});

conditions.sort((a, b) => a.zoneId.localeCompare(b.zoneId));
fs.writeFileSync(
  path.join(ROOT, "src/data/zoneConditions.json"),
  conditions.length === 0 ? "[]\n" : `[\n${conditions.map((c) => JSON.stringify(c)).join(",\n")}\n]\n`,
  "utf8",
);

for (const c of conditions) console.log(`  x${c.delayFactor.toFixed(2)}  ${c.label}`);
console.log(`\n${conditions.length} zone(s) not running normally.`);
