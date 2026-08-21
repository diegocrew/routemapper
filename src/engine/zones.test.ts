import { describe, expect, it } from "vitest";
import { createZoneIndex, zoneActiveAt, zoneActiveBetween } from "./zones";
import type { CargoRule, Zone } from "./types";

const civilian: CargoRule = { excludeModes: [] };
const military: CargoRule = { excludeModes: [], allowMilitaryNodes: true };

function square(centerLon: number, centerLat: number, half = 1): [number, number][] {
  return [
    [centerLon - half, centerLat - half],
    [centerLon + half, centerLat - half],
    [centerLon + half, centerLat + half],
    [centerLon - half, centerLat + half],
  ];
}

const hazardZone: Zone = {
  id: "quake_test",
  label: "Test earthquake",
  security: 20,
  access: "hazard",
  surchargeUsdPerKm: 0,
  tollUsd: 0,
  hazardKind: "earthquake",
  detectedAt: "2026-08-20T00:00:00.000Z",
  center: [0, 0],
  radiusKm: 120,
};

const wildfireZone: Zone = {
  id: "fire_test",
  label: "Test wildfire",
  security: 20,
  access: "hazard",
  surchargeUsdPerKm: 2,
  tollUsd: 0,
  hazardKind: "wildfire",
  detectedAt: "2026-08-20T00:00:00.000Z",
  center: [30, 30],
  radiusKm: 40,
};

const militaryZone: Zone = {
  id: "restricted_test",
  label: "Test restricted zone",
  security: 10,
  access: "military-only",
  surchargeUsdPerKm: 0,
  tollUsd: 0,
  polygon: square(50, 50),
};

const openZone: Zone = {
  id: "open_test",
  label: "Test open zone",
  security: 80,
  access: "open",
  surchargeUsdPerKm: 0.5,
  tollUsd: 10,
  polygon: square(100, 10),
};

describe("createZoneIndex", () => {
  it("blocks civilian cargo from an earthquake zone, same as a military-only zone", () => {
    const index = createZoneIndex([hazardZone, militaryZone, openZone]);
    const blocked = index.blockedZoneIds(civilian);
    expect(blocked.has("quake_test")).toBe(true);
    expect(blocked.has("restricted_test")).toBe(true);
    expect(blocked.has("open_test")).toBe(false);
  });

  it("lets civilian cargo cross a wildfire zone rather than deleting it from the network", () => {
    const index = createZoneIndex([wildfireZone, hazardZone]);
    const blocked = index.blockedZoneIds(civilian);
    expect(blocked.has("fire_test")).toBe(false);
    expect(blocked.has("quake_test")).toBe(true);
  });

  it("closes a site to civilian cargo for an eruption but not for a cyclone or flood", () => {
    const hazard = (id: string, hazardKind: Zone["hazardKind"]): Zone => ({
      ...wildfireZone,
      id,
      hazardKind,
    });
    const index = createZoneIndex([
      hazard("volcano_test", "volcano"),
      hazard("cyclone_test", "cyclone"),
      hazard("flood_test", "flood"),
    ]);
    const blocked = index.blockedZoneIds(civilian);
    expect([...blocked]).toEqual(["volcano_test"]);
  });

  it("lets military cargo through a hazard zone (blockedZoneIds empty)", () => {
    const index = createZoneIndex([hazardZone, militaryZone, openZone]);
    expect(index.blockedZoneIds(military).size).toBe(0);
  });

  it("tracks hazard zone ids separately from other access kinds", () => {
    const index = createZoneIndex([hazardZone, militaryZone, openZone]);
    expect(index.hazardZoneIds.has("quake_test")).toBe(true);
    expect(index.hazardZoneIds.has("restricted_test")).toBe(false);
    expect(index.hazardZoneIds.has("open_test")).toBe(false);
  });
  it("finds a point inside a hazard zone's circle, and not one outside it", () => {
    const index = createZoneIndex([hazardZone]);
    expect(index.zonesAt(0, 0).map((z) => z.id)).toEqual(["quake_test"]);
    expect(index.zonesAt(0, 2).map((z) => z.id)).toEqual([]);
    expect(index.zonesAt(80, 80)).toEqual([]);
  });

  it("still tests hand-drawn ring zones as polygons", () => {
    const index = createZoneIndex([openZone]);
    expect(index.zonesAt(100, 10).map((z) => z.id)).toEqual(["open_test"]);
    expect(index.zonesAt(103, 10)).toEqual([]);
  });
});

describe("zone validity windows", () => {
  const forecast: Zone = {
    ...wildfireZone,
    id: "storm_forecast",
    hazardKind: "cyclone",
    activeFrom: "2026-08-20T00:00:00.000Z",
    activeUntil: "2026-08-22T00:00:00.000Z",
  };
  const at = (iso: string) => Date.parse(iso);

  it("is in effect only inside its window", () => {
    expect(zoneActiveAt(forecast, at("2026-08-21T00:00:00Z"))).toBe(true);
    expect(zoneActiveAt(forecast, at("2026-08-19T00:00:00Z"))).toBe(false);
    expect(zoneActiveAt(forecast, at("2026-08-23T00:00:00Z"))).toBe(false);
  });

  it("counts as in effect when a journey window overlaps it at all", () => {
    expect(zoneActiveBetween(forecast, at("2026-08-18T00:00:00Z"), at("2026-08-25T00:00:00Z"))).toBe(true);
    expect(zoneActiveBetween(forecast, at("2026-08-23T00:00:00Z"), at("2026-08-25T00:00:00Z"))).toBe(false);
  });

  it("treats an observed hazard with no window as always in effect", () => {
    expect(zoneActiveAt(wildfireZone, at("2030-01-01T00:00:00Z"))).toBe(true);
  });
});
