import { KIND_COLORS } from "../map/modeStyle";
import type { NodeKind } from "../engine/types";

const KIND_LABELS: Record<NodeKind, string> = {
  capital: "Capital",
  city: "Major City",
  seaport: "Seaport",
  airport: "Airport",
  railhub: "Rail Hub",
};

const ORDER: NodeKind[] = ["capital", "city", "seaport", "airport", "railhub"];

const ROLE_ROWS: { label: string; color: string }[] = [
  { label: "Origin", color: "#4ade80" },
  { label: "Destination", color: "#f87171" },
  { label: "Via point", color: "#a78bfa" },
];

export function MapLegend() {
  return (
    <div className="map-legend">
      {ORDER.map((kind) => (
        <div key={kind} className="map-legend-row">
          <span className="map-legend-dot" style={{ background: KIND_COLORS[kind] }} />
          {KIND_LABELS[kind]}
        </div>
      ))}
      <div className="map-legend-divider" />
      {ROLE_ROWS.map((r) => (
        <div key={r.label} className="map-legend-row">
          <span className="map-legend-dot" style={{ background: r.color }} />
          {r.label}
        </div>
      ))}
    </div>
  );
}
