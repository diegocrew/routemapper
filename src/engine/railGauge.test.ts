import { describe, expect, it } from "vitest";
import { breakOfGauge, gaugeLabel, gaugeOf } from "./railGauge";
import type { GeoNode } from "./types";

const node = (id: string, country: string): GeoNode => ({
  id,
  name: id,
  country,
  kind: "railhub",
  lat: 0,
  lon: 0,
});

describe("track gauge", () => {
  it("reads a country's gauge, falling back to standard gauge", () => {
    expect(gaugeOf(node("warsaw", "Poland"))).toBe(1435);
    expect(gaugeOf(node("minsk", "Belarus"))).toBe(1520);
    expect(gaugeOf(node("madrid", "Spain"))).toBe(1668);
    expect(gaugeOf(node("nowhere", "Atlantis"))).toBe(1435);
  });

  it("finds no break between two countries on the same gauge", () => {
    expect(breakOfGauge(node("warsaw", "Poland"), node("berlin", "Germany"))).toBeNull();
    expect(breakOfGauge(node("riga", "Latvia"), node("vilnius", "Lithuania"))).toBeNull();
  });

  it("finds a break on the Russian-gauge and Iberian-gauge borders", () => {
    expect(breakOfGauge(node("minsk", "Belarus"), node("warsaw", "Poland"))).toEqual([1520, 1435]);
    expect(breakOfGauge(node("madrid", "Spain"), node("paris", "France"))).toEqual([1668, 1435]);
    expect(breakOfGauge(node("xian", "China"), node("khorgos", "Kazakhstan"))).toEqual([1435, 1520]);
  });

  it("treats 1520 and 1524 mm as one network", () => {
    // Finnish and Russian wagons run through: the 4 mm is within tolerance, and
    // comparing the numbers alone would invent a transshipment that never happens.
    expect(breakOfGauge(node("helsinki", "Finland"), node("moscow", "Russia"))).toBeNull();
  });

  it("labels a break in the direction of travel", () => {
    expect(gaugeLabel([1520, 1435])).toBe("1520→1435 mm");
  });
});
