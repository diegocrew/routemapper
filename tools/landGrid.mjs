/**
 * Shared land raster + overland path search used by the route generators.
 *
 * Rasterizes Natural Earth land polygons into a 0.1-degree grid, labels
 * connected landmasses, and runs A* over land cells so road/rail legs can be
 * given geometry that stays on land (or be rejected when no land path exists).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;

const LAND_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson";
const RIVERS_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson";
const LAKES_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson";

/** Natural Earth vectors are megabytes each, so they're cached outside the repo rather than committed. */
async function ensureGeojson(name, url, explicitPath) {
  if (explicitPath) return explicitPath;
  const cacheDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/.cache");
  const cached = path.join(cacheDir, name);
  if (fs.existsSync(cached)) return cached;
  console.log(`downloading ${url} …`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not download ${name}: ${response.status}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cached, Buffer.from(await response.arrayBuffer()));
  return cached;
}

export const ensureLandGeojson = (explicitPath) => ensureGeojson("ne_10m_land.geojson", LAND_URL, explicitPath);
export const ensureRiversGeojson = (explicitPath) =>
  ensureGeojson("ne_10m_rivers.geojson", RIVERS_URL, explicitPath);
export const ensureLakesGeojson = (explicitPath) => ensureGeojson("ne_10m_lakes.geojson", LAKES_URL, explicitPath);

export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const RES = 0.1;
const NX = Math.round(360 / RES);
const NY = Math.round(180 / RES);

const wrapX = (x) => ((x % NX) + NX) % NX;
const cellIndex = (x, y) => y * NX + wrapX(x);
export const cellCenter = (x, y) => ({ lon: wrapX(x) * RES - 180 + RES / 2, lat: y * RES - 90 + RES / 2 });
export const cellOf = (lon, lat) => ({
  x: wrapX(Math.floor((((lon + 180) % 360 + 360) % 360) / RES)),
  y: Math.min(NY - 1, Math.max(0, Math.floor((lat + 90) / RES))),
});

/** Scanline-rasterize polygon features: one crossing sweep per grid row. */
function scanlineFill(geojson, setCell) {
  const bands = new Map();
  for (const feature of geojson.features) {
    const polys =
      feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [x1, y1] = ring[i];
          const [x2, y2] = ring[i + 1];
          if (y1 === y2) continue;
          for (let b = Math.floor(Math.min(y1, y2)); b <= Math.floor(Math.max(y1, y2)); b++) {
            if (!bands.has(b)) bands.set(b, []);
            bands.get(b).push([x1, y1, x2, y2]);
          }
        }
      }
    }
  }

  for (let y = 0; y < NY; y++) {
    const lat = y * RES - 90 + RES / 2;
    const segs = bands.get(Math.floor(lat));
    if (!segs) continue;
    const xs = [];
    for (const [x1, y1, x2, y2] of segs) {
      if (y1 > lat === y2 > lat) continue;
      xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      // Only cells whose centre falls inside the span count, so the raster never
      // bulges out over coastal water.
      const from = Math.ceil((xs[i] + 180 - RES / 2) / RES);
      const to = Math.floor((xs[i + 1] + 180 - RES / 2) / RES);
      for (let x = from; x <= to; x++) setCell(wrapX(x), y);
    }
  }
}

export function buildLandGrid(geojsonPath) {
  const grid = new Uint8Array(NX * NY);
  scanlineFill(JSON.parse(fs.readFileSync(geojsonPath, "utf8")), (x, y) => {
    grid[cellIndex(x, y)] = 1;
  });
  return grid;
}

export const isLandCell = (grid, x, y) => y >= 0 && y < NY && grid[cellIndex(x, y)] === 1;

/**
 * Ship-navigable cells: open sea, plus river centrelines and lakes so barge
 * routes up the Rhine, Danube, Mississippi or Amazon have somewhere to go, plus
 * the man-made canals that Natural Earth draws as unbroken land.
 */
export function buildWaterGrid(landGrid, riversPath, lakesPath) {
  const water = new Uint8Array(landGrid.length);
  for (let i = 0; i < landGrid.length; i++) water[i] = landGrid[i] === 1 ? 0 : 1;

  // Inland waterways are drawn as centrelines, so they're widened by a cell:
  // the network stays connected across data gaps, and a curated route within a
  // cell of the centreline still counts as being on the river.
  const inland = new Uint8Array(landGrid.length);
  const mark = (lon, lat) => {
    const { x, y } = cellOf(lon, lat);
    if (y >= 0 && y < NY) inland[cellIndex(x, y)] = 1;
  };
  const traceLine = (coords) => {
    for (let i = 0; i < coords.length - 1; i++) {
      const [x1, y1] = coords[i];
      const [x2, y2] = coords[i + 1];
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / (RES / 2)));
      for (let s = 0; s <= steps; s++) mark(x1 + ((x2 - x1) * s) / steps, y1 + ((y2 - y1) * s) / steps);
    }
  };

  const rivers = JSON.parse(fs.readFileSync(riversPath, "utf8"));
  for (const feature of rivers.features) {
    const lines =
      feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const line of lines) traceLine(line);
  }

  const lakes = JSON.parse(fs.readFileSync(lakesPath, "utf8"));
  scanlineFill(lakes, (x, y) => {
    inland[cellIndex(x, y)] = 1;
  });
  for (const feature of lakes.features) {
    const polys =
      feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) traceLine(ring);
  }

  for (const canal of CANALS) traceLine(canal);

  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      if (inland[cellIndex(x, y)] !== 1) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= NY) continue;
        for (let dx = -1; dx <= 1; dx++) water[cellIndex(x + dx, ny)] = 1;
      }
    }
  }
  return water;
}

/** Ship canals cut through what the coastline data calls solid land. */
const CANALS = [
  [[32.32, 31.26], [32.35, 30.6], [32.57, 30.0], [32.56, 29.93]], // Suez
  [[-79.92, 9.36], [-79.8, 9.15], [-79.61, 9.03], [-79.55, 8.94]], // Panama
  [[9.14, 53.89], [9.4, 54.05], [9.7, 54.3], [10.14, 54.37]], // Kiel
  [[22.94, 37.94], [23.01, 37.93]], // Corinth
];

/** Land test straight off the polygons — a grid cell is 11 km wide, too coarse for coast-hugging legs. */
export function exactLandTest(geojsonPath) {
  const land = JSON.parse(fs.readFileSync(geojsonPath, "utf8"));
  const bands = new Map();
  for (const feature of land.features) {
    const polys =
      feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [x1, y1] = ring[i];
          const [x2, y2] = ring[i + 1];
          if (y1 === y2) continue;
          for (let b = Math.floor(Math.min(y1, y2)); b <= Math.floor(Math.max(y1, y2)); b++) {
            if (!bands.has(b)) bands.set(b, []);
            bands.get(b).push([x1, y1, x2, y2]);
          }
        }
      }
    }
  }
  return (lon, lat) => {
    const segs = bands.get(Math.floor(lat));
    if (!segs) return false;
    const x0 = ((((lon + 180) % 360) + 360) % 360) - 180;
    let crossings = 0;
    for (const [x1, y1, x2, y2] of segs) {
      if (y1 > lat === y2 > lat) continue;
      if (x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1) > x0) crossings++;
    }
    return crossings % 2 === 1;
  };
}

/** Flood-fill land cells into landmass ids (8-connected, wrapping at the antimeridian). */
export function labelLandmasses(grid) {
  const label = new Int32Array(NX * NY).fill(-1);
  let next = 0;
  const stack = [];
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const start = cellIndex(x, y);
      if (grid[start] !== 1 || label[start] !== -1) continue;
      const id = next++;
      label[start] = id;
      stack.push([x, y]);
      while (stack.length > 0) {
        const [cx, cy] = stack.pop();
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const ny = cy + dy;
            if (ny < 0 || ny >= NY) continue;
            const idx = cellIndex(cx + dx, ny);
            if (grid[idx] !== 1 || label[idx] !== -1) continue;
            label[idx] = id;
            stack.push([wrapX(cx + dx), ny]);
          }
        }
      }
    }
  }
  return label;
}

/** Nearest land cell to a node; ports and island cities often sit on a water cell at this resolution. */
export function snapToLand(grid, lon, lat, maxRingCells = 4) {
  const { x, y } = cellOf(lon, lat);
  if (isLandCell(grid, x, y)) return { x, y };
  for (let r = 1; r <= maxRingCells; r++) {
    let best = null;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = wrapX(x + dx);
        const ny = y + dy;
        if (!isLandCell(grid, nx, ny)) continue;
        const km = haversineKm({ lon, lat }, cellCenter(nx, ny));
        if (!best || km < best.km) best = { x: nx, y: ny, km };
      }
    }
    if (best) return { x: best.x, y: best.y };
  }
  return null;
}

class MinHeap {
  #items = [];

  push(item) {
    const items = this.#items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].f <= items[i].f) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop() {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      while (true) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < items.length && items[l].f < items[smallest].f) smallest = l;
        if (r < items.length && items[r].f < items[smallest].f) smallest = r;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }

  get size() {
    return this.#items.length;
  }
}

/**
 * A* between two land cells, staying on land. `maxKm` bounds the search so
 * unreachable pairs fail fast instead of scanning a whole continent.
 */
export function overlandPath(grid, startCell, goalCell, maxKm) {
  const goal = cellCenter(goalCell.x, goalCell.y);
  const startIdx = cellIndex(startCell.x, startCell.y);
  const goalIdx = cellIndex(goalCell.x, goalCell.y);
  if (startIdx === goalIdx) return { km: 0, cells: [startCell] };

  const gScore = new Map([[startIdx, 0]]);
  const cameFrom = new Map();
  const open = new MinHeap();
  open.push({ idx: startIdx, x: startCell.x, y: startCell.y, f: haversineKm(cellCenter(startCell.x, startCell.y), goal) });
  const closed = new Set();

  while (open.size > 0) {
    const current = open.pop();
    if (closed.has(current.idx)) continue;
    closed.add(current.idx);

    if (current.idx === goalIdx) {
      const cells = [];
      let idx = goalIdx;
      let cell = { x: goalCell.x, y: goalCell.y };
      while (idx !== startIdx) {
        cells.unshift(cell);
        const prev = cameFrom.get(idx);
        idx = prev.idx;
        cell = { x: prev.x, y: prev.y };
      }
      cells.unshift(startCell);
      return { km: gScore.get(goalIdx), cells };
    }

    const here = cellCenter(current.x, current.y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = wrapX(current.x + dx);
        const ny = current.y + dy;
        if (!isLandCell(grid, nx, ny)) continue;
        const nIdx = cellIndex(nx, ny);
        if (closed.has(nIdx)) continue;
        const nCenter = cellCenter(nx, ny);
        const tentative = gScore.get(current.idx) + haversineKm(here, nCenter);
        if (tentative > maxKm) continue;
        if (tentative >= (gScore.get(nIdx) ?? Infinity)) continue;
        gScore.set(nIdx, tentative);
        cameFrom.set(nIdx, { idx: current.idx, x: current.x, y: current.y });
        open.push({ idx: nIdx, x: nx, y: ny, f: tentative + haversineKm(nCenter, goal) });
      }
    }
  }
  return null;
}

/** Douglas-Peucker in lon/lat degrees, good enough for drawing a corridor. */
export function simplify(points, toleranceDeg) {
  if (points.length < 3) return points;
  const [first] = points;
  const last = points[points.length - 1];
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicular(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= toleranceDeg) return [first, last];
  return [
    ...simplify(points.slice(0, index + 1), toleranceDeg).slice(0, -1),
    ...simplify(points.slice(index), toleranceDeg),
  ];
}

function perpendicular(p, a, b) {
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) return Math.hypot(p.lon - a.lon, p.lat - a.lat);
  const t = ((p.lon - a.lon) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(p.lon - (a.lon + clamped * dx), p.lat - (a.lat + clamped * dy));
}

/**
 * MapLibre draws a GeoJSON segment as a straight line in Web Mercator, so route
 * geometry has to be sampled the same way — a great-circle sample would check
 * water the map never actually draws over.
 */
export function mercatorPoint(a, b, f) {
  const y = (lat) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
  const merc = y(a.lat) + (y(b.lat) - y(a.lat)) * f;
  return {
    lon: a.lon + (b.lon - a.lon) * f,
    lat: ((2 * Math.atan(Math.exp(merc)) - Math.PI / 2) * 180) / Math.PI,
  };
}

/** Longest contiguous stretch of open water along a polyline, in km. */
export function longestWaterRunKm(isLand, points, stepKm = 5) {
  let best = 0;
  let run = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segKm = haversineKm(a, b);
    const steps = Math.max(1, Math.ceil(segKm / stepKm));
    for (let s = 1; s <= steps; s++) {
      const p = mercatorPoint(a, b, s / steps);
      if (isLand(p.lon, p.lat)) run = 0;
      else {
        run += segKm / steps;
        if (run > best) best = run;
      }
    }
  }
  return best;
}

/**
 * Turns an A* cell path into the coarsest `via` list that still keeps the drawn
 * leg on land — simplifying aggressively would otherwise straighten the corridor
 * back across the bay it was routed around.
 */
export function corridorVia(isLand, from, to, cells, maxWaterKm) {
  const corridor = cells.map(({ x, y }) => cellCenter(x, y));
  const round = (via) => via.map((p) => [Number(p.lon.toFixed(3)), Number(p.lat.toFixed(3))]);
  let fallback = [];
  for (const tolerance of [0.35, 0.2, 0.1, 0.05, 0]) {
    const via = (tolerance === 0 ? corridor : simplify(corridor, tolerance)).slice(1, -1);
    if (via.length === 0) continue; // collapsed to a straight line; try a finer tolerance
    fallback = via;
    if (longestWaterRunKm(isLand, [from, ...via, to]) <= maxWaterKm) return round(via);
  }
  return round(fallback);
}
