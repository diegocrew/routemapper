export interface FeedSourceStatus {
  id: string;
  label: string;
  status: "ok" | "stale" | "unavailable";
  lastSuccessAt: string | null;
  expiresAt: string | null;
  retainedZones: number;
}

export interface FeedStatusData {
  updatedAt: string | null;
  sources: FeedSourceStatus[];
}

export function sourceFreshness(source: FeedSourceStatus, now: number): "current" | "stale" | "unavailable" {
  if (source.status === "unavailable") return "unavailable";
  const expiry = Date.parse(source.expiresAt ?? "");
  if (!Number.isFinite(expiry) || expiry <= now) return "unavailable";
  return source.status === "ok" ? "current" : "stale";
}