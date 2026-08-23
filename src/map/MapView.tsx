import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoNode, Zone } from "../engine/types";
import type { RouteOption } from "../engine/types";
import { HAZARD_COLOR, HAZARD_KIND_COLORS, KIND_COLORS, MODE_COLORS } from "./modeStyle";
import { hazardZones } from "../engine/zones";

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
const HAZARDS_SOURCE = "rm-hazards";
const HAZARDS_FILL_LAYER = "rm-hazards-fill";
const HAZARDS_OUTLINE_LAYER = "rm-hazards-outline";
const HAZARDS_POINT_LAYER = "rm-hazards-point";
const FIRES_FILL_LAYER = "rm-fires-fill";
const FIRES_OUTLINE_LAYER = "rm-fires-outline";
const FIRES_POINT_LAYER = "rm-fires-point";
// Wildfires outnumber every other hazard about two hundred to one, so they get their own switch rather than burying the rest of the layer.
const HAZARD_LAYERS = [HAZARDS_FILL_LAYER, HAZARDS_OUTLINE_LAYER, HAZARDS_POINT_LAYER];
const FIRE_LAYERS = [FIRES_FILL_LAYER, FIRES_OUTLINE_LAYER, FIRES_POINT_LAYER];
const NODE_LAYERS = [NODES_LAYER, NODES_LABEL_LAYER];

const IS_WILDFIRE: maplibregl.ExpressionSpecification = ["==", ["get", "kind"], "wildfire"];
const NOT_WILDFIRE: maplibregl.ExpressionSpecification = ["!=", ["get", "kind"], "wildfire"];
// Installations outnumber every other kind roughly ten to one, and civilian
// cargo can't route to one at all — so for a civilian load they are noise, and
// come off the map entirely rather than just fading at low zoom.
const NOT_MILITARY: maplibregl.ExpressionSpecification = ["!=", ["get", "kind"], "military"];
const isPolygon: maplibregl.ExpressionSpecification = ["==", ["geometry-type"], "Polygon"];
const isPoint: maplibregl.ExpressionSpecification = ["==", ["geometry-type"], "Point"];

const hazardColorByKind: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "kind"],
  "wildfire",
  HAZARD_KIND_COLORS.wildfire,
  "cyclone",
  HAZARD_KIND_COLORS.cyclone,
  "flood",
  HAZARD_KIND_COLORS.flood,
  "volcano",
  HAZARD_KIND_COLORS.volcano,
  "navwarning",
  HAZARD_KIND_COLORS.navwarning,
  "conflict",
  HAZARD_KIND_COLORS.conflict,
  HAZARD_COLOR,
];

interface MapViewProps {
  nodes: GeoNode[];
  originId: string | null;
  destinationId: string | null;
  waypointIds: string[];
  route: RouteOption | null;
  showHazards: boolean;
  showWildfires: boolean;
  showMilitary: boolean;
  onToggleHazards: () => void;
  onToggleWildfires: () => void;
  onToggleMilitary: () => void;
  onSelectNode: (id: string) => void;
}

interface ToggleSpec {
  glyph: string;
  className: string;
  labelOn: string;
  labelOff: string;
  onToggle: () => void;
}

/** Sits in the map's own top-right button stack alongside zoom/globe/terrain, so every map-display switch is in one place. */
class LayerToggleControl implements maplibregl.IControl {
  private container: HTMLDivElement | null = null;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly specs: ToggleSpec[];

  constructor(specs: ToggleSpec[]) {
    this.specs = specs;
  }

  onAdd(): HTMLElement {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    for (const spec of this.specs) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = spec.className;
      button.textContent = spec.glyph;
      button.addEventListener("click", () => spec.onToggle());
      this.container.appendChild(button);
      this.buttons.push(button);
    }
    return this.container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = null;
    this.buttons.length = 0;
  }

  setActive(index: number, active: boolean): void {
    const button = this.buttons[index];
    const spec = this.specs[index];
    if (!button || !spec) return;
    button.classList.toggle(`${spec.className}-on`, active);
    button.title = active ? spec.labelOn : spec.labelOff;
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(active));
  }
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

const HAZARD_RING_POINTS = 18;

function hazardCenter(zone: Zone): [number, number] | null {
  if (zone.center) return zone.center;
  const ring = zone.polygon;
  if (!ring?.length) return null;
  return [
    ring.reduce((sum, [lon]) => sum + lon, 0) / ring.length,
    ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length,
  ];
}

/** Hazard radii top out around 350 km, small enough that a degree-space ellipse is indistinguishable from a true geodesic circle on screen. */
function hazardRing(zone: Zone, center: [number, number]): [number, number][] {
  if (zone.polygon) return zone.polygon;
  const [lon, lat] = center;
  const dLat = (zone.radiusKm ?? 0) / 111.32;
  const dLon = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
  const ring: [number, number][] = [];
  for (let i = 0; i < HAZARD_RING_POINTS; i++) {
    const angle = (2 * Math.PI * i) / HAZARD_RING_POINTS;
    ring.push([lon + dLon * Math.cos(angle), lat + dLat * Math.sin(angle)]);
  }
  ring.push(ring[0]);
  return ring;
}

/** Hazard zones are generated offline on a schedule (tools/fetchHazards.mjs) and baked into the build, so this is static — no live updates needed inside the running app. */
function hazardsToGeoJSON() {
  const features = [];
  for (const zone of hazardZones) {
    if (zone.access !== "hazard") continue;
    const center = hazardCenter(zone);
    if (!center) continue;
    const properties = { label: zone.label, kind: zone.hazardKind ?? "hazard" };
    features.push({
      type: "Feature" as const,
      geometry: { type: "Polygon" as const, coordinates: [hazardRing(zone, center)] },
      properties,
    });
    // A 15-75 km footprint is well under a pixel wide at world zoom, so the
    // real extent alone leaves the map looking empty; a marker at the centre
    // keeps hazards visible until you are zoomed in enough to see the circle.
    features.push({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: center },
      properties,
    });
  }
  return { type: "FeatureCollection" as const, features };
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

export function MapView({ nodes, originId, destinationId, waypointIds, route, showHazards, showWildfires, showMilitary, onToggleHazards, onToggleWildfires, onToggleMilitary, onSelectNode }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const loadedRef = useRef(false);
  const onSelectNodeRef = useRef(onSelectNode);
  onSelectNodeRef.current = onSelectNode;
  const onToggleHazardsRef = useRef(onToggleHazards);
  onToggleHazardsRef.current = onToggleHazards;
  const onToggleWildfiresRef = useRef(onToggleWildfires);
  onToggleWildfiresRef.current = onToggleWildfires;
  const onToggleMilitaryRef = useRef(onToggleMilitary);
  onToggleMilitaryRef.current = onToggleMilitary;
  const layerControlRef = useRef<LayerToggleControl | null>(null);
  // The map finishes loading after the first render, so the layers need the toggles' current values when they are created.
  const showHazardsRef = useRef(showHazards);
  showHazardsRef.current = showHazards;
  const showWildfiresRef = useRef(showWildfires);
  showWildfiresRef.current = showWildfires;
  const showMilitaryRef = useRef(showMilitary);
  showMilitaryRef.current = showMilitary;

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

      const layerControl = new LayerToggleControl([
        {
          glyph: "⚠",
          className: "rm-hazard-toggle",
          labelOn: "Hide active hazards (excluding wildfires)",
          labelOff: "Show active hazards (excluding wildfires)",
          onToggle: () => onToggleHazardsRef.current(),
        },
        {
          glyph: "🔥",
          className: "rm-fire-toggle",
          labelOn: "Hide wildfires",
          labelOff: "Show wildfires",
          onToggle: () => onToggleWildfiresRef.current(),
        },
        {
          glyph: "●",
          className: "rm-military-toggle",
          labelOn: "Hide military installations",
          labelOff: "Show military installations",
          onToggle: () => onToggleMilitaryRef.current(),
        },
      ]);
      map.addControl(layerControl, "top-right");
      layerControl.setActive(0, showHazardsRef.current);
      layerControl.setActive(1, showWildfiresRef.current);
      layerControl.setActive(2, showMilitaryRef.current);
      layerControlRef.current = layerControl;

      map.addSource(NODES_SOURCE, { type: "geojson", data: nodesToGeoJSON(nodes) });
      map.addSource(SELECTED_SOURCE, { type: "geojson", data: selectedToGeoJSON(nodes, null, null, []) });
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: routeToGeoJSON(nodes, null) });
      map.addSource(HAZARDS_SOURCE, { type: "geojson", data: hazardsToGeoJSON() });

      // Fire-season clusters overlap heavily, so at world zoom their footprints stack into one solid red mass — below zoom 5 the marker rings carry the layer instead.
      const footprintFill: maplibregl.FillLayerSpecification["paint"] = {
        "fill-color": hazardColorByKind,
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 7, 0.18],
      };
      const footprintOutline: maplibregl.LineLayerSpecification["paint"] = {
        "line-color": hazardColorByKind,
        "line-width": 1.5,
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 7, 0.8],
      };

      for (const [fillId, outlineId, kindFilter, visible] of [
        [HAZARDS_FILL_LAYER, HAZARDS_OUTLINE_LAYER, NOT_WILDFIRE, showHazardsRef.current],
        [FIRES_FILL_LAYER, FIRES_OUTLINE_LAYER, IS_WILDFIRE, showWildfiresRef.current],
      ] as const) {
        map.addLayer({
          id: fillId,
          type: "fill",
          source: HAZARDS_SOURCE,
          filter: ["all", isPolygon, kindFilter],
          layout: { visibility: visible ? "visible" : "none" },
          paint: { ...footprintFill },
        });

        map.addLayer({
          id: outlineId,
          type: "line",
          source: HAZARDS_SOURCE,
          filter: ["all", isPolygon, kindFilter],
          layout: { visibility: visible ? "visible" : "none" },
          paint: { ...footprintOutline },
        });
      }

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

      const nodeFilter = showMilitaryRef.current ? undefined : NOT_MILITARY;

      map.addLayer({
        id: NODES_LAYER,
        type: "circle",
        source: NODES_SOURCE,
        filter: nodeFilter,
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
          // Military installations outnumber every other kind roughly ten to one, so at world zoom they bury the trunk network they attach to.
          // A zoom expression has to be the outermost one — an interpolate nested inside a `case` is rejected and takes the whole layer with it.
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            2.5,
            ["case", ["==", ["get", "kind"], "military"], 0, 1],
            4,
            1,
          ],
          "circle-stroke-color": "#0f172a",
          "circle-stroke-width": 1.2,
          "circle-stroke-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            2.5,
            ["case", ["==", ["get", "kind"], "military"], 0, 1],
            4,
            1,
          ],
        },
      });

      map.addLayer({
        id: NODES_LABEL_LAYER,
        type: "symbol",
        source: NODES_SOURCE,
        filter: nodeFilter,
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

      // Above the node dots: a hazard marker that sat underneath thousands of installations would never be seen.
      for (const [pointId, kindFilter, visible] of [
        [HAZARDS_POINT_LAYER, NOT_WILDFIRE, showHazardsRef.current],
        [FIRES_POINT_LAYER, IS_WILDFIRE, showWildfiresRef.current],
      ] as const) {
        map.addLayer({
          id: pointId,
          type: "circle",
          source: HAZARDS_SOURCE,
          filter: ["all", isPoint, kindFilter],
          layout: { visibility: visible ? "visible" : "none" },
          paint: {
            // Fire-season regions hold hundreds of clusters within a few degrees: at world zoom the markers have to stay small and faint or they merge into one opaque blot.
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 1.5, 1.5, 4, 4, 6, 6.5],
            // Hollow, so a hazard reads differently from the solid red dot of a military installation.
            "circle-color": "rgba(0, 0, 0, 0)",
            "circle-stroke-color": hazardColorByKind,
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 1.5, 0.8, 4, 2],
            // Fades out as the true footprint below becomes big enough to read on its own.
            "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 1.5, 0.35, 4, 0.95, 7, 0],
          },
        });
      }

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

      // A bare red blob says nothing about what the hazard is, so name it on hover.
      const hazardPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
      for (const layer of [HAZARDS_POINT_LAYER, HAZARDS_FILL_LAYER, FIRES_POINT_LAYER, FIRES_FILL_LAYER]) {
        map.on("mousemove", layer, (e: MapLayerMouseEvent) => {
          const label = e.features?.[0]?.properties?.label;
          if (typeof label !== "string") return;
          hazardPopup.setLngLat(e.lngLat).setText(label).addTo(map);
        });
        map.on("mouseleave", layer, () => {
          hazardPopup.remove();
        });
      }

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    for (const layer of HAZARD_LAYERS) {
      map.setLayoutProperty(layer, "visibility", showHazards ? "visible" : "none");
    }
    layerControlRef.current?.setActive(0, showHazards);
  }, [showHazards]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    for (const layer of FIRE_LAYERS) {
      map.setLayoutProperty(layer, "visibility", showWildfires ? "visible" : "none");
    }
    layerControlRef.current?.setActive(1, showWildfires);
  }, [showWildfires]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    for (const layer of NODE_LAYERS) {
      map.setFilter(layer, showMilitary ? null : NOT_MILITARY);
    }
    layerControlRef.current?.setActive(2, showMilitary);
  }, [showMilitary]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}
