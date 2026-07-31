import indicesData from "../data/indices.json";
import type { Mode } from "./types";

interface CountryTier {
  econ: number;
  sec: number;
}

const countryTiers = indicesData.countryTiers as Record<string, CountryTier>;
const cityEconomicBonus = indicesData.cityEconomicBonus as Record<string, number>;

const DEFAULT_TIER: CountryTier = { econ: 2, sec: 3 };

function tierToScore(tier: number): number {
  return tier * 20 - 10;
}

export function economicIndex(nodeId: string, country: string): number {
  const tier = countryTiers[country] ?? DEFAULT_TIER;
  const bonus = cityEconomicBonus[nodeId] ?? 0;
  return Math.max(0, Math.min(100, tierToScore(tier.econ) + bonus));
}

export function securityIndex(country: string): number {
  const tier = countryTiers[country] ?? DEFAULT_TIER;
  return Math.max(0, Math.min(100, tierToScore(tier.sec)));
}

/** Below this a route is flagged and a safer alternative is offered. */
export const SECURITY_ALERT_THRESHOLD = 30;

/**
 * Security accumulated over every stop, weighted so the weakest link dominates:
 * one hostile transhipment point should sink a route that is otherwise safe,
 * while a route that is merely mediocre throughout still scores mediocre.
 */
export function routeSecurityIndex(stopScores: number[]): number {
  if (stopScores.length === 0) return 0;
  const worst = Math.min(...stopScores);
  const mean = stopScores.reduce((sum, s) => sum + s, 0) / stopScores.length;
  return Math.round(0.6 * worst + 0.4 * mean);
}

const ALL_MODES: Mode[] = ["sea", "air", "rail", "truck"];

/** 100 minus 15 points per transport mode not available at this node — a full multi-modal hub trades cargo between types easily, a single-mode node can't. */
export function transitIndex(availableModes: Mode[]): number {
  const missing = ALL_MODES.filter((m) => !availableModes.includes(m)).length;
  return Math.max(0, 100 - missing * 15);
}
