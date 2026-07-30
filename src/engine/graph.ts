import type { BaseEdge, CostsConfig, GeoNode, Mode } from "./types";
import { haversineKm } from "./geo";

export const HUB = "HUB";

export interface LegInfo {
  from: string;
  to: string;
  mode: Mode;
  distanceKm: number;
  via?: [number, number][];
}

export interface AdjEdge {
  to: string;
  usd: number;
  hours: number;
  isLoad: boolean;
  leg?: LegInfo;
}

export interface Graph {
  adjacency: Map<string, AdjEdge[]>;
}

export function stateKey(nodeId: string, mode: Mode | typeof HUB): string {
  return `${nodeId}#${mode}`;
}

/**
 * Each hub is modeled as one "state node" per transport mode used there, plus a
 * neutral HUB state. Traveling requires loading from HUB onto a mode (paying that
 * mode's overhead) and unloading back to HUB (free) before switching modes. This
 * keeps Dijkstra itself mode-agnostic: mode-transfer penalties fall naturally out
 * of the graph shape instead of needing special-cased search logic.
 */
export function buildGraph(nodes: GeoNode[], edges: BaseEdge[], costs: CostsConfig, allowedModes: Set<Mode>): Graph {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, AdjEdge[]>();
  const modesAtNode = new Map<string, Set<Mode>>();

  const addEdge = (from: string, edge: AdjEdge) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push(edge);
  };

  const registerMode = (nodeId: string, mode: Mode) => {
    if (!modesAtNode.has(nodeId)) modesAtNode.set(nodeId, new Set());
    modesAtNode.get(nodeId)!.add(mode);
  };

  for (const e of edges) {
    if (!allowedModes.has(e.mode)) continue;
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    if (!a || !b) continue;

    const modeCfg = costs.modes[e.mode];
    const routePoints = [a, ...(e.via ?? []).map(([lon, lat]) => ({ lon, lat })), b];
    const routeDistanceKm = routePoints.slice(1).reduce(
      (sum, point, index) => sum + haversineKm(routePoints[index], point),
      0,
    );
    const distanceKm = routeDistanceKm * modeCfg.detourFactor;
    const usd = distanceKm * modeCfg.usdPerKm;
    const hours = distanceKm / modeCfg.kmPerHour;

    registerMode(a.id, e.mode);
    registerMode(b.id, e.mode);

    addEdge(stateKey(a.id, e.mode), {
      to: stateKey(b.id, e.mode),
      usd,
      hours,
      isLoad: false,
      leg: { from: a.id, to: b.id, mode: e.mode, distanceKm, via: e.via },
    });
    addEdge(stateKey(b.id, e.mode), {
      to: stateKey(a.id, e.mode),
      usd,
      hours,
      isLoad: false,
      leg: { from: b.id, to: a.id, mode: e.mode, distanceKm, via: e.via?.toReversed() },
    });
  }

  for (const [nodeId, modes] of modesAtNode) {
    for (const mode of modes) {
      const modeCfg = costs.modes[mode];
      addEdge(stateKey(nodeId, HUB), {
        to: stateKey(nodeId, mode),
        usd: modeCfg.hubUsd,
        hours: modeCfg.hubHours,
        isLoad: true,
      });
      addEdge(stateKey(nodeId, mode), {
        to: stateKey(nodeId, HUB),
        usd: 0,
        hours: 0,
        isLoad: false,
      });
    }
  }

  return { adjacency };
}

/** Modes actually reachable at each node across the full curated + generated edge set, ignoring any user mode filter — used for "what's available here" display, not for pathfinding. */
export function computeAvailableModes(nodes: GeoNode[], edges: BaseEdge[]): Map<string, Set<Mode>> {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const modesAtNode = new Map<string, Set<Mode>>();
  const register = (nodeId: string, mode: Mode) => {
    if (!modesAtNode.has(nodeId)) modesAtNode.set(nodeId, new Set());
    modesAtNode.get(nodeId)!.add(mode);
  };
  for (const e of edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) continue;
    register(e.from, e.mode);
    register(e.to, e.mode);
  }
  return modesAtNode;
}
