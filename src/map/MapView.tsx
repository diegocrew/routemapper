import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoNode } from "../engine/types";
import type { RouteOption } from "../engine/types";
import { KIND_COLORS, MODE_COLORS } from "./modeStyle";

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

function routeToGeoJSON(nodes: GeoNode[], route: RouteOption | null) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const features = (route?.legs ?? []).flatMap((leg) => {
    const from = byId.get(leg.from);
    const to = byId.get(leg.to);
    if (!from || !to) return [];
    return [
      {
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [from.lon, from.lat],
            [to.lon, to.lat],
          ],
        },
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
