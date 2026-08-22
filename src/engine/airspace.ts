import airspaceData from "../data/airspace.json";
import airEdgeZonesData from "../data/airEdgeZones.json";
import type { AirspaceZone } from "./types";

/**
 * Restricted airspace, and which of the runtime-generated air legs crosses it.
 *
 * The crossings are resolved offline (`npm run generate:airspace`) because the
 * air network is a ~109k-edge mesh and country outlines are far too expensive
 * to sample in the browser. What lands here is one bitmask per affected leg,
 * over `zones` — no distances, because a closed airspace lengthens the leg by
 * a flat factor rather than charging per km, and validate:data holds these
 * zones to a zero per-km charge so nothing downstream can want a distance that
 * isn't stored.
 */
export const airspaceZones = (airspaceData as { zones: AirspaceZone[] }).zones;

const tags = airEdgeZonesData as { zones: string[]; legs: Record<string, Record<string, number>> };

/**
 * The restricted airspaces an air leg passes through, in either direction —
 * the mesh is generated once per unordered pair, but a leg is walked both ways.
 */
export function airspaceOnLeg(from: string, to: string): string[] {
  const mask = tags.legs[from]?.[to] ?? tags.legs[to]?.[from];
  if (!mask) return [];
  return tags.zones.filter((_, i) => mask & (1 << i));
}
