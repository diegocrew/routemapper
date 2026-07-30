const fs = require("node:fs");
const path = require("node:path");

const edgesPath = path.resolve(__dirname, "../src/data/edges.json");
const edges = JSON.parse(fs.readFileSync(edgesPath, "utf8"));
const missing = edges.filter((edge) => edge.mode === "sea" && (!edge.via || edge.via.length === 0));

if (missing.length > 0) {
  console.error(`${missing.length} sea edges have no routed geometry:`);
  for (const edge of missing) console.error(`- ${edge.from} -> ${edge.to}`);
  process.exitCode = 1;
} else {
  console.log("All sea edges have routed geometry.");
}