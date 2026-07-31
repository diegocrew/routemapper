import type { CSSProperties } from "react";
import type { GeoNode, Mode, RouteOption } from "../engine/types";
import type { NodeInfo } from "../engine/pathfinder";
import { NodePicker } from "./NodePicker";
import { RouteResults } from "./RouteResults";
import { RouteStopsDetail } from "./RouteStopsDetail";
import { CityDetails } from "./CityDetails";
import { MODE_COLORS, MODE_LABELS } from "../map/modeStyle";

const ALL_MODES: Mode[] = ["sea", "air", "rail", "truck"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface CargoOption {
  key: string;
  label: string;
}

interface ControlPanelProps {
  nodes: GeoNode[];
  originId: string | null;
  destinationId: string | null;
  onSetOrigin: (id: string | null) => void;
  onSetDestination: (id: string | null) => void;
  onSwap: () => void;
  onClear: () => void;
  waypointIds: string[];
  onRemoveWaypoint: (id: string) => void;
  allowedModes: Set<Mode>;
  onToggleMode: (mode: Mode) => void;
  onSetModes: (modes: Mode[]) => void;
  cargoType: string;
  cargoOptions: CargoOption[];
  onCargoTypeChange: (key: string) => void;
  month: number;
  onMonthChange: (month: number) => void;
  weightTonnes: number;
  onWeightChange: (tonnes: number) => void;
  routeOptions: RouteOption[];
  selectedKey: string | null;
  onSelectOption: (key: string) => void;
  showSecurity: boolean;
  saferAvailable: boolean;
  safetyRequested: boolean;
  onRequestSafer: () => void;
  selectedRoute: RouteOption | null;
  getNodeInfo: (nodeId: string) => NodeInfo;
  selectedNodeId: string | null;
  onCloseSelectedNode: () => void;
  roleOf: (id: string) => "origin" | "destination" | "waypoint" | null;
  onSetOriginFromDetails: (id: string) => void;
  onSetDestinationFromDetails: (id: string) => void;
  onAddWaypointFromDetails: (id: string) => void;
}

export function ControlPanel({
  nodes,
  originId,
  destinationId,
  onSetOrigin,
  onSetDestination,
  onSwap,
  onClear,
  waypointIds,
  onRemoveWaypoint,
  allowedModes,
  onToggleMode,
  onSetModes,
  cargoType,
  cargoOptions,
  onCargoTypeChange,
  month,
  onMonthChange,
  weightTonnes,
  onWeightChange,
  routeOptions,
  selectedKey,
  onSelectOption,
  showSecurity,
  saferAvailable,
  safetyRequested,
  onRequestSafer,
  selectedRoute,
  getNodeInfo,
  selectedNodeId,
  onCloseSelectedNode,
  roleOf,
  onSetOriginFromDetails,
  onSetDestinationFromDetails,
  onAddWaypointFromDetails,
}: ControlPanelProps) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const selectedNode = selectedNodeId ? byId.get(selectedNodeId) : undefined;

  return (
    <div className="panel">
      <div className="panel-header">
        <h1>Route Mapper</h1>
        <p className="subtitle">Multi-modal cargo route planning</p>
      </div>

      <NodePicker label="From" nodes={nodes} value={originId} onChange={onSetOrigin} disabledId={destinationId} />
      <NodePicker label="To" nodes={nodes} value={destinationId} onChange={onSetDestination} disabledId={originId} />

      {waypointIds.length > 0 && (
        <div className="field">
          <span className="field-label">Via (mandatory stops)</span>
          <div className="waypoint-list">
            {waypointIds.map((id) => (
              <span key={id} className="waypoint-chip">
                {byId.get(id)?.name ?? id}
                <button className="waypoint-remove" onClick={() => onRemoveWaypoint(id)} aria-label={`Remove ${byId.get(id)?.name ?? id}`}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="row-actions">
        <button onClick={onSwap} disabled={!originId || !destinationId}>Swap</button>
        <button onClick={onClear} disabled={!originId && !destinationId}>Clear</button>
      </div>

      <div className="field">
        <span className="field-label">Transport modes</span>
        <div className="mode-toggles">
          {ALL_MODES.map((m) => (
            <button
              key={m}
              className={`mode-toggle ${allowedModes.has(m) ? "on" : ""}`}
              style={{ "--mode-color": MODE_COLORS[m] } as CSSProperties}
              onClick={() => onToggleMode(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <div className="presets">
          <button onClick={() => onSetModes(["sea", "truck"])}>Ships only</button>
          <button onClick={() => onSetModes(["sea", "rail", "truck"])}>No planes</button>
          <button onClick={() => onSetModes(ALL_MODES)}>All modes</button>
        </div>
      </div>

      <label className="field">
        <span className="field-label">Cargo type</span>
        <select value={cargoType} onChange={(e) => onCargoTypeChange(e.target.value)}>
          {cargoOptions.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
      </label>

      <div className="field-row">
        <label className="field">
          <span className="field-label">Departs</span>
          <select value={month} onChange={(e) => onMonthChange(Number(e.target.value))}>
            {MONTHS.map((label, i) => (
              <option key={label} value={i + 1}>{label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Weight (t)</span>
          <input
            type="number"
            min={1}
            max={5000}
            step={1}
            value={weightTonnes}
            onChange={(e) => onWeightChange(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
      </div>

      <div className="field">
        <span className="field-label">Route options</span>
        <RouteResults
          options={routeOptions}
          selectedKey={selectedKey}
          onSelect={onSelectOption}
          showSecurity={showSecurity}
          saferAvailable={saferAvailable}
          safetyRequested={safetyRequested}
          onRequestSafer={onRequestSafer}
        />
      </div>

      {selectedRoute && <RouteStopsDetail route={selectedRoute} nodes={nodes} getNodeInfo={getNodeInfo} />}

      {selectedNode && (
        <CityDetails
          node={selectedNode}
          info={getNodeInfo(selectedNode.id)}
          currentRole={roleOf(selectedNode.id)}
          onSetOrigin={() => onSetOriginFromDetails(selectedNode.id)}
          onSetDestination={() => onSetDestinationFromDetails(selectedNode.id)}
          onAddWaypoint={() => onAddWaypointFromDetails(selectedNode.id)}
          onClose={onCloseSelectedNode}
        />
      )}
    </div>
  );
}
