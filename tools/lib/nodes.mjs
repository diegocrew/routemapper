/**
 * Nodes come from two files: the hand-curated src/data/nodes.json, and
 * src/data/militaryBases.json, imported from Wikidata by
 * tools/fetchMilitaryBases.mjs. Every tool that walks the network needs both.
 */
import fs from "node:fs";
import path from "node:path";

const read = (root, file) => JSON.parse(fs.readFileSync(path.join(root, "src/data", file), "utf8"));

export function readCuratedNodes(root) {
  return read(root, "nodes.json");
}

export function readNodes(root) {
  const bases = fs.existsSync(path.join(root, "src/data/militaryBases.json"))
    ? read(root, "militaryBases.json")
    : [];
  return [...read(root, "nodes.json"), ...bases];
}
