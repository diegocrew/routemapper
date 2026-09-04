import zoneConditionsData from "../data/zoneConditions.json";

export interface ZoneCondition {
  zoneId: string;
  /** Multiplies the transit time of any leg crossing the zone. 1 = normal. */
  delayFactor: number;
  label: string;
  source: string;
  detectedAt: string;
}

export const zoneConditions = zoneConditionsData as ZoneCondition[];

const byZone = new Map(zoneConditions.map((c) => [c.zoneId, c]));

/**
 * How much longer a leg takes right now because of measured conditions in the
 * zones it crosses — a chokepoint running below its normal throughput, a river
 * too low to load barges to full draft.
 *
 * Distinct from `seasonalDelay`, which encodes what a zone is *usually* like in
 * a given month. This is what it is like today, and it is deliberately
 * multiplicative with the seasonal factor: a low Danube in the month the Danube
 * is normally low is worse than either on its own.
 */
export function liveDelay(zoneIds: Iterable<string>): number {
  let factor = 1;
  for (const id of zoneIds) factor *= byZone.get(id)?.delayFactor ?? 1;
  return factor;
}

/** Human-readable notes for the zones a route actually crosses. */
export function conditionNotes(zoneIds: Iterable<string>): string[] {
  const notes: string[] = [];
  for (const id of zoneIds) {
    const condition = byZone.get(id);
    if (condition && !notes.includes(condition.label)) notes.push(condition.label);
  }
  return notes;
}
