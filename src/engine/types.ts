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
  /** Zone id -> km of this leg spent inside it, tagged offline. */
  zones?: Record<string, number>;
}

export interface Zone {
  id: string;
  label: string;
  /** 0-100, folded into a route's security score like any stop. */
  security: number;
  /** "hazard" zones are generated offline from live feeds and are blocked exactly like military-only ones, but flagged separately so military transit can carry a warning instead of being treated as a restricted site. */
  access: "open" | "military-only" | "hazard";
  /** War-risk insurance and escort costs, charged per km actually spent inside. */
  surchargeUsdPerKm: number;
  /** Flat transit fee, per container, charged once per leg that passes through. */
  tollUsd: number;
  /** Modes the zone applies to; all of them when omitted. */
  modes?: Mode[];
  /** Months (1-12) the zone is unnavigable — ice, not politics. */
  closedMonths?: number[];
  /** Months when transit is slowed rather than stopped, and by how much. */
  delayMonths?: number[];
  delayFactor?: number;
  /** Set only on generated hazard zones. Earthquakes and volcanoes close a site outright; the rest only make it expensive to cross. */
  hazardKind?: "earthquake" | "wildfire" | "cyclone" | "flood" | "volcano";
  /** ISO timestamp the hazard was detected/generated, set only on generated hazard zones. */
  detectedAt?: string;
  /**
   * Hand-drawn zones are rings; generated hazard zones are circles stored as
   * `center` + `radiusKm`, which is both far smaller on disk and much cheaper
   * to test against than a sampled ring. Exactly one of the two is set.
   */
  polygon?: [number, number][];
  center?: [number, number];
  radiusKm?: number;
}

export interface Restriction {
  id: string;
  label: string;
  countries: string[];
  /** When set, the ban applies between `countries` and these, not within either group. */
  pairsWith?: string[];
  modes: Mode[];
}

export interface CostModeConfig {
  label: string;
  usdPerKm: number;
  kmPerHour: number;
  detourFactor: number;
  hubUsd: number;
  hubHours: number;
  /** Largest single consignment the mode can carry; the mode is dropped above it. */
  maxTonnes?: number;
}

/** Freight tariffs taper with distance, so short hops are dearer per km than long hauls. */
export interface DistanceTier {
  /** Upper bound of this bracket in km; null for the remainder. */
  km: number | null;
  multiplier: number;
}

export interface CargoSizingConfig {
  defaultTonnes: number;
  /** One chargeable unit is roughly one container: this many tonnes or this many m3. */
  tonnesPerUnit: number;
  m3PerUnit: number;
}

export type CargoClass = "civilian" | "military";

export interface CargoClassConfig {
  label: string;
  /** Military-kind nodes are off-limits to every class except the one(s) with this set — that class may use military nodes *and* ordinary civilian ones. */
  allowMilitaryNodes?: boolean;
}

/** A handling requirement carried on top of a class, e.g. hazmat or cold chain. */
export interface CargoHandlingConfig {
  label: string;
  /** Shown instead of `label` under the military class. */
  militaryLabel?: string;
  excludeModes?: Mode[];
  /** Cargo that is a target in itself: the safest routing is worked out and offered without being asked for. */
  alwaysSafest?: boolean;
}

/** One shipment's class and handling flags folded into the rules routing actually applies. */
export interface CargoRule {
  excludeModes: Mode[];
  allowMilitaryNodes?: boolean;
  alwaysSafest?: boolean;
}

export interface HubEfficiencyConfig {
  /** Dwell and fee multipliers applied to a mode's flat hub overhead, interpolated by the node's economic score. */
  minDwellFactor: number;
  maxDwellFactor: number;
  minFeeFactor: number;
  maxFeeFactor: number;
}

export interface CostsConfig {
  modes: Record<Mode, CostModeConfig>;
  truck: { maxLegKm: number; maxNeighbors: number };
  hub: HubEfficiencyConfig;
  cargo: CargoSizingConfig;
  distanceTiers: DistanceTier[];
  cargoClasses: Record<CargoClass, CargoClassConfig>;
  cargoHandling: Record<string, CargoHandlingConfig>;
}

export interface RouteLeg {
  from: string;
  to: string;
  mode: Mode;
  distanceKm: number;
  usd: number;
  hours: number;
  via?: [number, number][];
  zones?: Record<string, number>;
}

export type RouteOptionKey = "cheapest" | "fastest" | "most-direct" | "safest";

export interface RouteOption {
  key: RouteOptionKey;
  label: string;
  legs: RouteLeg[];
  totalUsd: number;
  totalHours: number;
  transferCount: number;
  /** 0-100 across every stop and zone on the route. */
  securityScore: number;
  /** Labels of the risk zones this route passes through. */
  zoneLabels: string[];
  /** Set when this route crosses an active hazard zone — only possible at all for cargo with allowMilitaryNodes, since civilian cargo is blocked from hazard zones outright. */
  hazardWarnings: string[];
}

export interface RouteRequest {
  originId: string;
  destinationId: string;
  allowedModes: Mode[];
  cargoClass?: CargoClass;
  /** Handling flag ids (keys of `cargoHandling`) that apply to this shipment. */
  handling?: string[];
  /** Node ids the route must pass through, in order, between origin and destination. */
  waypointIds?: string[];
  /** Also return a route that trades cost for safer stops. */
  preferSafety?: boolean;
  /** Month of departure (1-12); drives seasonal closures and delays. */
  month?: number;
  weightTonnes?: number;
  volumeM3?: number;
}
