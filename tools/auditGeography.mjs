/**
 * Geography audit: flags sea/rail/truck legs that cross the wrong medium.
 *
 * Usage: node tools/auditGeography.mjs [path-to-ne_10m_land.geojson]
 */
import nodes from "../src/data/nodes.json" with { type: "json" };
import edges from "../src/data/edges.json" with { type: "json" };
import seaEdgeData from "../src/data/seaEdges.json" with { type: "json" };
import truckEdgeData from "../src/data/truckEdges.json" with { type: "json" };
import {
  buildLandGrid,
  buildWaterGrid,
  cellOf,
  ensureLakesGeojson,
  ensureLandGeojson,
  ensureRiversGeojson,
  exactLandTest,
  haversineKm,
  isLandCell,
  mercatorPoint,
} from "./landGrid.mjs";

const landPath = await ensureLandGeojson(process.argv[2]);
const isLand = exactLandTest(landPath);
// Ships also use rivers, lakes and canals, which coastline polygons call land.
const water = buildWaterGrid(
  buildLandGrid(landPath),
  await ensureRiversGeojson(process.argv[3]),
  await ensureLakesGeojson(process.argv[4]),
);
const isNavigable = (lon, lat) => {
  const { x, y } = cellOf(lon, lat);
  return isLandCell(water, x, y);
};

// --- path sampling ---------------------------------------------------------
const STEP_KM = 5;

/** Walk a polyline and return the longest contiguous run where `isBad` holds. */
function longestRun(points, isBad) {
  let best = { km: 0, from: null, to: null };
  let cur = { km: 0, from: null, at: null };

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segKm = haversineKm(a, b);
    const steps = Math.max(1, Math.ceil(segKm / STEP_KM));
    for (let s = 1; s <= steps; s++) {
      const p = mercatorPoint(a, b, s / steps);
      if (isBad(p.lon, p.lat)) {
        if (cur.from === null) cur.from = p;
        cur.km += segKm / steps;
        cur.at = p;
        if (cur.km > best.km) best = { km: cur.km, from: cur.from, to: cur.at };
      } else {
        cur = { km: 0, from: null, at: null };
      }
    }
  }
  return best;
}

/** Length of the contiguous run at the start of the polyline where `isBad` holds. */
function leadingRunKm(points, isBad) {
  let km = 0;
  if (!isBad(points[0].lon, points[0].lat)) return 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segKm = haversineKm(a, b);
    const steps = Math.max(1, Math.ceil(segKm / STEP_KM));
    for (let s = 1; s <= steps; s++) {
      const p = mercatorPoint(a, b, s / steps);
      if (!isBad(p.lon, p.lat)) return km;
      km += segKm / steps;
    }
  }
  return km;
}

const offWater = (lon, lat) => !isNavigable(lon, lat);
const offLand = (lon, lat) => !isLand(lon, lat);

const fmt = (p) => (p ? `${p.lat.toFixed(2)},${p.lon.toFixed(2)}` : "-");

// --- inputs ----------------------------------------------------------------
const nodeById = new Map(nodes.map((n) => [n.id, n]));
const seaEdges = [...edges.filter((e) => e.mode === "sea"), ...seaEdgeData.map((e) => ({ ...e, mode: "sea" }))];
const railEdges = edges.filter((e) => e.mode === "rail");

function truckEdges() {
  return truckEdgeData.map((e) => ({ ...e, mode: "truck" }));
}

function edgePoints(e) {
  const a = nodeById.get(e.from);
  const b = nodeById.get(e.to);
  if (!a || !b) return null;
  return [
    { lat: a.lat, lon: a.lon },
    ...(e.via ?? []).map(([lon, lat]) => ({ lat, lon })),
    { lat: b.lat, lon: b.lon },
  ];
}

// --- reports ---------------------------------------------------------------
const LAND_TOLERANCE_KM = 25; // ports sit on the coast; short overlaps are map resolution, not bugs
const WATER_TOLERANCE_KM = 25; // ferries / short bridges are plausible for road & rail

console.log(`nodes=${nodes.length} sea=${seaEdges.length} rail=${railEdges.length}`);

console.log("\n=== SEA EDGES LEAVING NAVIGABLE WATER ===");
const seaBad = [];
for (const e of seaEdges) {
  const pts = edgePoints(e);
  if (!pts) {
    seaBad.push({ e, km: Infinity, note: "unknown node id" });
    continue;
  }
  const run = longestRun(pts, offWater);
  if (run.km > LAND_TOLERANCE_KM) seaBad.push({ e, km: run.km, at: `${fmt(run.from)} -> ${fmt(run.to)}` });
}
seaBad.sort((a, b) => b.km - a.km);
for (const r of seaBad) console.log(`  ${r.km.toFixed(0).padStart(5)} km overland  ${r.e.from} -> ${r.e.to}   [${r.at ?? r.note}]`);
console.log(`  (${seaBad.length}/${seaEdges.length} sea edges leave navigable water for >${LAND_TOLERANCE_KM} km)`);

console.log("\n=== SEA EDGES WITH NO ROUTED GEOMETRY ===");
for (const e of seaEdges.filter((e) => !e.via?.length)) console.log(`  ${e.from} -> ${e.to}`);

console.log("\n=== SEA EDGE ENDPOINTS THAT ARE LANDLOCKED (route starts overland) ===");
const inland = new Map();
for (const e of seaEdges) {
  const pts = edgePoints(e);
  if (!pts) continue;
  const head = leadingRunKm(pts, offWater);
  const tail = leadingRunKm([...pts].reverse(), offWater);
  if (head > LAND_TOLERANCE_KM) inland.set(e.from, Math.max(inland.get(e.from) ?? 0, head));
  if (tail > LAND_TOLERANCE_KM) inland.set(e.to, Math.max(inland.get(e.to) ?? 0, tail));
}
for (const [id, km] of [...inland].sort((a, b) => b[1] - a[1])) {
  const n = nodeById.get(id);
  console.log(`  ${km.toFixed(0).padStart(5)} km overland from ${id} (${n.name}, ${n.country}, kind=${n.kind})`);
}

console.log("\n=== SEA POLYLINE GAPS (>300 km between consecutive points) ===");
for (const e of seaEdges) {
  const pts = edgePoints(e);
  if (!pts) continue;
  for (let i = 0; i < pts.length - 1; i++) {
    const km = haversineKm(pts[i], pts[i + 1]);
    if (km > 300) console.log(`  ${km.toFixed(0).padStart(5)} km  ${e.from} -> ${e.to}  @${fmt(pts[i])} -> ${fmt(pts[i + 1])}`);
  }
}

console.log("\n=== ANTIMERIDIAN JUMPS (renders as a line across the whole map) ===");
for (const e of [...edges, ...seaEdgeData.map((e) => ({ ...e, mode: "sea" }))]) {
  const pts = edgePoints(e);
  if (!pts) continue;
  for (let i = 0; i < pts.length - 1; i++) {
    if (Math.abs(pts[i].lon - pts[i + 1].lon) > 180) {
      console.log(`  ${e.mode} ${e.from} -> ${e.to}  @${fmt(pts[i])} -> ${fmt(pts[i + 1])}`);
    }
  }
}

console.log("\n=== RAIL EDGES CROSSING WATER ===");
const railBad = [];
for (const e of railEdges) {
  const pts = edgePoints(e);
  if (!pts) continue;
  const run = longestRun(pts, offLand);
  if (run.km > WATER_TOLERANCE_KM) railBad.push({ e, km: run.km, at: `${fmt(run.from)} -> ${fmt(run.to)}` });
}
railBad.sort((a, b) => b.km - a.km);
for (const r of railBad) console.log(`  ${r.km.toFixed(0).padStart(5)} km water  ${r.e.from} -> ${r.e.to}   [${r.at}]`);
console.log(`  (${railBad.length}/${railEdges.length} rail edges cross >${WATER_TOLERANCE_KM} km of water)`);

console.log("\n=== TRUCK EDGES CROSSING WATER ===");
const trucks = truckEdges();
const truckBad = [];
for (const e of trucks) {
  const pts = edgePoints(e);
  if (!pts) continue;
  const run = longestRun(pts, offLand);
  if (run.km > WATER_TOLERANCE_KM) truckBad.push({ e, km: run.km, at: `${fmt(run.from)} -> ${fmt(run.to)}` });
}
truckBad.sort((a, b) => b.km - a.km);
for (const r of truckBad) console.log(`  ${r.km.toFixed(0).padStart(5)} km water  ${r.e.from} -> ${r.e.to}   [${r.at}]`);
console.log(`  (${truckBad.length}/${trucks.length} generated truck edges cross >${WATER_TOLERANCE_KM} km of water)`);

console.log("\n=== SEAPORTS WITH NO WATER NEARBY ===");
for (const n of nodes) {
  if (n.kind !== "seaport") continue;
  if (!isNavigable(n.lon, n.lat)) console.log(`  ${n.id} (${n.name}) is a seaport but sits away from navigable water`);
}
