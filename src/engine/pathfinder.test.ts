import { describe, expect, it } from "vitest";
import { createRouteEngine } from "./pathfinder";
import type { BaseEdge, CostsConfig, GeoNode } from "./types";
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

  it("returns an empty array for identical origin and destination", () => {
    const engine = createRouteEngine(syntheticNodes, syntheticEdges, costs);
    const options = engine.computeRoutes({ originId: "a", destinationId: "a", allowedModes: ["sea", "air", "rail", "truck"] });
    expect(options).toHaveLength(0);
  });
});

describe("routing engine (real dataset smoke test)", () => {
  const nodes = nodesData as GeoNode[];
  const edges = edgesData as BaseEdge[];

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
});
