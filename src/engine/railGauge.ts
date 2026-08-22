import railGaugeData from "../data/railGauge.json";
import type { GeoNode } from "./types";

interface RailGaugeData {
  default: number;
  /** Gauges close enough to share rolling stock, so crossing between them is not a break. */
  interoperable: number[][];
  countries: Record<string, number>;
  nodes: Record<string, number>;
}

const data = railGaugeData as RailGaugeData;

const compatible = new Map<number, Set<number>>();
for (const group of data.interoperable) {
  for (const gauge of group) compatible.set(gauge, new Set(group));
}

export function gaugeOf(node: GeoNode): number {
  return data.nodes[node.id] ?? data.countries[node.country] ?? data.default;
}

/**
 * Whether freight has to change trains between two railheads.
 *
 * Unlike a road or a sea lane, track is physical infrastructure with a fixed
 * width, and a 1520 mm wagon simply cannot run on 1435 mm rail. At Brest,
 * Khorgos, Erenhot and Irun every container is craned across (or the bogies
 * swapped) before it goes on — hours of work and a second handling charge that
 * a same-gauge border crossing doesn't pay. Half the corridors in this dataset
 * cross one, including the whole China-to-Europe land bridge.
 */
export function breakOfGauge(a: GeoNode, b: GeoNode): [number, number] | null {
  const from = gaugeOf(a);
  const to = gaugeOf(b);
  if (from === to || compatible.get(from)?.has(to)) return null;
  return [from, to];
}

export const gaugeLabel = ([from, to]: [number, number]): string => `${from}→${to} mm`;
