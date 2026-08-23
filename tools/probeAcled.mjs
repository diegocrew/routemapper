/**
 * One-shot check that ACLED credentials work end to end, before anything is
 * built on top of them: mints an access token, reads a few recent events, and
 * prints what came back. Writes nothing.
 *
 * Usage: npm run probe:acled
 *        Credentials come from .env (gitignored) or the environment.
 */
import { loadLocalEnv } from "./lib/env.mjs";
import { acledCredentials, fetchAccessToken, readEvents } from "./lib/acled.mjs";

loadLocalEnv();

const credentials = acledCredentials();
if (!credentials) {
  console.error("Set ACLED_USERNAME and ACLED_PASSWORD, in .env or the environment.");
  process.exit(1);
}

// A failed probe is an expected outcome here rather than a crash: the message
// is the whole point, and a stack trace through the fetch helpers buries it.
try {
  console.log(`requesting a token for ${credentials.username}…`);
  const token = await fetchAccessToken(credentials);
  console.log(`got an access token (${token.length} chars, valid 24 h).`);

  // If the token is a JWT its payload is readable, and what the account is
  // actually entitled to is the question when the data endpoint says 403 while
  // the token endpoint is perfectly happy. Opaque tokens simply skip this.
  const parts = token.split(".");
  if (parts.length === 3) {
    try {
      console.log(`token claims: ${Buffer.from(parts[1], "base64url").toString("utf8")}`);
    } catch {
      console.log("token looks like a JWT but its payload did not decode.");
    }
  }

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

  console.log(`\n${events.length} sample event(s) since ${since}:`);
  for (const event of events) {
    console.log(
      `  ${event.event_date}  ${String(event.country).padEnd(20)} ${event.sub_event_type ?? event.event_type}` +
        `  @${Number(event.latitude).toFixed(2)},${Number(event.longitude).toFixed(2)}  fatalities=${event.fatalities}`,
    );
  }
  if (events.length === 0) {
    console.log("  (none — the login and access work, but the query matched nothing: suspect the filter syntax)");
  }
  console.log("\nCredentials work. Nothing was written.");
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}
