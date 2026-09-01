/**
 * Refreshes src/data/conflictZones.json and conflictEdgeZones.json: armed
 * conflict as "hazard" zones, in the same shape as the natural hazards, but on
 * its own schedule and in its own files.
 *
 * Split out from fetchHazards.mjs for two reasons. The first is cadence: a
 * cyclone track is stale within hours, whereas UCDP publishes monthly and lands
 * about four weeks after the month it covers, so fetching it six times a day
 * would spend requests to rewrite an identical file. Once a day is already
 * thirty times more often than the data changes.
 *
 * The second is that both pipelines rewrite their zone file wholesale. Sharing
 * one file would mean whichever ran last erased the other's zones, and the two
 * schedules would take turns deleting each other's work.
 *
 * Usage: node tools/fetchConflict.mjs [--retag]
 *        --retag re-tags the committed zones without calling any API, needed
 *        after nodes or edges change since stale leg keys fail validation.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalEnv } from "./lib/env.mjs";
import { tagEdgesWithZones } from "./lib/tagEdges.mjs";
import { fetchUcdpConflictZones } from "./feeds/ucdp.mjs";

loadLocalEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, "src/data", file), "utf8"));
const write = (file, data) =>
  fs.writeFileSync(path.join(ROOT, "src/data", file), `${JSON.stringify(data, null, 2)}\n`, "utf8");
/** One record per line: compact, but still a line-per-zone diff when the bot refreshes it. */
const writeCompactList = (file, list) =>
  fs.writeFileSync(
    path.join(ROOT, "src/data", file),
    list.length === 0 ? "[]\n" : `[\n${list.map((item) => JSON.stringify(item)).join(",\n")}\n]\n`,
    "utf8",
  );

const retagOnly = process.argv.includes("--retag");

let conflictZones;
if (retagOnly) {
  conflictZones = read("conflictZones.json");
  console.log(`Re-tagging ${conflictZones.length} committed conflict zones without fetching.`);
} else {
  try {
    conflictZones = await fetchUcdpConflictZones();
  } catch (error) {
    // Keeping yesterday's zones beats publishing none: the data describes wars
    // that are still going on, and a provider having a bad morning is not
    // evidence that they stopped.
    console.error(`conflict fetch failed, keeping the committed zones: ${error.message}`);
    process.exit(0);
  }
  if (conflictZones.length === 0) {
    console.error("No conflict zones returned — keeping the committed file rather than emptying it.");
    process.exit(0);
  }
  conflictZones.sort((a, b) => a.id.localeCompare(b.id));
  writeCompactList("conflictZones.json", conflictZones);
  console.log(`Conflict zones: ${conflictZones.length}.`);
}

const conflictEdgeZones = tagEdgesWithZones(ROOT, conflictZones);
write("conflictEdgeZones.json", conflictEdgeZones);
console.log(`Tagged ${Object.keys(conflictEdgeZones).length} legs.`);
