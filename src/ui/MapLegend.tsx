import { useState } from "react";
import { HAZARD_COLOR, KIND_COLORS } from "../map/modeStyle";
import type { NodeKind } from "../engine/types";

const KIND_LABELS: Record<NodeKind, string> = {
  capital: "Capital",
  city: "Major City",
  seaport: "Seaport",
  airport: "Airport",
  railhub: "Rail Hub",
  military: "Military (restricted)",
};

const ORDER: NodeKind[] = ["capital", "city", "seaport", "airport", "railhub", "military"];

const ROLE_ROWS: { label: string; color: string }[] = [
  { label: "Origin", color: "#4ade80" },
  { label: "Destination", color: "#f87171" },
  { label: "Via point", color: "#a78bfa" },
];

export function MapLegend() {
  const [open, setOpen] = useState(true);

  return (
    <div className="map-legend">
      <button
        type="button"
        className="map-legend-toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="map-legend-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        Legend
      </button>
      {open && (
        <div className="map-legend-body">
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
          <div className="map-legend-divider" />
          <div className="map-legend-row">
            <span className="map-legend-dot" style={{ background: HAZARD_COLOR }} />
            Active hazard (earthquake/wildfire)
          </div>
        </div>
      )}
    </div>
  );
}
