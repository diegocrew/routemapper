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
  it("reads the curated country score", () => {
    expect(economicIndex("some_unbonused_city", "Germany")).toBe(90);
    expect(securityIndex("Germany")).toBe(88);
  });

  it("applies a city-level bonus on top of the country base, clamped to 100", () => {
    expect(economicIndex("new_york", "United States")).toBe(100);
  });

  it("lets a city override its country's security score", () => {
    // The override is the final word for that node; the bare country score is
    // the curated base minus whatever live sanctions/conflict penalty applies,
    // so it is asserted as a bound rather than a fixed number.
    expect(securityIndex("Somalia", "mogadishu")).toBe(3);
    expect(securityIndex("Somalia")).toBeLessThanOrEqual(4);
  });

  it("penalises a sanctioned country below its curated score, and leaves others alone", () => {
    expect(securityIndex("Iran")).toBeLessThan(securityIndex("Switzerland"));
    expect(securityIndex("Germany")).toBe(88);
  });

  it("falls back to a mid-range default for an unrecognized country string", () => {
    expect(economicIndex("nowhere", "Fictionland")).toBe(30);
    expect(securityIndex("Fictionland")).toBe(50);
  });
});
