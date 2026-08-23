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
  /**
   * Countries whose operators may not cross this zone, for closures that turn
   * on who is travelling rather than on the corridor itself: Russian airspace
   * is shut to Western carriers and open to everyone else. A leg pays
   * `detourFactor` only when *both* ends are listed, since a lane with one
   * unbanned end still has an operator who can fly it straight, and a shipper
   * buys the cheapest capacity going.
   */
  closedToCountries?: string[];
  /**
   * How much longer a leg gets when it has to route around this zone. Closed
   * airspace doesn't cancel a flight, it lengthens it — Helsinki–Tokyo runs a
   * couple of hours longer for a European carrier and is untouched for an
   * Emirati one, which is the whole competitive story of that lane.
   */
  detourFactor?: number;
  /** Months (1-12) the zone is unnavigable — ice, not politics. */
  closedMonths?: number[];
  /** Months when transit is slowed rather than stopped, and by how much. */
  delayMonths?: number[];
  delayFactor?: number;
  /** Set only on generated hazard zones. Earthquakes and volcanoes close a site outright; the rest only make it expensive to cross. */
  hazardKind?: "earthquake" | "wildfire" | "cyclone" | "flood" | "volcano" | "navwarning" | "conflict";
  /** ISO timestamp the hazard was detected/generated, set only on generated hazard zones. */
  detectedAt?: string;
  /**
   * Validity window, set on hazards that have one — a storm forecast is only
   * true for the hours it covers. A zone with no window is treated as in
   * effect whenever it is present in the data at all.
   */
  activeFrom?: string;
  activeUntil?: string;
  /** Set on zones extrapolated forward in time rather than observed. */
  forecast?: boolean;
  /**
   * Hand-drawn zones are rings; generated hazard zones are circles stored as
   * `center` + `radiusKm`, which is both far smaller on disk and much cheaper
   * to test against than a sampled ring. Exactly one of the two is set.
   */
  polygon?: [number, number][];
  center?: [number, number];
  radiusKm?: number;
}

/**
 * A restricted national airspace. Its outline deliberately isn't here: which
 * flights cross it is resolved offline by tools/generateAirspaceZones.mjs into
 * airEdgeZones.json, so the browser never carries a country polygon and never
 * tests one. That also keeps these out of the point-in-zone lookup, which is
 * right — an airport inside closed airspace is still a fine place to truck to.
 */
export interface AirspaceZone extends Zone {
  /** Country whose airspace this is; the offline tagger uses it to find the outline. */
  country: string;
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
  /** Read by tools/generate_sea_routes.py, not by the engine: how many nearest-port hops each port gets in seaEdges.json. */
  sea: { maxNeighbors: number };
  /** What a break of gauge costs on top of the leg itself: craning every container across, or swapping bogies, before the train goes on. */
  rail: { breakOfGaugeUsd: number; breakOfGaugeHours: number };
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
  /** Hours from departure to arriving at the end of this leg, so a leg can be checked against a hazard's validity window. */
  etaHours?: number;
  /** `[from, to]` track gauge in mm, set only on a rail leg whose ends are on incompatible track — the cargo is transshipped at the border. */
  breakOfGauge?: [number, number];
  /** Label of the live border congestion slowing this leg down, if any. */
  borderDelay?: string;
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
  /** Break-of-gauge transshipments along this route, e.g. "Warsaw · 1520→1435 mm". */
  transshipments: string[];
  /** Live border congestion on this route, from the fetched feeds rather than the curated closures. */
  borderDelays: string[];
  /** Set when this route crosses an active hazard zone — only possible at all for cargo with allowMilitaryNodes, since civilian cargo is blocked from hazard zones outright. */
  hazardWarnings: string[];
  /** Hazards on this route that the shipment outruns: forecast to have expired by the time it reaches them. */
  clearedHazards: string[];
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
  /** ISO date of departure. Hazards are applied only if their validity window covers the point in the journey where the shipment would actually meet them. */
  departureDate?: string;
  weightTonnes?: number;
  volumeM3?: number;
}
