import type { BaseEdge, GeoNode } from "./types";
import truckEdgeData from "../data/truckEdges.json";

/**
 * Truck legs are resolved offline (`npm run generate:truck-edges`) instead of
 * from straight-line proximity in the browser: drivability depends on real
 * coastlines, so pairs are pre-checked against land polygons, and legs whose
 * straight line would cut across water carry a routed land corridor. Pairs on
 * different landmasses, or out of road range overland, are simply not in the file.
 */
export function buildTruckEdges(nodes: GeoNode[]): BaseEdge[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  return (truckEdgeData as { from: string; to: string; via?: [number, number][] }[])
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e) => ({ from: e.from, to: e.to, mode: "truck", via: e.via }));
}
