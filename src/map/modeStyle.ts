import type { Mode } from "../engine/types";

export const MODE_COLORS: Record<Mode, string> = {
  sea: "#38bdf8",
  air: "#f472b6",
  rail: "#fb923c",
  truck: "#4ade80",
};

export const MODE_DASH: Record<Mode, number[] | undefined> = {
  sea: undefined,
  air: [2, 2],
  rail: [4, 2],
  truck: [1, 2],
};

export const MODE_LABELS: Record<Mode, string> = {
  sea: "Ships",
  air: "Planes",
  rail: "Rail",
  truck: "Trucks",
};

export const KIND_COLORS: Record<string, string> = {
  capital: "#facc15",
  city: "#e2e8f0",
  seaport: "#38bdf8",
  airport: "#f472b6",
  railhub: "#fb923c",
  military: "#ef4444",
};

/** Distinct from KIND_COLORS.military — hazard zones are a temporary condition, not a permanent restricted site. */
export const HAZARD_COLOR = "#dc2626";

/** Per-hazard colours, so a cyclone track doesn't read as a wildfire at a glance. */
export const HAZARD_KIND_COLORS: Record<string, string> = {
  earthquake: "#dc2626",
  wildfire: "#f97316",
  cyclone: "#38bdf8",
  flood: "#3b82f6",
  volcano: "#a855f7",
  navwarning: "#facc15",
  conflict: "#f43f5e",
};
