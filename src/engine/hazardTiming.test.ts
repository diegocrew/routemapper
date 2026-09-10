import { describe, expect, it, vi } from "vitest";
import { createRouteEngine } from "./pathfinder";
import type { BaseEdge, CostsConfig, GeoNode } from "./types";
import costsData from "../data/costs.config.json";

vi.mock("../data/hazardZones.json", () => ({
  default: [{
    id: "test-storm", label: "Test storm", access: "hazard", hazardKind: "cyclone",
    center: [100, 50], radiusKm: 10, security: 10, surchargeUsdPerKm: 5, tollUsd: 0,
    activeFrom: "2026-09-10T00:00:00Z", activeUntil: "2026-09-12T00:00:00Z",
  }],
}));

const nodes: GeoNode[] = [
  { id: "test-start", name: "Start", country: "X", kind: "seaport", lat: 0, lon: 0 },
  { id: "test-end", name: "End", country: "X", kind: "seaport", lat: 1, lon: 1 },
];
const edge: BaseEdge = { from: "test-start", to: "test-end", mode: "sea" };
const costs = costsData as CostsConfig;

describe("hazard timing in route results", () => {
  it.each(["2026-10-01", "2026-01-01"])("ignores hazards outside the planning window for %s", (departureDate) => {
    const plain = createRouteEngine(nodes, [edge], costs);
    const tagged = createRouteEngine(nodes, [{ ...edge, zones: { "test-storm": 10 } }], costs);
    for (const [originId, destinationId] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const request = { originId, destinationId, allowedModes: ["sea" as const], departureDate, preferSafety: true };
      const expected = plain.computeRoutes(request);
      const actual = tagged.computeRoutes(request);
      expect(actual.map(({ totalUsd, securityScore }) => ({ totalUsd, securityScore })))
        .toEqual(expected.map(({ totalUsd, securityScore }) => ({ totalUsd, securityScore })));
      expect(actual[0].zoneLabels).toEqual([]);
      expect(actual[0].hazardWarnings).toEqual([]);
      expect(actual[0].clearedHazards).toEqual([]);
    }
  });

  it("keeps active hazards in prices, scores and warnings", () => {
    const request = { originId: edge.from, destinationId: edge.to, allowedModes: ["sea" as const], departureDate: "2026-09-10" };
    const [plain] = createRouteEngine(nodes, [edge], costs).computeRoutes(request);
    const [tagged] = createRouteEngine(nodes, [{ ...edge, zones: { "test-storm": 10 } }], costs).computeRoutes(request);
    expect(tagged.totalUsd).toBeGreaterThan(plain.totalUsd);
    expect(tagged.securityScore).toBeLessThan(plain.securityScore);
    expect(tagged.hazardWarnings).toHaveLength(1);
  });
});