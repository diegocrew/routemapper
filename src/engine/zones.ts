import zonesData from "../data/zones.json";
import hazardZonesData from "../data/hazardZones.json";
import hazardEdgeZonesData from "../data/hazardEdgeZones.json";
import type { CargoRule, Mode, Zone } from "./types";

export const edgeKey = (from: string, to: string, mode: Mode): string => `${from}|${to}|${mode}`;

export const hazardEdgeZones = hazardEdgeZonesData as Record<string, Record<string, number>>;

function contains(zone: Zone, lon: number, lat: number): boolean {
  const ring = zone.polygon;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Builds the zone lookups off a given zone list, so tests can exercise them
 * against synthetic fixtures instead of the real (and, for hazard zones,
 * frequently-refreshed) committed data.
 */
export function createZoneIndex(zones: Zone[]) {
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  const getZone = (id: string): Zone | undefined => zoneById.get(id);

  const zonesAt = (lon: number, lat: number): Zone[] => zones.filter((z) => contains(z, lon, lat));

  /** Zones a given shipment may not enter at all. Escorted cargo goes anywhere. Hazard zones are blocked the same way as military-only ones. */
  function blockedZoneIds(cargoRule: CargoRule): Set<string> {
    if (cargoRule.allowMilitaryNodes) return new Set();
    return new Set(zones.filter((z) => z.access === "military-only" || z.access === "hazard").map((z) => z.id));
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

const index = createZoneIndex([...(zonesData as Zone[]), ...(hazardZonesData as Zone[])]);

export const zones = index.zones;
export const getZone = index.getZone;
export const zonesAt = index.zonesAt;
export const blockedZoneIds = index.blockedZoneIds;
export const closedInMonth = index.closedInMonth;
export const seasonalDelay = index.seasonalDelay;
export const hazardZoneIds = index.hazardZoneIds;
