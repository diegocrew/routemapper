/**
 * One-shot check that ACLED credentials work end to end, before anything is
 * built on top of them: mints an access token, reads a few recent events, and
 * prints what came back.
 *
 * Usage:
 *   ACLED_USERNAME=you@example.com ACLED_PASSWORD='...' node tools/probeAcled.mjs
 */
import { acledCredentials, fetchAccessToken, readEvents } from "./lib/acled.mjs";

const credentials = acledCredentials();
if (!credentials) {
  console.error("Set ACLED_USERNAME and ACLED_PASSWORD (your myACLED login).");
  process.exit(1);
}

console.log(`requesting a token for ${credentials.username}…`);
const token = await fetchAccessToken(credentials);
console.log(`got an access token (${token.length} chars, valid 24 h).\n`);

const day = (offsetDays) => new Date(Date.now() - offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
const since = day(7);
const events = await readEvents(
  token,
  {
    event_date: `${since}|${day(0)}`,
    event_date_where: "BETWEEN",
    event_type: "Battles",
    fields: "event_date|event_type|sub_event_type|country|latitude|longitude|fatalities",
  },
  { limit: 5 },
);

console.log(`${events.length} sample event(s) since ${since}:`);
for (const event of events) {
  console.log(
    `  ${event.event_date}  ${event.country.padEnd(20)} ${event.sub_event_type ?? event.event_type}` +
      `  @${Number(event.latitude).toFixed(2)},${Number(event.longitude).toFixed(2)}  fatalities=${event.fatalities}`,
  );
}
console.log("\nCredentials work. Nothing was written.");
