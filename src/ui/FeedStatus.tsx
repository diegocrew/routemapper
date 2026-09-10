import { useEffect, useState } from "react";
import feedStatusData from "../data/feedStatus.json";
import { sourceFreshness, type FeedStatusData } from "../engine/feedFreshness";

const data = feedStatusData as FeedStatusData;

export function FeedStatus() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const sources = data.sources.map((source) => ({ ...source, freshness: sourceFreshness(source, now) }));
  const summary = sources.length === 0 ? "unverified"
    : sources.every((source) => source.freshness === "current") ? "current"
    : sources.every((source) => source.freshness === "unavailable") ? "unavailable" : "degraded";

  return (
    <details className={`feed-status feed-status-${summary}`}>
      <summary>Hazard feeds: {summary}</summary>
      {sources.length === 0 ? <p>Freshness has not been recorded for this dataset.</p> : (
        <ul>
          {sources.map((source) => (
            <li key={source.id}>
              <strong>{source.label}: {source.freshness}</strong>
              <span>Last success: {source.lastSuccessAt ? new Date(source.lastSuccessAt).toLocaleString() : "unknown"}</span>
              {source.freshness === "stale" && <span>{source.retainedZones} retained zones</span>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}