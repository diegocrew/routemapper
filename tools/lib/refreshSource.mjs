export async function refreshSource({ id, label, prefix, fetchZones, previousZones, previousStatus, now }) {
  const nowMs = Date.parse(now);
  const maxAgeMs = 24 * 3600 * 1000;
  try {
    const zones = await fetchZones();
    if (!Array.isArray(zones)) throw new Error("Expected a zone array");
    const expiresAt = new Date(nowMs + maxAgeMs).toISOString();
    return {
      zones: zones.map((zone) => ({ ...zone, activeUntil: zone.activeUntil ?? expiresAt })),
      status: { id, label, status: "ok", lastSuccessAt: now, expiresAt, retainedZones: 0 },
    };
  } catch {
    const owned = previousZones.filter((zone) => zone.id.startsWith(prefix));
    const lastSuccessAt = previousStatus?.lastSuccessAt ?? null;
    const zones = owned.flatMap((zone) => {
      const observedMs = Date.parse(lastSuccessAt ?? zone.detectedAt ?? "");
      const expiryMs = Math.min(observedMs + maxAgeMs, zone.activeUntil ? Date.parse(zone.activeUntil) : Infinity);
      if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) return [];
      return [{ ...zone, activeUntil: new Date(expiryMs).toISOString() }];
    });
    const expiresAt = zones.length ? zones.map((zone) => zone.activeUntil).sort()[0] : null;
    return {
      zones,
      status: { id, label, status: zones.length ? "stale" : "unavailable", lastSuccessAt, expiresAt, retainedZones: zones.length },
    };
  }
}