import type { CargoClass, CargoRule, CostsConfig } from "./types";

/**
 * A shipment is described by what it is (civilian or defense freight) and how it
 * has to be handled (hazmat, cold chain, high value), rather than by one cargo
 * type out of a fixed list — the handling flags combine, so a refrigerated
 * hazardous load is simply both sets of rules at once.
 */
export function resolveCargo(
  costs: CostsConfig,
  cargoClass: CargoClass | undefined,
  handling: string[] | undefined,
): CargoRule {
  const base = cargoClass ? costs.cargoClasses[cargoClass] : undefined;
  const flags = (handling ?? []).map((id) => costs.cargoHandling[id]).filter((flag) => flag !== undefined);

  return {
    excludeModes: [...new Set(flags.flatMap((flag) => flag.excludeModes ?? []))],
    allowMilitaryNodes: base?.allowMilitaryNodes,
    alwaysSafest: flags.some((flag) => flag.alwaysSafest),
  };
}
