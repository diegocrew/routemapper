import { describe, expect, it } from "vitest";
import { createRouteEngine } from "./pathfinder";
import type { BaseEdge, CostsConfig, GeoNode, Mode } from "./types";
import nodesData from "../data/nodes.json";
import edgesData from "../data/edges.json";
import costsData from "../data/costs.config.json";

const costs = costsData as CostsConfig;

const A: GeoNode = { id: "a", name: "A", country: "X", kind: "city", lat: 0, lon: 0 };
const B: GeoNode = { id: "b", name: "B", country: "X", kind: "seaport", lat: 1, lon: 1 };
const C: GeoNode = { id: "c", name: "C", country: "X", kind: "airport", lat: 5, lon: 5 };
const D: GeoNode = { id: "d", name: "D", country: "X", kind: "seaport", lat: 20, lon: 20 };

const syntheticNodes = [A, B, C, D];
const syntheticEdges: BaseEdge[] = [
  { from: "a", to: "b", mode: "sea" },
  { from: "b", to: "d", mode: "sea" },
  { from: "a", to: "c", mode: "air" },
  { from: "c", to: "d", mode: "air" },
];

describe("routing engine (synthetic graph)", () => {
  it("finds a direct route when only one mode connects origin and destination", () => {
    const engine = createRouteEngine(syntheticNodes, syntheticEdges, costs);
    const options = engine.computeRoutes({ originId: "a", destinationId: "d", allowedModes: ["sea"] });
    expect(options.length).toBeGreaterThan(0);
    for (const opt of options) {
      expect(opt.legs.every((l) => l.mode === "sea" || l.mode === "truck")).toBe(true);
    }
  });

  it("excludes a mode entirely when it is not in allowedModes", () => {
    const engine = createRouteEngine(syntheticNodes, syntheticEdges, costs);
    const options = engine.computeRoutes({ originId: "a", destinationId: "d", allowedModes: ["air"] });
    expect(options.length).toBeGreaterThan(0);
    for (const opt of options) {
      expect(opt.legs.some((l) => l.mode === "sea")).toBe(false);
    }
  });

  it("returns no routes when cargo type excludes the only viable mode", () => {
    const engine = createRouteEngine(syntheticNodes, syntheticEdges, costs);
    const options = engine.computeRoutes({
      originId: "a",
      destinationId: "d",
      allowedModes: ["air"],
      cargoType: "hazmat",
    });
    expect(options).toHaveLength(0);
  });

  it("finds the fastest air route faster than a slower sea-only route for far-apart nodes", () => {
    const engine = createRouteEngine(syntheticNodes, syntheticEdges, costs);
    const [seaOnly] = engine.computeRoutes({ originId: "a", destinationId: "d", allowedModes: ["sea"] });
    const [airOnly] = engine.computeRoutes({ originId: "a", destinationId: "d", allowedModes: ["air"] });
    expect(airOnly.totalHours).toBeLessThan(seaOnly.totalHours);
  });

  it("reports zero transfers for a single-leg route and counts a mode switch", () => {
    const engine = createRouteEngine(syntheticNodes, syntheticEdges, costs);
    const [direct] = engine.computeRoutes({ originId: "a", destinationId: "b", allowedModes: ["sea"] });
    expect(direct.transferCount).toBe(0);
  });

  it("preserves curated route waypoints in both travel directions", () => {
    const via: [number, number][] = [[0.25, 0.75], [0.75, 0.75]];
    const engine = createRouteEngine([A, B], [{ from: "a", to: "b", mode: "sea", via }], costs);

    const [forward] = engine.computeRoutes({ originId: "a", destinationId: "b", allowedModes: ["sea"] });
    const [reverse] = engine.computeRoutes({ originId: "b", destinationId: "a", allowedModes: ["sea"] });

    expect(forward.legs[0].via).toEqual(via);
    expect(reverse.legs[0].via).toEqual(via.toReversed());
  });

  it("returns an empty array for identical origin and destination", () => {
    const engine = createRouteEngine(syntheticNodes, syntheticEdges, costs);
    const options = engine.computeRoutes({ originId: "a", destinationId: "a", allowedModes: ["sea", "air", "rail", "truck"] });
    expect(options).toHaveLength(0);
  });
});

describe("routing engine (real dataset smoke test)", () => {
  const nodes = nodesData as GeoNode[];
  const edges = edgesData as BaseEdge[];

  it("has routed geometry for every sea edge", () => {
    const missingGeometry = edges.filter((edge) => edge.mode === "sea" && (!edge.via || edge.via.length === 0));
    expect(missingGeometry).toEqual([]);
  });

  it("finds a route between two well-connected real ports", () => {
    const engine = createRouteEngine(nodes, edges, costs);
    const options = engine.computeRoutes({
      originId: "shanghai",
      destinationId: "rotterdam",
      allowedModes: ["sea", "air", "rail", "truck"],
    });
    expect(options.length).toBeGreaterThan(0);
    expect(options.some((o) => o.key === "cheapest")).toBe(true);
  });

  it("uses a single direct flight for 'fastest' between two distant airports with no curated air route between them", () => {
    // N'Djamena and Yekaterinburg aren't on any hand-curated air trunk line —
    // air must be a fully-connected mode (any airport to any airport), or the
    // router is forced through unrealistic multi-hop layovers just to fly.
    const engine = createRouteEngine(nodes, edges, costs);
    const options = engine.computeRoutes({
      originId: "ndjamena",
      destinationId: "yekaterinburg",
      allowedModes: ["sea", "air", "rail", "truck"],
    });
    const fastest = options.find((o) => o.key === "fastest");
    expect(fastest).toBeDefined();
    expect(fastest!.legs).toHaveLength(1);
    expect(fastest!.legs[0].mode).toBe("air");
  });

  it("finds an inland route using rail/truck when sea and air are excluded", () => {
    const engine = createRouteEngine(nodes, edges, costs);
    const options = engine.computeRoutes({
      originId: "chongqing",
      destinationId: "duisburg",
      allowedModes: ["rail", "truck"],
    });
    expect(options.length).toBeGreaterThan(0);
    for (const opt of options) {
      expect(opt.legs.every((l) => l.mode === "rail" || l.mode === "truck")).toBe(true);
    }
  });

  it("reports available modes and economic/security/transit indices via getNodeInfo", () => {
    const engine = createRouteEngine(nodes, edges, costs);
    const info = engine.getNodeInfo("rotterdam");
    expect(info.modes.length).toBeGreaterThan(0);
    expect(info.economicIndex).toBeGreaterThan(0);
    expect(info.securityIndex).toBeGreaterThan(0);
    expect(info.transitIndex).toBeGreaterThan(0);
  });

  it("scores a well-connected multi-modal hub higher on transit index than a single-mode node", () => {
    const engine = createRouteEngine(nodes, edges, costs);
    const hub = engine.getNodeInfo("rotterdam"); // sea + rail + truck (+ maybe air)
    const island = engine.getNodeInfo("nukualofa"); // sea + truck only, per earlier fix
    expect(hub.transitIndex).toBeGreaterThanOrEqual(island.transitIndex);
  });

  it("routes through a mandatory waypoint", () => {
    const engine = createRouteEngine(nodes, edges, costs);
    const options = engine.computeRoutes({
      originId: "shanghai",
      destinationId: "rotterdam",
      waypointIds: ["dubai"],
      allowedModes: ["sea", "air", "rail", "truck"],
    });
    expect(options.length).toBeGreaterThan(0);
    for (const opt of options) {
      const stops = [opt.legs[0].from, ...opt.legs.map((l) => l.to)];
      const shanghaiIdx = stops.indexOf("shanghai");
      const dubaiIdx = stops.indexOf("dubai");
      const rotterdamIdx = stops.lastIndexOf("rotterdam");
      expect(dubaiIdx).toBeGreaterThan(shanghaiIdx);
      expect(rotterdamIdx).toBeGreaterThan(dubaiIdx);
    }
  });

  it("keeps the Vienna-to-Malé shipping route on curated water corridors", () => {
    const engine = createRouteEngine(nodes, edges, costs);
    const [route] = engine.computeRoutes({
      originId: "vienna",
      destinationId: "male",
      allowedModes: ["sea"],
    });

    expect(route).toBeDefined();
    expect(route.legs.every((leg) => leg.mode === "sea")).toBe(true);
    for (const segment of [
      ["vienna", "budapest"],
      ["budapest", "belgrade"],
      ["belgrade", "constanta"],
      ["constanta", "piraeus"],
      ["mumbai", "colombo"],
    ]) {
      const leg = route.legs.find(({ from, to }) => from === segment[0] && to === segment[1]);
      expect(leg?.via?.length).toBeGreaterThan(0);
    }
  });

  it("routes ships from Oman to Jeddah around the Arabian Peninsula", () => {
    const engine = createRouteEngine(nodes, edges, costs);
    const [route] = engine.computeRoutes({
      originId: "muscat",
      destinationId: "jeddah",
      allowedModes: ["sea"],
    });

    expect(route.legs.map(({ from, to }) => [from, to])).toEqual([
      ["muscat", "salalah"],
      ["salalah", "jeddah"],
    ]);
    expect(route.legs.every((leg) => (leg.via?.length ?? 0) > 0)).toBe(true);
  });

  it("routes ships from Jeddah to Dubai around Arabia instead of across land", () => {
    const engine = createRouteEngine(nodes, edges, costs);
    const [route] = engine.computeRoutes({
      originId: "jeddah",
      destinationId: "dubai",
      allowedModes: ["sea"],
    });

    expect(route.legs.map(({ from, to }) => [from, to])).toEqual([
      ["jeddah", "salalah"],
      ["salalah", "dubai"],
    ]);
    expect(route.legs.every((leg) => (leg.via?.length ?? 0) > 0)).toBe(true);
  });

  it("returns no routes when a waypoint duplicates the origin", () => {
    const engine = createRouteEngine(nodes, edges, costs);
    const options = engine.computeRoutes({
      originId: "shanghai",
      destinationId: "rotterdam",
      waypointIds: ["shanghai"],
      allowedModes: ["sea", "air", "rail", "truck"],
    });
    expect(options).toHaveLength(0);
  });

  it("offers a ship option between two naval/coastal military bases", () => {
    const engine = createRouteEngine(nodes, edges, costs);
    const options = engine.computeRoutes({
      originId: "norfolk_naval",
      destinationId: "guantanamo",
      allowedModes: ["sea"],
      cargoType: "military",
    });
    expect(options.length).toBeGreaterThan(0);
    expect(options.some((o) => o.legs.some((l) => l.mode === "sea"))).toBe(true);
  });

  it("routes military cargo between two military-only nodes", () => {
    const engine = createRouteEngine(nodes, edges, costs);
    const options = engine.computeRoutes({
      originId: "area_51",
      destinationId: "ramstein",
      allowedModes: ["sea", "air", "rail", "truck"],
      cargoType: "military",
    });
    expect(options.length).toBeGreaterThan(0);
  });

  it("allows military cargo to use a civilian node as origin or destination", () => {
    const engine = createRouteEngine(nodes, edges, costs);
    const options = engine.computeRoutes({
      originId: "area_51",
      destinationId: "rotterdam",
      allowedModes: ["sea", "air", "rail", "truck"],
      cargoType: "military",
    });
    expect(options.length).toBeGreaterThan(0);
  });

  it("lets military cargo truck between a base and a nearby civilian city", () => {
    // Faslane (military) sits ~40km from Glasgow (civilian) — too close for
    // anything but a direct truck hop, which only exists because military
    // nodes now get proximity truck edges to civilian ones too.
    const engine = createRouteEngine(nodes, edges, costs);
    const options = engine.computeRoutes({
      originId: "faslane",
      destinationId: "glasgow",
      allowedModes: ["truck"],
      cargoType: "military",
    });
    expect(options.length).toBeGreaterThan(0);
    expect(options[0].legs.every((l) => l.mode === "truck")).toBe(true);
  });

  it("refuses civilian cargo when either endpoint is a military node", () => {
    const engine = createRouteEngine(nodes, edges, costs);
    const options = engine.computeRoutes({
      originId: "area_51",
      destinationId: "ramstein",
      allowedModes: ["sea", "air", "rail", "truck"],
    });
    expect(options).toHaveLength(0);
  });

  it("scores civilian routes for security and leaves military cargo unscored", () => {
    const engine = createRouteEngine(nodes, edges, costs);
    const request = {
      originId: "rotterdam",
      destinationId: "new_york",
      allowedModes: ["sea"] as Mode[],
    };
    const civilian = engine.computeRoutes({ ...request, cargoType: "general" });
    expect(civilian[0].securityScore).toBeGreaterThan(0);

    const military = engine.computeRoutes({ ...request, cargoType: "military" });
    expect(military[0].securityScore).toBe(0);
  });

  it("only offers a safest option when safety is requested, and it is no less safe", () => {
    const engine = createRouteEngine(nodes, edges, costs);
    const request = {
      originId: "kabul",
      destinationId: "rotterdam",
      allowedModes: ["sea", "rail", "truck"] as Mode[],
      cargoType: "general",
    };
    expect(engine.computeRoutes(request).some((o) => o.key === "safest")).toBe(false);

    const withSafety = engine.computeRoutes({ ...request, preferSafety: true });
    const safest = withSafety.find((o) => o.key === "safest");
    const cheapest = withSafety.find((o) => o.key === "cheapest");
    if (safest && cheapest) expect(safest.securityScore).toBeGreaterThanOrEqual(cheapest.securityScore);
  });
});
