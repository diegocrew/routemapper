import { describe, expect, it } from "vitest";
import { borderDelay, borderStatus } from "./borderStatus";
import { buildGraph, stateKey } from "./graph";
import type { BaseEdge, CostsConfig, GeoNode } from "./types";
import costsData from "../data/costs.config.json";

const costs = costsData as CostsConfig;

const laredo: GeoNode = { id: "laredo", name: "Laredo", country: "United States", kind: "city", lat: 27.5, lon: -99.5 };
const monterrey: GeoNode = { id: "monterrey", name: "Monterrey", country: "Mexico", kind: "city", lat: 25.7, lon: -100.3 };
const houston: GeoNode = { id: "houston", name: "Houston", country: "United States", kind: "city", lat: 29.8, lon: -95.4 };

const congestion = { label: "US–Mexico border: 90 min median commercial wait", delayHours: 1.5 };

const hoursFor = (edge: BaseEdge, nodes: GeoNode[], delay?: typeof congestion) =>
  buildGraph(nodes, [edge], costs, new Set(["truck"]), {
    blockedZones: new Set(),
    isBorderClosed: () => undefined,
    borderDelay: delay ? () => delay : undefined,
  }).adjacency.get(stateKey(edge.from, "truck"))![0].hours;

describe("live border congestion", () => {
  it("adds the queue to a leg that crosses the border", () => {
    const edge: BaseEdge = { from: "laredo", to: "monterrey", mode: "truck" };
    const queued = hoursFor(edge, [laredo, monterrey], congestion);
    const clear = hoursFor(edge, [laredo, monterrey]);
    expect(queued - clear).toBeCloseTo(1.5, 6);
  });

  it("never removes the leg, however long the queue", () => {
    const edge: BaseEdge = { from: "laredo", to: "monterrey", mode: "truck" };
    const graph = buildGraph([laredo, monterrey], [edge], costs, new Set(["truck"]), {
      blockedZones: new Set(),
      isBorderClosed: () => undefined,
      borderDelay: () => ({ label: "shut", delayHours: 48 }),
    });
    // A fetched feed reports closures far more reliably than reopenings, so it
    // is only ever allowed to make a border slow, never to delete the corridor.
    const onward = graph.adjacency.get(stateKey("laredo", "truck"))!.filter((e) => e.leg);
    expect(onward.map((e) => e.leg!.to)).toEqual(["monterrey"]);
  });

  it("labels the leg so the route can say why it is slow", () => {
    const graph = buildGraph([laredo, monterrey], [{ from: "laredo", to: "monterrey", mode: "truck" }], costs, new Set(["truck"]), {
      blockedZones: new Set(),
      isBorderClosed: () => undefined,
      borderDelay: () => congestion,
    });
    expect(graph.adjacency.get(stateKey("laredo", "truck"))![0].leg?.borderDelay).toBe(congestion.label);
  });

  it("leaves a domestic leg alone", () => {
    const lookup = borderDelay({ excludeModes: [] });
    expect(lookup("United States", "United States", "truck")).toBeUndefined();
    const edge: BaseEdge = { from: "laredo", to: "houston", mode: "truck" };
    // The graph-level hook is only ever handed cross-border pairs by borderDelay().
    expect(hoursFor(edge, [laredo, houston])).toBeGreaterThan(0);
  });

  it("lets defense cargo through without the queue", () => {
    const lookup = borderDelay({ excludeModes: [], allowMilitaryNodes: true });
    expect(lookup("United States", "Mexico", "truck")).toBeUndefined();
  });

  it("holds every committed entry to a delay, not a closure", () => {
    for (const entry of borderStatus) {
      expect(entry.delayHours).toBeGreaterThanOrEqual(0);
      expect(entry.delayHours).toBeLessThanOrEqual(72);
    }
  });
});
