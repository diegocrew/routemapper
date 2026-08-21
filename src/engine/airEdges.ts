import { haversineKm } from "./geo";
import curatedNodes from "../data/nodes.json";
import type { BaseEdge, GeoNode } from "./types";

/**
 * Unlike ships/trains/trucks, cargo planes aren't confined to fixed lanes,
 * tracks, or roads — any two airport-capable points can fly a direct route,
 * limited only by aircraft range, which for cargo aircraft comfortably covers
 * any distance on Earth. So the hand-curated network is a full air mesh: every
 * curated node gets a direct air edge to every other, instead of relying only
 * on the hand-curated "known trunk route" edges (which otherwise force a
 * router that's genuinely just picking the fastest option into unrealistic
 * layovers whenever neither endpoint happens to sit on a curated route).
 *
 * A full mesh is O(n²), though, and the military installations imported from
 * Wikidata take the network into the thousands of nodes — millions of air
 * edges rebuilt on every graph build. Those are attached as spokes to their
 * nearest few curated hubs instead, which is also the more honest model: a
 * remote barracks is not an airport, and freight reaching it flies to the
 * nearest air hub first. Routing between curated nodes is unchanged.
 */
const HUBS_PER_SPOKE = 3;
const HUB_IDS = new Set((curatedNodes as { id: string }[]).map((n) => n.id));

function fullMesh(nodes: GeoNode[]): BaseEdge[] {
  const edges: BaseEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      edges.push({ from: nodes[i].id, to: nodes[j].id, mode: "air" });
    }
  }
  return edges;
}

export function buildAirEdges(nodes: GeoNode[]): BaseEdge[] {
  const hubs = nodes.filter((n) => HUB_IDS.has(n.id));
  const spokes = nodes.filter((n) => !HUB_IDS.has(n.id));
  // Synthetic graphs (and any set with nothing curated in it) have no hubs to attach to.
  if (hubs.length < 2) return fullMesh(nodes);

  const edges = fullMesh(hubs);
  for (const node of spokes) {
    const nearest = hubs
      .map((hub) => ({ hub, km: haversineKm(node, hub) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, HUBS_PER_SPOKE);
    for (const { hub } of nearest) edges.push({ from: node.id, to: hub.id, mode: "air" });
  }
  return edges;
}
