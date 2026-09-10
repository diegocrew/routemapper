import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, fetchText } from "../lib/http.mjs";
import { fetchEarthquakeZones } from "./usgs.mjs";
import { fetchGdacsZones } from "./gdacs.mjs";
import { fetchStormZones } from "./nhc.mjs";
import { fetchNavWarningZones } from "./nga.mjs";
import { fetchWildfireZones } from "./firms.mjs";

vi.mock("../lib/http.mjs", () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("hazard feed response contracts", () => {
  it.each([
    ["USGS", fetchEarthquakeZones, { features: [] }],
    ["GDACS", fetchGdacsZones, { features: [] }],
    ["NHC", fetchStormZones, { activeStorms: [] }],
    ["NGA", fetchNavWarningZones, { "broadcast-warn": [] }],
  ])("distinguishes an empty %s response from an error payload", async (_name, fetchZones, empty) => {
    fetchJson.mockResolvedValueOnce(empty).mockResolvedValueOnce({ error: "Unavailable" });
    await expect(fetchZones()).resolves.toEqual([]);
    await expect(fetchZones()).rejects.toThrow();
  });

  it("treats missing FIRMS credentials as unavailable", async () => {
    vi.stubEnv("FIRMS_API_KEY", "");
    await expect(fetchWildfireZones()).rejects.toThrow("FIRMS_API_KEY");
    expect(fetchText).not.toHaveBeenCalled();
  });

  it("accepts header-only FIRMS data but rejects an error body", async () => {
    vi.stubEnv("FIRMS_API_KEY", "test-placeholder");
    fetchText.mockResolvedValueOnce("latitude,longitude,confidence,frp\n").mockResolvedValueOnce("Invalid request");
    await expect(fetchWildfireZones()).resolves.toEqual([]);
    await expect(fetchWildfireZones()).rejects.toThrow("Invalid FIRMS response");
  });
});