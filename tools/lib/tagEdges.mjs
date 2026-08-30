/**
 * Which legs cross which zones, resolved offline so the browser never tests a
 * polygon at route time.
 *
 * Shared by the two zone pipelines — hazards every six hours, conflict once a
 * day — which tag the same edge set against different zone lists and write to
 * different files. Keeping one implementation means a leg is sampled the same
 * way whichever pipeline is asking.
 *
 * Air legs are absent on purpose: they are generated at runtime and there are
 * ~109k of them. The air side of a hazard is modelled as restricted airspace in
 * src/data/airspace.json instead.
 */
import fs from "node:fs";
import path from "node:path";

import { createZoneGrid, zonesOnEdge } from "./geo.mjs";
import { readNodes } from "./nodes.mjs";

export function tagEdgesWithZones(root, zones) {
  const read = (file) => JSON.parse(fs.readFileSync(path.join(root, "src/data", file), "utf8"));
  const nodes = readNodes(root);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const grid = createZoneGrid(zones);

  const tags = {};
  const tagList = (list, fallbackMode) => {
    for (const edge of list) {
      const mode = edge.mode ?? fallbackMode;
      const hit = zonesOnEdge(edge, mode, zones, nodeById, { grid });
      if (hit) tags[`${edge.from}|${edge.to}|${mode}`] = hit;
    }
  };

  tagList(read("edges.json"));
  tagList(read("seaEdges.json"), "sea");
  tagList(read("truckEdges.json"), "truck");
  return tags;
}
