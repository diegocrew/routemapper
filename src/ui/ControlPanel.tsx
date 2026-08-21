import type { CSSProperties, ReactNode } from "react";
import type { CargoClass, GeoNode, Mode, RouteOption } from "../engine/types";
import type { NodeInfo } from "../engine/pathfinder";
import { NodePicker } from "./NodePicker";
import { RouteResults } from "./RouteResults";
import { RouteStopsDetail } from "./RouteStopsDetail";
import { CityDetails } from "./CityDetails";
import { MODE_COLORS, MODE_LABELS } from "../map/modeStyle";

const ALL_MODES: Mode[] = ["sea", "air", "rail", "truck"];
const CARGO_CLASSES: CargoClass[] = ["civilian", "military"];

const BiohazardIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="6.6" r="3.5" />
      <circle cx="6.9" cy="15.4" r="3.5" />
      <circle cx="17.1" cy="15.4" r="3.5" />
    </g>
    <circle cx="12" cy="12.4" r="2.1" fill="currentColor" />
  </svg>
);

const SnowflakeIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2 3.8 16.8" />
    <path d="M9.6 4.6 12 6.4l2.4-1.8M9.6 19.4 12 17.6l2.4 1.8" />
    <path d="m5 10.6 1-2.7 2.8.4M19 13.4l-1 2.7-2.8-.4M19 10.6l-1-2.7-2.8.4M5 13.4l1 2.7 2.8-.4" />
  </svg>
);

const HvtIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
    <path d="M12 2.6 4.6 5.6v6c0 4.6 3 8.4 7.4 9.8 4.4-1.4 7.4-5.2 7.4-9.8v-6L12 2.6Z" />
    <circle cx="12" cy="10" r="2.1" />
    <path d="M8.5 16.6c.6-1.9 1.9-2.9 3.5-2.9s2.9 1 3.5 2.9" strokeLinecap="round" />
  </svg>
);

/** Colour carries the meaning here: biohazard keeps its green until the load is
 * military, where amber stands in for a possible radiological consignment. */
const HANDLING_STYLE: Record<string, { icon: ReactNode; short: string; color: string; militaryColor?: string }> = {
  hazmat: { icon: <BiohazardIcon />, short: "Hazard", color: "#22c55e", militaryColor: "#facc15" },
  perishable: { icon: <SnowflakeIcon />, short: "Chilled", color: "#38bdf8" },
  hvt: { icon: <HvtIcon />, short: "HVT", color: "#c084fc" },
};

interface HandlingOption {
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
  cargoClass: CargoClass;
  cargoClassLabels: Record<CargoClass, string>;
  onCargoClassChange: (cargoClass: CargoClass) => void;
  handling: string[];
  handlingOptions: HandlingOption[];
  onToggleHandling: (key: string) => void;
  departureDate: string;
  onDepartureDateChange: (date: string) => void;
  weightTonnes: number;
  onWeightChange: (tonnes: number) => void;
  routeOptions: RouteOption[];
  selectedKey: string | null;
  onSelectOption: (key: string) => void;
  noRouteReason: string | null;
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
  cargoClass,
  cargoClassLabels,
  onCargoClassChange,
  handling,
  handlingOptions,
  onToggleHandling,
  departureDate,
  onDepartureDateChange,
  weightTonnes,
  onWeightChange,
  routeOptions,
  selectedKey,
  onSelectOption,
  noRouteReason,
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

      <div className="field">
        <span className="field-label">Cargo</span>
        <div className="cargo-row">
          <div className="cargo-class" role="group" aria-label="Cargo class">
            {CARGO_CLASSES.map((key) => (
              <button
                key={key}
                className={`cargo-class-option ${cargoClass === key ? "on" : ""}`}
                aria-pressed={cargoClass === key}
                onClick={() => onCargoClassChange(key)}
              >
                {cargoClassLabels[key]}
              </button>
            ))}
          </div>
          <div className="cargo-handling">
            {handlingOptions.map((option) => {
              const style = HANDLING_STYLE[option.key];
              const on = handling.includes(option.key);
              const color = (cargoClass === "military" && style.militaryColor) || style.color;
              return (
                <button
                  key={option.key}
                  className={`cargo-toggle ${on ? "on" : ""}`}
                  style={{ "--cargo-color": color } as CSSProperties}
                  aria-pressed={on}
                  title={option.label}
                  onClick={() => onToggleHandling(option.key)}
                >
                  {style.icon}
                  <span>{style.short}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field-label">Departs</span>
          <input
            type="date"
            value={departureDate}
            onChange={(e) => onDepartureDateChange(e.target.value)}
          />
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
          noRouteReason={noRouteReason}
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
