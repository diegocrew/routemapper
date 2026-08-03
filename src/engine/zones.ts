import zonesData from "../data/zones.json";
import type { CargoRule, Zone } from "./types";

export const zones = zonesData as Zone[];
const zoneById = new Map(zones.map((z) => [z.id, z]));

export const getZone = (id: string): Zone | undefined => zoneById.get(id);

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

export const zonesAt = (lon: number, lat: number): Zone[] => zones.filter((z) => contains(z, lon, lat));

/** Zones a given shipment may not enter at all. Escorted cargo goes anywhere. */
export function blockedZoneIds(cargoRule: CargoRule): Set<string> {
  if (cargoRule.allowMilitaryNodes) return new Set();
  return new Set(zones.filter((z) => z.access === "military-only").map((z) => z.id));
}

/** Zones frozen or otherwise unnavigable in a given month. Ice does not care about cargo type. */
export function closedInMonth(month: number | undefined): Set<string> {
  if (month === undefined) return new Set();
  return new Set(zones.filter((z) => z.closedMonths?.includes(month)).map((z) => z.id));
}

/** How much a month's conditions stretch transit time through the zones a leg crosses. */
export function seasonalDelay(zoneIds: Iterable<string>, month: number | undefined): number {
  if (month === undefined) return 1;
  let factor = 1;
  for (const id of zoneIds) {
    const zone = zoneById.get(id);
    if (zone?.delayMonths?.includes(month)) factor *= zone.delayFactor ?? 1;
  }
  return factor;
}
