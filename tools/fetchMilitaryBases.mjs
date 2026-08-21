/**
 * Imports the world's military installations from Wikidata into
 * src/data/militaryBases.json, which is merged with the hand-curated
 * src/data/nodes.json everywhere nodes are read.
 *
 * Scope matches https://en.wikipedia.org/wiki/Lists_of_military_installations:
 * anything in the "military base" subclass tree that is still active, has
 * coordinates, and has an English Wikipedia article (the notability filter that
 * keeps this to installations those lists actually cover, rather than every
 * tagged barracks). Police/gendarmerie barracks are excluded — they are in the
 * same Wikidata tree but are not military logistics sites.
 *
 * On top of that, a node here has to be somewhere freight could plausibly move
 * through. Barracks, cantonments, radar/listening stations and the Royal Navy's
 * "stone frigate" shore establishments are accommodation, training and signals
 * sites with no berth or apron, and they dominated the raw import across the UK
 * and western Europe. Airfields additionally have to show evidence of a real
 * runway (an ICAO/IATA code or a mapped runway), which is what separates a
 * working air base from a non-flying station that kept the name.
 *
 * Usage: node tools/fetchMilitaryBases.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readCuratedNodes } from "./lib/nodes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENDPOINT = "https://query.wikidata.org/sparql";
const PAGE_SIZE = 1000;
/** An imported base this close to a hand-curated node is the same place under a different name. */
const DUPLICATE_KM = 3;

// Wikidata's country labels are its own; the rest of this repo (indices.json,
// restrictions.json) uses short common names.
const COUNTRY_ALIASES = {
  "United States of America": "United States",
  "People's Republic of China": "China",
  "Republic of Korea": "South Korea",
  "Democratic People's Republic of Korea": "North Korea",
  "Republic of Ireland": "Ireland",
  "Kingdom of the Netherlands": "Netherlands",
  "Czech Republic": "Czechia",
  "Russian Federation": "Russia",
  "Republic of China": "Taiwan",
  "United Republic of Tanzania": "Tanzania",
  "Republic of the Congo": "Congo",
  "Democratic Republic of the Congo": "DR Congo",
  "Kingdom of Denmark": "Denmark",
  "State of Palestine": "Palestine",
  "Myanmar": "Myanmar",
  "Eswatini": "Eswatini",
};

// Wikidata classes with no transit function of their own. Carrying any of them
// is disqualifying: the handful of sites tagged both "barracks" and something
// broader are accommodation first, whatever else they are also called.
const NON_TRANSIT_CLASSES = new Set([
  "Q131263", // barracks
  "Q116257904", // former barracks
  "Q134318865", // Carabinieri barracks
  "Q7619063", // naval shore establishment ("stone frigate" — a unit, not a port)
  "Q57178953", // cantonment town
  "Q5034013", // cantonment
  "Q2543279", // cantonment
  "Q111212994", // cantonment in India
  "Q133288241", // military radar station
  "Q6646468", // listening station
  "Q1229395", // Distant Early Warning Line
  "Q7708182", // Texas Tower
  "Q1321241", // outpost
  "Q21193688", // missile base
]);

// Airfield classes, which only count as transit points with evidence of a runway.
const AIRFIELD_CLASSES = new Set([
  "Q695850", // airbase
  "Q7373622", // Royal Air Force station
  "Q130008763", // Royal Air Force aerodrome
  "Q6981985", // naval air station
  "Q71754457", // Royal Naval Air Service station
  "Q129004351", // Royal Naval Air Station
  "Q1593547", // Heeresflugplatz
  "Q1428515", // Fliegerhorst
  "Q5127959", // Class A airfield
  "Q92547605", // airbase annex
]);

/** Training, education and heritage sites arrive as a generic "military base" — nothing in their Wikidata classes separates them, but their names do. ("Fort X" is deliberately absent: it is how half the US Army names an active post.) */
const NON_TRANSIT_NAME =
  /\b(academy|academies|training|school|college|university|museum|memorial|cemetery|hospital|barracks|lines|towers|castle|ch[âa]teau|fortress|fortification|citadel|redoubt|stalag|oflag|prisoner)\b/i;

const query = (offset) => `
SELECT ?item ?article ?countryLabel ?coord ?cls ?icao ?iata ?runway WHERE {
  ?item wdt:P31 ?cls ;
        wdt:P625 ?coord .
  ?cls wdt:P279* wd:Q245016 .
  FILTER NOT EXISTS { ?item wdt:P576 ?dissolved }
  # An end date or a heritage listing both mean the site is history, not infrastructure — this is what keeps the Georgian naval dockyards out.
  FILTER NOT EXISTS { ?item wdt:P582 ?endTime }
  FILTER NOT EXISTS { ?item wdt:P1435 ?heritage }
  FILTER NOT EXISTS { ?item wdt:P31/wdt:P279* wd:Q1195942 }
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
  # P17 often still carries the historical state a site was built under (Empire
  # of Japan, Soviet Union, British Raj); only a country that hasn't been
  # dissolved is useful for routing.
  OPTIONAL {
    ?item wdt:P17 ?country .
    FILTER NOT EXISTS { ?country wdt:P576 ?ceased }
  }
  OPTIONAL { ?item wdt:P239 ?icao }
  OPTIONAL { ?item wdt:P238 ?iata }
  OPTIONAL { ?item wdt:P529 ?runway }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?item
LIMIT ${PAGE_SIZE} OFFSET ${offset}
`;

async function fetchPage(offset) {
  // The public endpoint returns an occasional 429/502 under load; the query itself is fine on retry.
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query(offset))}`, {
      headers: {
        Accept: "application/sparql-results+json",
        // Wikidata blocks unidentified clients, and asks for a contact URL.
        "User-Agent": "routemapper/1.0 (https://github.com/diegocrew/routemapper)",
      },
    });
    if (res.ok) return (await res.json()).results.bindings;
    if (attempt >= 5) throw new Error(`Wikidata query failed at offset ${offset}: ${res.status}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
  }
}

/** "Point(12.34 56.78)" -> { lon, lat } */
function parsePoint(wkt) {
  const match = /^Point\(([-\d.eE]+) ([-\d.eE]+)\)$/.exec(wkt);
  if (!match) return null;
  return { lon: Number(match[1]), lat: Number(match[2]) };
}

function slugify(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const rows = [];
for (let offset = 0; ; offset += PAGE_SIZE) {
  const page = await fetchPage(offset);
  rows.push(...page);
  console.log(`fetched ${rows.length} rows`);
  if (page.length < PAGE_SIZE) break;
}

const curated = readCuratedNodes(ROOT);
const takenIds = new Set(curated.map((n) => n.id));
const bases = [];
let duplicates = 0;
let notTransit = 0;

// One row per class/country/code combination, so fold them back into one record per item.
const byItem = new Map();
for (const row of rows) {
  const key = row.item.value;
  let entry = byItem.get(key);
  if (!entry) {
    entry = { row, classes: new Set(), hasRunway: false };
    byItem.set(key, entry);
  }
  if (!entry.row.countryLabel && row.countryLabel) entry.row = row;
  entry.classes.add(row.cls.value.split("/").pop());
  if (row.icao || row.iata || row.runway) entry.hasRunway = true;
}

/** Freight has to be able to get in or out: a berth, an apron, or a base big enough to hold materiel. */
function isTransitPoint({ classes, hasRunway }, name) {
  if (NON_TRANSIT_NAME.test(name)) return false;
  if ([...classes].some((c) => NON_TRANSIT_CLASSES.has(c))) return false;
  const nonAirfield = [...classes].filter((c) => !AIRFIELD_CLASSES.has(c));
  return nonAirfield.length > 0 || hasRunway;
}

for (const entry of byItem.values()) {
  const row = entry.row;
  const point = parsePoint(row.coord.value);
  if (!point || Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) continue;

  // The Wikipedia article title is the name those lists use; the raw label is often a bare QID for sparse items.
  const name = decodeURIComponent(row.article.value.split("/wiki/").pop()).replace(/_/g, " ");
  if (/^Q\d+$/.test(name)) continue;

  if (!isTransitPoint(entry, name)) {
    notTransit++;
    continue;
  }

  const near = curated.find((n) => haversineKm(n, point) <= DUPLICATE_KM);
  if (near) {
    duplicates++;
    continue;
  }

  const rawCountry = row.countryLabel?.value ?? "";
  const country = COUNTRY_ALIASES[rawCountry] ?? rawCountry;
  if (!country || /^Q\d+$/.test(country)) continue;

  let id = slugify(name);
  if (!id) continue;
  if (takenIds.has(id)) {
    let suffix = 2;
    while (takenIds.has(`${id}_${suffix}`)) suffix++;
    id = `${id}_${suffix}`;
  }
  takenIds.add(id);

  bases.push({
    id,
    name,
    country,
    kind: "military",
    lat: Number(point.lat.toFixed(4)),
    lon: Number(point.lon.toFixed(4)),
  });
}

bases.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(
  path.join(ROOT, "src/data/militaryBases.json"),
  `[\n${bases.map((b) => JSON.stringify(b)).join(",\n")}\n]\n`,
  "utf8",
);

const byCountry = {};
for (const base of bases) byCountry[base.country] = (byCountry[base.country] ?? 0) + 1;
const top = Object.entries(byCountry)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([c, n]) => `${c} ${n}`)
  .join(", ");
console.log(
  `Wrote ${bases.length} bases (${notTransit} dropped as non-transit sites, ${duplicates} as duplicates of curated nodes). Top: ${top}`,
);
