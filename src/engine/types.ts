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
  /** Intermediate [longitude, latitude] points for a curated route corridor. */
  via?: [number, number][];
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
  /** Escorted cargo defends itself, so hostile stops along the way aren't scored or routed around. */
  ignoresSecurity?: boolean;
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
  via?: [number, number][];
}

export type RouteOptionKey = "cheapest" | "fastest" | "most-direct" | "safest";

export interface RouteOption {
  key: RouteOptionKey;
  label: string;
  legs: RouteLeg[];
  totalUsd: number;
  totalHours: number;
  transferCount: number;
  /** 0-100 across every stop on the route; 0 when the cargo type ignores security. */
  securityScore: number;
}

export interface RouteRequest {
  originId: string;
  destinationId: string;
  allowedModes: Mode[];
  cargoType?: string;
  /** Node ids the route must pass through, in order, between origin and destination. */
  waypointIds?: string[];
  /** Also return a route that trades cost for safer stops. */
  preferSafety?: boolean;
}
