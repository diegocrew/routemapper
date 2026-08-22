import { describe, expect, it } from "vitest";
import { airspaceOnLeg, airspaceZones } from "./airspace";
import { buildGraph, stateKey } from "./graph";
import type { BaseEdge, CostsConfig, GeoNode } from "./types";
import costsData from "../data/costs.config.json";

const costs = costsData as CostsConfig;

describe("restricted airspace", () => {
  it("resolves a leg's crossings in either direction", () => {
    // Helsinki to Japan is the textbook case: the great circle runs the length
    // of Siberia, which is why the lane got two hours longer for European
    // carriers in 2022 and stayed put for Gulf ones.
    expect(airspaceOnLeg("helsinki", "yokohama")).toContain("russia_airspace");
    expect(airspaceOnLeg("yokohama", "helsinki")).toContain("russia_airspace");
  });

  it("leaves a leg nowhere near restricted airspace untagged", () => {
    expect(airspaceOnLeg("frankfurt", "new_york")).toEqual([]);
  });

  it("charges no zone per km, since no distance is stored to charge against", () => {
    for (const zone of airspaceZones) expect(zone.surchargeUsdPerKm).toBe(0);
  });
});

describe("overflight bans in the graph", () => {
  // Two operators on one lane: only the nationality at the ends differs.
  const helsinki: GeoNode = { id: "helsinki", name: "H", country: "Finland", kind: "airport", lat: 60.17, lon: 24.94 };
  const dubai: GeoNode = { id: "dubai", name: "D", country: "United Arab Emirates", kind: "airport", lat: 25.2, lon: 55.27 };
  const tokyo: GeoNode = { id: "tokyo", name: "T", country: "Japan", kind: "airport", lat: 35.68, lon: 139.69 };

  const legHours = (nodes: GeoNode[], edge: BaseEdge, respectOverflightBans = true) => {
    const graph = buildGraph(nodes, [edge], costs, new Set(["air"]), {
      blockedZones: new Set(),
      isBorderClosed: () => undefined,
      respectOverflightBans,
    });
    return graph.adjacency.get(stateKey(edge.from, "air"))![0].hours;
  };

  const overRussia = { zones: { russia_airspace: 0 } };

  it("lengthens the leg for a banned operator instead of deleting it", () => {
    const banned = legHours([helsinki, tokyo], { from: "helsinki", to: "tokyo", mode: "air", ...overRussia });
    const clear = legHours([helsinki, tokyo], { from: "helsinki", to: "tokyo", mode: "air" });
    expect(banned).toBeGreaterThan(clear);
    expect(banned / clear).toBeCloseTo(1.18, 2);
  });

  it("leaves an operator the ban doesn't name flying straight through", () => {
    // The UAE is on nobody's reciprocal ban list, so the same airspace costs it nothing.
    const emirati = legHours([dubai, tokyo], { from: "dubai", to: "tokyo", mode: "air", ...overRussia });
    const clear = legHours([dubai, tokyo], { from: "dubai", to: "tokyo", mode: "air" });
    expect(emirati).toBeCloseTo(clear, 6);
  });

  it("lets defense cargo ignore the ban", () => {
    const withBans = legHours([helsinki, tokyo], { from: "helsinki", to: "tokyo", mode: "air", ...overRussia });
    const ignoring = legHours([helsinki, tokyo], { from: "helsinki", to: "tokyo", mode: "air", ...overRussia }, false);
    expect(ignoring).toBeLessThan(withBans);
  });
});
