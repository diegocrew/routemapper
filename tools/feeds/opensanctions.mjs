/**
 * Sanctions exposure per country, from OpenSanctions (CC-BY 4.0), keyless.
 *
 * The full entity dump is hundreds of MB; the dataset's own statistics.json is
 * a few KB and carries what matters here.
 *
 * It offers two country signals and only one of them is meaningful. Target
 * counts per country say where sanctioned entities are *registered*, which
 * puts the United States near the top — plenty of US-registered entities
 * appear on other jurisdictions' lists. Scoring on that penalised the US,
 * India and Nigeria hardest, which is an artefact of company registration, not
 * risk.
 *
 * Programme identifiers (`AU-RUSSIA`, `UN-SC1718`, `AU-DPRK`) instead name the
 * country a regime is aimed *at*, so that is what is used: a country is
 * penalised for being the subject of sanctions programmes, weighted by how
 * many entities those programmes designate.
 */
import { fetchJson } from "../lib/http.mjs";

const INDEX = "https://data.opensanctions.org/datasets/latest/sanctions/index.json";

/** Programme-id tokens mapped to the country names this repo uses. */
const PROGRAM_COUNTRIES = {
  RUSSIA: "Russia",
  UKRAINE: "Ukraine",
  BELARUS: "Belarus",
  IRAN: "Iran",
  SYRIA: "Syria",
  DPRK: "North Korea",
  MYANMAR: "Myanmar",
  BURMA: "Myanmar",
  LIBYA: "Libya",
  SUDAN: "Sudan",
  SOMALIA: "Somalia",
  YEMEN: "Yemen",
  IRAQ: "Iraq",
  AFGHANISTAN: "Afghanistan",
  VENEZUELA: "Venezuela",
  NICARAGUA: "Nicaragua",
  CUBA: "Cuba",
  ZIM: "Zimbabwe",
  ZIMBABWE: "Zimbabwe",
  MALI: "Mali",
  DRC: "DR Congo",
  GUINEA: "Guinea",
  LEBANON: "Lebanon",
  HAITI: "Haiti",
  ERITREA: "Eritrea",
  BURUNDI: "Burundi",
  MOLDOVA: "Moldova",
  ETHIOPIA: "Ethiopia",
  NIGER: "Niger",
};

/** UN Security Council programmes name no country in the id itself. */
const UNSC_COUNTRIES = {
  SC1718: "North Korea",
  SC1737: "Iran",
  SC1970: "Libya",
  SC1591: "Sudan",
  SC2140: "Yemen",
  SC1533: "DR Congo",
  SC2127: "Central African Republic",
  SC2206: "South Sudan",
  SC1988: "Afghanistan",
  SC1518: "Iraq",
  SC2653: "Haiti",
};

function countryForProgram(id) {
  for (const token of String(id).toUpperCase().split(/[-_ ]+/)) {
    if (PROGRAM_COUNTRIES[token]) return PROGRAM_COUNTRIES[token];
    if (UNSC_COUNTRIES[token]) return UNSC_COUNTRIES[token];
  }
  return null;
}

export async function fetchSanctionsByCountry() {
  const index = await fetchJson(INDEX);
  if (!index.statistics_url) throw new Error("OpenSanctions index carries no statistics_url");
  const stats = await fetchJson(index.statistics_url);

  const byCountry = new Map();
  for (const program of stats.sanctions?.programs ?? []) {
    const country = countryForProgram(program.id);
    if (!country) continue;
    const current = byCountry.get(country) ?? { designations: 0, programs: 0 };
    current.designations += Number(program.count) || 0;
    current.programs += 1;
    byCountry.set(country, current);
  }
  return { byCountry, updatedAt: stats.last_change ?? index.updated_at ?? null };
}
