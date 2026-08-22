import zonesData from "../data/zones.json";
import hazardZonesData from "../data/hazardZones.json";
import hazardEdgeZonesData from "../data/hazardEdgeZones.json";
import { haversineKm } from "./geo";
import { airspaceZones } from "./airspace";
import type { CargoRule, Mode, Zone } from "./types";

export const edgeKey = (from: string, to: string, mode: Mode): string => `${from}|${to}|${mode}`;

export const hazardEdgeZones = hazardEdgeZonesData as Record<string, Record<string, number>>;

/** Degrees of latitude per km, used to turn a circular zone's radius into a bounding box. */
const KM_PER_DEG_LAT = 111.32;
/** Cell size of the zone lookup grid, comfortably wider than the largest hazard radius. */
const CELL_DEG = 10;

const cellKey = (lon: number, lat: number): number =>
  Math.floor(lon / CELL_DEG) * 1000 + Math.floor(lat / CELL_DEG);

function contains(zone: Zone, lon: number, lat: number): boolean {
  if (zone.center && zone.radiusKm !== undefined) {
    const [centerLon, centerLat] = zone.center;
    return haversineKm({ lon: centerLon, lat: centerLat }, { lon, lat }) <= zone.radiusKm;
  }
  const ring = zone.polygon;
  if (!ring) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function boundingBox(zone: Zone): [number, number, number, number] {
  if (zone.center && zone.radiusKm !== undefined) {
    const [lon, lat] = zone.center;
    const dLat = zone.radiusKm / KM_PER_DEG_LAT;
    // Meridians converge toward the poles, so the same radius spans more longitude the further from the equator it sits.
    const dLon = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
    return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
  }
  const ring = zone.polygon ?? [];
  const lons = ring.map(([x]) => x);
  const lats = ring.map(([, y]) => y);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

/**
 * Bins zones into a coarse lon/lat grid so a point test only considers zones
 * near it — without this every node lookup scanned all several-thousand
 * hazard zones.
 */
function buildGrid(zones: Zone[]): Map<number, Zone[]> {
  const grid = new Map<number, Zone[]>();
  for (const zone of zones) {
    const [minLon, minLat, maxLon, maxLat] = boundingBox(zone);
    // A box spanning more than half the world is either genuinely global or wrapped across the antimeridian; index it across all longitudes rather than guessing which.
    const wraps = maxLon - minLon > 180;
    const lonStart = Math.floor((wraps ? -180 : minLon) / CELL_DEG);
    const lonEnd = Math.floor((wraps ? 180 : maxLon) / CELL_DEG);
    for (let lon = lonStart; lon <= lonEnd; lon++) {
      for (let lat = Math.floor(minLat / CELL_DEG); lat <= Math.floor(maxLat / CELL_DEG); lat++) {
        const key = lon * 1000 + lat;
        const bucket = grid.get(key);
        if (bucket) bucket.push(zone);
        else grid.set(key, [zone]);
      }
    }
  }
  return grid;
}

/**
 * Earthquakes and volcanic eruptions damage or close the site itself, so they
 * shut it to everyone but military transit. Wildfires, tropical cyclones and
 * floods do not: they are routed around where possible (their surcharge and
 * low security score make them expensive) but never delete a port from the
 * network. Hard-blocking everything severed the civilian network, since the
 * global fire feed alone covers thousands of zones at a time.
 */
const BLOCKING_HAZARDS = new Set(["earthquake", "volcano"]);

const blocksCivilianCargo = (zone: Zone): boolean =>
  zone.access === "military-only" ||
  (zone.access === "hazard" && BLOCKING_HAZARDS.has(zone.hazardKind ?? ""));

/**
 * Builds the zone lookups off a given zone list, so tests can exercise them
 * against synthetic fixtures instead of the real (and, for hazard zones,
 * frequently-refreshed) committed data.
 */
export function createZoneIndex(zones: Zone[]) {
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const grid = buildGrid(zones);

  const getZone = (id: string): Zone | undefined => zoneById.get(id);

  const zonesAt = (lon: number, lat: number): Zone[] =>
    (grid.get(cellKey(lon, lat)) ?? []).filter((z) => contains(z, lon, lat));

  /** Zones a given shipment may not enter at all. Escorted cargo goes anywhere. */
  function blockedZoneIds(cargoRule: CargoRule): Set<string> {
    if (cargoRule.allowMilitaryNodes) return new Set();
    return new Set(zones.filter(blocksCivilianCargo).map((z) => z.id));
  }

  /** Zones frozen or otherwise unnavigable in a given month. Ice does not care about cargo type. */
  function closedInMonth(month: number | undefined): Set<string> {
    if (month === undefined) return new Set();
    return new Set(zones.filter((z) => z.closedMonths?.includes(month)).map((z) => z.id));
  }

  /** How much a month's conditions stretch transit time through the zones a leg crosses. */
  function seasonalDelay(zoneIds: Iterable<string>, month: number | undefined): number {
    if (month === undefined) return 1;
    let factor = 1;
    for (const id of zoneIds) {
      const zone = zoneById.get(id);
      if (zone?.delayMonths?.includes(month)) factor *= zone.delayFactor ?? 1;
    }
    return factor;
  }

  const hazardZoneIds = new Set(zones.filter((z) => z.access === "hazard").map((z) => z.id));

  return { zones, getZone, zonesAt, blockedZoneIds, closedInMonth, seasonalDelay, hazardZoneIds };
}

/**
 * Whether a zone is in effect at any point in [fromMs, toMs]. A zone with no
 * validity window is always in effect — hand-drawn chokepoints and observed
 * hazards have no expiry, only forecasts do.
 */
export function zoneActiveBetween(zone: Zone, fromMs: number, toMs: number): boolean {
  if (zone.activeFrom && Date.parse(zone.activeFrom) > toMs) return false;
  if (zone.activeUntil && Date.parse(zone.activeUntil) < fromMs) return false;
  return true;
}

export const zoneActiveAt = (zone: Zone, atMs: number): boolean => zoneActiveBetween(zone, atMs, atMs);

export const hazardZones = hazardZonesData as Zone[];

// Airspace zones join the index so their labels, security scores and
// closedToCountries lists resolve like any other. They carry no outline, which
// keeps them out of the point-in-zone grid — deliberately: an airport under
// closed airspace is still a perfectly good place to send a truck.
const index = createZoneIndex([...(zonesData as Zone[]), ...airspaceZones, ...hazardZones]);

export const zones = index.zones;
export const getZone = index.getZone;
export const zonesAt = index.zonesAt;
export const blockedZoneIds = index.blockedZoneIds;
export const closedInMonth = index.closedInMonth;
export const seasonalDelay = index.seasonalDelay;
export const hazardZoneIds = index.hazardZoneIds;
