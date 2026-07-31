import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoNode } from "../engine/types";
import type { RouteOption } from "../engine/types";
import { KIND_COLORS, MODE_COLORS } from "./modeStyle";

// MapLibre resolves its worker script relative to its own module's runtime
// `import.meta.url`, which Rollup can't statically follow — so in a
// production build the worker file never gets emitted, and the map silently
// never renders (no error, just a black canvas). `maplibre-gl-worker.mjs`
// itself statically imports a sibling `./maplibre-gl-shared.mjs`, so a
// hashed/relocated Vite asset copy (`?url`) breaks that relative import too —
// both files are copied verbatim into public/ (unhashed, side by side, same
// filenames as in the package) so that relative import keeps resolving, and
// referenced here via BASE_URL so the path is correct under any base path.
maplibregl.setWorkerUrl(`${import.meta.env.BASE_URL}maplibre-gl-worker.mjs`);

const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const NODES_SOURCE = "rm-nodes";
const NODES_LAYER = "rm-nodes-circle";
const NODES_LABEL_LAYER = "rm-nodes-label";
const SELECTED_SOURCE = "rm-selected";
const SELECTED_LAYER = "rm-selected-circle";
const ROUTE_SOURCE = "rm-route";
const ROUTE_LAYER = "rm-route-line";
const ROUTE_CASING_LAYER = "rm-route-casing";

interface MapViewProps {
  nodes: GeoNode[];
  originId: string | null;
  destinationId: string | null;
  waypointIds: string[];
  route: RouteOption | null;
  onSelectNode: (id: string) => void;
}

function nodesToGeoJSON(nodes: GeoNode[]) {
  return {
    type: "FeatureCollection" as const,
    features: nodes.map((n) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [n.lon, n.lat] },
      properties: { id: n.id, name: n.name, kind: n.kind, country: n.country },
    })),
  };
}

function selectedToGeoJSON(nodes: GeoNode[], originId: string | null, destinationId: string | null, waypointIds: string[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const features = [];
  const origin = originId ? byId.get(originId) : undefined;
  const destination = destinationId ? byId.get(destinationId) : undefined;
  if (origin) {
    features.push({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [origin.lon, origin.lat] },
      properties: { role: "origin" },
    });
  }
  if (destination) {
    features.push({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [destination.lon, destination.lat] },
      properties: { role: "destination" },
    });
  }
  for (const id of waypointIds) {
    const wp = byId.get(id);
    if (!wp) continue;
    features.push({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [wp.lon, wp.lat] },
      properties: { role: "waypoint" },
    });
  }
  return { type: "FeatureCollection" as const, features };
}

const DEM_SOURCE = "rm-dem";
const TERRAIN_DEM_SOURCE = "rm-dem-terrain";
const HILLSHADE_LAYER = "rm-hillshade";

const DEM_TILES = {
  type: "raster-dem" as const,
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium" as const,
  tileSize: 256,
  maxzoom: 12,
  attribution:
    '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Tilezen Joerd terrain</a>',
};

/**
 * The dark basemap is deliberately flat, which reads as an empty void at world
 * zoom. A shaded relief underlay brings out mountain ranges, and the basemap's
 * own river lines are widened and lifted out of near-black so continents read
 * as terrain rather than silhouettes.
 */
function addTerrainAndWater(map: MLMap) {
  map.addSource(DEM_SOURCE, DEM_TILES);
  // MapLibre wants 3D terrain on its own source so the two don't share a tile cache.
  map.addSource(TERRAIN_DEM_SOURCE, DEM_TILES);

  map.addLayer(
    {
      id: HILLSHADE_LAYER,
      type: "hillshade",
      source: DEM_SOURCE,
      paint: {
        "hillshade-exaggeration": 0.6,
        "hillshade-shadow-color": "#04060a",
        "hillshade-highlight-color": "#8aa3bd",
        "hillshade-accent-color": "#24384c",
        "hillshade-illumination-direction": 315,
      },
    },
    map.getLayer("water") ? "water" : undefined,
  );

  if (map.getLayer("waterway")) {
    map.setPaintProperty("waterway", "line-color", "#3f6b8f");
    map.setPaintProperty("waterway", "line-width", [
      "interpolate",
      ["linear"],
      ["zoom"],
      3,
      0.6,
      6,
      1,
      10,
      1.6,
      16,
      3,
    ]);
    map.setLayerZoomRange("waterway", 2, 24);
  }
  if (map.getLayer("water")) map.setPaintProperty("water", "fill-color", "#16222c");

  // Globe removes Mercator's polar distortion and draws Pacific lanes as the
  // short hop they really are; the sky gives it an atmosphere at the limb.
  map.setProjection({ type: "globe" });
  map.setSky({
    "sky-color": "#0a1626",
    "horizon-color": "#2b4a6b",
    "fog-color": "#0b1220",
    "fog-ground-blend": 0.6,
    "horizon-fog-blend": 0.7,
    "sky-horizon-blend": 0.85,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 5, 0.4, 7, 0],
  });
}

/**
 * Splits a leg where it crosses the antimeridian. MapLibre wraps each vertex
 * into [-180, 180] on its own, so a Pacific crossing left in one piece is drawn
 * as a straight line back across every continent instead of over the dateline.
 */
function splitAtAntimeridian(coordinates: number[][]): number[][][] {
  const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
  const parts: number[][][] = [];
  let current: number[][] = [];

  for (const [rawLon, lat] of coordinates) {
    const lon = wrap(rawLon);
    const previous = current[current.length - 1];
    if (previous && Math.abs(lon - previous[0]) > 180) {
      const eastward = lon < previous[0];
      const edge = eastward ? 180 : -180;
      const span = lon + (eastward ? 360 : -360) - previous[0];
      const crossLat = previous[1] + (lat - previous[1]) * ((edge - previous[0]) / span);
      current.push([edge, crossLat]);
      parts.push(current);
      current = [[-edge, crossLat]];
    }
    current.push([lon, lat]);
  }
  if (current.length > 1) parts.push(current);
  return parts;
}

function routeToGeoJSON(nodes: GeoNode[], route: RouteOption | null) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const features = (route?.legs ?? []).flatMap((leg) => {
    const from = byId.get(leg.from);
    const to = byId.get(leg.to);
    if (!from || !to) return [];
    const parts = splitAtAntimeridian([
      [from.lon, from.lat],
      ...(leg.via ?? []),
      [to.lon, to.lat],
    ]);
    return [
      {
        type: "Feature" as const,
        geometry:
          parts.length === 1
            ? { type: "LineString" as const, coordinates: parts[0] }
            : { type: "MultiLineString" as const, coordinates: parts },
        properties: { mode: leg.mode },
      },
    ];
  });
  return { type: "FeatureCollection" as const, features };
}

export function MapView({ nodes, originId, destinationId, waypointIds, route, onSelectNode }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const loadedRef = useRef(false);
  const onSelectNodeRef = useRef(onSelectNode);
  onSelectNodeRef.current = onSelectNode;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [15, 20],
      zoom: 2.1,
      pitch: 7,
      bearing: -6,
      maxPitch: 70,
      minZoom: 1.5,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", () => {
      addTerrainAndWater(map);
      map.addControl(new maplibregl.GlobeControl(), "top-right");
      map.addControl(new maplibregl.TerrainControl({ source: TERRAIN_DEM_SOURCE, exaggeration: 1.4 }), "top-right");

      map.addSource(NODES_SOURCE, { type: "geojson", data: nodesToGeoJSON(nodes) });
      map.addSource(SELECTED_SOURCE, { type: "geojson", data: selectedToGeoJSON(nodes, null, null, []) });
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: routeToGeoJSON(nodes, null) });

      map.addLayer({
        id: ROUTE_CASING_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        paint: { "line-color": "#0f172a", "line-width": 6, "line-opacity": 0.6 },
        layout: { "line-cap": "round", "line-join": "round" },
      });

      map.addLayer({
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        paint: {
          "line-color": ["match", ["get", "mode"], "sea", MODE_COLORS.sea, "air", MODE_COLORS.air, "rail", MODE_COLORS.rail, "truck", MODE_COLORS.truck, "#ffffff"],
          "line-width": 3.5,
          "line-dasharray": ["match", ["get", "mode"], "air", ["literal", [2, 2]], "rail", ["literal", [4, 2]], "truck", ["literal", [1, 2]], ["literal", [1, 0]]],
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });

      map.addLayer({
        id: NODES_LAYER,
        type: "circle",
        source: NODES_SOURCE,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 2.5, 4, 4.5, 8, 7],
          "circle-color": [
            "match",
            ["get", "kind"],
            "capital",
            KIND_COLORS.capital,
            "city",
            KIND_COLORS.city,
            "seaport",
            KIND_COLORS.seaport,
            "airport",
            KIND_COLORS.airport,
            "railhub",
            KIND_COLORS.railhub,
            "military",
            KIND_COLORS.military,
            "#e2e8f0",
          ],
          "circle-stroke-color": "#0f172a",
          "circle-stroke-width": 1.2,
        },
      });

      map.addLayer({
        id: NODES_LABEL_LAYER,
        type: "symbol",
        source: NODES_SOURCE,
        minzoom: 3,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-font": ["Noto Sans Regular"],
        },
        paint: {
          "text-color": "#f1f5f9",
          "text-halo-color": "#0f172a",
          "text-halo-width": 1.2,
        },
      });

      map.addLayer({
        id: SELECTED_LAYER,
        type: "circle",
        source: SELECTED_SOURCE,
        paint: {
          "circle-radius": ["match", ["get", "role"], "waypoint", 7, 9],
          "circle-color": ["match", ["get", "role"], "origin", "#4ade80", "destination", "#f87171", "waypoint", "#a78bfa", "#ffffff"],
          "circle-stroke-color": "#0f172a",
          "circle-stroke-width": 2,
        },
      });

      map.on("mouseenter", NODES_LAYER, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", NODES_LAYER, () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", NODES_LAYER, (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        const id = feature?.properties?.id;
        if (typeof id === "string") onSelectNodeRef.current(id);
      });

      loadedRef.current = true;
    });

    // Steep pitch at world-scale zoom leaves most of the flat map plane
    // pointing off-screen (a near-empty "horizon" view), so tilt increases
    // with zoom instead of staying fixed: flat and readable zoomed out,
    // isometric-feeling once you're looking at a region/city. A user's own
    // manual tilt (right-drag / two-finger drag) is left alone afterward.
    let manualPitch = false;
    map.on("pitchstart", (e) => {
      if (e.originalEvent) manualPitch = true;
    });
    map.on("zoom", () => {
      if (manualPitch) return;
      const targetPitch = Math.min(55, Math.max(0, map.getZoom() * 9 - 12));
      map.setPitch(targetPitch);
    });

    return () => {
      loadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource(SELECTED_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(selectedToGeoJSON(nodes, originId, destinationId, waypointIds));
  }, [nodes, originId, destinationId, waypointIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(routeToGeoJSON(nodes, route));
  }, [nodes, route]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}
