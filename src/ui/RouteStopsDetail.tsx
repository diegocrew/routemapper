import type { GeoNode, RouteOption } from "../engine/types";
import type { NodeInfo } from "../engine/pathfinder";
import { NodeInfoCard } from "./NodeInfoCard";

interface RouteStopsDetailProps {
  route: RouteOption;
  nodes: GeoNode[];
  getNodeInfo: (nodeId: string) => NodeInfo;
}

export function RouteStopsDetail({ route, nodes, getNodeInfo }: RouteStopsDetailProps) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const stopIds = route.legs.length > 0 ? [route.legs[0].from, ...route.legs.map((l) => l.to)] : [];

  return (
    <div className="field">
      <span className="field-label">Stops on this route</span>
      <ol className="stops-list">
        {stopIds.map((id, i) => {
          const node = byId.get(id);
          if (!node) return null;
          return (
            <li key={`${id}-${i}`} className="stop-row">
              <NodeInfoCard node={node} info={getNodeInfo(id)} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
