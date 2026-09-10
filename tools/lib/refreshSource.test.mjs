import { describe, expect, it } from "vitest";
import { refreshSource } from "./refreshSource.mjs";

const now = "2026-09-10T12:00:00.000Z";
const previousZones = [{ id: "fire_test", detectedAt: "2026-09-10T06:00:00.000Z" }, { id: "quake_other" }];
const options = { id: "firms", label: "NASA FIRMS", prefix: "fire_", previousZones, now };
const failedFetch = async () => { throw new Error("Unavailable"); };

describe("source refresh retention", () => {
  it("clears previous zones on a successful empty response", async () => {
    const result = await refreshSource({ ...options, fetchZones: async () => [] });
    expect(result.zones).toEqual([]);
    expect(result.status.status).toBe("ok");
    expect(result.status.lastSuccessAt).toBe(now);
  });

  it("retains only the failed source within a bounded window", async () => {
    const result = await refreshSource({ ...options, fetchZones: failedFetch });
    expect(result.zones).toEqual([{ ...previousZones[0], activeUntil: "2026-09-11T06:00:00.000Z" }]);
    expect(result.status.status).toBe("stale");
    const repeated = await refreshSource({ ...options, fetchZones: failedFetch, previousZones: result.zones, previousStatus: result.status, now: "2026-09-11T07:00:00.000Z" });
    expect(repeated.zones).toEqual([]);
    expect(repeated.status.status).toBe("unavailable");
  });

  it("does not retain expired forecasts or undated observations", async () => {
    const result = await refreshSource({ ...options, fetchZones: failedFetch, previousZones: [
      { ...previousZones[0], activeUntil: "2026-09-10T11:00:00.000Z" },
      { id: "fire_undated" },
    ] });
    expect(result.zones).toEqual([]);
  });

  it("expires fresh observations but preserves forecast windows", async () => {
    const result = await refreshSource({ ...options, fetchZones: async () => [previousZones[0], { id: "fire_forecast", activeUntil: "2026-09-10T18:00:00.000Z" }] });
    expect(result.zones[0].activeUntil).toBe("2026-09-11T12:00:00.000Z");
    expect(result.zones[1].activeUntil).toBe("2026-09-10T18:00:00.000Z");
  });
});