import type { GeoNode } from "../engine/types";
import type { NodeInfo } from "../engine/pathfinder";
import { MODE_COLORS, MODE_LABELS } from "../map/modeStyle";

export const KIND_LABELS: Record<string, string> = {
  capital: "Capital",
  city: "Major City",
  seaport: "Seaport",
  airport: "Airport",
  railhub: "Rail Hub",
  military: "Military Installation",
};

function indexColor(value: number): string {
  if (value >= 65) return "#4ade80";
  if (value >= 40) return "#facc15";
  return "#f87171";
}

function IndexBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="index-bar">
      <div className="index-bar-label">
        <span>{label}</span>
        <span>{Math.round(value)}</span>
      </div>
      <div className="index-bar-track">
        <div className="index-bar-fill" style={{ width: `${value}%`, background: indexColor(value) }} />
      </div>
    </div>
  );
}

interface NodeInfoCardProps {
  node: GeoNode;
  info: NodeInfo;
}

export function NodeInfoCard({ node, info }: NodeInfoCardProps) {
  return (
    <>
      <div className="stop-row-header">
        <span className="stop-name">{node.name}</span>
        <span className="stop-country">{node.country}</span>
      </div>
      <div className="stop-meta">{KIND_LABELS[node.kind] ?? node.kind}</div>
      <div className="stop-modes">
        {info.modes.map((m) => (
          <span key={m} className="mode-pill" style={{ borderColor: MODE_COLORS[m] }}>
            {MODE_LABELS[m]}
          </span>
        ))}
      </div>
      <div className="index-bars">
        <IndexBar label="Economic" value={info.economicIndex} />
        <IndexBar label="Security" value={info.securityIndex} />
        <IndexBar label="Transit" value={info.transitIndex} />
      </div>
    </>
  );
}
