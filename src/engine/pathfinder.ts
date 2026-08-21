import type { AdjEdge, Graph } from "./graph";
import { HUB, stateKey, computeAvailableModes } from "./graph";
import type { BaseEdge, CostsConfig, GeoNode, Mode, RouteLeg, RouteOption, RouteOptionKey, RouteRequest } from "./types";
import { buildGraph } from "./graph";
import { buildTruckEdges } from "./truckEdges";
import { buildAirEdges } from "./airEdges";
import { economicIndex, routeSecurityIndex, securityIndex, transitIndex } from "./indices";
import { blockedZoneIds, closedInMonth, edgeKey, getZone, hazardEdgeZones, hazardZoneIds, zoneActiveAt, zoneActiveBetween, zonesAt } from "./zones";
import { borderCheck } from "./restrictions";
import { resolveCargo } from "./cargo";

/** How far ahead a departure looks for hazards. Beyond this a forecast is noise, and nothing in the feeds forecasts further. */
const PLANNING_HORIZON_DAYS = 30;

/** What crossing each hazard actually means for the shipment, shown on the route card. */
const HAZARD_NOTES: Record<string, string> = {
  earthquake: "active hazard, military transit only",
  volcano: "erupting — site closed to civilian cargo",
  wildfire: "active wildfire on this leg, expect disruption",
  cyclone: "tropical cyclone on this leg, expect port closures and delay",
  flood: "flooding on this leg, expect road and rail disruption",
  navwarning: "navigational warning in force on this leg",
};

type Weight = (edge: AdjEdge) => number;

/** Binary min-heap keyed on tentative distance; lazily deleted, so entries can be stale. */
class Frontier {
  #items: { node: string; dist: number }[] = [];

  push(node: string, dist: number) {
    const items = this.#items;
    items.push({ node, dist });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].dist <= items[i].dist) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop() {
    const items = this.#items;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      while (true) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < items.length && items[l].dist < items[smallest].dist) smallest = l;
        if (r < items.length && items[r].dist < items[smallest].dist) smallest = r;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }

  get size() {
    return this.#items.length;
  }
}

function dijkstra(graph: Graph, source: string, target: string, weight: Weight): string[] | null {
  const dist = new Map<string, number>([[source, 0]]);
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  const frontier = new Frontier();
  frontier.push(source, 0);

  while (frontier.size > 0) {
    const { node: current, dist: currentDist } = frontier.pop();
    if (visited.has(current)) continue;
    if (current === target) break;
    visited.add(current);

    for (const edge of graph.adjacency.get(current) ?? []) {
      if (visited.has(edge.to)) continue;
      const next = currentDist + weight(edge);
      if (next < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, next);
        prev.set(edge.to, current);
        frontier.push(edge.to, next);
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
function reconstructLegs(graph: Graph, path: string[], units: number): RouteLeg[] {
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
        usd: (edge.usd + pendingUsd) * units,
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
  hazardWarnings: string[],
  clearedHazards: string[],
): RouteOption {
  const totalUsd = legs.reduce((sum, l) => sum + l.usd, 0);
  const totalHours = legs.reduce((sum, l) => sum + l.hours, 0);
  const transferCount = legs.slice(1).filter((l, i) => l.mode !== legs[i].mode).length;

  return { key, label, legs, totalUsd, totalHours, transferCount, securityScore, zoneLabels, hazardWarnings, clearedHazards };
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
  // Hazard-zone crossings are tagged separately from the hand-curated edge
  // files (see tools/fetchHazards.mjs) so the bot never rewrites them; merge
  // the two here so blocking/surcharge/seasonal logic downstream sees one
  // combined `zones` map per edge.
  const allEdges = [...curatedEdges, ...truckEdges, ...airEdges].map((e) => {
    const extra = hazardEdgeZones[edgeKey(e.from, e.to, e.mode)];
    return extra ? { ...e, zones: { ...e.zones, ...extra } } : e;
  });
  const availableModes = computeAvailableModes(nodes, allEdges);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // Rebuilding the graph walks ~110k edges, so it is kept per constraint set.
  // Consignment size deliberately isn't part of the key: it scales every price
  // by the same factor, so it can be applied to the finished legs instead.
  const graphCache = new Map<string, Graph>();
  const CACHE_LIMIT = 12;
  const cachedGraph = (key: string, build: () => Graph): Graph => {
    const hit = graphCache.get(key);
    if (hit) return hit;
    const graph = build();
    if (graphCache.size >= CACHE_LIMIT) graphCache.delete(graphCache.keys().next().value!);
    graphCache.set(key, graph);
    return graph;
  };

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
      const cargoRule = resolveCargo(costs, request.cargoClass, request.handling);
      const excluded = new Set(cargoRule.excludeModes);
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

      // A forecast hazard is only real if it is still running when the shipment
      // gets there. The planning window bounds what could possibly matter; the
      // per-leg check below is what decides whether it actually did.
      const departMs = request.departureDate ? Date.parse(request.departureDate) : Date.now();
      const horizonMs = departMs + PLANNING_HORIZON_DAYS * 24 * 3600 * 1000;
      const isZoneInEffect = (id: string) => {
        const zone = getZone(id);
        return zone ? zoneActiveBetween(zone, departMs, horizonMs) : true;
      };

      // Military-kind nodes are off-limits to every cargo type except one flagged
      // allowMilitaryNodes — and that cargo type can still freely use civilian
      // nodes too, it just isn't restricted the way everyone else is. The same
      // rule closes off nodes that sit inside a military-only zone.
      const blockedZones = new Set([...blockedZoneIds(cargoRule)].filter(isZoneInEffect));
      const inClosedZone = (n: GeoNode) => zonesAt(n.lon, n.lat).some((z) => blockedZones.has(z.id));
      const eligibleNodes = cargoRule.allowMilitaryNodes
        ? nodes
        : nodes.filter((n) => n.kind !== "military" && !inClosedZone(n));
      if (stops.some((id) => !eligibleNodes.some((n) => n.id === id))) return [];

      const handlingKey = [...(request.handling ?? [])].sort().join("+");
      // Bucketed by day: two departures on the same date see the same hazards.
      const dayKey = Math.floor(departMs / (24 * 3600 * 1000));
      const graphKey = `${[...allowedModes].sort().join(",")}|${request.cargoClass ?? ""}|${handlingKey}|${request.month ?? ""}|${dayKey}`;
      const graph = cachedGraph(graphKey, () =>
        buildGraph(eligibleNodes, allEdges, costs, allowedModes, {
          blockedZones: new Set([...blockedZones, ...closedInMonth(request.month)]),
          isBorderClosed: borderCheck(cargoRule),
          isZoneInEffect,
          month: request.month,
        }),
      );


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
      if (request.preferSafety) {
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
          legs.push(...reconstructLegs(graph, path, units));
        }
        if (!ok || legs.length === 0) continue;

        // Legs are walked in order so each one knows when the shipment reaches it.
        let elapsedHours = 0;
        for (const leg of legs) {
          elapsedHours += leg.hours;
          leg.etaHours = Math.round(elapsedHours);
        }

        const visited = [legs[0].from, ...legs.map((l) => l.to)];
        const crossed = [...new Set(legs.flatMap((l) => Object.keys(l.zones ?? {})))];
        const score = routeSecurityIndex([
          ...visited.map((id) => securityIndex(nodeById.get(id)?.country ?? "", id)),
          ...crossed.map((id) => getZone(id)?.security ?? 100),
        ]);
        const zoneLabels = crossed.map((id) => getZone(id)?.label ?? id);

        const hazardWarnings: string[] = [];
        const clearedHazards: string[] = [];
        for (const leg of legs) {
          const arrivalMs = departMs + (leg.etaHours ?? 0) * 3600 * 1000;
          for (const id of Object.keys(leg.zones ?? {})) {
            if (!hazardZoneIds.has(id)) continue;
            const zone = getZone(id);
            const label = zone?.label ?? id;
            if (zone && !zoneActiveAt(zone, arrivalMs)) {
              if (!clearedHazards.includes(label)) clearedHazards.push(label);
              continue;
            }
            const note = `${label} — ${HAZARD_NOTES[zone?.hazardKind ?? ""] ?? "active hazard on this leg"}`;
            if (!hazardWarnings.includes(note)) hazardWarnings.push(note);
          }
        }

        const option = combineLegs(legs, run.key, run.label, score, zoneLabels, hazardWarnings, clearedHazards);
        if (!options.some((o) => routesEqual(o, option))) {
          options.push(option);
        }
      }

      return options;
    },
  };
}
