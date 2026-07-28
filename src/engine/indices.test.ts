import { describe, expect, it } from "vitest";
import { economicIndex, securityIndex, transitIndex } from "./indices";

describe("transitIndex", () => {
  it("scores 100 when all four modes are available", () => {
    expect(transitIndex(["sea", "air", "rail", "truck"])).toBe(100);
  });

  it("deducts 15 points per missing mode", () => {
    expect(transitIndex(["sea", "air", "rail"])).toBe(85);
    expect(transitIndex(["sea", "air"])).toBe(70);
    expect(transitIndex(["sea"])).toBe(55);
    expect(transitIndex([])).toBe(40);
  });
});

describe("economicIndex / securityIndex", () => {
  it("gives a top-tier country a base score of 90", () => {
    expect(economicIndex("some_unbonused_city", "Germany")).toBe(90);
    expect(securityIndex("Germany")).toBe(90);
  });

  it("applies a city-level bonus on top of the country base, clamped to 100", () => {
    expect(economicIndex("new_york", "United States")).toBe(100);
  });

  it("falls back to a mid-range default for an unrecognized country string", () => {
    expect(economicIndex("nowhere", "Fictionland")).toBe(30);
    expect(securityIndex("Fictionland")).toBe(50);
  });
});
