import type { GeoNode } from "../engine/types";
import type { NodeInfo } from "../engine/pathfinder";
import { NodeInfoCard } from "./NodeInfoCard";

type Role = "origin" | "destination" | "waypoint" | null;

interface CityDetailsProps {
  node: GeoNode;
  info: NodeInfo;
  currentRole: Role;
  onSetOrigin: () => void;
  onSetDestination: () => void;
  onAddWaypoint: () => void;
  onClose: () => void;
}

const ROLE_LABEL: Record<Exclude<Role, null>, string> = {
  origin: "Currently set as origin",
  destination: "Currently set as destination",
  waypoint: "Currently a required via point",
};

export function CityDetails({ node, info, currentRole, onSetOrigin, onSetDestination, onAddWaypoint, onClose }: CityDetailsProps) {
  return (
    <div className="field city-details">
      <div className="field-label-row">
        <span className="field-label">Selected location</span>
        <button className="close-btn" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="stop-row">
        <NodeInfoCard node={node} info={info} />
      </div>
      {currentRole && <p className="hint">{ROLE_LABEL[currentRole]}</p>}
      <div className="city-details-actions">
        <button onClick={onSetOrigin} disabled={currentRole === "origin"}>Set as Origin</button>
        <button onClick={onSetDestination} disabled={currentRole === "destination"}>Set as Destination</button>
        <button onClick={onAddWaypoint} disabled={currentRole === "waypoint"}>Add as Via Point</button>
      </div>
    </div>
  );
}
