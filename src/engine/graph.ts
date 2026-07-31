import type { BaseEdge, CostsConfig, DistanceTier, GeoNode, Mode } from "./types";
import { haversineKm } from "./geo";
import { economicIndex } from "./indices";
import { getZone, seasonalDelay } from "./zones";

export const HUB = "HUB";

/**
 * A transfer at Rotterdam and one at Lagos used to cost the same flat overhead.
 * The economic score stands in for port/customs efficiency: a weak hub mostly
 * costs you time (demurrage, clearance) and somewhat more money (handling,
 * informal fees), while a strong one clears cargo faster than the baseline.
 */
function hubFactors(node: GeoNode | undefined, cfg: CostsConfig["hub"]) {
  if (!node) return { usd: 1, hours: 1 };
  const efficiency = economicIndex(node.id, node.country) / 100;
  return {
    usd: cfg.maxFeeFactor + (cfg.minFeeFactor - cfg.maxFeeFactor) * efficiency,
    hours: cfg.maxDwellFactor + (cfg.minDwellFactor - cfg.maxDwellFactor) * efficiency,
  };
}

export interface LegInfo {
  from: string;
  to: string;
  mode: Mode;
  distanceKm: number;
  via?: [number, number][];
  zones?: Record<string, number>;
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
/** Everything that can close a leg off or make it dearer than its distance suggests. */
export interface AccessRules {
  blockedZones: Set<string>;
  isBorderClosed: (fromCountry: string, toCountry: string, mode: Mode) => unknown;
  /** Departure month, for seasonal delays. */
  month?: number;
  /** Chargeable units (roughly containers) the consignment occupies. */
  units?: number;
}

const OPEN: AccessRules = { blockedZones: new Set(), isBorderClosed: () => undefined };

/** Tariffs taper with distance, so each bracket of km is billed at its own multiplier. */
function taperedUsd(distanceKm: number, usdPerKm: number, tiers: DistanceTier[]): number {
  let remaining = distanceKm;
  let previous = 0;
  let usd = 0;
  for (const tier of tiers) {
    if (remaining <= 0) break;
    const bracket = tier.km === null ? remaining : Math.min(remaining, tier.km - previous);
    usd += bracket * usdPerKm * tier.multiplier;
    remaining -= bracket;
    previous = tier.km ?? previous;
  }
  return usd;
}

export function buildGraph(
  nodes: GeoNode[],
  edges: BaseEdge[],
  costs: CostsConfig,
  allowedModes: Set<Mode>,
  access: AccessRules = OPEN,
): Graph {
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
    const zoneEntries = Object.entries(e.zones ?? {});
    if (zoneEntries.some(([id]) => access.blockedZones.has(id))) continue;
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    if (!a || !b) continue;
    if (access.isBorderClosed(a.country, b.country, e.mode)) continue;

    const modeCfg = costs.modes[e.mode];
    const routePoints = [a, ...(e.via ?? []).map(([lon, lat]) => ({ lon, lat })), b];
    const routeDistanceKm = routePoints.slice(1).reduce(
      (sum, point, index) => sum + haversineKm(routePoints[index], point),
      0,
    );
    const distanceKm = routeDistanceKm * modeCfg.detourFactor;
    const zoneUsd = zoneEntries.reduce((sum, [id, km]) => {
      const zone = getZone(id);
      return zone ? sum + km * zone.surchargeUsdPerKm + zone.tollUsd : sum;
    }, 0);
    const units = access.units ?? 1;
    const usd = (taperedUsd(distanceKm, modeCfg.usdPerKm, costs.distanceTiers) + zoneUsd) * units;
    const hours = (distanceKm / modeCfg.kmPerHour) * seasonalDelay(zoneEntries.map(([id]) => id), access.month);

    registerMode(a.id, e.mode);
    registerMode(b.id, e.mode);

    addEdge(stateKey(a.id, e.mode), {
      to: stateKey(b.id, e.mode),
      usd,
      hours,
      isLoad: false,
      leg: { from: a.id, to: b.id, mode: e.mode, distanceKm, via: e.via, zones: e.zones },
    });
    addEdge(stateKey(b.id, e.mode), {
      to: stateKey(a.id, e.mode),
      usd,
      hours,
      isLoad: false,
      leg: { from: b.id, to: a.id, mode: e.mode, distanceKm, via: e.via?.toReversed(), zones: e.zones },
    });
  }

  for (const [nodeId, modes] of modesAtNode) {
    const factors = hubFactors(nodeById.get(nodeId), costs.hub);
    for (const mode of modes) {
      const modeCfg = costs.modes[mode];
      addEdge(stateKey(nodeId, HUB), {
        to: stateKey(nodeId, mode),
        usd: modeCfg.hubUsd * factors.usd * (access.units ?? 1),
        hours: modeCfg.hubHours * factors.hours,
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
