"""
Builds the ocean network out of searoute's maritime graph.

Two jobs, because both of them need searoute loaded:

* curated sea edges in `edges.json` that were added without a `via` get real
  water-following geometry;
* `seaEdges.json` is rebuilt from scratch: every port's nearest few other
  ports, each pair routed through searoute. The curated trunk lanes alone
  averaged 2.5 lanes per port, which left the sea network hop-starved — a ship
  would sail past its actual port of call because the next port over happened
  to be the one with a curated onward link. Chaining short hops is how liner
  services (and the truck network here) already work; nobody sails
  great-circle for 8,000 km either.

Curated lanes always win: a pair already in `edges.json` is never generated,
so the hand-drawn river and canal corridors are left alone.

Usage: npm run generate:sea-routes
"""

import json
import math
from collections import defaultdict
from pathlib import Path

import searoute


ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data"
EDGES_PATH = DATA / "edges.json"
NODES_PATH = DATA / "nodes.json"
SEA_EDGES_PATH = DATA / "seaEdges.json"
COSTS_PATH = DATA / "costs.config.json"

EARTH_RADIUS_KM = 6371

# searoute snaps each end onto the nearest node of its maritime network, and a
# real port lands within a few tens of km. Anything much further away isn't on
# the ocean network at all — Vienna, Memphis and Asuncion are river cities
# hundreds of km inland, and a leg from one would open with a long straight
# line over land. Their legs stay curated, routed by generate:inland-routes.
MAX_SNAP_KM = 75

# A pair whose sea route runs this much longer than the straight line is a
# "nearest port" on paper only: the far side of an isthmus or a peninsula.
# Dijkstra gets there by chaining hops, so the direct edge is dead weight.
MAX_DETOUR_RATIO = 3.0

# Same shape as the truck generator: rank a wider candidate set by the distance
# that actually matters — sailed, not straight-line — and keep the nearest few.
CANDIDATE_FACTOR = 2


def haversine_km(a: dict, b: dict) -> float:
    lat1, lat2 = math.radians(a["lat"]), math.radians(b["lat"])
    d_lat = lat2 - lat1
    d_lon = math.radians(b["lon"] - a["lon"])
    h = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def point(lon: float, lat: float) -> dict:
    return {"lon": lon, "lat": lat}


def polyline_km(points: list) -> float:
    return sum(haversine_km(points[i], points[i + 1]) for i in range(len(points) - 1))


def sea_route(origin: dict, destination: dict):
    """The searoute path between two nodes, or None when searoute has none."""
    try:
        route = searoute.searoute(
            [origin["lon"], origin["lat"]],
            [destination["lon"], destination["lat"]],
            units="km",
        )
    except Exception:
        return None
    coordinates = route["geometry"]["coordinates"]
    if len(coordinates) < 2:
        return None
    return [[round(lon, 4), round(lat, 4)] for lon, lat in coordinates]


def format_edge(edge: dict, keys: tuple) -> str:
    fields = []
    for key in keys:
        if key not in edge:
            continue
        separators = (",", ":") if key in ("via", "zones") else (", ", ": ")
        value = json.dumps(edge[key], ensure_ascii=False, separators=separators)
        fields.append(f"{json.dumps(key)}: {value}")
    joined = ", ".join(fields)
    return "{ " + joined + " }"


def write_list(path: Path, edges: list, keys: tuple) -> None:
    body = ",\n  ".join(format_edge(edge, keys) for edge in edges)
    path.write_text("[\n  " + body + "\n]\n", encoding="utf-8")


edges = json.loads(EDGES_PATH.read_text(encoding="utf-8"))
# Only the curated nodes: the ~1,500 installations imported from Wikidata into
# militaryBases.json reach the network by road and air spokes, never by sea.
nodes = json.loads(NODES_PATH.read_text(encoding="utf-8"))
costs = json.loads(COSTS_PATH.read_text(encoding="utf-8"))
node_by_id = {node["id"]: node for node in nodes}
max_neighbors = costs["sea"]["maxNeighbors"]

# --- curated lanes missing geometry ----------------------------------------
missing = [edge for edge in edges if edge["mode"] == "sea" and not edge.get("via")]
for edge in missing:
    via = sea_route(node_by_id[edge["from"]], node_by_id[edge["to"]])
    if via is None:
        raise RuntimeError("No maritime path for {} -> {}".format(edge["from"], edge["to"]))
    edge["via"] = via
if missing:
    write_list(EDGES_PATH, edges, ("from", "to", "mode", "via", "zones"))
print(f"Generated geometry for {len(missing)} curated sea edges.")

# --- generated nearest-neighbour network -----------------------------------
curated_pairs = {tuple(sorted((e["from"], e["to"]))) for e in edges if e["mode"] == "sea"}
curated_ports = {port for pair in curated_pairs for port in pair}
# Every declared seaport, plus anything the curated lanes already treat as one
# (coastal capitals, naval bases). Growing the network's *reach* past that is a
# curation decision, not something to infer from proximity.
ports = sorted(
    (n for n in nodes if n["kind"] == "seaport" or n["id"] in curated_ports),
    key=lambda n: n["id"],
)
print(f"{len(ports)} ports, {len(curated_pairs)} curated lanes.")

pairs = set()
for origin in ports:
    nearest = sorted(ports, key=lambda other: haversine_km(origin, other))
    for other in nearest[1 : max_neighbors * CANDIDATE_FACTOR + 1]:
        pairs.add(tuple(sorted((origin["id"], other["id"]))))
pairs = sorted(pairs - curated_pairs)
print(f"routing {len(pairs)} candidate pairs...")

candidates = {}
unroutable = 0
off_network = defaultdict(int)
detours = 0
for pair in pairs:
    origin, destination = node_by_id[pair[0]], node_by_id[pair[1]]
    via = sea_route(origin, destination)
    if via is None:
        unroutable += 1
        continue
    # A leg is drawn (and costed) from the node itself through its via points,
    # so a distant snap shows up as a straight line over whatever lies between.
    snapped_far = False
    for node, end in ((origin, via[0]), (destination, via[-1])):
        if haversine_km(node, point(*end)) > MAX_SNAP_KM:
            off_network[node["id"]] += 1
            snapped_far = True
    if snapped_far:
        continue
    sailed_km = polyline_km([origin, *(point(*p) for p in via), destination])
    if sailed_km > haversine_km(origin, destination) * MAX_DETOUR_RATIO:
        detours += 1
        continue
    candidates[pair] = {"from": pair[0], "to": pair[1], "via": via, "km": sailed_km}

# Cap each port's own spokes, ranked by how far a ship actually sails. Curated
# lanes deliberately don't count against the cap: they are long trunk routes,
# and the whole point of this file is the short local hops they skip over.
by_port = defaultdict(list)
for pair, edge in candidates.items():
    by_port[edge["from"]].append(pair)
    by_port[edge["to"]].append(pair)
kept = set()
for spokes in by_port.values():
    spokes.sort(key=lambda pair: candidates[pair]["km"])
    kept.update(spokes[:max_neighbors])

generated = [candidates[pair] for pair in sorted(kept)]
write_list(SEA_EDGES_PATH, generated, ("from", "to", "via"))

print(f"  {unroutable} pairs with no maritime path")
print(f"  {detours} pairs dropped as detours over {MAX_DETOUR_RATIO}x the straight line")
if off_network:
    worst = sorted(off_network, key=lambda port: -off_network[port])
    print(f"  {len(worst)} ports further than {MAX_SNAP_KM} km from the maritime network: " + ", ".join(worst))
linked = {port for edge in generated for port in (edge["from"], edge["to"])}
print(f"Wrote {len(generated)} generated sea edges across {len(linked)} ports.")
