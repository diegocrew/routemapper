export type Mode = "sea" | "air" | "rail" | "truck";

export type NodeKind = "capital" | "city" | "seaport" | "airport" | "railhub" | "military";

export interface GeoNode {
  id: string;
  name: string;
  country: string;
  kind: NodeKind;
  lat: number;
  lon: number;
}

export interface BaseEdge {
  from: string;
  to: string;
  mode: Mode;
}

export interface CostModeConfig {
  label: string;
  usdPerKm: number;
  kmPerHour: number;
  detourFactor: number;
  hubUsd: number;
  hubHours: number;
}

export interface CargoTypeConfig {
  label: string;
  excludeModes: Mode[];
  /** Military-kind nodes are off-limits to every cargo type except the one(s) with this set — that cargo type may use military nodes *and* ordinary civilian nodes. */
  allowMilitaryNodes?: boolean;
}

export interface CostsConfig {
  modes: Record<Mode, CostModeConfig>;
  truck: { maxLegKm: number; maxNeighbors: number };
  cargoTypes: Record<string, CargoTypeConfig>;
}

export interface RouteLeg {
  from: string;
  to: string;
  mode: Mode;
  distanceKm: number;
  usd: number;
  hours: number;
}

export type RouteOptionKey = "cheapest" | "fastest" | "most-direct";

export interface RouteOption {
  key: RouteOptionKey;
  label: string;
  legs: RouteLeg[];
  totalUsd: number;
  totalHours: number;
  transferCount: number;
}

export interface RouteRequest {
  originId: string;
  destinationId: string;
  allowedModes: Mode[];
  cargoType?: string;
  /** Node ids the route must pass through, in order, between origin and destination. */
  waypointIds?: string[];
}
