/**
 * Commercial-vehicle wait times at US land border crossings, from CBP's public
 * feed. Keyless, refreshed continuously, and measured rather than inferred —
 * which makes it the only genuinely hard border-condition source wired up here.
 *
 * Coverage is exactly the US–Canada and US–Mexico borders, so it says nothing
 * about the rest of the world. That is the trade: precision over reach.
 */
import { fetchJson } from "../lib/http.mjs";

const URL = "https://bwt.cbp.gov/api/bwtnew";

/** CBP's own naming for the two land borders it reports on. */
const BORDERS = {
  "Canadian Border": "Canada",
  "Mexican Border": "Mexico",
};

/** Below this a queue is just a border being a border, not a disruption worth routing around. */
const REPORTABLE_MINUTES = 30;

const minutes = (value) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function fetchBorderWaits() {
  let ports;
  try {
    ports = await fetchJson(URL, { attempts: 2, timeoutMs: 20000 });
  } catch (error) {
    console.error(`CBP border wait times unavailable: ${error.message}`);
    return [];
  }

  // One crossing is a queue; a border is the state of all of them. Freight
  // reroutes to the next bridge over, so the median across a border's open
  // crossings describes a truck's prospects better than the worst one does.
  const waits = new Map();
  for (const port of ports) {
    const neighbour = BORDERS[port.border];
    if (!neighbour) continue;
    const lanes = port.commercial_vehicle_lanes?.standard_lanes;
    if (!lanes) continue;
    if (!waits.has(neighbour)) waits.set(neighbour, { open: [], shut: [] });
    const border = waits.get(neighbour);
    const closed = /closed/i.test(port.port_status ?? "") || /closed/i.test(lanes.operational_status ?? "");
    if (!closed) {
      border.open.push(minutes(lanes.delay_minutes));
    } else if (/24\s*hrs/i.test(port.hours ?? "")) {
      // Most small crossings keep office hours, so "closed" at 3am is normal
      // and says nothing. A crossing that advertises 24/7 and is shut anyway is
      // the only kind whose closure is news.
      border.shut.push(port.crossing_name ?? port.port_name);
    }
  }

  const entries = [];
  for (const [neighbour, { open, shut }] of waits) {
    if (open.length === 0) continue;
    const sorted = [...open].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // Queueing at a border is what borders do. Only an unusual wait is a fact
    // worth routing on, and an empty file is the correct answer on a normal day.
    if (median < REPORTABLE_MINUTES) continue;
    const notes = [`${median} min median commercial wait across ${open.length} crossings`];
    if (shut.length > 0) notes.push(`${shut.length} of the 24-hour crossings shut`);
    entries.push({
      id: `cbp_${neighbour.toLowerCase()}`,
      countries: ["United States", neighbour],
      modes: ["truck"],
      label: `US–${neighbour} border: ${notes.join(", ")}`,
      delayHours: Math.round((median / 60) * 10) / 10,
      source: "CBP border wait times",
    });
  }
  return entries;
}
