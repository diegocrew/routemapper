/**
 * Pulls live natural hazards into temporary "hazard" zones in the same shape
 * as src/data/zones.json, then tags which curated/sea/truck legs cross them.
 * Each source lives in tools/feeds/; all are keyless except FIRMS.
 * Air legs are generated at runtime and are not tagged here — the air side of a
 * hazard is handled as restricted airspace in src/data/airspace.json instead.
 *
 * Armed conflict is deliberately *not* here. It moves monthly rather than
 * hourly, so it runs on its own daily schedule in tools/fetchConflict.mjs and
 * writes its own files — this one rewrites hazardZones.json wholesale on every
 * run, and two pipelines sharing that file would overwrite each other's work.
 *
 * Run on a schedule by .github/workflows/hazards.yml. Successful sources
 * replace their observations; failed sources retain bounded last-known data.
 * feedStatus.json reports freshness, and hazardHistory.json keeps a compact
 * trace of each run. Retention and expiry live in lib/refreshSource.mjs.
 *
 * Usage: node tools/fetchHazards.mjs [--retag]
 *        --retag re-tags which legs cross the already-committed hazard zones
 *        without calling any API — needed after nodes or edges change, since
 *        stale leg keys fail validation.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalEnv } from "./lib/env.mjs";
import { tagEdgesWithZones } from "./lib/tagEdges.mjs";
import { fetchEarthquakeZones } from "./feeds/usgs.mjs";
import { fetchWildfireZones } from "./feeds/firms.mjs";
import { fetchGdacsZones } from "./feeds/gdacs.mjs";
import { fetchStormZones } from "./feeds/nhc.mjs";
import { fetchNavWarningZones } from "./feeds/nga.mjs";
import { refreshSource } from "./lib/refreshSource.mjs";

loadLocalEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, "src/data", file), "utf8"));
const write = (file, data) =>
  fs.writeFileSync(path.join(ROOT, "src/data", file), `${JSON.stringify(data, null, 2)}\n`, "utf8");

// Thousands of hazard zones at two-space indentation is tens of MB of JSON
// shipped in the app bundle, so these are written one record per line instead:
// compact, but still a line-per-hazard diff when the bot refreshes them.
const writeCompactList = (file, list) =>
  fs.writeFileSync(
    path.join(ROOT, "src/data", file),
    list.length === 0 ? "[]\n" : `[\n${list.map((item) => JSON.stringify(item)).join(",\n")}\n]\n`,
    "utf8",
  );

const SOURCES = [
  ["usgs", "USGS", "quake_", fetchEarthquakeZones],
  ["firms", "NASA FIRMS", "fire_", fetchWildfireZones],
  ["gdacs", "GDACS", "gdacs_", fetchGdacsZones],
  ["nhc", "NOAA NHC", "storm_", fetchStormZones],
  ["nga", "NGA", "navwarn_", fetchNavWarningZones],
];

// --- History ------------------------------------------------------------------

// Each run overwrites the live files, so without this the past is simply gone.
// One compact row per run keeps a trace of what the world looked like — enough
// to answer "how often is this corridor disrupted in August" once a season of
// rows has accumulated, without retaining thousands of wildfire footprints.
const HISTORY_FILE = "hazardHistory.json";
const HISTORY_MAX_ROWS = 1460; // ~1 year at the 4-runs-a-day schedule
const HISTORY_NOTABLE_MAX = 40;

function appendHistory(zones, counts) {
  const notable = zones
    .filter((z) => z.hazardKind !== "wildfire")
    .slice(0, HISTORY_NOTABLE_MAX)
    .map((z) => ({ id: z.id, kind: z.hazardKind, label: z.label, center: z.center, radiusKm: z.radiusKm }));

  const file = path.join(ROOT, "src/data", HISTORY_FILE);
  const rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  rows.push({ at: new Date().toISOString(), total: zones.length, counts, notable });

  const trimmed = rows.slice(-HISTORY_MAX_ROWS);
  fs.writeFileSync(file, `[\n${trimmed.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`, "utf8");
  console.log(`History: ${trimmed.length} snapshots retained.`);
}

// --- Main ---------------------------------------------------------------------

const retagOnly = process.argv.includes("--retag");

let hazardZones;
if (retagOnly) {
  hazardZones = read("hazardZones.json");
  console.log(`Re-tagging ${hazardZones.length} committed hazard zones without fetching.`);
} else {
  const previousZones = read("hazardZones.json");
  const previousStatus = read("feedStatus.json");
  const now = new Date().toISOString();
  const results = await Promise.all(
    SOURCES.map(([id, label, prefix, fetchZones]) =>
      refreshSource({
        id, label, prefix, fetchZones, previousZones, now,
        previousStatus: previousStatus.sources.find((source) => source.id === id),
      }),
    ),
  );
  hazardZones = results.flatMap((result) => result.zones).sort((a, b) => a.id.localeCompare(b.id));
  writeCompactList("hazardZones.json", hazardZones);
  write("feedStatus.json", { updatedAt: now, sources: results.map((result) => result.status) });
  for (const { status } of results) {
    console.log(`${status.label}: ${status.status}; ${status.retainedZones} retained zones`);
  }

  const counts = {};
  for (const zone of hazardZones) counts[zone.hazardKind] = (counts[zone.hazardKind] ?? 0) + 1;
  console.log(`Hazard zones: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ")}.`);

  appendHistory(hazardZones, counts);
}

const hazardEdgeZones = tagEdgesWithZones(ROOT, hazardZones);
write("hazardEdgeZones.json", hazardEdgeZones);

console.log(`Tagged ${Object.keys(hazardEdgeZones).length} legs.`);
