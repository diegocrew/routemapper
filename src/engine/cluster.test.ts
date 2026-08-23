import { describe, expect, it } from "vitest";
// The clustering that turns a scatter of wildfire detections or conflict
// incidents into hazard circles lives in tools/, which the app never imports —
// but it decides the shape of every generated hazard zone, so it is worth
// holding to the behaviour the feeds assume of it.
import { clusterPoints, clusterSpreadKm } from "../../tools/lib/cluster.mjs";

const at = (lat: number, lon: number) => ({ lat, lon });

describe("point clustering", () => {
  it("groups points inside the link distance and separates ones outside it", () => {
    const clusters = clusterPoints([at(50, 30), at(50.1, 30.1), at(50.05, 30.05), at(10, -60)], 40);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.points.length).sort()).toEqual([1, 3]);
  });

  it("puts the centroid at the mean of its points", () => {
    const [cluster] = clusterPoints([at(10, 20), at(10.2, 20.2)], 100);
    expect(cluster.centroid.lat).toBeCloseTo(10.1, 6);
    expect(cluster.centroid.lon).toBeCloseTo(20.1, 6);
  });

  it("measures spread as the distance to the furthest point", () => {
    const [cluster] = clusterPoints([at(0, 0), at(0, 1)], 200);
    // A degree of longitude at the equator is ~111 km, and the centroid sits
    // halfway, so the furthest point is about half that away.
    expect(clusterSpreadKm(cluster)).toBeGreaterThan(50);
    expect(clusterSpreadKm(cluster)).toBeLessThan(60);
  });

  it("gives a lone point a cluster of its own with zero spread", () => {
    const clusters = clusterPoints([at(-33.9, 151.2)], 40);
    expect(clusters).toHaveLength(1);
    expect(clusterSpreadKm(clusters[0])).toBe(0);
  });

  it("handles an empty feed without inventing a zone", () => {
    expect(clusterPoints([], 40)).toEqual([]);
  });

  it("breaks a long chain into several clusters rather than one sprawling one", () => {
    // Linkage is to the centroid, not to the nearest point, and the centroid
    // lags behind as a chain extends — so a 200 km front comes out as a few
    // adjacent zones instead of one circle swallowing everything between the
    // ends. Worth pinning down: single-linkage on the same input would give one
    // cluster whose radius the downstream clamp would then have to fight.
    const chain = Array.from({ length: 6 }, (_, i) => at(50, 30 + i * 0.4));
    const clusters = clusterPoints(chain, 40);
    expect(clusters.length).toBeGreaterThan(1);
    expect(clusters.reduce((n, c) => n + c.points.length, 0)).toBe(6);
  });

  it("assigns every point to exactly one cluster", () => {
    const points = Array.from({ length: 200 }, (_, i) => at((i % 40) - 20, ((i * 7) % 90) - 45));
    const clusters = clusterPoints(points, 40);
    expect(clusters.reduce((n, c) => n + c.points.length, 0)).toBe(points.length);
  });
});
