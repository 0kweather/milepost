import { AGENCIES, SOURCES, fetchSource, advanceEstimated } from "./sources.js?v=dev";
import { loadStations, trainsDue, mbtaPredictions, meters } from "./stations.js?v=dev";
import { RailIndex, estimatePosition, snapToTrack } from "./estimate.js?v=dev";
import { NETWORKS, networkColor } from "./networks.js?v=dev";

// localStorage "tt-relay" overrides config.js, handy when testing a relay locally.
const RELAY = ((() => { try { return localStorage.getItem("tt-relay"); } catch { return null; } })() ||
  window.TRAINTRACKER_RELAY || "").trim();
const STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
const STALE_MS = 10 * 60 * 1000;
const ANIM_MS = 1200;

const $ = (id) => document.getElementById(id);
// Attach a listener if the element exists. A missing element (say, a stale
// cached page) must never stop the trains from loading.
const on = (id, type, fn) => $(id)?.addEventListener(type, fn);
const setChecked = (id, value) => { const el = $(id); if (el) el.checked = value; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- State ----------

const state = {
  bySource: {},          // source id -> train[]
  sourceStatus: {},      // source id -> { status, error, at }
  trains: new Map(),     // id -> train (merged)
  display: new Map(),    // id -> { lat, lon } currently drawn
  hidden: new Set(store.get("tt-hidden", [])),
  kind: "all",
  selected: null,        // selected train id
  stations: new Map(),   // merged station id -> station
  station: null,         // selected station id
  predictions: null,     // live MBTA predictions for the selected station
  estimate: store.get("tt-estimate", false), // "Estimate live location" mode
  showStations: store.get("tt-stations", true),
  // Trains the viewer is following (saved in the browser):
  // [{ id, agency, number, route, stopKey, stopName, eta, lastSeen }]
  tracked: store.get("tt-tracked", []),
  trackPicker: null,     // train id whose "where are you headed?" picker is open
  trackPick: null,       // stop key chosen in the picker ("" = no particular stop)
  est: new Map(),        // train id -> estimated { lat, lon, bearing, basis }
  rail: null,            // RailIndex, loaded when estimating
  stopPos: new Map(),    // station member key -> { lat, lon }
  follow: false,
  query: "",
  relayFeeds: null,      // feeds the relay can serve (null = no relay)
};

// ---------- Theme ----------

const prefersDark = matchMedia("(prefers-color-scheme: dark)");
// "auto" follows the device's light/dark setting.
let themePref = store.get("tt-theme", "auto");
const resolveTheme = () => (themePref === "auto" ? (prefersDark.matches ? "dark" : "light") : themePref);
let theme = resolveTheme();
document.documentElement.dataset.theme = theme;

// ---------- Map ----------

const isPhone = matchMedia("(max-width: 720px)").matches;
const map = new maplibregl.Map({
  container: "map",
  style: STYLES[theme],
  center: [-96.5, 38.6],
  zoom: isPhone ? 2.6 : 3.7,
  minZoom: 2,
  maxZoom: 17,
  hash: "map",
  attributionControl: { compact: true },
  dragRotate: false,
  pitchWithRotate: false,
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
map.addControl(new maplibregl.GeolocateControl({ fitBoundsOptions: { maxZoom: 10 } }), "bottom-right");

// Marker images are drawn on a canvas once per agency color: a dot for trains
// with no known heading, and a dot with a pointer for trains that have one.
function markerImage(color, withArrow) {
  const ratio = 2, size = 44, c = document.createElement("canvas");
  c.width = c.height = size * ratio;
  const g = c.getContext("2d");
  g.scale(ratio, ratio);
  const cx = size / 2, cy = size / 2, r = 7.5;
  g.lineJoin = "round";
  g.shadowColor = "rgba(0,0,0,0.3)";
  g.shadowBlur = 3;
  g.shadowOffsetY = 0.5;
  if (withArrow) {
    // Chevron just ahead of the dot, pointing north; MapLibre rotates it.
    g.beginPath();
    g.moveTo(cx, cy - r - 9);
    g.lineTo(cx + 6.5, cy - r - 1);
    g.lineTo(cx, cy - r - 3.5);
    g.lineTo(cx - 6.5, cy - r - 1);
    g.closePath();
    g.lineWidth = 3;
    g.strokeStyle = "#fff";
    g.stroke();
    g.fillStyle = color;
    g.fill();
  }
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = "#fff";
  g.fill();
  g.shadowColor = "transparent";
  g.beginPath();
  g.arc(cx, cy, r - 2, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  return { image: g.getImageData(0, 0, c.width, c.height), ratio };
}

function addImages() {
  for (const [id, a] of Object.entries(AGENCIES)) {
    for (const arrow of [true, false]) {
      const name = `tt-${id}-${arrow ? "arrow" : "dot"}`;
      if (map.hasImage(name)) continue;
      const { image, ratio } = markerImage(a.color, arrow);
      map.addImage(name, image, { pixelRatio: ratio });
    }
  }
}

function themeColors() {
  return theme === "dark"
    ? { text: "#eceef1", halo: "rgba(21,23,27,0.92)", rail: "#8d9ab0", railCommuter: "#66728a", railCasing: "rgba(0,0,0,0.5)",
        stationFill: "#1c1f24", stationText: "#b9bfc8", railOpacity: 0.85, footprintOpacity: 0.18, stateBorder: "rgba(160,170,185,0.35)" }
    : { text: "#1b1d21", halo: "rgba(255,255,255,0.95)", rail: "#5d6675", railCommuter: "#8d95a3", railCasing: "rgba(255,255,255,0.9)",
        stationFill: "#ffffff", stationText: "#4a505a", railOpacity: 0.8, footprintOpacity: 0.1, stateBorder: "rgba(90,100,115,0.35)" };
}

function addLayers() {
  addImages();
  const colors = themeColors();
  // Our layers go above every basemap shape (roads, buildings, water) but below
  // its remaining labels. Styles differ: the dark one puts a label early and
  // draws roads after it, so "before the first label" would bury the rails.
  const baseLayers = map.getStyle().layers;
  let lastShape = -1;
  baseLayers.forEach((l, i) => { if (l.type !== "symbol") lastShape = i; });
  const firstSymbol = baseLayers[lastShape + 1]?.id; // undefined = top of the stack
  // Keep the basemap quiet: of its labels only country and state names stay
  // (station names are the rest of the text); none of its rail layers (ours
  // replace them; its own draw every yard and siding up close); and its
  // sub-national borders give way to our state borders below (the light
  // style mixes in county lines and only starts at zoom 8).
  for (const l of map.getStyle().layers) {
    const keepLabel = l.type === "symbol" && /^(label|place)_(country|state)/.test(l.id);
    if ((l.type === "symbol" && !keepLabel) || /^railway/.test(l.id) || /^boundary_(3|state)$/.test(l.id)) {
      map.setLayoutProperty(l.id, "visibility", "none");
    }
  }
  map.addLayer({
    id: "tt-state-borders",
    type: "line",
    source: "openmaptiles",
    "source-layer": "boundary",
    filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
    layout: { "line-join": "round" },
    paint: {
      "line-color": colors.stateBorder,
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 1.1, 12, 1.6],
      "line-dasharray": [3, 2],
    },
  }, firstSymbol);

  // Passenger rail network (USDOT NTAD), colored by the railroads that run on
  // each stretch. Track shared by several railroads (up to three) is drawn as
  // parallel strands, one color each, centered on the real alignment.
  map.addSource("rail", { type: "geojson", data: "data/rail.geojson?v=dev", tolerance: 0.6 });
  const STRAND = [[3, 1], [6, 1.6], [9, 2.4], [12, 3.4], [15, 5]]; // [zoom, strand width px]
  const byZoom = (f) => ["interpolate", ["linear"], ["zoom"], ...STRAND.flatMap(([z, w]) => [z, f(w)])];
  map.addLayer({
    id: "tt-rail-casing",
    type: "line",
    source: "rail",
    minzoom: 6,
    filter: ["!", ["has", "h"]], // hidden pieces are parallel duplicates kept for routing
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": colors.railCasing, "line-width": byZoom((w) => ["+", ["*", ["get", "n"], w], 2]) },
  }, firstSymbol);
  ["a", "b", "c"].forEach((prop, slot) => {
    map.addLayer({
      id: `tt-rail-${slot}`,
      type: "line",
      source: "rail",
      filter: ["all", [">", ["get", "n"], slot], ["!", ["has", "h"]]],
      layout: { "line-join": "round", "line-cap": "butt" },
      paint: {
        "line-color": networkColor(prop),
        "line-opacity": colors.railOpacity,
        "line-width": byZoom((w) => w),
        // Strand i of n sits (i - (n-1)/2) strand-widths off the centerline.
        "line-offset": byZoom((w) => ["*", ["-", slot, ["/", ["-", ["get", "n"], 1], 2]], w]),
      },
    }, firstSymbol);
  });
  // Other main-line track (freight) from the basemap, faintly, when zoomed in.
  // Yards, sidings and spurs are left out; they turn terminals into a tangle.
  map.addLayer({
    id: "tt-rail-other",
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    minzoom: 10,
    filter: ["all", ["==", ["get", "class"], "rail"], ["!", ["has", "service"]]],
    paint: { "line-color": colors.railCommuter, "line-opacity": 0.45, "line-width": 1 },
  }, "tt-rail-casing");

  // Outlines of major terminals (platforms and building), from city zoom.
  map.addSource("footprints", { type: "geojson", data: footprintCollection() });
  map.addLayer({
    id: "tt-footprint-fill",
    type: "fill",
    source: "footprints",
    minzoom: 11.5,
    layout: { visibility: state.showStations ? "visible" : "none" },
    paint: { "fill-color": ["get", "color"], "fill-opacity": ["interpolate", ["linear"], ["zoom"], 11.5, 0, 12.5, colors.footprintOpacity] },
  }, "tt-rail-casing");
  map.addLayer({
    id: "tt-footprint-line",
    type: "line",
    source: "footprints",
    minzoom: 11.5,
    layout: { visibility: state.showStations ? "visible" : "none", "line-join": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 16, 2],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 11.5, 0, 12.5, 0.75],
    },
  }, firstSymbol);

  // Stations sit under the trains. Intercity stops appear from regional zoom,
  // commuter stops once you're looking at a metro area.
  map.addSource("stations", { type: "geojson", data: stationCollection() });
  const stationPaint = (r) => ({
    "circle-radius": r,
    "circle-color": colors.stationFill,
    "circle-stroke-color": ["get", "color"],
    "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 5, 1.3, 12, 2.2],
  });
  map.addLayer({
    id: "tt-stations-minor",
    layout: { visibility: state.showStations ? "visible" : "none" },
    type: "circle",
    source: "stations",
    minzoom: 8,
    filter: ["!", ["get", "major"]],
    paint: stationPaint(["interpolate", ["linear"], ["zoom"], 8, 2.2, 12, 5, 15, 7]),
  });
  map.addLayer({
    id: "tt-stations-major",
    layout: { visibility: state.showStations ? "visible" : "none" },
    type: "circle",
    source: "stations",
    minzoom: 4.5,
    filter: ["get", "major"],
    paint: stationPaint(["interpolate", ["linear"], ["zoom"], 4.5, 1.8, 8, 3.6, 12, 6, 15, 8]),
  });
  map.addLayer({
    id: "tt-station-selected",
    type: "circle",
    source: "stations",
    filter: ["==", ["get", "id"], ""],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 7, 12, 12],
      "circle-color": "transparent",
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": 3,
    },
  });
  // Station names (most of the basemap's place names are hidden): the
  // busiest stations at every zoom, every intercity station from zoom 7, and
  // every station from zoom 9. Labels that would collide are dropped, busiest
  // stations first in line.
  map.addLayer({
    id: "tt-station-labels",
    type: "symbol",
    source: "stations",
    minzoom: 4.5,
    layout: {
      "text-field": ["step", ["zoom"],
        ["case", ["get", "top"], ["get", "name"], ""],                 // busiest stations
        7, ["case", ["any", ["get", "top"], ["get", "major"]], ["get", "name"], ""], // + every intercity station
        9, ["get", "name"]],                                           // every station
      "text-font": ["case", ["get", "top"], ["literal", ["Noto Sans Bold"]], ["literal", ["Noto Sans Regular"]]],
      "text-size": ["interpolate", ["linear"], ["zoom"], 4.5, 10, 9, 11, 15, 13],
      "text-max-width": 8,
      "text-variable-anchor": ["top", "bottom", "right", "left"],
      "text-radial-offset": ["interpolate", ["linear"], ["zoom"], 4.5, 0.6, 12, 0.9],
      "text-padding": 3,
      "symbol-sort-key": ["-", ["get", "rank"]],
      visibility: state.showStations ? "visible" : "none",
    },
    paint: {
      "text-color": ["case", ["get", "major"], colors.text, colors.stationText],
      "text-halo-color": colors.halo,
      "text-halo-width": 1.5,
    },
  });

  map.addSource("trains", { type: "geojson", data: featureCollection() });

  // Intercity trains draw a little larger than commuter trains.
  const sized = (v) => ["*", ["case", ["get", "intercity"], 1.12, 1], v];
  const iconSize = ["interpolate", ["linear"], ["zoom"], 2, sized(0.5), 5, sized(0.68), 8, sized(0.85), 12, sized(1)];

  map.addLayer({
    id: "tt-halo",
    type: "circle",
    source: "trains",
    filter: ["==", ["get", "id"], ""],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 11, 8, 17, 12, 21],
      "circle-color": ["get", "color"],
      "circle-opacity": 0.22,
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": 2,
      "circle-stroke-opacity": 0.7,
    },
  });

  map.addLayer({
    id: "tt-trains",
    type: "symbol",
    source: "trains",
    layout: {
      "icon-image": ["concat", "tt-", ["get", "agency"], ["case", ["get", "hasBearing"], "-arrow", "-dot"]],
      "icon-size": iconSize,
      "icon-rotate": ["get", "bearing"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "symbol-sort-key": ["get", "drawOrder"],
    },
    paint: { "icon-opacity": ["case", ["get", "stale"], 0.45, 1] },
  });

  // Labels only appear once there's room for them, and collide with each
  // other instead of piling up — intercity trains win ties.
  const labelText = ["format",
    ["get", "label"], {},
    ["case", [">", ["length", ["get", "subtitle"]], 0], ["concat", "\n", ["get", "subtitle"]], ""],
    { "font-scale": 0.85, "text-font": ["literal", ["Noto Sans Regular"]] }];
  const labelLayout = {
    "text-field": labelText,
    "text-font": ["Noto Sans Bold"],
    "text-size": ["interpolate", ["linear"], ["zoom"], 5, 11, 10, 13],
    "text-variable-anchor": ["left", "right", "top", "bottom"],
    "text-radial-offset": ["interpolate", ["linear"], ["zoom"], 5, 0.75, 10, 1.1],
    "text-justify": "auto",
    "text-padding": 3,
    "symbol-sort-key": ["get", "labelOrder"],
  };
  const labelPaint = { "text-color": colors.text, "text-halo-color": colors.halo, "text-halo-width": 1.6 };

  map.addLayer({
    id: "tt-labels",
    type: "symbol",
    source: "trains",
    minzoom: 11, // trains are unlabeled dots until zoomed in tight
    filter: ["!=", ["get", "id"], ""],
    layout: labelLayout,
    paint: labelPaint,
  });

  map.addLayer({
    id: "tt-label-selected",
    type: "symbol",
    source: "trains",
    filter: ["==", ["get", "id"], ""],
    layout: { ...labelLayout, "text-allow-overlap": true, "text-ignore-placement": true },
    paint: labelPaint,
  });

  applySelectionFilter();
}

map.on("style.load", addLayers);

// ---------- Train features ----------

function visible(t) {
  const a = AGENCIES[t.agency];
  if (state.hidden.has(t.agency)) return false;
  if (state.kind !== "all" && a.kind !== state.kind) return false;
  return true;
}

function labelFor(t) {
  const a = AGENCIES[t.agency];
  if (t.number) return `${a.short} ${t.number}`;
  if (t.route && t.route !== a.short) return `${a.short} ${t.route}`;
  return a.short;
}

function featureCollection() {
  const features = [];
  for (const t of state.trains.values()) {
    if (!visible(t)) continue;
    const pos = state.display.get(t.id) || targetOf(t);
    const intercity = AGENCIES[t.agency].kind === "intercity";
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [pos.lon, pos.lat] },
      properties: {
        id: t.id,
        agency: t.agency,
        color: AGENCIES[t.agency].color,
        label: labelFor(t),
        // Second label line, shown when zoomed in; skipped if the label already names the line.
        subtitle: t.number && t.route ? t.route : "",
        bearing: targetOf(t).bearing ?? 0,
        hasBearing: targetOf(t).bearing != null,
        intercity,
        stale: Date.now() - t.updated > STALE_MS && !t.estimated,
        drawOrder: intercity ? 1 : 0,
        labelOrder: intercity ? 0 : 1,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function redraw() {
  map.getSource("trains")?.setData(featureCollection());
}

function agencyShown(agency) {
  if (state.hidden.has(agency)) return false;
  if (state.kind !== "all" && AGENCIES[agency].kind !== state.kind) return false;
  const src = SOURCES.find((s) => s.agencies.includes(agency));
  return src && sourceAvailability(src).ok;
}

// Draw each station on its railroad's track: the nearest point on the track
// of its first (highest-priority) railroad within STATION_SNAP_M.
const STATION_SNAP_M = 400;
function snapStations() {
  if (!state.rail) return;
  for (const st of state.stations.values()) {
    st.draw = null;
    for (const m of st.members) {
      const s = state.rail.snap([st.lon, st.lat], STATION_SNAP_M, m.agency);
      if (s && state.rail.lines[s.line].nets.includes(m.agency)) {
        const [lon, lat] = state.rail.at(s.line, s.along).point;
        st.draw = { lon, lat };
        break;
      }
    }
  }
  redrawStations();
}
const stationPos = (st) => st.draw || st;

function stationCollection() {
  const features = [];
  for (const st of state.stations.values()) {
    const shown = st.agencies.filter(agencyShown);
    if (!shown.length) continue;
    const pos = stationPos(st);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [pos.lon, pos.lat] },
      properties: {
        id: st.id,
        name: st.name,
        major: st.major && shown.some((a) => AGENCIES[a].kind === "intercity"),
        color: AGENCIES[shown[0]].color,
        rank: st.rank,
        top: !!st.top,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function footprintCollection() {
  const features = [];
  for (const st of state.stations.values()) {
    if (!st.footprint) continue;
    const shown = st.agencies.filter(agencyShown);
    if (!shown.length) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [st.footprint] },
      properties: { id: st.id, color: AGENCIES[shown[0]].color },
    });
  }
  return { type: "FeatureCollection", features };
}

function redrawStations() {
  map.getSource("stations")?.setData(stationCollection());
  map.getSource("footprints")?.setData(footprintCollection());
}

// Where to draw a train: on the nearest track, and in live-estimate mode
// moved forward to where it most likely is now. Falls back to exactly what
// the feed reported (e.g., VIA trains in Canada, beyond the rail data).
function targetOf(t) {
  return state.est.get(t.id) || t;
}

// Snapping depends only on the reported position, so cache it per train.
const snapCache = new Map(); // id -> { lat, lon, result }
function snapped(t) {
  const c = snapCache.get(t.id);
  if (c && c.lat === t.lat && c.lon === t.lon) return c.result;
  const result = snapToTrack(t, state.rail);
  snapCache.set(t.id, { lat: t.lat, lon: t.lon, result });
  return result;
}

function computeEstimates() {
  state.est.clear();
  const stationAt = (key) => state.stopPos.get(key);
  const now = Date.now();
  for (const t of state.trains.values()) {
    const e = (state.estimate && estimatePosition(t, state.rail, stationAt, now)) || snapped(t);
    if (e) state.est.set(t.id, e);
  }
  for (const id of snapCache.keys()) if (!state.trains.has(id)) snapCache.delete(id);
}

let railLoading = null;
function loadRail() {
  railLoading ??= fetch("data/rail.geojson?v=dev")
    .then((r) => r.json())
    .then((geojson) => {
      state.rail = new RailIndex(geojson);
      snapCache.clear();
      snapStations();
      computeEstimates();
      animateTo();
    })
    .catch((err) => console.warn("rail index", err)); // trains stay at reported positions
  return railLoading;
}

// Slides markers from where they're drawn to where they should be.
let anim = null;
// Approximate on-screen distance in pixels between two positions at the
// current zoom (Web Mercator: 512 px per world at zoom 0).
function pixelGap(a, b) {
  const scale = (512 * 2 ** map.getZoom()) / 360;
  const k = 1 / Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lon - a.lon) * scale, (b.lat - a.lat) * scale * k);
}

// Longer slides follow the track between the old and new spot, so a train
// never cuts across a curve. Short hops just slide straight.
function glidePath(t, from, to) {
  if (!state.rail || !t) return null;
  const straight = meters(from, to);
  if (straight < 150) return null;
  const a = state.rail.snap([from.lon, from.lat], 60, t.agency);
  const b = state.rail.snap([to.lon, to.lat], 60, t.agency);
  const path = state.rail.route(a, b, t.agency);
  return path && path.length < straight * 2.5 + 300 ? path : null;
}

function animateTo(duration = ANIM_MS, linear = false) {
  cancelAnimationFrame(anim);
  const targets = new Map();
  for (const t of state.trains.values()) targets.set(t.id, targetOf(t));
  for (const id of [...state.display.keys()]) if (!targets.has(id)) state.display.delete(id);

  // Only animate trains that are on screen and would visibly move; everything
  // else jumps straight to its new spot in the same single redraw.
  const view = map.getBounds();
  const pad = 0.2 * Math.max(view.getNorth() - view.getSouth(), view.getEast() - view.getWest());
  const inView = (p) => p.lat > view.getSouth() - pad && p.lat < view.getNorth() + pad &&
    p.lon > view.getWest() - pad && p.lon < view.getEast() + pad;
  const still = document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const movers = [];
  for (const [id, p] of targets) {
    const f = state.display.get(id);
    if (still || !f || Math.abs(f.lat - p.lat) + Math.abs(f.lon - p.lon) > 1 ||
        !(inView(f) || inView(p)) || pixelGap(f, p) < 1) {
      state.display.set(id, { lat: p.lat, lon: p.lon });
    } else {
      movers.push([id, f, p, glidePath(state.trains.get(id), f, p)]);
    }
  }
  redraw();
  if (!movers.length) return;

  // Rebuilding the marker layer is the expensive part, so cap the frame rate:
  // ~30 fps for short refresh glides, ~10 fps for continuous estimate drift.
  const frameMs = linear ? 100 : 33;
  const start = performance.now();
  let last = 0;
  const step = (now) => {
    const k = Math.min(1, (now - start) / duration);
    if (now - last >= frameMs || k === 1) {
      last = now;
      const e = linear ? k : k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      for (const [id, f, p, path] of movers) {
        if (path) {
          const [lon, lat] = path.at(path.length * e).point;
          state.display.set(id, { lat, lon });
        } else {
          state.display.set(id, { lat: f.lat + (p.lat - f.lat) * e, lon: f.lon + (p.lon - f.lon) * e });
        }
      }
      redraw();
    }
    if (k < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}

function mergeTrains() {
  state.trains = new Map();
  for (const list of Object.values(state.bySource)) for (const t of list) state.trains.set(t.id, t);
  computeEstimates();
  animateTo();
  checkTracked();
  renderAll();
  if (state.follow && state.selected) {
    const t = state.trains.get(state.selected);
    if (t) map.easeTo({ center: [targetOf(t).lon, targetOf(t).lat], duration: ANIM_MS });
  }
}

// ---------- Feeds ----------

function sourceAvailability(src) {
  if (!src.relay) return { ok: true };
  if (!RELAY) return { ok: false, reason: "Needs the relay (see README)" };
  if (state.relayFeeds && !state.relayFeeds[src.id]) {
    return { ok: false, reason: src.needsKey ? "Needs a free API key" : "Not enabled on relay" };
  }
  return { ok: true };
}

async function poll(src, attempt = 0) {
  let delay = src.interval;
  // Background tabs skip refreshes, but always load once.
  if (!document.hidden || !state.sourceStatus[src.id]?.at) {
    try {
      state.bySource[src.id] = await fetchSource(src, RELAY);
      state.sourceStatus[src.id] = { status: "ok", at: Date.now() };
      attempt = 0;
    } catch (err) {
      console.warn(`[${src.id}]`, err);
      const prev = state.sourceStatus[src.id];
      state.sourceStatus[src.id] = { status: "error", error: err.message, at: prev?.at };
      // Keep showing the last good positions for a few minutes.
      if (!prev?.at || Date.now() - prev.at > 5 * 60 * 1000) state.bySource[src.id] = [];
      attempt++;
      delay = Math.min(300, src.interval * 2 ** attempt);
    }
    mergeTrains();
  }
  setTimeout(() => poll(src, attempt), delay * 1000);
}

async function start() {
  loadRail();
  if (state.estimate) setEstimate(true);
  loadStations()
    .then((stations) => {
      state.stations = stations;
      // Optional: outlines for major terminals (scripts/build_footprints.py).
      fetch("data/footprints.json?v=dev")
        .then((r) => (r.ok ? r.json() : {}))
        .then((outlines) => {
          for (const st of stations.values()) st.footprint = st.members.map((m) => outlines[m.key]).find(Boolean) || null;
          redrawStations();
        })
        .catch(() => {});
      for (const st of stations.values()) for (const m of st.members) state.stopPos.set(m.key, { lat: m.lat, lon: m.lon });
      snapStations();
      computeEstimates();
      redrawStations();
      if (wantedStation) selectStation(wantedStation);
      renderResults();
    })
    .catch((err) => console.warn("stations", err));
  if (RELAY) {
    try {
      const res = await fetch(`${RELAY.replace(/\/$/, "")}/status`);
      state.relayFeeds = (await res.json()).feeds;
      redrawStations();
    } catch {
      state.relayFeeds = {};
      toast("Couldn't reach the relay — showing directly available railroads only.");
    }
  }
  for (const src of SOURCES) {
    if (sourceAvailability(src).ok) {
      state.sourceStatus[src.id] = { status: "loading" };
      poll(src);
    }
  }
  renderAll();
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    // Refresh soon after returning to the tab; regular polling resumes itself.
    for (const src of SOURCES) if (sourceAvailability(src).ok) fetchSource(src, RELAY).then((l) => {
      state.bySource[src.id] = l;
      state.sourceStatus[src.id] = { status: "ok", at: Date.now() };
      mergeTrains();
    }).catch(() => {});
  }
});

// Trains placed by timetable keep moving between refreshes; in live-estimate
// mode every train does, re-estimated every couple of seconds.
// Timetable-placed trains (Metro-North) advance every 6 s. In live-estimate
// mode every train is re-estimated, more often when zoomed in where the
// motion is visible: every 2 s in a city, up to 8 s for the whole country.
let lastTimetable = 0;
function tick() {
  const z = map.getZoom();
  const every = !state.estimate ? 2000 : z >= 9 ? 2000 : z >= 6 ? 4000 : 8000;
  setTimeout(tick, every);
  if (document.hidden || map.isMoving()) return;
  const now = Date.now();
  let moved = false;
  if (now - lastTimetable >= 6000) {
    lastTimetable = now;
    for (const t of state.trains.values()) moved = advanceEstimated(t) || moved;
  }
  if (state.estimate) {
    computeEstimates();
    animateTo(every, true);
    if (state.follow && state.selected) {
      const t = state.trains.get(state.selected);
      if (t) map.easeTo({ center: [targetOf(t).lon, targetOf(t).lat], duration: every, easing: (x) => x });
    }
  } else if (moved) {
    computeEstimates(); // re-snap the timetable-placed trains that moved
    animateTo();
  }
}
setTimeout(tick, 2000);
// The selected train's panel ("estimated now", "last report") ages too.
setInterval(() => !document.hidden && state.selected && renderDetail(), 10000);

async function setEstimate(on) {
  state.estimate = on;
  store.set("tt-estimate", on);
  setChecked("estimate-toggle", on);
  await loadRail();
  computeEstimates();
  animateTo();
  renderAll();
}

on("estimate-toggle", "change", (e) => setEstimate(e.target.checked));

// ---------- Rendering: list ----------

const CHECK = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="#fff" d="m9.5 16.2-4.2-4.2-1.4 1.4 5.6 5.6 11-11-1.4-1.4z"/></svg>';
const ZOOM = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 1 7 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 0 1 7-7Zm0 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"/></svg>';

function agencyCounts() {
  const counts = {};
  for (const t of state.trains.values()) counts[t.agency] = (counts[t.agency] || 0) + 1;
  return counts;
}

function renderAgencies() {
  const counts = agencyCounts();
  const rows = { intercity: [], commuter: [], off: [] };
  for (const src of SOURCES) {
    const avail = sourceAvailability(src);
    const st = state.sourceStatus[src.id];
    for (const id of src.agencies) {
      const a = AGENCIES[id];
      if (!avail.ok) {
        rows.off.push(`
          <div class="agency unavailable" style="--swatch:${a.color}" title="${esc(avail.reason)}">
            <span class="check"></span>
            <span class="name">${esc(a.name)}<span class="sub">${esc(a.region)} · ${esc(avail.reason)}</span></span>
            <span></span>
          </div>`);
        continue;
      }
      const off = state.hidden.has(id);
      let count = `<span class="count">${counts[id] || 0}</span>`;
      if (st?.status === "loading") count = '<span class="count">…</span>';
      else if (st?.status === "error" && !counts[id]) count = `<span class="count err" title="${esc(st.error)}">offline</span>`;
      rows[a.kind].push(`
        <div class="agency-row">
          <button class="agency ${off ? "off" : ""}" data-toggle="${id}" style="--swatch:${a.color}" aria-pressed="${!off}">
            <span class="check">${CHECK}</span>
            <span class="name">${esc(a.name)}<span class="sub">${esc(a.region)}</span></span>
            ${count}
          </button>
          <button class="zoom" data-zoom="${id}" title="Show ${esc(a.short)} trains" aria-label="Zoom to ${esc(a.name)}">${ZOOM}</button>
        </div>`);
    }
  }
  const showIntercity = state.kind !== "commuter", showCommuter = state.kind !== "intercity";
  $("agencies").innerHTML =
    (showIntercity ? `<div class="group-title">Intercity</div>${rows.intercity.join("")}` : "") +
    (showCommuter ? `<div class="group-title">Commuter &amp; regional</div>${rows.commuter.join("")}` : "") +
    (rows.off.length
      ? `<div class="group-title">Not connected yet</div>${rows.off.join("")}
         <p class="note">These railroads publish live data, but it has to be fetched through a small relay server${RELAY ? " or with a free developer key" : ""}. See the README to switch them on.</p>`
      : "");
}

function renderLiveCount() {
  const n = [...state.trains.values()].filter(visible).length;
  const times = Object.values(state.sourceStatus).map((s) => s.at).filter(Boolean);
  if (!times.length) {
    $("live-count").textContent = "Loading trains…";
    return;
  }
  const ago = Math.round((Date.now() - Math.max(...times)) / 1000);
  $("live-count").textContent = `${n.toLocaleString()} trains moving · updated ${ago < 5 ? "just now" : ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)} min ago`}`;
}

function renderCredits() {
  const seen = new Map();
  for (const s of SOURCES) if (sourceAvailability(s).ok) seen.set(s.credit.label, s.credit.href);
  $("credits").innerHTML = "Data: " + [...seen].map(([l, h]) => `<a href="${esc(h)}" target="_blank" rel="noopener">${esc(l)}</a>`).join(", ") +
    '. Map © <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>.';
}

function statusClass(t) {
  if (t.delayMin == null) return "neutral";
  if (t.delayMin <= 5) return "good";
  if (t.delayMin <= 20) return "warn";
  return "bad";
}

function trainTitle(t) {
  const a = AGENCIES[t.agency];
  return t.route ? `${t.route}` : a.name;
}

function renderResults() {
  const q = state.query.trim().toLowerCase();
  const el = $("results");
  if (!q) {
    el.hidden = true;
    $("agencies").hidden = false;
    return;
  }
  el.hidden = false;
  $("agencies").hidden = true;
  const terms = q.split(/\s+/);
  const matches = [];
  for (const t of state.trains.values()) {
    if (!visible(t)) continue;
    const a = AGENCIES[t.agency];
    const hay = `${a.name} ${a.short} ${a.region} ${t.number} ${t.route} ${t.origin} ${t.destination} ${t.nextStop}`.toLowerCase();
    if (!terms.every((w) => hay.includes(w))) continue;
    const exact = String(t.number).toLowerCase() === q || terms.includes(String(t.number).toLowerCase());
    matches.push({ t, score: (exact ? 0 : 1) + (a.kind === "intercity" ? 0 : 0.5) });
  }
  matches.sort((x, y) => x.score - y.score || String(x.t.number).localeCompare(String(y.t.number), undefined, { numeric: true }));
  const stationHits = [];
  for (const st of state.stations.values()) {
    if (!st.agencies.some(agencyShown)) continue;
    const hay = `${st.name} ${st.place} ${st.members.map((m) => `${m.name} ${m.lines.join(" ")} ${AGENCIES[m.agency].short}`).join(" ")}`.toLowerCase();
    if (terms.every((w) => hay.includes(w))) stationHits.push(st);
  }
  stationHits.sort((a, b) => (b.major - a.major) || (b.members.length - a.members.length) || a.name.localeCompare(b.name));
  const stationHtml = stationHits.slice(0, 6).map((st) => `<button class="result" data-station="${esc(st.id)}">
      <span class="station-icon" style="--c:${AGENCIES[st.agencies[0]].color}"></span>
      <span><span class="title">${esc(st.name)}</span><br><span class="sub">${esc([st.place, st.agencies.map((a) => AGENCIES[a].short).join(", ")].filter(Boolean).join(" · "))}</span></span>
      <span></span>
    </button>`).join("");
  const stationBlock = stationHtml ? `<div class="group-title">Stations</div>${stationHtml}` : "";
  if (!matches.length && stationBlock) {
    el.innerHTML = stationBlock;
    return;
  }
  if (!matches.length) {
    el.innerHTML = `<div class="empty">No trains or stations match “${esc(state.query)}”.</div>`;
    return;
  }
  el.innerHTML = stationBlock + (stationBlock ? '<div class="group-title">Trains</div>' : "") + matches.slice(0, 60).map(({ t }) => {
    const a = AGENCIES[t.agency];
    const sub = [t.destination && `to ${t.destination}`, t.nextStop && !t.destination && `next ${t.nextStop}`, t.departedOn && `left ${t.departedOn}`]
      .filter(Boolean).join(" · ") || a.region;
    return `<button class="result" data-select="${esc(t.id)}">
      <span class="badge" style="background:${a.color}">${esc(t.number || a.short)}</span>
      <span><span class="title">${esc(trainTitle(t))}</span><br><span class="sub">${esc(a.short)} · ${esc(sub)}</span></span>
      ${t.statusText ? `<span class="status ${statusClass(t)}">${esc(t.statusText)}</span>` : ""}
    </button>`;
  }).join("");
}

// ---------- Rendering: train detail ----------

function fmtTime(iso, tz) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "";
  try {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz || undefined });
  } catch {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
}

function fmtAgo(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

const HEADINGS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

function renderDetail() {
  if (state.station) return renderStation();
  const t = state.trains.get(state.selected);
  const el = $("train-detail");
  if (!t) {
    el.innerHTML = '<p class="empty">This train isn’t reporting right now. It may have finished its trip.</p>';
    return;
  }
  const a = AGENCIES[t.agency];
  const lineColor = t.routeColor || a.color;
  const facts = [
    ["Next stop", t.nextStop],
    ["Speed", t.speedMph != null && !t.estimated ? `${Math.round(t.speedMph)} mph` : null],
    ["Heading", t.bearing != null ? HEADINGS[Math.round(t.bearing / 45) % 8] : null],
    ["Departed", t.departedOn],
    ["Position", state.est.get(t.id)?.basis
      ? `Estimated now (${state.est.get(t.id).basis})`
      : `${t.estimated ? "Estimated" : "GPS"} · ${fmtAgo(t.updated)}`],
    ["Last report", state.est.get(t.id)?.basis ? fmtAgo(t.updated) : null],
    ["Equipment", t.detail],
  ].filter(([, v]) => v);
  const stops = t.stops?.length
    ? `<h3 class="section-title">Stops</h3><div class="stops-scroll"><ol class="stops" style="--line-color:${lineColor}">${t.stops.map((s) => {
        const lateMin = s.scheduled && s.time ? Math.round((Date.parse(s.time) - Date.parse(s.scheduled)) / 60000) : 0;
        const late = lateMin > 1
          ? ` <span class="late">+${lateMin < 60 ? `${lateMin}m` : `${Math.floor(lateMin / 60)}h${String(lateMin % 60).padStart(2, "0")}`}</span>`
          : "";
        return `<li class="${s.status}"><span>${esc(s.name)}</span><span class="time">${fmtTime(s.time, s.tz)}${late}</span></li>`;
      }).join("")}</ol></div>`
    : "";
  el.innerHTML = `
    <div class="hero">
      <div class="agency-name" style="color:${a.color}"><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</div>
      <h2>${esc(trainTitle(t))}</h2>
      ${t.number ? `<div style="color:var(--muted)">Train ${esc(t.number)}</div>` : ""}
      ${t.destination ? `<p class="od">${t.origin ? `${esc(t.origin)}<span class="arrow">→</span>` : "to "}<strong>${esc(t.destination)}</strong></p>` : ""}
      ${t.statusText ? `<span class="pill ${statusClass(t)}">${esc(t.statusText)}</span>` : ""}
      ${trackButton(t)}
    </div>
    ${state.trackPicker === t.id ? trackPicker(t) : ""}
    ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}
    ${t.estimated ? '<p class="estimate-note">This railroad doesn’t publish GPS positions, so the train is placed between stations using its predicted arrival times.</p>' : ""}
    ${stops}`;
  // Re-rendering replaces the list, so keep the reader's scroll position;
  // the first time, center the next stop.
  const list = el.querySelector(".stops-scroll");
  const next = el.querySelector(".stops li.next");
  if (list && el.dataset.scrollTop != null) list.scrollTop = +el.dataset.scrollTop;
  else if (list && next) list.scrollTop = Math.max(0, next.offsetTop - list.clientHeight / 2);
  list?.addEventListener("scroll", () => (el.dataset.scrollTop = list.scrollTop));
}

function fmtIn(ms) {
  const min = Math.round((ms - Date.now()) / 60000);
  if (min <= 0) return "now";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

function lateText(min) {
  if (min == null) return { text: "", cls: "neutral" };
  if (min <= 1) return { text: "On time", cls: "good" };
  return { text: `${Math.round(min)} min late`, cls: min <= 20 ? "warn" : "bad" };
}

function departureRow({ id, color, badge, title, sub, time, tz, status, statusCls }) {
  const when = time
    ? `<span class="when"><strong>${fmtTime(new Date(time).toISOString(), tz)}</strong><span>${fmtIn(time)}</span></span>`
    : '<span class="when"><strong>Next</strong><span>stop</span></span>';
  const inner = `${when}
    <span class="badge" style="background:${color}">${esc(badge)}</span>
    <span class="what"><span class="title">${esc(title)}</span><span class="sub">${esc(sub || "")}</span></span>
    ${status ? `<span class="status ${statusCls}">${esc(status)}</span>` : "<span></span>"}`;
  return id
    ? `<button class="dep" data-select="${esc(id)}">${inner}</button>`
    : `<div class="dep">${inner}</div>`;
}

function renderStation() {
  const st = state.stations.get(state.station);
  const el = $("train-detail");
  if (!st) return;
  const trains = [...state.trains.values()].filter(visible);

  // Live departures: MBTA predictions where available, then trains on the map
  // that are due here.
  const rows = [];
  const listed = new Set();
  for (const p of state.predictions || []) {
    const t = p.trainId && state.trains.get(p.trainId);
    if (t) listed.add(t.id);
    rows.push({
      sort: p.time,
      html: departureRow({
        id: t?.id, color: AGENCIES.mbta.color, badge: p.number || "MBTA", title: p.headsign ? `to ${p.headsign}` : p.route,
        sub: p.route, time: p.time, tz: p.tz, status: p.status || "", statusCls: "neutral",
      }),
    });
  }
  for (const d of trainsDue(st, trains)) {
    if (listed.has(d.train.id) || (state.predictions && d.train.agency === "mbta")) continue;
    listed.add(d.train.id);
    const t = d.train, a = AGENCIES[t.agency];
    const late = d.here ? { text: "At station", cls: "good" } : lateText(d.lateMin);
    rows.push({
      sort: d.time ?? Date.now(),
      html: departureRow({
        id: t.id, color: a.color, badge: t.number || a.short,
        title: d.terminates && t.origin ? `from ${t.origin}` : t.destination ? `to ${t.destination}` : trainTitle(t),
        sub: [d.terminates && "Arriving", a.short, t.route].filter(Boolean).join(" · "),
        time: d.time, tz: d.tz, status: late.text, statusCls: late.cls,
      }),
    });
  }
  rows.sort((x, y) => x.sort - y.sort);

  // Other trains close by, for railroads whose feeds don't say where trains stop.
  const nearby = trains
    .filter((t) => !listed.has(t.id) && st.agencies.includes(t.agency))
    .map((t) => ({ t, d: meters(st, targetOf(t)) }))
    .filter((x) => x.d < 25000)
    .sort((x, y) => x.d - y.d)
    .slice(0, 6);

  const loading = st.agencies.includes("mbta") && state.predictions === null;
  const lines = st.members.map((m) => {
    const a = AGENCIES[m.agency];
    // "City Terminal Zone" is an LIRR scheduling zone, not a line riders know.
    const named = (m.lines || []).filter((l) => l !== "City Terminal Zone");
    const ls = named.length ? named.join(", ") : a.kind === "intercity" ? "Intercity trains" : "";
    return `<li><span class="dot" style="background:${a.color}"></span><span><strong>${esc(a.name)}</strong>${ls ? `<br><span class="sub">${esc(ls)}</span>` : ""}</span></li>`;
  }).join("");

  el.innerHTML = `
    <div class="hero">
      <div class="agency-name" style="color:var(--muted)">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2c4 0 8 .5 8 4v9.5a3.5 3.5 0 0 1-3.5 3.5l1.5 1.5v.5h-2l-2-2h-4l-2 2H6v-.5L7.5 19A3.5 3.5 0 0 1 4 15.5V6c0-3.5 4-4 8-4Zm0 2c-3.5 0-5.5.5-6 1.5V10h12V5.5C17.5 4.5 15.5 4 12 4ZM7.5 13a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/></svg>
        Station${st.place ? ` · ${esc(st.place)}` : ""}
      </div>
      <h2>${esc(st.name)}</h2>
    </div>
    <ul class="served">${lines}</ul>
    <h3 class="section-title">Next trains</h3>
    <div class="deps">
      ${rows.length ? rows.slice(0, 14).map((r) => r.html).join("")
        : `<p class="empty">${loading ? "Loading live departures…" : "No live trains are reporting a stop here right now."}</p>`}
    </div>
    ${nearby.length ? `<h3 class="section-title">Nearby trains</h3><div class="deps">${nearby.map(({ t, d }) => {
      const a = AGENCIES[t.agency];
      return `<button class="dep" data-select="${esc(t.id)}">
        <span class="when"><strong>${(d / 1609).toFixed(d < 16090 ? 1 : 0)}</strong><span>mi away</span></span>
        <span class="badge" style="background:${a.color}">${esc(t.number || a.short)}</span>
        <span class="what"><span class="title">${esc(t.destination ? `to ${t.destination}` : trainTitle(t))}</span><span class="sub">${esc([a.short, t.route].filter(Boolean).join(" · "))}</span></span>
        <span></span></button>`;
    }).join("")}</div>` : ""}
    <p class="estimate-note">Times are live predictions from each railroad. Trains on railroads whose feeds don't list stops appear under “Nearby trains”.</p>`;
}

// ---------- Tracked trains ----------
// For people riding a train, or following one someone they know is on.

const MAX_TRACKED = 3;
const LOST_MS = 30 * 60 * 1000;  // gone from its feed this long: trip finished or cancelled
const PAGE_OPENED = Date.now(); // trips that ended while the page was closed are dropped quietly

const trainLabel = (rec) => `${AGENCIES[rec.agency]?.short || ""} ${rec.number || ""}`.trim();
const saveTracked = () => store.set("tt-tracked", state.tracked);

// The live train for a tracked record, if it's reporting. A feed can reuse a
// vehicle id for a different train, so the number has to match too.
function trackedTrain(rec) {
  const t = state.trains.get(rec.id);
  if (!t || (rec.number && t.number && String(t.number) !== String(rec.number))) return null;
  return t;
}

// The stop that ends tracking: the one chosen, else the final destination.
function endStop(t, rec) {
  if (!t.stops?.length) return null;
  return (rec.stopKey && t.stops.find((s) => s.key === rec.stopKey)) || t.stops[t.stops.length - 1];
}

function hasArrived(t, stop) {
  if (!stop) return false;
  if (stop.status === "past" || stop.here) return true;
  // Some feeds never mark the final stop: near it, after its time, counts.
  const pos = state.stopPos.get(stop.key), drawn = targetOf(t);
  return !!pos && Date.parse(stop.time) < Date.now() && meters(pos, drawn) < 400;
}

function checkTracked() {
  const now = Date.now();
  let changed = false;
  for (const rec of [...state.tracked]) {
    const src = SOURCES.find((s) => s.agencies.includes(rec.agency));
    if (!state.sourceStatus[src?.id]?.at) continue; // its feed hasn't loaded yet
    const t = trackedTrain(rec);
    if (t) {
      rec.lastSeen = now;
      const stop = endStop(t, rec);
      if (stop) {
        rec.eta = Date.parse(stop.time) || rec.eta;
        rec.stopName = stop.name;
      }
      if (stop && hasArrived(t, stop)) {
        untrack(rec.id, `${trainLabel(rec)} arrived at ${stop.name}.`);
        continue;
      }
      changed = true;
    } else if (rec.eta && rec.eta < now) {
      // Vanished after its arrival time: it got there and the trip ended.
      untrack(rec.id, rec.lastSeen < PAGE_OPENED ? null : `${trainLabel(rec)} arrived at ${rec.stopName}.`);
    } else if (now - (rec.lastSeen || 0) > LOST_MS) {
      untrack(rec.id, rec.lastSeen < PAGE_OPENED ? null
        : `Stopped tracking ${trainLabel(rec)}: it hasn't reported for 30 minutes, so its trip may have finished or been cancelled.`);
    }
  }
  if (changed) saveTracked();
}

function startTracking(t, stopKey) {
  if (state.tracked.some((r) => r.id === t.id)) return;
  if (state.tracked.length >= MAX_TRACKED) return toast("You can track up to three trains at once.");
  const stop = stopKey ? t.stops?.find((s) => s.key === stopKey) : null;
  state.tracked.push({
    id: t.id, agency: t.agency, number: t.number, route: t.route,
    stopKey: stop?.key || null, stopName: stop?.name || null,
    eta: stop ? Date.parse(stop.time) : null, lastSeen: Date.now(),
  });
  saveTracked();
  state.trackPicker = null;
  checkTracked();
  renderAll();
}

function untrack(id, message) {
  state.tracked = state.tracked.filter((r) => r.id !== id);
  saveTracked();
  if (message) toast(message);
  renderAll();
}

function trackButton(t) {
  const rec = state.tracked.find((r) => r.id === t.id);
  if (rec) {
    return `<div class="track-row"><span class="tracking-note">Tracking${rec.stopName ? ` to ${esc(rec.stopName)}` : ""}</span>
      <button class="btn small" data-untrack="${esc(t.id)}">Stop</button></div>`;
  }
  return `<div class="track-row"><button class="btn primary small" data-track="${esc(t.id)}">Track this train</button></div>`;
}

function trackPicker(t) {
  const ahead = t.stops.filter((s) => s.status !== "past");
  const pick = state.trackPick ?? ahead[ahead.length - 1]?.key ?? "";
  const option = (key, label, sub) => `<label class="tp-option">
      <input type="radio" name="tp" value="${esc(key)}" ${key === pick ? "checked" : ""}>
      <span>${label}${sub ? `<span class="sub">${sub}</span>` : ""}</span></label>`;
  return `<div class="track-picker">
    <h3>Where are you headed?</h3>
    <p class="sub">Tracking stops when the train gets there. Optional.</p>
    <div class="tp-list">
      ${ahead.map((s) => option(s.key, esc(s.name), fmtTime(s.time, s.tz))).join("")}
      ${option("", "No particular stop", "follow it to the end of its trip")}
    </div>
    <div class="tp-actions">
      <button class="btn small" data-tp-cancel>Cancel</button>
      <button class="btn primary small" data-tp-start="${esc(t.id)}">Start tracking</button>
    </div>
  </div>`;
}

function renderTracked() {
  const el = $("tracked");
  if (!el) return;
  el.hidden = !state.tracked.length;
  el.innerHTML = state.tracked.map((rec) => {
    const t = trackedTrain(rec);
    const a = AGENCIES[rec.agency] || { color: "#888", short: "" };
    let where = "", status = "", warn = "";
    if (t) {
      const chosen = rec.stopKey && t.stops?.find((s) => s.key === rec.stopKey);
      const next = !chosen && (t.stops?.find((s) => s.status === "next") || t.stops?.find((s) => s.status === "future"));
      const stop = chosen || next;
      if (stop) {
        const time = Date.parse(stop.time);
        where = `${chosen ? "" : "Next: "}<strong>${esc(stop.name)}</strong>${time ? ` · ${fmtTime(stop.time, stop.tz)} · ${time > Date.now() ? `in ${fmtIn(time)}` : "now"}` : ""}`;
      } else if (t.nextStop) {
        where = `Next: <strong>${esc(t.nextStop)}</strong>`;
      } else if (t.destination) {
        where = `to <strong>${esc(t.destination)}</strong>`;
      }
      const late = lateText(t.delayMin);
      if (late.text) status = `<span class="status ${late.cls}">${late.text}</span>`;
      if (Date.now() - t.updated > STALE_MS && !t.estimated) warn = `<span class="stale">⚠ Position ${fmtAgo(t.updated)}</span>`;
    } else {
      where = rec.stopName ? `to <strong>${esc(rec.stopName)}</strong>` : "";
      warn = `<span class="stale">Not reporting · last seen ${fmtAgo(rec.lastSeen)}</span>`;
    }
    return `<div class="track-card" style="--c:${a.color}" role="button" tabindex="0" data-track-open="${esc(rec.id)}">
      <span class="bar"></span>
      <span class="tc-main">
        <span class="tc-title"><strong>${esc(trainLabel(rec))}</strong>${rec.route ? ` · ${esc(rec.route)}` : ""}</span>
        ${where ? `<span class="tc-where">${where}</span>` : ""}
        ${status || warn ? `<span class="tc-status">${status}${warn}</span>` : ""}
      </span>
      <button class="tc-x" data-untrack="${esc(rec.id)}" aria-label="Stop tracking ${esc(trainLabel(rec))}" title="Stop tracking">×</button>
    </div>`;
  }).join("");
  // On phones, keep the cards visible when the sheet is collapsed.
  document.documentElement.style.setProperty("--tracked-h", `${el.hidden ? 0 : el.offsetHeight}px`);
}

function openTracked(id) {
  const t = state.trains.get(id);
  if (!t) return toast("That train isn't reporting right now.");
  select(id);
}

setInterval(() => {
  if (document.hidden) return;
  checkTracked();
  renderTracked(); // ETAs count down between feed updates
}, 30000);

function renderAll() {
  renderTracked();
  renderLiveCount();
  renderAgencies();
  renderResults();
  renderCredits();
  if (state.selected || state.station) renderDetail();
}

setInterval(renderLiveCount, 5000);

// ---------- Selection ----------

function applySelectionFilter() {
  if (!map.getLayer("tt-halo")) return;
  const id = state.selected || "";
  map.setFilter("tt-halo", ["==", ["get", "id"], id]);
  map.setFilter("tt-label-selected", ["==", ["get", "id"], id]);
  map.setFilter("tt-labels", ["!=", ["get", "id"], id]);
  map.setFilter("tt-station-selected", ["==", ["get", "id"], state.station || ""]);
}

function setUrlSelection() {
  const url = new URL(location.href);
  url.searchParams.delete("train");
  url.searchParams.delete("station");
  if (state.selected) url.searchParams.set("train", state.selected);
  if (state.station) url.searchParams.set("station", state.station);
  history.replaceState(null, "", url);
}

function showDetailView(open) {
  $("view-list").hidden = open;
  $("view-train").hidden = !open;
  $("follow-btn").hidden = !state.selected;
  delete $("train-detail").dataset.scrollTop;
  $("train-detail").scrollTop = 0;
}

function select(id, { fly = true } = {}) {
  state.returnTo = null;
  $("back-btn").lastChild.textContent = " All trains";
  state.selected = id;
  state.station = null;
  state.predictions = null;
  setUrlSelection();
  applySelectionFilter();
  showDetailView(!!id);
  if (!id) {
    setFollow(false);
    renderAll();
    return;
  }
  renderDetail();
  const t = state.trains.get(id);
  if (t && fly) {
    map.flyTo({
      center: [targetOf(t).lon, targetOf(t).lat], // where it's drawn (estimated position if that's on)
      zoom: Math.max(map.getZoom(), 9),
      padding: panelPadding(),
      duration: 900,
    });
  }
  if (isPhone) setSheet("");
}

let predictionTimer;
async function refreshPredictions(st) {
  const place = st.members.find((m) => m.agency === "mbta");
  if (!place || state.station !== st.id) return;
  try {
    state.predictions = await mbtaPredictions(place.id);
  } catch {
    state.predictions = [];
  }
  if (state.station === st.id) renderDetail();
}

function selectStation(id, { fly = true } = {}) {
  const st = state.stations.get(id);
  if (!st) return;
  state.selected = null;
  state.station = id;
  state.predictions = null;
  setFollow(false);
  setUrlSelection();
  applySelectionFilter();
  showDetailView(true);
  renderDetail();
  clearInterval(predictionTimer);
  if (st.agencies.includes("mbta")) {
    refreshPredictions(st);
    predictionTimer = setInterval(() => refreshPredictions(st), 30000);
  }
  if (fly) {
    map.flyTo({ center: [stationPos(st).lon, stationPos(st).lat], zoom: Math.max(map.getZoom(), 12), padding: panelPadding(), duration: 900 });
  }
  if (isPhone) setSheet("");
}

function closeDetail() {
  clearInterval(predictionTimer);
  const back = state.selected && state.returnTo;
  state.returnTo = null;
  $("back-btn").lastChild.textContent = " All trains";
  if (back && state.stations.has(back)) return selectStation(back, { fly: false });
  state.station = null;
  select(null);
}

function panelPadding() {
  if (matchMedia("(max-width: 720px)").matches) return { bottom: window.innerHeight * 0.46, top: 0, left: 0, right: 0 };
  return { left: 360, top: 0, bottom: 0, right: 0 };
}

function setFollow(on) {
  state.follow = on;
  $("follow-btn")?.setAttribute("aria-pressed", String(on));
}

// ---------- Events ----------

const canHover = matchMedia("(hover: hover)").matches;
const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: "hover-card" });

// Hovering a track names the railroads that run on it.
const RAIL_LAYERS = ["tt-rail-0", "tt-rail-1", "tt-rail-2"];
map.on("mousemove", (e) => {
  if (!canHover || !map.getLayer("tt-rail-0")) return;
  const box = [[e.point.x - 3, e.point.y - 3], [e.point.x + 3, e.point.y + 3]];
  if (map.queryRenderedFeatures(box, { layers: ["tt-trains", ...STATION_LAYERS].filter((l) => map.getLayer(l)) }).length) return;
  const rail = map.queryRenderedFeatures(box, { layers: RAIL_LAYERS })[0];
  if (!rail) {
    if (popup._railHover) popup.remove();
    popup._railHover = false;
    return;
  }
  const nets = ["a", "b", "c"].map((k) => rail.properties[k]).filter(Boolean);
  popup
    .setLngLat(e.lngLat)
    .setHTML(nets.map((n) => `<div class="rail-net"><span class="dot" style="background:${NETWORKS[n]?.color || "#8d95a3"}"></span>${esc(NETWORKS[n]?.name || "Commuter rail")}</div>`).join(""))
    .addTo(map);
  popup._railHover = true;
});

const STATION_LAYERS = ["tt-stations-major", "tt-stations-minor", "tt-station-labels", "tt-footprint-fill"];

// One click handler so a train sitting on a station wins over the station.
map.on("click", (e) => {
  const box = [[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]];
  const train = map.queryRenderedFeatures(box, { layers: ["tt-trains"] })[0];
  if (train) return select(train.properties.id);
  const station = map.queryRenderedFeatures(box, { layers: STATION_LAYERS.filter((l) => map.getLayer(l)) })[0];
  if (station) return selectStation(station.properties.id);
  if ((state.selected && !state.follow) || state.station) closeDetail();
});

for (const layer of STATION_LAYERS) {
  map.on("mousemove", layer, (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: ["tt-trains"] }).length) return;
    map.getCanvas().style.cursor = "pointer";
    if (!canHover) return;
    const st = state.stations.get(e.features[0].properties.id);
    if (!st) return;
    popup
      .setLngLat([stationPos(st).lon, stationPos(st).lat])
      .setHTML(`<div class="t">${esc(st.name)}</div><div class="s">${st.agencies.map((a) => esc(AGENCIES[a].short)).join(" · ")}</div>`)
      .addTo(map);
  });
  map.on("mouseleave", layer, () => {
    map.getCanvas().style.cursor = "";
    popup.remove();
  });
}

map.on("mousemove", "tt-trains", (e) => {
  map.getCanvas().style.cursor = "pointer";
  if (!canHover) return;
  const t = state.trains.get(e.features[0].properties.id);
  if (!t) return;
  const a = AGENCIES[t.agency];
  popup
    .setLngLat(e.features[0].geometry.coordinates)
    .setHTML(`<div class="t" style="color:${a.color}">${esc(labelFor(t))}</div>
      <div>${esc(trainTitle(t))}</div>
      <div class="s">${t.destination ? `to ${esc(t.destination)}` : ""}${t.statusText ? ` · ${esc(t.statusText)}` : ""}</div>`)
    .addTo(map);
});
map.on("mouseleave", "tt-trains", () => {
  map.getCanvas().style.cursor = "";
  popup.remove();
});

map.on("dragstart", () => state.follow && setFollow(false));

on("back-btn", "click", closeDetail);
on("tracked", "click", (e) => {
  const x = e.target.closest("[data-untrack]");
  if (x) return untrack(x.dataset.untrack);
  const card = e.target.closest("[data-track-open]");
  if (card) openTracked(card.dataset.trackOpen);
});
on("tracked", "keydown", (e) => {
  const card = e.target.closest("[data-track-open]");
  if (card && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    openTracked(card.dataset.trackOpen);
  }
});

on("train-detail", "change", (e) => {
  if (e.target.name === "tp") state.trackPick = e.target.value;
});

on("train-detail", "click", (e) => {
  const track = e.target.closest("[data-track]");
  if (track) {
    const t = state.trains.get(track.dataset.track);
    if (!t) return;
    if (state.tracked.length >= MAX_TRACKED) return toast("You can track up to three trains at once.");
    // No stop list (most GPS-only railroads): track without a destination.
    if (!t.stops?.some((s) => s.status !== "past")) return startTracking(t, null);
    state.trackPicker = t.id;
    state.trackPick = null;
    return renderDetail();
  }
  if (e.target.closest("[data-tp-cancel]")) {
    state.trackPicker = null;
    return renderDetail();
  }
  const start = e.target.closest("[data-tp-start]");
  if (start) {
    const t = state.trains.get(start.dataset.tpStart);
    const picked = e.currentTarget.querySelector('input[name="tp"]:checked')?.value || "";
    if (t) startTracking(t, picked || null);
    return;
  }
  const stop = e.target.closest("[data-untrack]");
  if (stop) return untrack(stop.dataset.untrack);
  const b = e.target.closest("[data-select]");
  if (b) {
    const from = state.station;
    select(b.dataset.select);
    state.returnTo = from; // "back" from this train goes to the station
    $("back-btn").lastChild.textContent = from ? " Station" : " All trains";
  }
  const st = e.target.closest("[data-station]");
  if (st) selectStation(st.dataset.station);
});
on("follow-btn", "click", () => {
  setFollow(!state.follow);
  const t = state.trains.get(state.selected);
  if (state.follow && t) map.easeTo({ center: [t.lon, t.lat], padding: panelPadding() });
});

on("search", "input", (e) => {
  state.query = e.target.value;
  renderResults();
  if (isPhone && state.query) setSheet("expanded");
});
on("search", "keydown", (e) => {
  if (e.key === "Enter") $("results").querySelector("[data-select]")?.click();
  if (e.key === "Escape") {
    e.target.value = "";
    state.query = "";
    renderResults();
  }
});

on("results", "click", (e) => {
  const b = e.target.closest("[data-select]");
  const st = e.target.closest("[data-station]");
  if (b) select(b.dataset.select);
  else if (st) selectStation(st.dataset.station);
});

on("agencies", "click", (e) => {
  const toggle = e.target.closest("[data-toggle]");
  const zoom = e.target.closest("[data-zoom]");
  if (toggle) {
    const id = toggle.dataset.toggle;
    state.hidden.has(id) ? state.hidden.delete(id) : state.hidden.add(id);
    store.set("tt-hidden", [...state.hidden]);
    redraw();
    redrawStations();
    renderAll();
  } else if (zoom) {
    const id = zoom.dataset.zoom;
    const pts = [...state.trains.values()].filter((t) => t.agency === id);
    if (!pts.length) return toast(`No ${AGENCIES[id].short} trains are reporting right now.`);
    if (state.hidden.has(id)) {
      state.hidden.delete(id);
      store.set("tt-hidden", [...state.hidden]);
      redraw();
      renderAll();
    }
    const b = new maplibregl.LngLatBounds();
    for (const t of pts) b.extend([t.lon, t.lat]);
    map.fitBounds(b, { padding: { ...panelPadding(), top: 60, right: 60, bottom: Math.max(60, panelPadding().bottom), left: Math.max(60, panelPadding().left + 40) }, maxZoom: 10, duration: 900 });
    if (isPhone) setSheet("collapsed");
  }
});

on("kind-filter", "click", (e) => {
  const b = e.target.closest("[data-kind]");
  if (!b) return;
  state.kind = b.dataset.kind;
  for (const x of $("kind-filter").children) x.setAttribute("aria-selected", String(x === b));
  redraw();
  redrawStations();
  renderAll();
});

// ---------- Settings menu ----------

function applyTheme() {
  const next = resolveTheme();
  for (const b of $("theme-choice")?.children || []) b.setAttribute("aria-pressed", String(b.dataset.themeChoice === themePref));
  if (next === theme) return;
  theme = next;
  document.documentElement.dataset.theme = theme;
  // diff:false forces a full reload so "style.load" fires and our layers are
  // re-added; a diffed swap silently drops them.
  map.setStyle(STYLES[theme], { diff: false });
}
prefersDark.addEventListener("change", () => themePref === "auto" && applyTheme());

on("theme-choice", "click", (e) => {
  const b = e.target.closest("[data-theme-choice]");
  if (!b) return;
  themePref = b.dataset.themeChoice;
  store.set("tt-theme", themePref);
  applyTheme();
});

function setShowStations(on) {
  state.showStations = on;
  store.set("tt-stations", on);
  setChecked("stations-toggle", on);
  for (const id of ["tt-stations-minor", "tt-stations-major", "tt-station-labels", "tt-footprint-fill", "tt-footprint-line"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  }
}
on("stations-toggle", "change", (e) => setShowStations(e.target.checked));

function toggleMenu(open = $("settings-menu").hidden) {
  const menu = $("settings-menu"), btn = $("settings-btn");
  menu.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  if (!open) return;
  // Pin the menu under the gear, kept inside the window.
  const r = btn.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(12, Math.min(r.right - w, innerWidth - w - 12))}px`;
  menu.style.top = `${r.bottom + 8 + h > innerHeight ? Math.max(12, r.top - h - 8) : r.bottom + 8}px`;
}
on("settings-btn", "click", (e) => {
  e.stopPropagation();
  toggleMenu();
});
document.addEventListener("click", (e) => {
  if (!$("settings-menu").hidden && !e.target.closest("#settings-menu")) toggleMenu(false);
});
document.addEventListener("keydown", (e) => e.key === "Escape" && toggleMenu(false));
map.on("movestart", () => toggleMenu(false));

applyTheme();
setChecked("stations-toggle", state.showStations);
setChecked("estimate-toggle", state.estimate);

// Phone bottom sheet: collapsed / normal / expanded.
function setSheet(mode) {
  const p = $("panel");
  p.classList.toggle("collapsed", mode === "collapsed");
  p.classList.toggle("expanded", mode === "expanded");
  document.body.classList.toggle("sheet-collapsed", mode === "collapsed");
  document.body.classList.toggle("sheet-expanded", mode === "expanded");
}
on("sheet-handle", "click", () => {
  const p = $("panel");
  setSheet(p.classList.contains("collapsed") ? "" : p.classList.contains("expanded") ? "collapsed" : "expanded");
});

let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

// Open a shared link to a specific train once its feed has loaded.
const wantedStation = new URL(location.href).searchParams.get("station");
const wanted = new URL(location.href).searchParams.get("train");
if (wanted) {
  const wait = setInterval(() => {
    if (state.trains.has(wanted)) {
      clearInterval(wait);
      select(wanted);
    }
  }, 500);
  setTimeout(() => clearInterval(wait), 30000);
}

// Handy for poking at the live state from the browser console.
window.traintracker = { state, map, checkTracked };

start();
