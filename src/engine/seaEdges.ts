import type { BaseEdge, GeoNode } from "./types";
import seaEdgeData from "../data/seaEdges.json";

/**
 * The generated half of the ocean network (`npm run generate:sea-routes`):
 * each port's nearest few other ports, routed through searoute so the leg
 * follows real water. edges.json keeps the hand-curated trunk lanes and the
 * river/canal corridors; this file is what stops a ship being sent past its
 * actual port of call because the next port over happened to be the one with
 * a curated onward link.
 */
export function buildSeaEdges(nodes: GeoNode[]): BaseEdge[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  return (seaEdgeData as { from: string; to: string; via?: [number, number][]; zones?: Record<string, number> }[])
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e) => ({ from: e.from, to: e.to, mode: "sea", via: e.via, zones: e.zones }));
}
