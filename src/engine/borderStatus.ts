import borderStatusData from "../data/borderStatus.json";
import type { CargoRule, Mode } from "./types";

export interface BorderStatus {
  id: string;
  countries: string[];
  modes: Mode[];
  label: string;
  /** Added to any matching leg. Never enough to remove it — see below. */
  delayHours: number;
  source: string;
  detectedAt: string;
  headline?: string;
}

export const borderStatus = borderStatusData as BorderStatus[];

/**
 * Live border conditions, as distinct from the standing closures in
 * restrictions.json: those are curated and block a border outright, while
 * everything here is fetched and only ever slows one down.
 *
 * The asymmetry is deliberate. A feed reports that a crossing shut far more
 * reliably than it reports that one reopened, so letting one delete a corridor
 * would reroute the world off a noisy week of headlines and quietly keep it
 * that way. Closing a border stays a decision someone makes on purpose.
 */
export function borderDelay(cargoRule: CargoRule) {
  if (cargoRule.allowMilitaryNodes) return () => undefined;

  return (fromCountry: string, toCountry: string, mode: Mode): BorderStatus | undefined => {
    if (fromCountry === toCountry) return undefined;
    return borderStatus.find(
      (entry) =>
        entry.modes.includes(mode) &&
        entry.countries.includes(fromCountry) &&
        entry.countries.includes(toCountry),
    );
  };
}
