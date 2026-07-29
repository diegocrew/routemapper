import type { BaseEdge, GeoNode } from "./types";

/**
 * Unlike ships/trains/trucks, cargo planes aren't confined to fixed lanes,
 * tracks, or roads — any two airport-capable points can fly a direct route,
 * limited only by aircraft range, which for cargo aircraft comfortably covers
 * any distance on Earth. So air is modeled as a fully connected mode: every
 * node gets a direct air edge to every other node, instead of relying only on
 * the hand-curated "known trunk route" edges (which otherwise force a router
 * that's genuinely just picking the fastest option into unrealistic layovers
 * whenever neither endpoint happens to sit on a curated route).
 */
export function buildAirEdges(nodes: GeoNode[]): BaseEdge[] {
  const edges: BaseEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      edges.push({ from: nodes[i].id, to: nodes[j].id, mode: "air" });
    }
  }
  return edges;
}
