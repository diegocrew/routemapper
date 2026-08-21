const nga = await (
  await fetch("https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=A", {
    headers: { "User-Agent": "routemapper-probe/1.0" },
    signal: AbortSignal.timeout(30000),
  })
).json();
const warnings = nga["broadcast-warn"] ?? [];
console.log("NGA count:", warnings.length);
console.log("NGA keys:", Object.keys(warnings[0] ?? {}));
const withCoords = warnings.filter((w) => w.text && /\d+-\d+(\.\d+)?[NS]\s+\d+-\d+(\.\d+)?[EW]/.test(w.text));
console.log("NGA with parseable DMS coords in text:", withCoords.length);
console.log("NGA sample text:\n", (withCoords[0] ?? warnings[0])?.text?.slice(0, 500));
console.log("NGA navAreas:", JSON.stringify([...new Set(warnings.map((w) => w.navArea))]));
const cats = {};
for (const w of warnings) cats[w.subregion ?? "-"] = (cats[w.subregion ?? "-"] ?? 0) + 1;
console.log("NGA subregions (top):", Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 8));

const nhc = await (
  await fetch("https://www.nhc.noaa.gov/CurrentStorms.json", {
    headers: { "User-Agent": "routemapper-probe/1.0" },
    signal: AbortSignal.timeout(30000),
  })
).json();
console.log("\nNHC storms:", nhc.activeStorms?.length);
console.log("NHC sample:", JSON.stringify(nhc.activeStorms?.[0], null, 1).slice(0, 1600));
