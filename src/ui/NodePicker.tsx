import type { GeoNode } from "../engine/types";

const KIND_LABELS: Record<string, string> = {
  capital: "Capitals",
  city: "Major Cities",
  seaport: "Seaports",
  airport: "Airports",
  railhub: "Rail Hubs",
};

interface NodePickerProps {
  label: string;
  nodes: GeoNode[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabledId?: string | null;
}

export function NodePicker({ label, nodes, value, onChange, disabledId }: NodePickerProps) {
  const groups = new Map<string, GeoNode[]>();
  for (const n of nodes) {
    if (!groups.has(n.kind)) groups.set(n.kind, []);
    groups.get(n.kind)!.push(n);
  }
  for (const list of groups.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Select a location…</option>
        {[...groups.entries()].map(([kind, list]) => (
          <optgroup key={kind} label={KIND_LABELS[kind] ?? kind}>
            {list.map((n) => (
              <option key={n.id} value={n.id} disabled={n.id === disabledId}>
                {n.name} ({n.country})
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
