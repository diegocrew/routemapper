/**
 * Pulls live natural hazards into temporary "hazard" zones in the same shape
 * as src/data/zones.json, then tags which curated/truck legs cross them. Each
 * source lives in tools/feeds/ and is keyless except FIRMS.
 *
 * Run on a schedule by .github/workflows/hazards.yml — each run re-fetches the
 * current upstream window and overwrites the output files wholesale, so an
 * event "expires" simply by aging out of its source's own time bucket; there
 * is no separate delete/expiry step. src/data/hazardHistory.json keeps a
 * compact trace of what each run saw, since the live files are overwritten.
 *
 * Usage: node tools/fetchHazards.mjs [--retag]
 *        --retag re-tags which legs cross the already-committed hazard zones
 *        without calling any API — needed after nodes or edges change, since
 *        stale leg keys fail validation.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createZoneGrid, zonesOnEdge } from "./lib/geo.mjs";
import { readNodes } from "./lib/nodes.mjs";
import { fetchEarthquakeZones } from "./feeds/usgs.mjs";
import { fetchWildfireZones } from "./feeds/firms.mjs";
import { fetchGdacsZones } from "./feeds/gdacs.mjs";
import { fetchStormZones } from "./feeds/nhc.mjs";
import { fetchNavWarningZones } from "./feeds/nga.mjs";

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
  ["earthquake", fetchEarthquakeZones],
  ["wildfire", fetchWildfireZones],
  ["GDACS", fetchGdacsZones],
  ["storm", fetchStormZones],
  ["nav warning", fetchNavWarningZones],
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
  const results = await Promise.all(
    SOURCES.map(([name, fetchZones]) =>
      fetchZones().catch((err) => {
        // One dead upstream must not wipe the other sources' zones for this run.
        console.error(`${name} fetch failed, keeping no ${name} zones this run: ${err.message}`);
        return [];
      }),
    ),
  );
  hazardZones = results.flat().sort((a, b) => a.id.localeCompare(b.id));
  writeCompactList("hazardZones.json", hazardZones);

  const counts = {};
  for (const zone of hazardZones) counts[zone.hazardKind] = (counts[zone.hazardKind] ?? 0) + 1;
  console.log(`Hazard zones: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ")}.`);

  appendHistory(hazardZones, counts);
}

const nodes = readNodes(ROOT);
const edges = read("edges.json");
const seaEdges = read("seaEdges.json");
const truckEdges = read("truckEdges.json");
const nodeById = new Map(nodes.map((n) => [n.id, n]));
const grid = createZoneGrid(hazardZones);

const hazardEdgeZones = {};
const tagList = (list, fallbackMode) => {
  for (const edge of list) {
    const mode = edge.mode ?? fallbackMode;
    const hit = zonesOnEdge(edge, mode, hazardZones, nodeById, { grid });
    if (hit) hazardEdgeZones[`${edge.from}|${edge.to}|${mode}`] = hit;
  }
};
tagList(edges);
tagList(seaEdges, "sea");
tagList(truckEdges, "truck");
write("hazardEdgeZones.json", hazardEdgeZones);

console.log(`Tagged ${Object.keys(hazardEdgeZones).length} legs.`);
