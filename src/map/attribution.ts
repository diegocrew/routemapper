/**
 * Credit for the data this app ships, shown in the map's attribution control
 * alongside the basemap's own.
 *
 * Not merely courtesy: OpenSanctions and UCDP are CC-BY, so attribution is the
 * licence condition under which their data is here at all. The rest are public
 * bodies whose terms ask to be named. Anything added to the fetch tools in
 * tools/feeds/ belongs in this string too — the README's data-sources table is
 * the fuller version of the same list.
 */
const source = (name: string, href: string) => `<a href="${href}" target="_blank" rel="noreferrer">${name}</a>`;

export const DATA_ATTRIBUTION = [
  `Network: ${source("Natural Earth", "https://www.naturalearthdata.com/")}`,
  source("searoute", "https://github.com/genthalili/searoute-py"),
  source("Wikidata", "https://www.wikidata.org/"),
  `| Hazards: ${source("USGS", "https://earthquake.usgs.gov/")}`,
  source("GDACS", "https://www.gdacs.org/"),
  source("NOAA NHC", "https://www.nhc.noaa.gov/"),
  source("NGA", "https://msi.nga.mil/"),
  source("NASA FIRMS", "https://firms.modaps.eosdis.nasa.gov/"),
  source("UCDP", "https://ucdp.uu.se/"),
  `| Risk: ${source("OpenSanctions", "https://www.opensanctions.org/")}`,
  source("GDELT", "https://www.gdeltproject.org/"),
  `| Conditions: ${source("IMF PortWatch", "https://portwatch.imf.org/")}`,
  source("PEGELONLINE", "https://pegelonline.wsv.de/"),
  `| Borders: ${source("US CBP", "https://bwt.cbp.gov/")}`,
].join(", ").replace(/, \|/g, " |");
