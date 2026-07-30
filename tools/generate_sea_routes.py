import json
from pathlib import Path

import searoute


ROOT = Path(__file__).resolve().parent.parent
EDGES_PATH = ROOT / "src" / "data" / "edges.json"
NODES_PATH = ROOT / "src" / "data" / "nodes.json"


def format_edge(edge: dict) -> str:
    fields = [
        f'"from": {json.dumps(edge["from"], ensure_ascii=False)}',
        f'"to": {json.dumps(edge["to"], ensure_ascii=False)}',
        f'"mode": {json.dumps(edge["mode"])}',
    ]
    if "via" in edge:
        fields.append(f'"via": {json.dumps(edge["via"], separators=(",", ":"))}')
    return f'{{ {", ".join(fields)} }}'


edges = json.loads(EDGES_PATH.read_text(encoding="utf-8"))
nodes = json.loads(NODES_PATH.read_text(encoding="utf-8"))
node_by_id = {node["id"]: node for node in nodes}
missing = [edge for edge in edges if edge["mode"] == "sea" and not edge.get("via")]

for edge in missing:
    origin = node_by_id[edge["from"]]
    destination = node_by_id[edge["to"]]
    route = searoute.searoute(
        [origin["lon"], origin["lat"]],
        [destination["lon"], destination["lat"]],
        units="km",
    )
    coordinates = route["geometry"]["coordinates"]
    if len(coordinates) < 1:
        raise RuntimeError(f'No maritime path for {edge["from"]} -> {edge["to"]}')
    edge["via"] = [[round(lon, 4), round(lat, 4)] for lon, lat in coordinates]

content = "[\n  " + ",\n  ".join(format_edge(edge) for edge in edges) + "\n]\n"
EDGES_PATH.write_text(content, encoding="utf-8")
print(f"Generated geometry for {len(missing)} sea edges.")