/**
 * The conflict layer, from whichever provider this deployment can reach.
 *
 * ACLED and UCDP describe the same wars, so running both would count every
 * front twice and cluster the two sets into fatter zones than either supports.
 * ACLED is preferred when its credentials work — weekly rather than monthly,
 * and a lower evidentiary bar, so it sees a corridor turn dangerous sooner.
 * UCDP is the fallback, and the one most deployments will actually use: its
 * token is free for the asking, where ACLED's API sits behind an access tier
 * that a personal registration does not reach.
 */
import { fetchAcledConflictZones } from "./acled.mjs";
import { fetchUcdpConflictZones } from "./ucdp.mjs";

export async function fetchConflictZones() {
  try {
    const acled = await fetchAcledConflictZones();
    if (acled.length > 0) return acled;
  } catch (error) {
    // Falling back is the point: a denied ACLED account should cost the run a
    // note, not its conflict zones.
    console.error(`ACLED unavailable, falling back to UCDP: ${error.message}`);
  }
  return fetchUcdpConflictZones();
}
