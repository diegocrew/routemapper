import type { BaseEdge, CostsConfig, GeoNode } from "./types";
import { nodeDistanceKm } from "./geo";

/**
 * Trucking has no curated route data: any two hubs within road range can be
 * connected by truck. Generate those edges from node coordinates instead of
 * hand-authoring them, capped per node so dense regions don't blow up the graph.
 */
export function buildTruckEdges(nodes: GeoNode[], costs: CostsConfig): BaseEdge[] {
  const { maxLegKm, maxNeighbors } = costs.truck;
  const edges: BaseEdge[] = [];
  const seenPairs = new Set<string>();

  // Proximity-based truck edges are generated for every node, military bases
  // included — a base near a city can truck cargo to/from it. Whether a given
  // cargo type is actually allowed to use a military node is decided later,
  // at route-compute time (see pathfinder.ts), not here.
  for (const node of nodes) {
    const candidates = nodes
      .filter((other) => other.id !== node.id)
      .map((other) => ({ other, distanceKm: nodeDistanceKm(node, other) }))
      .filter((c) => c.distanceKm <= maxLegKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, maxNeighbors);

    for (const { other } of candidates) {
      const pairKey = [node.id, other.id].sort().join("|");
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      edges.push({ from: node.id, to: other.id, mode: "truck" });
    }
  }

  return edges;
}
