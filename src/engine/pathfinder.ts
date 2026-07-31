import type { AdjEdge, Graph } from "./graph";
import { HUB, stateKey, computeAvailableModes } from "./graph";
import type { BaseEdge, CostsConfig, GeoNode, Mode, RouteLeg, RouteOption, RouteOptionKey, RouteRequest } from "./types";
import { buildGraph } from "./graph";
import { buildTruckEdges } from "./truckEdges";
import { buildAirEdges } from "./airEdges";
import { economicIndex, routeSecurityIndex, securityIndex, transitIndex } from "./indices";
import { blockedZoneIds, closedInMonth, getZone, zonesAt } from "./zones";
import { borderCheck } from "./restrictions";

type Weight = (edge: AdjEdge) => number;

function dijkstra(graph: Graph, source: string, target: string, weight: Weight): string[] | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  dist.set(source, 0);

  while (true) {
    let current: string | null = null;
    let currentDist = Infinity;
    for (const [node, d] of dist) {
      if (!visited.has(node) && d < currentDist) {
        current = node;
        currentDist = d;
      }
    }
    if (current === null) break;
    if (current === target) break;
    visited.add(current);

    const edges = graph.adjacency.get(current) ?? [];
    for (const edge of edges) {
      if (visited.has(edge.to)) continue;
      const next = currentDist + weight(edge);
      if (next < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, next);
        prev.set(edge.to, current);
      }
    }
  }

  if (!dist.has(target)) return null;

  const path: string[] = [target];
  let node = target;
  while (node !== source) {
    const p = prev.get(node);
    if (!p) return null;
    path.unshift(p);
    node = p;
  }
  return path;
}

/** Walks a Dijkstra path back into the physical legs it represents, folding each hub's load overhead into the leg that follows it. */
function reconstructLegs(graph: Graph, path: string[]): RouteLeg[] {
  const legs: RouteLeg[] = [];
  let pendingUsd = 0;
  let pendingHours = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];
    const edge = (graph.adjacency.get(from) ?? []).find((e) => e.to === to);
    if (!edge) continue;

    if (edge.isLoad) {
      pendingUsd += edge.usd;
      pendingHours += edge.hours;
      continue;
    }
    if (edge.leg) {
      legs.push({
        from: edge.leg.from,
        to: edge.leg.to,
        mode: edge.leg.mode,
        distanceKm: edge.leg.distanceKm,
        usd: edge.usd + pendingUsd,
        hours: edge.hours + pendingHours,
        via: edge.leg.via,
        zones: edge.leg.zones,
      });
      pendingUsd = 0;
      pendingHours = 0;
    }
    // unload edges (mode -> HUB) carry no cost and are skipped
  }

  return legs;
}

function combineLegs(
  legs: RouteLeg[],
  key: RouteOptionKey,
  label: string,
  securityScore: number,
  zoneLabels: string[],
): RouteOption {
  const totalUsd = legs.reduce((sum, l) => sum + l.usd, 0);
  const totalHours = legs.reduce((sum, l) => sum + l.hours, 0);
  const transferCount = legs.slice(1).filter((l, i) => l.mode !== legs[i].mode).length;

  return { key, label, legs, totalUsd, totalHours, transferCount, securityScore, zoneLabels };
}

function routesEqual(a: RouteOption, b: RouteOption): boolean {
  if (a.legs.length !== b.legs.length) return false;
  return a.legs.every((leg, i) => leg.from === b.legs[i].from && leg.to === b.legs[i].to && leg.mode === b.legs[i].mode);
}

export interface NodeInfo {
  modes: Mode[];
  economicIndex: number;
  securityIndex: number;
  transitIndex: number;
}

export interface RouteEngine {
  computeRoutes(request: RouteRequest): RouteOption[];
  getNodeInfo(nodeId: string): NodeInfo;
}

export function createRouteEngine(nodes: GeoNode[], curatedEdges: BaseEdge[], costs: CostsConfig): RouteEngine {
  const truckEdges = buildTruckEdges(nodes);
  const airEdges = buildAirEdges(nodes);
  const allEdges = [...curatedEdges, ...truckEdges, ...airEdges];
  const availableModes = computeAvailableModes(nodes, allEdges);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  return {
    getNodeInfo(nodeId: string): NodeInfo {
      const modes = [...(availableModes.get(nodeId) ?? [])];
      const node = nodeById.get(nodeId);
      return {
        modes,
        economicIndex: node ? economicIndex(nodeId, node.country) : 0,
        securityIndex: node ? securityIndex(node.country, nodeId) : 0,
        transitIndex: transitIndex(modes),
      };
    },

    computeRoutes(request: RouteRequest): RouteOption[] {
      const cargoRule = request.cargoType ? costs.cargoTypes[request.cargoType] : undefined;
      const excluded = new Set(cargoRule?.excludeModes ?? []);
      const weightTonnes = request.weightTonnes ?? costs.cargo.defaultTonnes;
      const units = Math.max(
        1,
        weightTonnes / costs.cargo.tonnesPerUnit,
        (request.volumeM3 ?? 0) / costs.cargo.m3PerUnit,
      );
      const allowedModes = new Set<Mode>(
        request.allowedModes.filter((m) => {
          if (excluded.has(m)) return false;
          const cap = costs.modes[m].maxTonnes;
          return cap === undefined || weightTonnes <= cap;
        }),
      );
      if (allowedModes.size === 0) return [];

      const stops = [request.originId, ...(request.waypointIds ?? []), request.destinationId];
      if (stops.some((id, i) => stops.indexOf(id) !== i)) return []; // repeated stop (e.g. waypoint == origin)
      if (stops.length < 2) return [];

      // Military-kind nodes are off-limits to every cargo type except one flagged
      // allowMilitaryNodes — and that cargo type can still freely use civilian
      // nodes too, it just isn't restricted the way everyone else is. The same
      // rule closes off nodes that sit inside a military-only zone.
      const blockedZones = blockedZoneIds(cargoRule);
      const inClosedZone = (n: GeoNode) => zonesAt(n.lon, n.lat).some((z) => blockedZones.has(z.id));
      const eligibleNodes = cargoRule?.allowMilitaryNodes
        ? nodes
        : nodes.filter((n) => n.kind !== "military" && !inClosedZone(n));
      if (stops.some((id) => !eligibleNodes.some((n) => n.id === id))) return [];

      const graph = buildGraph(eligibleNodes, allEdges, costs, allowedModes, {
        blockedZones: new Set([...blockedZones, ...closedInMonth(request.month)]),
        isBorderClosed: borderCheck(cargoRule),
        month: request.month,
        units,
      });
      const scoresSecurity = !cargoRule?.ignoresSecurity;

      // Entering a hostile hub or transiting a risky corridor is what costs you,
      // so risk multiplies the price of that leg; squaring keeps mild risk cheap.
      const penalty = (score: number) => {
        const risk = (100 - score) / 100;
        return 1 + risk * risk * 8;
      };
      const riskFactor = (nodeId: string | undefined, zoneIds: Record<string, number> | undefined) => {
        const node = nodeId ? nodeById.get(nodeId) : undefined;
        const nodeRisk = node ? penalty(securityIndex(node.country, node.id)) : 1;
        return Object.keys(zoneIds ?? {}).reduce(
          (factor, id) => factor * penalty(getZone(id)?.security ?? 100),
          nodeRisk,
        );
      };

      const runs: { key: RouteOptionKey; label: string; weight: Weight }[] = [
        { key: "cheapest", label: "Cheapest", weight: (e) => e.usd },
        { key: "fastest", label: "Fastest", weight: (e) => e.hours },
        { key: "most-direct", label: "Most Direct", weight: (e) => e.leg?.distanceKm ?? 0 },
      ];
      if (request.preferSafety && scoresSecurity) {
        runs.push({ key: "safest", label: "Safest", weight: (e) => e.usd * riskFactor(e.leg?.to, e.leg?.zones) });
      }

      const options: RouteOption[] = [];
      for (const run of runs) {
        const legs: RouteLeg[] = [];
        let ok = true;
        for (let i = 0; i < stops.length - 1; i++) {
          const source = stateKey(stops[i], HUB);
          const target = stateKey(stops[i + 1], HUB);
          const path = dijkstra(graph, source, target, run.weight);
          if (!path) {
            ok = false;
            break;
          }
          legs.push(...reconstructLegs(graph, path));
        }
        if (!ok || legs.length === 0) continue;

        const visited = [legs[0].from, ...legs.map((l) => l.to)];
        const crossed = [...new Set(legs.flatMap((l) => Object.keys(l.zones ?? {})))];
        const score = scoresSecurity
          ? routeSecurityIndex([
              ...visited.map((id) => securityIndex(nodeById.get(id)?.country ?? "", id)),
              ...crossed.map((id) => getZone(id)?.security ?? 100),
            ])
          : 0;
        const zoneLabels = crossed.map((id) => getZone(id)?.label ?? id);
        const option = combineLegs(legs, run.key, run.label, score, zoneLabels);
        if (!options.some((o) => routesEqual(o, option))) {
          options.push(option);
        }
      }

      return options;
    },
  };
}
