import { expect, it } from "vitest";
import { sourceFreshness, type FeedSourceStatus } from "./feedFreshness";

const source: FeedSourceStatus = {
  id: "usgs", label: "USGS", status: "ok", lastSuccessAt: "2026-09-10T00:00:00Z",
  expiresAt: "2026-09-11T00:00:00Z", retainedZones: 0,
};

it("does not report an old successful refresh as current", () => {
  expect(sourceFreshness(source, Date.parse("2026-09-10T12:00:00Z"))).toBe("current");
  expect(sourceFreshness(source, Date.parse(source.expiresAt!))).toBe("unavailable");
  expect(sourceFreshness({ ...source, expiresAt: null }, Date.now())).toBe("unavailable");
});

it("distinguishes retained observations from unavailable data", () => {
  const now = Date.parse("2026-09-10T12:00:00Z");
  expect(sourceFreshness({ ...source, status: "stale", retainedZones: 2 }, now)).toBe("stale");
  expect(sourceFreshness({ ...source, status: "unavailable" }, now)).toBe("unavailable");
});