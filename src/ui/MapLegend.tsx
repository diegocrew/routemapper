import { useMemo, useState } from "react";
import { HAZARD_KIND_COLORS, KIND_COLORS } from "../map/modeStyle";
import { hazardZones } from "../engine/zones";
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

const HAZARD_ROWS: { kind: string; label: string; effect: string }[] = [
  { kind: "earthquake", label: "Earthquake", effect: "no civilian transit" },
  { kind: "volcano", label: "Eruption", effect: "no civilian transit" },
  { kind: "cyclone", label: "Tropical cyclone", effect: "sea legs avoid" },
  { kind: "navwarning", label: "Nav warning", effect: "sea legs avoid" },
  { kind: "flood", label: "Flooding", effect: "road/rail legs avoid" },
  { kind: "wildfire", label: "Wildfire", effect: "legs avoid" },
];

interface MapLegendProps {
  /** Military installations are hidden for civilian cargo, and a key for dots that aren't drawn only invites the question of where they are. */
  showMilitary: boolean;
}

export function MapLegend({ showMilitary }: MapLegendProps) {
  const [open, setOpen] = useState(true);
  // A hazard kind with nothing live right now is still worth listing, so the map reading "all wildfire" is visibly the feed's doing rather than a missing layer.
  const hazardCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const zone of hazardZones) counts[zone.hazardKind ?? ""] = (counts[zone.hazardKind ?? ""] ?? 0) + 1;
    return counts;
  }, []);

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
          {ORDER.filter((kind) => kind !== "military" || showMilitary).map((kind) => (
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
          <div className="map-legend-heading">Active hazards</div>
          {HAZARD_ROWS.map((r) => {
            const count = hazardCounts[r.kind] ?? 0;
            return (
              <div
                key={r.kind}
                className={count === 0 ? "map-legend-row map-legend-row-empty" : "map-legend-row"}
                title={`${r.label} — ${r.effect}`}
              >
                <span className="map-legend-dot" style={{ background: HAZARD_KIND_COLORS[r.kind] }} />
                <span className="map-legend-label">{r.label}</span>
                <span className="map-legend-effect">{r.effect}</span>
                <span className="map-legend-count">{count}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
