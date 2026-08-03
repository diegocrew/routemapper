import restrictionsData from "../data/restrictions.json";
import type { CargoRule, Mode, Restriction } from "./types";

export const restrictions = restrictionsData as Restriction[];

/**
 * Closed borders, haulier bans and airspace closures, matched on the countries
 * at each end of a leg. `pairsWith` makes a rule one-sided: the ban applies
 * between the listed `countries` and any country in `pairsWith`, not within
 * either group. Defense cargo is not bound by any of it.
 */
export function borderCheck(cargoRule: CargoRule) {
  if (cargoRule.allowMilitaryNodes) return () => undefined;

  return (fromCountry: string, toCountry: string, mode: Mode): Restriction | undefined => {
    if (fromCountry === toCountry) return undefined; // a rule closes a border, never a domestic leg
    return restrictions.find((rule) => {
      if (!rule.modes.includes(mode)) return false;
      const left = rule.countries;
      const right = rule.pairsWith ?? rule.countries;
      return (
        (left.includes(fromCountry) && right.includes(toCountry)) ||
        (left.includes(toCountry) && right.includes(fromCountry))
      );
    });
  };
}
