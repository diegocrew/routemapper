import type { RouteOption } from "../engine/types";
import { SECURITY_ALERT_THRESHOLD } from "../engine/indices";
import { MODE_COLORS } from "../map/modeStyle";

interface RouteResultsProps {
  options: RouteOption[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  showSecurity: boolean;
  saferAvailable: boolean;
  safetyRequested: boolean;
  onRequestSafer: () => void;
}

function formatUsd(usd: number): string {
  return `$${Math.round(usd).toLocaleString()}`;
}

function formatHours(hours: number): string {
  const days = hours / 24;
  if (days >= 1) return `${days.toFixed(1)} d`;
  return `${Math.round(hours)} h`;
}

function securityTone(score: number): string {
  if (score < SECURITY_ALERT_THRESHOLD) return "bad";
  if (score < 60) return "warn";
  return "good";
}

export function RouteResults({
  options,
  selectedKey,
  onSelect,
  showSecurity,
  saferAvailable,
  safetyRequested,
  onRequestSafer,
}: RouteResultsProps) {
  if (options.length === 0) {
    return <p className="hint">No route found for the current constraints. Try allowing more transport modes.</p>;
  }

  const bestSecurity = Math.max(...options.map((o) => o.securityScore));
  const atRisk = showSecurity && bestSecurity < SECURITY_ALERT_THRESHOLD;

  return (
    <div className="route-results">
      {options.map((opt) => (
        <button
          key={opt.key}
          className={`route-card ${opt.key === selectedKey ? "selected" : ""}`}
          onClick={() => onSelect(opt.key)}
        >
          <div className="route-card-header">
            <span className="route-card-title">{opt.label}</span>
            <span className="route-card-price">{formatUsd(opt.totalUsd)}</span>
          </div>
          <div className="route-card-meta">
            <span>{formatHours(opt.totalHours)}</span>
            <span>·</span>
            <span>{opt.legs.length} leg{opt.legs.length === 1 ? "" : "s"}</span>
            <span>·</span>
            <span>{opt.transferCount} transfer{opt.transferCount === 1 ? "" : "s"}</span>
            {showSecurity && (
              <>
                <span>·</span>
                <span className={`route-security ${securityTone(opt.securityScore)}`}>
                  security {opt.securityScore}
                </span>
              </>
            )}
          </div>
          <div className="route-card-legs">
            {opt.legs.map((leg, i) => (
              <span key={i} className="leg-chip" style={{ borderColor: MODE_COLORS[leg.mode] }}>
                <span className="leg-dot" style={{ background: MODE_COLORS[leg.mode] }} />
                {leg.mode}
              </span>
            ))}
          </div>
        </button>
      ))}
      {atRisk && saferAvailable && !safetyRequested && (
        <button className="route-safety-cta" onClick={onRequestSafer}>
          Security below {SECURITY_ALERT_THRESHOLD} — show a safer routing
        </button>
      )}
      {atRisk && !saferAvailable && (
        <p className="hint">
          Security below {SECURITY_ALERT_THRESHOLD}: the risk is at a stop you picked, so no rerouting can avoid it.
        </p>
      )}
    </div>
  );
}
