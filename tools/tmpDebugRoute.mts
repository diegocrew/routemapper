import { createRouteEngine } from "./src/engine/pathfinder.ts";
import nodesData from "./src/data/nodes.json" with { type: "json" };
import basesData from "./src/data/militaryBases.json" with { type: "json" };
import edgesData from "./src/data/edges.json" with { type: "json" };
import costsData from "./src/data/costs.config.json" with { type: "json" };
import { getZone } from "./src/engine/zones.ts";

const engine = createRouteEngine([...nodesData, ...basesData], edgesData, costsData);
const [route] = engine.computeRoutes({
  originId: "vienna",
  destinationId: "male",
  allowedModes: ["sea"],
});
console.log("legs:", route.legs.map((l) => `${l.from}->${l.to}`).join(" | "));
console.log("zones:", route.zoneLabels);
console.log("hazards:", route.hazardWarnings);
for (const l of route.legs) {
  const ids = Object.keys(l.zones ?? {});
  if (ids.length) console.log(" ", l.from, "->", l.to, ids.map((i) => getZone(i)?.hazardKind ?? i).join(","));
}
