import { useMemo, useState } from "react";
import { MapView } from "./map/MapView";
import { ControlPanel } from "./ui/ControlPanel";
import { MapLegend } from "./ui/MapLegend";
import { createRouteEngine } from "./engine/pathfinder";
import type { CostsConfig, GeoNode, BaseEdge, Mode, RouteOption } from "./engine/types";
import nodesData from "./data/nodes.json";
import edgesData from "./data/edges.json";
import costsData from "./data/costs.config.json";
import "./App.css";

const nodes = nodesData as GeoNode[];
const edges = edgesData as BaseEdge[];
const costs = costsData as CostsConfig;
const ALL_MODES: Mode[] = ["sea", "air", "rail", "truck"];

function App() {
  const engine = useMemo(() => createRouteEngine(nodes, edges, costs), []);

  const [originId, setOriginIdRaw] = useState<string | null>(null);
  const [destinationId, setDestinationIdRaw] = useState<string | null>(null);
  const [waypointIds, setWaypointIds] = useState<string[]>([]);
  const [allowedModes, setAllowedModes] = useState<Set<Mode>>(new Set(ALL_MODES));
  const [cargoType, setCargoType] = useState<string>("general");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // A location can only hold one role at a time, so claiming a new role clears any other it was previously assigned.
  const setOriginId = (id: string | null) => {
    setWaypointIds((prev) => prev.filter((w) => w !== id));
    setDestinationIdRaw((prev) => (prev === id ? null : prev));
    setOriginIdRaw(id);
    setSelectedKey(null);
  };
  const setDestinationId = (id: string | null) => {
    setWaypointIds((prev) => prev.filter((w) => w !== id));
    setOriginIdRaw((prev) => (prev === id ? null : prev));
    setDestinationIdRaw(id);
    setSelectedKey(null);
  };
  const addWaypoint = (id: string) => {
    if (id === originId || id === destinationId || waypointIds.includes(id)) return;
    setWaypointIds((prev) => [...prev, id]);
    setSelectedKey(null);
  };
  const removeWaypoint = (id: string) => {
    setWaypointIds((prev) => prev.filter((w) => w !== id));
    setSelectedKey(null);
  };

  const routeOptions: RouteOption[] = useMemo(() => {
    if (!originId || !destinationId || originId === destinationId) return [];
    return engine.computeRoutes({
      originId,
      destinationId,
      waypointIds,
      allowedModes: [...allowedModes],
      cargoType,
    });
  }, [engine, originId, destinationId, waypointIds, allowedModes, cargoType]);

  const activeKey = routeOptions.some((o) => o.key === selectedKey) ? selectedKey : (routeOptions[0]?.key ?? null);
  const selectedRoute = routeOptions.find((o) => o.key === activeKey) ?? null;

  const cargoOptions = Object.entries(costs.cargoTypes).map(([key, cfg]) => ({ key, label: cfg.label }));

  const roleOf = (id: string): "origin" | "destination" | "waypoint" | null => {
    if (id === originId) return "origin";
    if (id === destinationId) return "destination";
    if (waypointIds.includes(id)) return "waypoint";
    return null;
  };

  const handleToggleMode = (mode: Mode) => {
    setAllowedModes((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) {
        if (next.size === 1) return prev;
        next.delete(mode);
      } else {
        next.add(mode);
      }
      return next;
    });
  };

  return (
    <div className="app">
      <MapView
        nodes={nodes}
        originId={originId}
        destinationId={destinationId}
        waypointIds={waypointIds}
        route={selectedRoute}
        onSelectNode={setSelectedNodeId}
      />
      <MapLegend />
      <ControlPanel
        nodes={nodes}
        originId={originId}
        destinationId={destinationId}
        onSetOrigin={setOriginId}
        onSetDestination={setDestinationId}
        onSwap={() => {
          const prevOrigin = originId;
          setOriginIdRaw(destinationId);
          setDestinationIdRaw(prevOrigin);
          setSelectedKey(null);
        }}
        onClear={() => {
          setOriginIdRaw(null);
          setDestinationIdRaw(null);
          setWaypointIds([]);
          setSelectedKey(null);
        }}
        waypointIds={waypointIds}
        onRemoveWaypoint={removeWaypoint}
        allowedModes={allowedModes}
        onToggleMode={handleToggleMode}
        onSetModes={(modes) => setAllowedModes(new Set(modes))}
        cargoType={cargoType}
        cargoOptions={cargoOptions}
        onCargoTypeChange={setCargoType}
        routeOptions={routeOptions}
        selectedKey={activeKey}
        onSelectOption={setSelectedKey}
        selectedRoute={selectedRoute}
        getNodeInfo={engine.getNodeInfo}
        selectedNodeId={selectedNodeId}
        onCloseSelectedNode={() => setSelectedNodeId(null)}
        roleOf={roleOf}
        onSetOriginFromDetails={(id) => {
          setOriginId(id);
          setSelectedNodeId(null);
        }}
        onSetDestinationFromDetails={(id) => {
          setDestinationId(id);
          setSelectedNodeId(null);
        }}
        onAddWaypointFromDetails={(id) => {
          addWaypoint(id);
          setSelectedNodeId(null);
        }}
      />
    </div>
  );
}

export default App;
