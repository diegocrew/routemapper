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
npm run generate:sea-routes      # ocean lanes, via searoute
npm run generate:inland-routes   # river/canal legs, routed on real waterways
npm run generate:rail-routes     # keeps rail off open water
npm run generate:truck-edges     # rebuild after changing nodes.json
npm run generate:edge-zones      # re-tag legs after changing zones.json
npm run check:sea-routes
npm run audit:geography          # report any leg crossing the wrong medium
```

The generators download Natural Earth coastline, river and lake vectors into
`node_modules/.cache/` on first run; nothing geographic is bundled into the
browser build. The sea-route generator runs `searoute` in an isolated Python
environment. Curated `via` points are preserved for inland rivers and canals
that are not covered by the ocean network.

> Note: `vite.config.ts` sets `base: '/routemapper/'` to match this repo's
> GitHub Pages URL. If you fork this under a different repo name, update
> that base path (or set it to `/` for a custom domain / user/org page).

## Project structure

```
src/
  data/            nodes.json, edges.json (hand-curated), costs.config.json
  engine/          graph construction, Dijkstra pathfinder, cost model, tests
  map/             MapLibre map view + per-mode line/marker styling
  ui/              control panel, node picker, route results list
```

## Data & cost model

- **Nodes** (`src/data/nodes.json`): ~150 real-world places — capitals,
  major cities, seaports, airports, and rail freight hubs — one node per
  physical place (a city that's also a major port carries both roles).
- **Edges** (`src/data/edges.json`): hand-curated trunk sea/air/rail routes
  covering major global trade lanes. Not exhaustive — MVP scope.
- **Truck legs** (`src/data/truckEdges.json`) are generated offline by
  `npm run generate:truck-edges`: a pair only becomes a road leg if both hubs
  sit on the same landmass and an overland path exists within road range, and
  legs whose straight line would cut across water carry a routed land corridor.
  Re-run it after editing `nodes.json`.
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
- **Cargo types** exclude certain modes (e.g. hazardous goods can't fly) —
  also configurable in `costs.config.json`. Defense cargo ignores security
  scoring, closed borders and closed zones.

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
- ~150 nodes and hand-picked trunk routes, not exhaustive global coverage.
- Truck legs use great-circle distance with a road detour factor, not real
  road-network routing; drivability is checked against coastlines, so a road
  leg never crosses open water, but it doesn't follow actual highways.
- A few inland waterway legs (Dnipro, lower Yangtze, St. Lawrence, Mekong)
  are hand-curated approximations of the river course.
- No accounts, saved routes, or mobile app.
