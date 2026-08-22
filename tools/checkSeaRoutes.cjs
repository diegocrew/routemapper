const fs = require("node:fs");
const path = require("node:path");

const read = (file) => JSON.parse(fs.readFileSync(path.resolve(__dirname, "../src/data", file), "utf8"));
const curated = read("edges.json").filter((edge) => edge.mode === "sea");
const generated = read("seaEdges.json");
const missing = [...curated, ...generated].filter((edge) => !edge.via || edge.via.length === 0);

if (missing.length > 0) {
  console.error(`${missing.length} sea edges have no routed geometry:`);
  for (const edge of missing) console.error(`- ${edge.from} -> ${edge.to}`);
  process.exitCode = 1;
} else {
  console.log(`All ${curated.length + generated.length} sea edges have routed geometry.`);
}
