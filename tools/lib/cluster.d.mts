/** Types for cluster.mjs, so the engine tests can exercise it without `any`. */
export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface PointCluster<T extends GeoPoint = GeoPoint> {
  centroid: GeoPoint;
  points: T[];
}

export function clusterPoints<T extends GeoPoint>(points: T[], linkKm: number): PointCluster<T>[];
export function clusterSpreadKm(cluster: PointCluster): number;
