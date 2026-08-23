# Route Mapper

A world map for planning multi-modal cargo freight routes — ships, cargo
planes, freight rail, and trucks — between capitals, major cities, seaports,
airports, and rail hubs.

Pick an origin and destination, set constraints (which transport modes are
allowed, cargo type), and the app computes ranked route options (cheapest,
fastest, most direct) across a multi-modal graph, entirely client-side.

**MVP status:** synthetic cost model (no live freight pricing/schedule data —
see [Data & cost model](#data--cost-model) below), curated dataset of ~150
nodes, real-world geographic map (MapLibre GL JS) with an isometric-styled
tilt, not a hand-drawn game map.

## Stack

- Vite + React + TypeScript
- [MapLibre GL JS](https://maplibre.org/) for the map, using CARTO's free
  [dark-matter basemap](https://github.com/CartoDB/basemap-styles) (no API
  key required), with shaded relief from the free
  [Tilezen Joerd](https://github.com/tilezen/joerd) terrain tiles
- Pure-TypeScript routing engine (`src/engine/`) — a layered multi-modal
  graph (Dijkstra), independently unit-tested with [Vitest](https://vitest.dev/)
- No backend: the graph is built in-browser from static JSON committed in
  the repo

## Development

Requires Node.js 20+.

```bash
npm install
npm run dev       # start the dev server (http://localhost:5173/routemapper/)
npm test          # run the routing-engine test suite
npm run build     # type-check + production build to dist/
```

Sea edges include committed water-following polylines. After adding or changing
a sea edge, install [uv](https://docs.astral.sh/uv/) and regenerate them:

```bash
npm run generate:sea-routes      # ocean lanes, via searoute; rebuilds seaEdges.json
npm run generate:inland-routes   # river/canal legs, routed on real waterways
npm run generate:rail-routes     # keeps rail off open water
npm run generate:truck-edges     # rebuild after changing nodes.json
npm run generate:edge-zones      # re-tag legs after changing zones.json
npm run generate:airspace        # re-tag air legs after changing airspace.json or nodes
npm run retag:hazards            # re-tag hazard crossings after nodes/edges change
npm run fetch:border-status      # live border waits and reported closures
npm run check:sea-routes
npm run audit:geography          # report any leg crossing the wrong medium
```

The generators download Natural Earth coastline, river and lake vectors into
`node_modules/.cache/` on first run; nothing geographic is bundled into the
browser build. The sea-route generator runs `searoute` in an isolated Python
environment. Curated `via` points are preserved for inland rivers and canals
that are not covered by the ocean network.

Changing `nodes.json` means re-running `generate:sea-routes` as well as
`generate:truck-edges`: both files are keyed on node ids and both pick each
node's nearest neighbours.

> Note: `vite.config.ts` sets `base: '/routemapper/'` to match this repo's
> GitHub Pages URL. If you fork this under a different repo name, update
> that base path (or set it to `/` for a custom domain / user/org page).

## Project structure

```
src/
  data/            nodes.json, edges.json (hand-curated), costs.config.json,
                   railGauge.json, airspace.json, restrictions.json,
                   seaEdges.json / truckEdges.json / airEdgeZones.json (generated)
  engine/          graph construction, Dijkstra pathfinder, cost model, tests
  map/             MapLibre map view + per-mode line/marker styling
  ui/              control panel, node picker, route results list
```

## Data & cost model

- **Nodes** (`src/data/nodes.json`): ~450 real-world places — capitals,
  major cities, seaports, airports, rail freight hubs and headline military
  sites — one node per physical place (a city that's also a major port carries
  both roles).
- **Military installations** (`src/data/militaryBases.json`): ~1,500 more,
  imported from Wikidata by `npm run fetch:military-bases` and merged with
  `nodes.json` wherever nodes are read. Scope matches
  [Lists of military installations](https://en.wikipedia.org/wiki/Lists_of_military_installations):
  the "military base" subclass tree, still active, with coordinates and an
  English Wikipedia article — that last filter is the notability line, and
  keeps this to the installations those lists cover rather than every tagged
  barracks. On top of that a node has to be somewhere freight could plausibly
  move through, which drops roughly 40% of the raw import: barracks,
  cantonments, radar and listening stations, "stone frigate" shore
  establishments, academies and heritage sites have no berth or apron, and
  airfields must show evidence of a real runway (an ICAO/IATA code or a mapped
  runway) rather than just having kept an air-station name. Without that
  filter the UK alone contributed 470 nodes, most of them drill halls.
  All are `kind: "military"`, so civilian cargo cannot route to them.
  Re-running the import means re-running `generate:truck-edges`,
  `generate:edge-zones` and `retag:hazards`.
- **Edges** (`src/data/edges.json`): hand-curated trunk sea/air/rail routes
  covering major global trade lanes, plus the river and canal corridors. Not
  exhaustive — MVP scope.
- **Sea legs** (`src/data/seaEdges.json`) fill in around those trunk lanes,
  generated offline by `npm run generate:sea-routes`: each port's `sea.maxNeighbors`
  nearest other ports, every pair routed through `searoute` so the leg follows
  real water. The curated lanes on their own averaged 2.5 per port, which left
  the network hop-starved — a ship would sail past its actual port of call
  because the next port over happened to be the one with a curated onward link.
  A pair already in `edges.json` is never generated, so hand-drawn corridors
  win. Two things are dropped: a port whose end snaps onto searoute's network
  more than 75 km away isn't on that network at all (Vienna, Memphis and
  Asunción are river cities, and their legs stay curated), and a pair whose sea
  route runs over 3x its straight line is a neighbour on paper only — the far
  side of an isthmus, reached by chaining hops instead.
- **Truck legs** (`src/data/truckEdges.json`) are generated offline by
  `npm run generate:truck-edges`: a pair only becomes a road leg if both hubs
  sit on the same landmass and an overland path exists within road range, and
  legs whose straight line would cut across water carry a routed land corridor.
  Re-run it after editing `nodes.json`. Only each node's nearest handful of
  in-range neighbours are pathfound, since anything further can't survive the
  `maxNeighbors` cut anyway — without that cap the thousands of imported
  installations turn this into hours of A*.
- **Air legs** are built at runtime. The curated network is a full mesh (cargo
  aircraft aren't confined to lanes, so any curated node can fly direct to any
  other), while imported installations attach as spokes to their three nearest
  curated hubs. A full mesh over every node would be millions of edges rebuilt
  on every graph build, and "fly to the nearest air hub, then onward" is the
  more honest model for a remote barracks anyway.
- **Costs** (`src/data/costs.config.json`): since real freight pricing and
  schedules aren't freely available, routes are ranked using configurable
  per-mode constants (`$/km`, `km/h`, per-hub loading overhead). Tune these
  to make the model more realistic without touching engine code.
- **Hub efficiency**: the flat per-mode hub overhead is scaled per node by its
  economic score, so clearing cargo through a weak port costs noticeably more
  time (and somewhat more money) than through an efficient one.
- **Indices** (`src/data/indices.json`): 0-100 economic and security scores per
  country, with per-city economic bonuses and per-node security overrides for
  places that differ from their country as a whole.
- **Zones** (`src/data/zones.json`): chokepoints and risk corridors
  (Bab-el-Mandeb, Hormuz, Malacca, the Black Sea, the Sahel…) as polygons with
  their own security score, a war-risk surcharge charged per km actually spent
  inside, and a flat transit toll for the canals. Legs are tagged with the zones
  they cross — and how far into each — by `npm run generate:edge-zones`, so no
  polygon tests run in the browser. Zones marked `military-only` are closed to
  civilian cargo entirely, both the legs crossing them and the nodes inside them.
  Canal tolls are per container (Suez ~$45, Panama ~$85), scaled to match the
  per-container basis of the `$/km` rates.
- **Restrictions** (`src/data/restrictions.json`): closed land borders, haulier
  bans and airspace closures, matched on the countries at each end of a leg for
  the listed modes. `pairsWith` makes a rule one-sided — the EU haulier ban
  applies between the EU states and Russia/Belarus, not within either group.
- **Track gauge** (`src/data/railGauge.json`): a rail leg between two
  incompatible networks isn't just a border crossing — a 1520 mm wagon cannot
  run on 1435 mm rail, so every container is craned across at Brest, Khorgos,
  Erenhot or Irun before the train goes on. Legs that cross one pay
  `rail.breakOfGauge*` from `costs.config.json` on top of the distance, and say
  where. Gauge is per country with per-node overrides for dual-gauge railheads;
  `interoperable` keeps 1520 and 1524 mm as one network, since Finnish and
  Russian wagons run through and comparing the numbers alone would invent a
  transshipment that never happens.
- **Restricted airspace** (`src/data/airspace.json`): overflight bans used to be
  matched on the countries at the ends of a flight, which got the common cases
  wrong both ways — Helsinki–Tokyo was banned outright though neither end is
  Russia, and Dubai–Tokyo was scored as if it never went near Siberia. Now the
  geometry decides: `npm run generate:airspace` samples every air leg's great
  circle against country outlines and commits the crossings to
  `airEdgeZones.json`. A closure lengthens the flight rather than cancelling it,
  since aircraft route around, and a reciprocal ban only bites when both ends
  are on its list — a lane with one unbanned end still has an operator who flies
  it straight.
- **Live border conditions** (`src/data/borderStatus.json`): fetched by
  `npm run fetch:border-status` from CBP's commercial wait times (keyless, and
  measured rather than inferred, but only US–Canada and US–Mexico) and from
  ReliefWeb reporting for the rest, which needs a free approved appname in
  `RELIEFWEB_APPNAME`. Unlike `restrictions.json`, nothing fetched here can
  close a border: a feed reports a crossing shutting far more reliably than it
  reports one reopening, so letting one delete a corridor would reroute the
  world off a noisy news week and quietly keep it that way. These only add
  delay and a warning; closing a border stays a curated decision.
- **Cargo types** exclude certain modes (e.g. hazardous goods can't fly) —
  also configurable in `costs.config.json`. Defense cargo ignores security
  scoring, closed borders and closed zones.

## Hazard zones (live monitoring)

`.github/workflows/hazards.yml` runs `npm run fetch:hazards`
(`tools/fetchHazards.mjs`) four times a day and commits
`src/data/hazardZones.json` / `src/data/hazardEdgeZones.json`. Sources:

| Source | Events | Key |
| --- | --- | --- |
| USGS | Earthquakes, magnitude ≥5.5, 7-day window | none |
| GDACS | Tropical cyclones, floods, volcanic eruptions at Orange/Red alert | none |
| NOAA NHC | Active named storms + a dead-reckoned +24/48/72 h track | none |
| NGA | NAVAREA broadcast warnings (firing areas, exercises, wrecks, piracy) | none |
| NASA FIRMS | Wildfire hotspots, last 4 days, clustered | `NASA` secret |
| ACLED | Battles and remote violence, last 14 days, clustered | `ACLEDUSER` + `ACLEDPWD` secrets |

Each becomes a temporary `access: "hazard"` zone, and the legs crossing it are
tagged. Retention is free: each run just re-fetches the current upstream window
and overwrites these files, so an event disappears on its own once it ages out
of its source — there's no separate expiry step.

Conflict is the one source that is neither weather nor geology, and it behaves
differently: a war does not age out of an upstream window the way a storm track
or a hotspot does. Its 14-day query window is what stands in for expiry — an
area with no reported violence in a fortnight stops producing a zone.

What a hazard does depends on what it actually stops:

| Hazard | Modes | Effect |
| --- | --- | --- |
| Earthquake | all | Closed to civilian cargo; military transits with a warning |
| Volcanic eruption | all | Closed to civilian cargo (ash and site damage) |
| Tropical cyclone | sea | Surcharge + low security score — routed around when possible |
| Navigational warning | sea | Surcharge + low security score |
| Flood | truck, rail | Surcharge + low security score |
| Wildfire | truck, rail | Surcharge + low security score |
| Armed conflict | truck, rail, sea | Surcharge + low security score — the air side is airspace.json, not a circle |

The closure/deterrent split matters: hard-blocking everything severed the
civilian network, because the global fire feed alone covers thousands of zones
at a time. Mode scoping is what makes the rest realistic — a cyclone should push
a ship off a lane without touching the road network behind the port, and a
wildfire should stop trucks and trains without surcharging aircraft overflying
it or ships passing tens of km offshore.

## Border conditions (live)

`npm run fetch:border-status` (`tools/fetchBorderStatus.mjs`) writes
`src/data/borderStatus.json` on the same schedule.

| Source | Signal | Key |
| --- | --- | --- |
| CBP border wait times | Measured commercial-vehicle queues, median across a border's open crossings | none |
| ReliefWeb | Reported disruption on a watchlist of borders, 21-day window | `RELIEFWEB_APPNAME` |

The hard rule here is that **nothing fetched can close a border**. Feeds report a
crossing shutting far more reliably than they report one reopening, so a feed
allowed to delete a corridor would reroute the world off a noisy news week and
then quietly keep it that way. Entries only ever add delay to a leg and a line
on the route card; closing a border is a curated decision in
`restrictions.json`, and `validate:data` fails the build on any generated entry
big enough to act like one.

CBP is the only genuinely measured source of the two, and it covers exactly the
US–Canada and US–Mexico borders — precision over reach. An empty file is the
normal state and the correct answer on an ordinary day; a queue only counts once
it exceeds half an hour, since queueing at a border is what borders do.

## Country risk (sanctions & conflict)

`npm run fetch:country-risk` (`tools/fetchCountryRisk.mjs`) writes
`src/data/countryRisk.json`: a **bounded adjustment** applied on top of the
curated scores in `indices.json`. The curated numbers stay the source of truth
— live data only nudges them, within caps set in the tool, so a bad feed day
cannot rewrite the model. A hand-set `nodeSecurity` override is the final word
for that node and is never adjusted.

| Source | Signal | Cap |
| --- | --- | --- |
| OpenSanctions (CC-BY) | Sanctions programmes aimed at a country, weighted by designations | −18 security, −12 economic |
| GDELT 2.0 | Conflict-related coverage volume for a country, 7-day | −12 security |

Both are proxies, not verified measures, and both fail soft.

One trap worth recording: OpenSanctions' per-country **target counts** say where
sanctioned entities are *registered*, which ranks the United States, India and
Nigeria among the highest — an artefact of company registration, not risk.
Scoring on it produced a −23 penalty for the US. The **programme identifiers**
(`AU-RUSSIA`, `UN-SC1718`) instead name the country a regime is aimed *at*, and
that is what is used. The corrected output penalises Iran, Ukraine, Russia,
North Korea, Afghanistan, DR Congo, Iraq and Syria hardest.

Similarly, GDELT's `sourcecountry` is where an article was *published*, so
aggregating on it just ranks countries by the size of their English-language
press; the tool queries `locationcc:` per country instead, over a watchlist, so
attribution is by the location an article is *about*. GDELT rate-limits hard and
its endpoints are frequently unreachable — the collector gives up after three
consecutive failures and contributes nothing rather than stalling the job.

Because this lands on security and economic scores, it is civilian cargo that
feels it: military cargo already ignores security scoring and closed borders.

Hazard zones are drawn on the map whether or not a route has been planned, and
can be hidden with the ⚠ button in the map's top-right control stack. Each kind
has its own colour. A 15–75 km footprint is sub-pixel at world zoom, so each
zone also gets a marker ring that fades out as you zoom in and the real circle
becomes readable; hovering either names the hazard.

Zones are stored as a centre point plus a radius rather than a sampled ring —
that is roughly a tenth of the JSON, and containment becomes one distance
check instead of a 24-point polygon scan. Both the app and the offline tagger
bin zones into a coarse lon/lat grid, so a lookup only tests nearby zones
instead of all of them.

The magnitude threshold, wildfire clustering distance/confidence, the
earthquake radius-by-magnitude table, the GDACS alert-level radius buckets and
the hazard surcharges are all approximations, flagged and kept as tunable
constants at the top of `tools/fetchHazards.mjs` — in the same spirit as this
repo's other hand-approximated geography (see below). GDACS's list endpoint
returns a centroid rather than a footprint, so cyclone and flood radii are
alert-level buckets, not the real affected area.

Setup required once per repo: add a `NASA` secret (a FIRMS `MAP_KEY`, free from
https://firms.modaps.eosdis.nasa.gov/api/map_key/) under Settings → Secrets →
Actions, and enable Settings → Actions → General → Workflow permissions →
"Read and write permissions" so the scheduled job can push its commit (which
then triggers the normal `deploy.yml` build/deploy). Earthquakes need no key.
Wildfires do — unlike some NASA APIs, FIRMS's Area API has no working
keyless/demo tier (confirmed by testing against the live endpoint), so without
the secret the workflow still runs and commits earthquake zones, it just skips
wildfires that run.

## Forecasting and history

A hazard can carry an `activeFrom`/`activeUntil` window, and a route request
carries a departure date. Two things follow:

- **Journey filtering.** A hazard whose window doesn't overlap
  `[departure, departure + 30 days]` is ignored entirely — not blocked, not
  surcharged, not warned about.
- **Arrival checking.** Each leg records `etaHours` from departure, so a hazard
  is only warned about if it is still in force when the shipment would actually
  reach it. Hazards the shipment outruns are reported separately as
  "forecast to clear before arrival" rather than silently dropped.

Storm forecast steps come from NHC's published movement vector run forward by
dead reckoning, with the radius widening by lead time to stand in for track
uncertainty. This is *not* NHC's official forecast cone (that is a shapefile
encoding real uncertainty); it is an approximation, flagged `forecast: true` on
the zone.

`src/data/hazardHistory.json` keeps one compact row per pipeline run — counts
by kind plus the non-wildfire events — capped at ~a year of the 4-a-day
schedule. The live files are overwritten wholesale on every run, so without
this the past is simply gone; with it, a season of rows is enough to answer
"how often is this corridor disrupted in August".

## Deployment

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages
(Actions-based deployment) on every push to `main`. In the repo's Settings →
Pages, set the source to **GitHub Actions** once, and pushes to `main` will
publish automatically.

## Known MVP limitations

- No live freight pricing/schedule data — costs are estimates, and the
  economic/security scores are curated estimation rather than sourced data.
- Zones are tagged on sea, rail and truck legs only; air legs are generated at
  runtime, so overflight bans aren't modelled — airspace closures only apply
  between the endpoint countries of a flight.
- ~150 nodes; air and sea are filled in from those nodes, but rail is still
  hand-picked trunk routes rather than exhaustive coverage.
- Truck legs use great-circle distance with a road detour factor, not real
  road-network routing; drivability is checked against coastlines, so a road
  leg never crosses open water, but it doesn't follow actual highways.
- A few inland waterway legs (Dnipro, lower Yangtze, St. Lawrence, Mekong)
  are hand-curated approximations of the river course.
- No accounts, saved routes, or mobile app.

## TODO: a denser, less hop-starved rail network

Rail edges are still a small hand-picked set of trunk routes (see `edges.json`
above), so a route can be forced through an odd detour just because the curated
network happens to have an edge there and not somewhere more direct — a ship
continuing past its actual port of call because the next port over is the only
one with a good onward rail link, when a more sensible rail link from the first
port simply hasn't been curated yet.

The sea half of this is done: `seaEdges.json` now generates each port's nearest
few ports through `searoute` and lets Dijkstra chain hops for long hauls, which
took the maritime network from 2.5 lanes per port to 9.

Rail can't be done the same way. Unlike roads or open water, rail track is
fixed physical infrastructure with real gaps that have nothing to do with
distance (gauge breaks, no track across oceans, missing links), so a
proximity-based "K nearest rail hubs" generator would happily invent edges that
don't physically exist. Doing this properly needs a real rail network dataset —
OpenStreetMap's `railway=rail` ways via Overpass, or a regional extract — and
computing connectivity over the *actual* track graph, the way `searoute`
already gives the real water graph for sea.
