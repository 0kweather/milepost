import { AGENCIES, SOURCES, fetchSource, advanceEstimated } from "./sources.js?v=dev";
import { loadStations, trainsDue, mbtaPredictions, meters, norm } from "./stations.js?v=dev";
import { RailIndex, snapToTrack } from "./estimate.js?v=dev";
import { NETWORKS, networkColor } from "./networks.js?v=dev";
import { trainNotices, stationNotices } from "./notices.js?v=dev";
import { inferDelay, restoreFeed } from "./delays.js?v=dev";
import { consistOf, consistHtml, carSvg, modelIds, fleetSamples } from "./consist.js?v=dev";
import { startTour } from "./tour.js?v=dev";

// localStorage "tt-relay" overrides config.js, handy when testing a relay locally.
const RELAY = ((() => { try { return localStorage.getItem("tt-relay"); } catch { return null; } })() ||
  window.TRAINSHEET_RELAY || "").trim();
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
// Number plate: a train's number on a white sign, railroad color on top.
const plate = (text, color, size = "") => `<span class="plate ${size}" style="--c:${color}"><span>${esc(text)}</span></span>`;
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
  selected: null,        // selected train id
  stations: new Map(),   // merged station id -> station
  station: null,         // selected station id
  railroad: null,        // railroad whose page is open
  trackPick: null,       // { id, from }: the stop a rider got on at, tapped first when tracking
  line: null,            // ...and the line, on a line's page
  predictions: null,     // live MBTA predictions for the selected station
  showStations: store.get("tt-stations", true),
  // Mark trains late when GPS shows a delay their railroad hasn't reported
  // (js/delays.js).
  inferDelays: store.get("tt-infer", true),
  // Point trains whose feed has no heading toward their next stop.
  inferHeading: store.get("tt-infer-heading", true),
  // What each train's plate on the map says: "number", "line" or "none"
  // (plates only on the selected and tracked trains).
  labels: store.get("tt-labels", "number"),
  // Leave out trains placed from timetables rather than GPS.
  hideEstimated: store.get("tt-hide-estimated", false),
  // While tracking a train, show only the tracked ones (and the selected one).
  onlyTracked: store.get("tt-only-tracked", true),
  // The car tapped in the selected train's drawing: { id (train), i (car),
  // page (its full model page instead of the train) }, or null.
  car: null,
  // A station's page lists departures or arrivals.
  stationView: "dep",
  // The open station's notices and (NJ Transit) its departure board's tracks:
  // { id, notices: [...], tracks: Map(train number -> track) }.
  stationExtras: null,
  // Times as 18:05 instead of 6:05 PM.
  clock24: store.get("tt-clock24", false),
  // Times shown in: "" the viewer's own zone, "station" each stop's local
  // time, or an IANA zone.
  timeZone: store.get("tt-tz", ""),
  // Miles or kilometers. The default follows the browser's language: miles in
  // the few countries that still use them, kilometers everywhere else.
  units: store.get("tt-units", /-(US|GB|LR|MM)\b/i.test(navigator.language || "en-US") ? "mi" : "km"),
  // Trains the viewer is following (saved in the browser):
  // [{ id, agency, number, route, stopKey, stopName, eta, lastSeen }]
  tracked: store.get("tt-tracked", []),
  // Service notices folded down to their heading until opened (remembered
  // across trains).
  noticesCollapsed: store.get("tt-notices-collapsed", true),
  // Railroad page sections folded to their heading (remembered).
  rrCollapsed: new Set(store.get("tt-rr-collapsed", [])),
  servedOpen: new Set(),  // railroads whose lines are unfolded on station pages
  notices: { id: null, list: [], at: 0 }, // official notices for the selected train
  est: new Map(),        // train id -> position on the track { lat, lon, bearing }
  rail: null,            // RailIndex (routing and snapping; uses every track)
  railGeo: null,         // rail.geojson as loaded; drawn filtered by railCollection()
  stopPos: new Map(),    // station member key -> { lat, lon }
  stopByName: new Map(), // "agency:normalized name" -> { lat, lon }
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

// Marker images are drawn on a canvas once per agency color: an arrow for
// trains heading a known way, and a dot for the rare train whose direction
// can't be worked out at all.
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
    // Arrowhead centered on the train, pointing north; MapLibre rotates it.
    g.beginPath();
    g.moveTo(cx, cy - 10);
    g.lineTo(cx + 7.5, cy + 8);
    g.lineTo(cx, cy + 4);
    g.lineTo(cx - 7.5, cy + 8);
    g.closePath();
    g.lineWidth = 3;
    g.strokeStyle = "#fff";
    g.stroke();
    g.shadowColor = "transparent";
    g.fillStyle = color;
    g.fill();
    return { image: g.getImageData(0, 0, c.width, c.height), ratio };
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

// A rounded tag that stretches around a label: the callout for whatever is
// selected. One per railroad color, plus one for stations.
function tagImage(fill) {
  const ratio = 2, w = 48, h = 36, c = document.createElement("canvas");
  c.width = w * ratio;
  c.height = h * ratio;
  const g = c.getContext("2d");
  g.scale(ratio, ratio);
  g.shadowColor = "rgba(0,0,0,0.28)";
  g.shadowBlur = 4;
  g.shadowOffsetY = 1;
  g.beginPath();
  g.roundRect(4, 3, w - 8, h - 8, 9);
  g.fillStyle = fill;
  g.fill();
  return {
    image: g.getImageData(0, 0, c.width, c.height),
    options: {
      pixelRatio: ratio,
      stretchX: [[14 * ratio, 34 * ratio]],
      stretchY: [[13 * ratio, 18 * ratio]],
      content: [11 * ratio, 6 * ratio, 37 * ratio, 25 * ratio],
    },
  };
}

// Each train's label on the map: a small number plate like the one in the
// panel, white with a black outline and the railroad's color across the top.
// It stretches sideways to fit the number.
function plateImage(color) {
  const ratio = 2, w = 32, h = 30, c = document.createElement("canvas");
  c.width = w * ratio;
  c.height = h * ratio;
  const g = c.getContext("2d");
  g.scale(ratio, ratio);
  const x = 2, y = 1, pw = 28, ph = 26, band = 4, r = 4;
  g.save();
  g.shadowColor = "rgba(0,0,0,0.25)";
  g.shadowBlur = 3;
  g.shadowOffsetY = 1;
  g.beginPath();
  g.roundRect(x, y, pw, ph, r);
  g.fillStyle = "#fff";
  g.fill();
  g.restore();
  g.save();
  g.beginPath();
  g.roundRect(x, y, pw, ph, r);
  g.clip();
  g.fillStyle = color;
  g.fillRect(x, y, pw, band);
  g.restore();
  g.beginPath();
  g.roundRect(x + 0.6, y + 0.6, pw - 1.2, ph - 1.2, r - 0.6);
  g.lineWidth = 1.2;
  g.strokeStyle = "#121417";
  g.stroke();
  return {
    image: g.getImageData(0, 0, c.width, c.height),
    options: {
      pixelRatio: ratio,
      stretchX: [[8 * ratio, 24 * ratio]],
      stretchY: [[10 * ratio, 21 * ratio]],
      content: [6 * ratio, (y + band + 1) * ratio, 26 * ratio, (y + ph - 3) * ratio],
    },
  };
}

function addImages() {
  for (const [id, a] of Object.entries(AGENCIES)) {
    const name = `tt-plate-${id}`;
    if (!map.hasImage(name)) {
      const { image, options } = plateImage(a.color);
      map.addImage(name, image, options);
    }
  }
  if (!map.hasImage("tt-tag-station")) {
    const { image, options } = tagImage(theme === "dark" ? "#eceef1" : "#1b1d21");
    map.addImage("tt-tag-station", image, options);
  }
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

// Train markers by zoom, the same for every railroad. The selected and tracked
// trains draw larger: the whole marker grows rather than gaining a halo. Their
// plates sit a little further out to clear it.
const SELECTED_SCALE = 1.4;
// Pings: filled circles in the marker's color, animated by ping() below.
// Their paint is set every frame, so MapLibre's own easing between values is
// off (it would show the snap back to the small size as a shrink).
const NO_EASING = { duration: 0, delay: 0 };
const PING_PAINT = {
  "circle-radius": 12, "circle-color": ["get", "color"], "circle-opacity": 0,
  "circle-radius-transition": NO_EASING, "circle-opacity-transition": NO_EASING,
};
function trainIconSize(highlighted = false) {
  const sized = (v) => ["*", ["case", highlighted, SELECTED_SCALE, 1], v];
  return ["interpolate", ["linear"], ["zoom"], 2, sized(0.5), 5, sized(0.68), 8, sized(0.85), 12, sized(1)];
}
const PLATE_OFFSET = ["left", [1.55, 0], "right", [-1.55, 0], "top", [0, 1.7], "bottom", [0, -1.45]];
const PLATE_OFFSET_SELECTED = ["left", [1.95, 0], "right", [-1.95, 0], "top", [0, 2.1], "bottom", [0, -1.85]];
function plateOffset(highlighted = false) {
  return ["case", highlighted, ["literal", PLATE_OFFSET_SELECTED], ["literal", PLATE_OFFSET]];
}

// A marker's radius by zoom, for the ping rings and the selected station's disc.
const DISC_STOPS = [[2, 0.5], [5, 0.68], [8, 0.85], [12, 1]].map(([z, k]) => [z, 7.5 * k * 1.12 + 1.5]);
function discRadius(extra = 0) {
  return ["interpolate", ["linear"], ["zoom"], ...DISC_STOPS.flatMap(([z, r]) => [z, r + extra])];
}
function discRadiusAt(z) {
  const s = DISC_STOPS;
  if (z <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (z <= s[i][0]) return s[i - 1][1] + ((z - s[i - 1][0]) / (s[i][0] - s[i - 1][0])) * (s[i][1] - s[i - 1][1]);
  }
  return s[s.length - 1][1];
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
  map.addSource("rail", { type: "geojson", data: railCollection(), tolerance: 0.6 });
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
  // A railroad's or a line's track, lit up while its page is open
  // (applyFocus): a soft glow under the strands, a solid line over them.
  map.addSource("focus", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "tt-focus-glow",
    type: "line",
    source: "focus",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": ["get", "color"], "line-opacity": 0.22, "line-width": byZoom((w) => w * 6) },
  }, "tt-rail-casing");
  map.addLayer({
    id: "tt-focus-line",
    type: "line",
    source: "focus",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": ["get", "color"], "line-width": byZoom((w) => w * 1.8) },
  }, firstSymbol);
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
  // Selected station: a ping, a soft shadow, then a white disc ringed in the
  // station's color, lifted above the map.
  const stationSel = ["==", ["get", "id"], ""];
  map.addLayer({
    id: "tt-station-ping",
    type: "circle",
    source: "stations",
    filter: stationSel,
    paint: PING_PAINT,
  });
  map.addLayer({
    id: "tt-station-shadow",
    type: "circle",
    source: "stations",
    filter: stationSel,
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 9, 12, 14], "circle-color": "#000", "circle-opacity": 0.22, "circle-blur": 0.9, "circle-translate": [0, 1] },
  });
  map.addLayer({
    id: "tt-station-selected",
    type: "circle",
    source: "stations",
    filter: stationSel,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 6, 12, 10],
      "circle-color": colors.stationFill,
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 12, 3.5],
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


  // A selected terminal's outline is drawn bolder.
  map.addLayer({
    id: "tt-footprint-selected",
    type: "line",
    source: "footprints",
    filter: stationSel,
    layout: { "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2, 16, 3.5] },
  }, "tt-station-ping");

  map.addSource("trains", { type: "geojson", data: featureCollection() });

  // Selected and tracked trains: a ping ring under an enlarged marker.
  const trainSel = ["==", ["get", "id"], ""];
  map.addLayer({
    id: "tt-ping",
    type: "circle",
    source: "trains",
    filter: trainSel,
    paint: PING_PAINT,
  });

  map.addLayer({
    id: "tt-trains",
    type: "symbol",
    source: "trains",
    layout: {
      "icon-image": ["concat", "tt-", ["get", "agency"], ["case", ["get", "hasBearing"], "-arrow", "-dot"]],
      "icon-size": trainIconSize(),
      "icon-rotate": ["get", "bearing"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "symbol-sort-key": ["get", "drawOrder"],
    },
    paint: { "icon-opacity": ["case", ["get", "stale"], 0.45, 1] },
  });

  // Each train is labeled with its plate once there's room for it. Plates
  // collide with each other instead of piling up, and intercity trains win
  // ties. The selected and tracked trains' plates are placed first and shown
  // at every zoom (see applySelectionFilter); they stay in this layer so
  // selecting a train never makes its plate blink.
  map.addLayer({
    id: "tt-labels",
    type: "symbol",
    source: "trains",
    filter: [">=", ["zoom"], 8], // zoomed further out, trains are unlabeled arrows
    layout: {
      "text-field": ["get", "plate"],
      "text-font": ["Noto Sans Bold"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 8, 11, 12, 12],
      // Beside the marker, clear of the white rim; the first one that fits wins.
      "text-variable-anchor-offset": plateOffset(),
      "icon-image": ["concat", "tt-plate-", ["get", "agency"]], // fitted around the number
      "icon-text-fit": "both",
      "icon-text-fit-padding": [0.5, 3, 0.5, 3],
      "text-padding": 2,
      "symbol-sort-key": ["get", "labelOrder"],
    },
    paint: { "text-color": "#121417" },
  });

  map.addLayer({
    id: "tt-station-selected-label",
    type: "symbol",
    source: "stations",
    filter: stationSel,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 13,
      "text-anchor": "bottom",
      "text-offset": [0, -2.2],
      "icon-image": "tt-tag-station", // fitted around the text, so it moves with it
      "icon-text-fit": "both",
      "icon-text-fit-padding": [3, 8, 3, 8],
      "text-allow-overlap": true,
      "icon-allow-overlap": true,
      // Always shown, and other labels placed after it move out of its way.
      "text-ignore-placement": false,
      "icon-ignore-placement": false,
    },
    paint: { "text-color": theme === "dark" ? "#16181c" : "#ffffff" },
  });


  applySelectionFilter();
}

map.on("style.load", () => {
  addLayers();
  applyFocus();
});

// Start with the attribution folded into its ⓘ button.
map.once("load", () => {
  const attrib = document.querySelector(".maplibregl-ctrl-attrib");
  attrib?.classList.remove("maplibregl-compact-show");
  attrib?.removeAttribute("open");
});

// ---------- Train features ----------

// Trains in lists (search, a station's trains): every train of the railroads
// switched on. The map-only settings (only tracked trains, hiding estimated
// ones) don't apply.
const inLists = (t) => !state.hidden.has(t.agency);

// Trains drawn on the map.
function visible(t) {
  if (state.hidden.has(t.agency)) return false;
  // A railroad's page (and its lines') shows only its trains.
  if (state.railroad && t.agency !== state.railroad) return false;
  // The selected and tracked trains always show.
  if (t.id === state.selected || state.tracked.some((r) => r.id === t.id)) return true;
  if (state.onlyTracked && state.tracked.length) return false;
  return !(state.hideEstimated && t.estimated);
}

// A train's line, shortened for its plate ("Northeast Corridor",
// "Fall River/New Bedford"); its number when it has no line.
const shortLine = (t) => (t.route || "").replace(/\s+(Line|Branch)$/i, "").trim() || t.number || AGENCIES[t.agency].short;

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
        plate: state.labels === "line" ? shortLine(t) : t.number || AGENCIES[t.agency].short,
        bearing: targetOf(t).bearing ?? 0,
        hasBearing: targetOf(t).bearing != null,
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

// A station's railroads on the map: those switched on, and on a railroad's
// or line's page only that railroad.
const stationAgencies = (st) => st.agencies.filter((a) => agencyShown(a) && (!state.railroad || a === state.railroad));

// The lines a station is on ("Kitchener line · Lakeshore West line"), for
// search: its railroads' lines, or the railroad's name where
// its stations don't name lines (Amtrak). Main lines (most stations) first;
// two, then how many more.
let lineSizes = null; // "railroad|line" -> stations on it
function lineSize(agency, line) {
  if (!lineSizes) {
    lineSizes = new Map();
    for (const s of state.stations.values()) {
      for (const m of s.members) for (const l of m.lines || []) lineSizes.set(`${m.agency}|${l}`, (lineSizes.get(`${m.agency}|${l}`) || 0) + 1);
    }
  }
  return lineSizes.get(`${agency}|${line}`) || 0;
}
function stationLinesText(st, agencies = st.agencies) {
  const out = [];
  for (const m of st.members) {
    if (!agencies.includes(m.agency)) continue;
    const named = (m.lines || []).filter((l) => l && l !== "City Terminal Zone").sort((x, y) => lineSize(m.agency, y) - lineSize(m.agency, x));
    for (const l of named.length ? named : [AGENCIES[m.agency].short]) if (!out.includes(l)) out.push(l);
  }
  return out.length > 2 ? `${out.slice(0, 2).join(" · ")} +${out.length - 2} more` : out.join(" · ");
}

function stationCollection() {
  const features = [];
  for (const st of state.stations.values()) {
    const shown = stationAgencies(st);
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
    const shown = stationAgencies(st);
    if (!shown.length) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [st.footprint] },
      properties: { id: st.id, color: AGENCIES[shown[0]].color },
    });
  }
  return { type: "FeatureCollection", features };
}

// Rail lines drawn for the railroads currently shown. Hiding a railroad in the
// list removes its strands; shared track redraws with the railroads that
// remain, side by side. Railroads drawn but not tracked live (MARC, VRE, ...)
// always show.
function networkShown(net) {
  return !(AGENCIES[net] && state.hidden.has(net));
}

function railCollection() {
  const src = state.railGeo;
  if (!src) return { type: "FeatureCollection", features: [] };
  const features = [];
  for (const f of src.features) {
    const p = f.properties;
    const nets = [p.a, p.b, p.c].filter((n) => n && networkShown(n));
    if (!nets.length) continue;
    const props = { n: nets.length, a: nets[0], b: nets[1], c: nets[2] };
    if (p.h) props.h = 1;
    features.push({ type: "Feature", geometry: f.geometry, properties: props });
  }
  return { type: "FeatureCollection", features };
}

function redrawRail() {
  map.getSource("rail")?.setData(railCollection());
  applyFocus();
}

function redrawStations() {
  map.getSource("stations")?.setData(stationCollection());
  map.getSource("footprints")?.setData(footprintCollection());
}

// Where to draw a train: on the nearest track. Falls back to exactly what the
// feed reported (e.g., trains beyond the rail data).
function targetOf(t) {
  return state.est.get(t.id) || t;
}

// Snapping depends only on the reported position, so cache it per train.
const snapCache = new Map(); // id -> { lat, lon, result }
function snapped(t) {
  const towards = state.inferHeading && t.bearing == null ? headingTarget(t) : null;
  const c = snapCache.get(t.id);
  if (c && c.lat === t.lat && c.lon === t.lon && c.towards?.lat === towards?.lat && c.towards?.lon === towards?.lon) return c.result;
  const result = snapToTrack(t, state.rail, towards);
  snapCache.set(t.id, { lat: t.lat, lon: t.lon, towards, result });
  return result;
}

// Where a train is headed next, for pointing it when its feed gives no
// heading: its next stop, or the one after if it's standing at the next.
// Feeds that only name the next stop and the destination (the MBTA's): that
// stop, or the destination once the train is standing at it.
function headingTarget(t) {
  for (const s of t.stops || []) {
    if (s.status === "past") continue;
    const p = state.stopPos.get(s.key);
    if (p && meters(p, t) > 400) return p;
  }
  if (t.stops?.length) return null;
  for (const name of [t.nextStop, t.destination]) {
    const p = name && state.stopByName.get(`${t.agency}:${norm(name)}`);
    if (p && meters(p, t) > 400) return p;
  }
  return null;
}

function computePositions() {
  state.est.clear();
  for (const t of state.trains.values()) {
    const p = snapped(t);
    if (p) state.est.set(t.id, p);
  }
  for (const id of snapCache.keys()) if (!state.trains.has(id)) snapCache.delete(id);
}

let railLoading = null;
function loadRail() {
  railLoading ??= fetch("data/rail.geojson?v=dev")
    .then((r) => r.json())
    .then((geojson) => {
      state.railGeo = geojson;
      redrawRail();
      state.rail = new RailIndex(geojson);
      snapCache.clear();
      snapStations();
      computePositions();
      animateTo();
      applyFocus(); // a line's track is traced along the rails
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

function animateTo(duration = ANIM_MS) {
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

  // Rebuilding the marker layer is the expensive part, so cap it at ~30 fps.
  const frameMs = 33;
  const start = performance.now();
  let last = 0;
  const step = (now) => {
    const k = Math.min(1, (now - start) / duration);
    if (now - last >= frameMs || k === 1) {
      last = now;
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
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
  applyInference();
  computePositions();
  animateTo();
  checkTracked();
  renderAll();
  if (state.follow && state.selected) {
    const t = state.trains.get(state.selected);
    if (t) map.easeTo({ center: [targetOf(t).lon, targetOf(t).lat], duration: ANIM_MS });
  }
}

// Delays the GPS proves but the railroad hasn't posted yet.
function applyInference() {
  for (const t of state.trains.values()) state.inferDelays ? inferDelay(t, state.stopPos) : restoreFeed(t);
}

// ---------- Feeds ----------

function sourceAvailability(src) {
  if (!src.relay || (window.TRAINSHEET_FEEDS || {})[src.id]) return { ok: true };
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
      // Rate limited (the MBTA without a key): its window is a minute.
      if (/HTTP 429/.test(err.message)) delay = Math.max(delay, 60);
    }
    mergeTrains();
  }
  setTimeout(() => poll(src, attempt), delay * 1000);
}

async function start() {
  loadRail();
  loadStations()
    .then((stations) => {
      state.stations = stations;
      // Each stop key (as trains list them) to its station on the map.
      state.stationOfKey = new Map([...stations.values()].flatMap((st) => [...st.keys].map((k) => [k, st.id])));
      // Optional: outlines for major terminals (scripts/build_footprints.py).
      fetch("data/footprints.json?v=dev")
        .then((r) => (r.ok ? r.json() : {}))
        .then((outlines) => {
          for (const st of stations.values()) st.footprint = st.members.map((m) => outlines[m.key]).find(Boolean) || null;
          redrawStations();
        })
        .catch(() => {});
      for (const st of stations.values()) {
        for (const m of st.members) {
          state.stopPos.set(m.key, { lat: m.lat, lon: m.lon });
          state.stopByName.set(`${m.agency}:${m.norm}`, { lat: m.lat, lon: m.lon });
        }
      }
      snapStations();
      applyInference();
      computePositions();
      redrawStations();
      if (wantedStation) selectStation(wantedStation);
      else if (AGENCIES[wantedRailroad]) {
        // Framed once the map is ready (a shared link may open before it is).
        openRailroad(wantedRailroad, { fly: false, line: new URL(location.href).searchParams.get("line") });
        const frame = () => frameFocus();
        mapLoaded ? frame() : map.once("load", frame);
      }
      renderResults();
    })
    .catch((err) => console.warn("stations", err));
  if (RELAY) {
    try {
      // Fresh every load, so a railroad just switched on in the relay shows at once.
      const res = await fetch(`${RELAY.replace(/\/$/, "")}/status`, { cache: "no-cache" });
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

// Trains placed from the timetable (Metro-North) advance between refreshes.
let lastTimetable = 0;
function tick() {
  setTimeout(tick, 2000);
  if (document.hidden || map.isMoving()) return;
  const now = Date.now();
  if (now - lastTimetable < 6000) return;
  lastTimetable = now;
  let moved = false;
  for (const t of state.trains.values()) moved = advanceEstimated(t) || moved;
  if (moved) {
    computePositions(); // re-snap the timetable-placed trains that moved
    animateTo();
  }
}
setTimeout(tick, 2000);
// The selected train's panel (its last GPS report, "3 min ago") ages too.
setInterval(() => !document.hidden && state.selected && renderDetail(), 10000);



// ---------- Rendering: list ----------

const CHECK = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="#fff" d="m9.5 16.2-4.2-4.2-1.4 1.4 5.6 5.6 11-11-1.4-1.4z"/></svg>';

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
            <span class="check-hit"><span class="check"></span></span>
            <span class="agency-open"><span class="name">${esc(a.name)}<span class="sub">${esc(a.region)} · ${esc(avail.reason)}</span></span></span>
          </div>`);
        continue;
      }
      // The checkbox shows or hides its trains; the rest of the row opens its page.
      const off = state.hidden.has(id);
      let count = `<span class="count">${counts[id] || 0} running ›</span>`;
      if (st?.status === "loading") count = '<span class="count">…</span>';
      else if (st?.status === "error" && !counts[id]) count = `<span class="count err" title="${esc(st.error)}">offline ›</span>`;
      rows[a.kind].push(`
        <div class="agency ${off ? "off" : ""}" style="--swatch:${a.color}">
          <button type="button" class="check-hit" data-toggle="${id}" aria-pressed="${!off}" aria-label="${off ? "Show" : "Hide"} ${esc(a.name)} trains" title="${off ? "Show" : "Hide"} its trains"><span class="check">${CHECK}</span></button>
          <button type="button" class="agency-open" data-railroad="${id}" aria-label="${esc(a.name)}: what's running, its lines and fleet">
            <span class="name">${esc(a.name)}<span class="sub">${esc(a.region)}</span></span>
            ${count}
          </button>
        </div>`);
    }
  }
  $("agencies").innerHTML =
    `<div class="group-title">Intercity</div>${rows.intercity.join("")}` +
    `<div class="group-title">Commuter &amp; regional</div>${rows.commuter.join("")}` +
    (rows.off.length
      ? `<div class="group-title">Not connected yet</div>${rows.off.join("")}
         <p class="note">These railroads publish live data, but it has to be fetched through a small relay server${RELAY ? " or with a free developer key" : ""}. See the README to switch them on.</p>`
      : "");
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

// The heading chip; a direction worked out from the next stop is marked.
function headingChip(t) {
  const est = state.est.get(t.id);
  const b = t.bearing ?? est?.bearing;
  if (b == null) return null;
  const dir = HEADINGS[Math.round(b / 45) % 8];
  return t.bearing == null && est?.inferred
    ? `<span class="inferred" title="Worked out from the train's next stop; its railroad doesn't report a heading">Heading <strong>${dir}</strong></span>`
    : `Heading <strong>${dir}</strong>`;
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
    if (!inLists(t)) continue;
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
      <span><span class="title">${esc(st.name)}</span><br><span class="sub">${esc([st.place, stationLinesText(st)].filter(Boolean).join(" · "))}</span></span>
      <span></span>
    </button>`).join("");
  const stationBlock = stationHtml ? `<div class="group-title">Stations</div>${stationHtml}` : "";

  // Railroads and lines, opening their pages.
  const has = (hay) => terms.every((w) => hay.toLowerCase().includes(w));
  const railroads = Object.entries(AGENCIES).filter(([, a]) => has(`${a.name} ${a.short} ${a.region}`));
  const railroadBlock = railroads.length ? `<div class="group-title">Railroads</div>` + railroads.slice(0, 4).map(([id, a]) => {
    const n = [...state.trains.values()].filter((t) => t.agency === id).length;
    return `<button class="result" data-railroad="${id}">
      <span class="rr-icon" style="--c:${a.color}"></span>
      <span><span class="title">${esc(a.name)}</span><br><span class="sub">${esc(a.region)}</span></span>
      <span class="count">${n} running ›</span>
    </button>`;
  }).join("") : "";
  const lines = allLines().filter((l) => has(`${l.name} ${AGENCIES[l.agency].name} ${AGENCIES[l.agency].short}`))
    .sort((x, y) => Number(!x.name.toLowerCase().startsWith(q)) - Number(!y.name.toLowerCase().startsWith(q)) || y.running - x.running);
  const lineBlock = lines.length ? `<div class="group-title">Lines</div>` + lines.slice(0, 6).map((l) => {
    const a = AGENCIES[l.agency];
    return `<button class="result" data-open-line="${esc(l.name)}" data-line-railroad="${l.agency}">
      <span class="line-icon" style="--c:${a.color}"></span>
      <span><span class="title">${esc(l.name)}</span><br><span class="sub">${esc(a.short)}</span></span>
      <span class="count">${l.running} running ›</span>
    </button>`;
  }).join("") : "";
  const before = railroadBlock + lineBlock + stationBlock;
  if (!matches.length) {
    el.innerHTML = before || `<div class="empty">Nothing matches “${esc(state.query)}”.</div>`;
    return;
  }
  el.innerHTML = before + (before ? '<div class="group-title">Trains</div>' : "") + matches.slice(0, 60).map(({ t }) => {
    const a = AGENCIES[t.agency];
    const sub = [t.destination && `to ${t.destination}`, t.nextStop && !t.destination && `next ${t.nextStop}`, t.departedOn && `left ${t.departedOn}`]
      .filter(Boolean).join(" · ") || a.region;
    return `<button class="result" data-select="${esc(t.id)}">
      ${plate(t.number || a.short, a.color, "sm")}
      <span><span class="title">${esc(trainTitle(t))}</span><br><span class="sub">${esc(a.short)} · ${esc(sub)}</span></span>
      ${t.statusText ? `<span class="status ${statusClass(t)}">${esc(t.statusText)}</span>` : ""}
    </button>`;
  }).join("");
}

// ---------- Rendering: train detail ----------

// 6:05 PM, or 18:05 with the 24-hour clock.
const clockOptions = () => (state.clock24 ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : { hour: "numeric", minute: "2-digit" });
// A time in the zone chosen in Settings (tz: the stop's own zone, used when
// that's the choice).
function fmtTime(iso, tz) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "";
  const zone = state.timeZone === "station" ? tz : state.timeZone;
  try {
    return d.toLocaleTimeString([], { ...clockOptions(), timeZone: zone || undefined });
  } catch {
    return d.toLocaleTimeString([], clockOptions());
  }
}

function fmtAgo(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

const HEADINGS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

// Speed in the chosen units.
const KM_PER_MI = 1.609344;
const speedText = (mph) => state.units === "km"
  ? `<strong>${Math.round(mph * KM_PER_MI)}</strong> km/h`
  : `<strong>${Math.round(mph)}</strong> mph`;

// ---------- Service notices ----------

const NOTICE_REFRESH_MS = 2 * 60 * 1000;

function loadNotices(t) {
  const n = state.notices;
  if (n.id === t.id && Date.now() - n.at < NOTICE_REFRESH_MS) return;
  state.notices = { id: t.id, list: n.id === t.id ? n.list : [], at: Date.now() };
  trainNotices(t)
    .then((list) => {
      if (state.notices.id !== t.id) return;
      state.notices.list = list;
      if (state.selected === t.id) renderDetail();
    })
    .catch((err) => console.warn("notices", err));
}

function noticesHtml(t) {
  return noticesBlock(state.notices.id === t.id ? state.notices.list : [], t.route);
}
// A foldable list of notices (folded or not as the viewer last left it).
function noticesBlock(list, route = null, title = "Service notices") {
  if (!list.length) return "";
  const open = !state.noticesCollapsed;
  return `<div class="notices${open ? "" : " collapsed"}">
    <h3 class="section-title"><button type="button" class="notices-toggle" data-notices-toggle aria-expanded="${open}">
      ${esc(title)} <span class="notices-count">${list.length}</span>
      <svg class="chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button></h3>
    ${open ? list.map((n) => `<div class="notice">
      <span class="notice-icon" aria-hidden="true">!</span>
      <div class="notice-body">
        <p class="notice-head">${esc(n.header)}</p>
        ${n.description && n.description !== n.header
          ? `<details><summary>More</summary><p>${esc(n.description).replace(/\n+/g, "<br>")}</p></details>` : ""}
        ${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">Details</a>` : ""}
        ${n.scope === "line" && route ? `<span class="notice-scope">${esc(route)}</span>` : ""}
      </div>
    </div>`).join("") : ""}
  </div>`;
}

const stripScroll = new Map();
// A press in the panel holds off feed redraws until it's released: replacing
// the row under the pointer between press and release loses the tap.
let pressing = false, redrawAfterPress = false;
on("train-detail", "pointerdown", () => { pressing = true; });
for (const type of ["pointerup", "pointercancel"]) {
  document.addEventListener(type, () => {
    if (!pressing) return;
    pressing = false;
    // After the click this release makes has been handled.
    if (redrawAfterPress) setTimeout(() => { redrawAfterPress = false; renderDetail(); });
  });
}

function renderDetail() {
  if (pressing) { redrawAfterPress = true; return; }
  if (state.railroad) return renderRailroad();
  if (state.station) return renderStation();
  const t = state.trains.get(state.selected);
  const el = $("train-detail");
  if (!t) {
    el.innerHTML = '<p class="empty">This train isn’t reporting right now. It may have finished its trip.</p>';
    return;
  }
  // How far the cars strip is scrolled, kept per train across re-renders
  // and a visit to a car's model page.
  const shown = el.querySelector(".consist-strip");
  if (shown && el.dataset.train) stripScroll.set(el.dataset.train, shown.scrollLeft);
  if (state.car?.page && state.car.id === t.id) return renderModelPage(t, el);
  loadNotices(t);
  const a = AGENCIES[t.agency];
  const lineColor = t.routeColor || a.color;
  const chips = [
    t.nextStop ? `Next <strong>${esc(t.nextStop)}</strong>` : null,
    t.speedMph != null && !t.estimated ? speedText(t.speedMph) : null,
    headingChip(t),
    t.departedOn ? `Left <strong>${esc(t.departedOn)}</strong>` : null,
    t.estimated ? `Estimated · ${fmtAgo(t.updated)}` : `<span class="signal" title="Last GPS report">${SIGNAL_ICON}${fmtAgo(t.updated)}</span>`,
  ].filter(Boolean);
  // Tracking: the rider taps the stop they got on at, then the one they're
  // getting off at. The ride between is drawn in the line's color; the stops
  // before and after it are greyed out.
  const rec = state.tracked.find((r) => r.id === t.id);
  const pick = state.trackPick?.id === t.id ? state.trackPick : null;
  const ahead = t.stops?.findIndex((s) => s.status !== "past") ?? -1;
  const indexOf = (key) => (key ? t.stops?.findIndex((s) => s.key === key) ?? -1 : -1);
  const dest = !rec || !t.stops ? -1 : rec.stopKey ? indexOf(rec.stopKey) : t.stops.length - 1;
  // Where the ride starts: where they got on; for a ride tracked without one,
  // the station the train is standing at, else the last one it left.
  const at = ahead >= 0 && t.stops[ahead].here;
  const from = rec?.fromKey && indexOf(rec.fromKey) >= 0 ? indexOf(rec.fromKey) : at ? ahead : ahead - 1;
  const pickFrom = pick ? indexOf(pick.from) : -1;
  const leg = (i) => pick ? (i === pickFrom ? " pick-from" : "")
    : dest < 0 ? ""
    : i === dest ? " dest" : i > dest ? " beyond" : i === from ? " ride-from" : i < from ? " before" : " ride";
  const hint = pick ? "Now tap the stop where you’re getting off."
    : !rec && t.stops?.length ? "Tap the stop you got on at, then the one you’re getting off at." : "";
  const stops = t.stops?.length
    ? rrSection("stops", "Stops", t.stops.length, `${hint ? `<p class="stops-hint">${hint}</p>` : ""}<div class="stops-scroll"><ol class="stops" style="--line-color:${lineColor}">${t.stops.map((s, i) => {
        const lateMin = s.scheduled && s.time ? Math.round((Date.parse(s.time) - Date.parse(s.scheduled)) / 60000) : 0;
        const late = lateMin > 1
          ? ` <span class="late">+${lateMin < 60 ? `${lateMin}m` : `${Math.floor(lateMin / 60)}h${String(lateMin % 60).padStart(2, "0")}`}</span>`
          : "";
        // Each stop opens its station's page ("back" returns to this train).
        const sid = s.key && state.stationOfKey?.get(s.key);
        const link = sid ? ` data-stop-station="${esc(sid)}" role="button" tabindex="0" title="${esc(s.name)} station"` : "";
        return `<li class="${s.status}${s.here ? " here" : ""}${leg(i)}${sid ? " link" : ""}"${link}>${stopDot(s, { isDest: !pick && i === dest, isFrom: i === pickFrom, picking: Boolean(pick) })}<span>${esc(s.name)}</span><span class="time">${fmtTime(s.time, s.tz)}${late}</span></li>`;
      }).join("")}</ol></div>`)
    : "";
  // Re-rendering replaces the content; keep the reader where they were in
  // the panel, the cars strip and the stop list (same train only).
  const same = el.dataset.train === t.id;
  const keepScroll = el.scrollTop;
  const keepStops = same ? el.querySelector(".stops-scroll")?.scrollTop || 0 : 0;
  el.dataset.train = t.id;
  el.innerHTML = `
    <div class="hero">
      <button type="button" class="agency-name hero-link" data-railroad="${t.agency}" style="color:${a.color}"><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</button>
      <div class="hero-title">${t.number ? plate(t.number, a.color) : ""}<h2>${t.route && !singleLine(t.agency)
        // The title is the train's line: it opens the line's page (or, with
        // no line or just the one, the railroad's).
        ? `<button type="button" class="hero-link" data-open-line="${esc(t.route)}" data-line-railroad="${t.agency}" style="--hc:${t.routeColor || a.color}">${esc(trainTitle(t))}<span class="hero-go" aria-hidden="true">›</span></button>`
        : `<button type="button" class="hero-link" data-railroad="${t.agency}" style="--hc:${a.color}">${esc(trainTitle(t))}<span class="hero-go" aria-hidden="true">›</span></button>`}</h2></div>
      ${t.destination ? `<p class="od">${t.origin ? `${esc(t.origin)}<span class="arrow">→</span>` : "to "}<strong>${esc(t.destination)}</strong></p>` : ""}
      <div class="hero-actions">
        ${t.statusText ? `<span class="pill ${statusClass(t)}${t.inferred ? " inferred" : ""}"${t.inferred ? ` title="${INFERRED_TITLE}"` : ""}>${esc(t.statusText)}</span>` : ""}
        ${trackButton(t)}
      </div>
      ${consistSection(t)}
    </div>
    ${noticesHtml(t)}
    ${chips.length ? `<ul class="meta">${chips.map((c) => `<li>${c}</li>`).join("")}</ul>` : ""}
    ${t.estimated ? '<p class="estimate-note">This railroad doesn’t publish GPS positions, so the train is placed between stations using its predicted arrival times.</p>' : ""}
    ${stops}`;
  el.scrollTop = keepScroll;
  const strip = el.querySelector(".consist-strip"), list = el.querySelector(".stops-scroll");
  if (strip) strip.scrollLeft = stripScroll.get(t.id) || 0;
  if (list) list.scrollTop = keepStops;
}

// A wifi-style signal mark beside the time of the train's last GPS report.
const SIGNAL_ICON = `<svg viewBox="0 0 16 16" width="13" height="13" aria-label="GPS"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M1.8 6.2a9 9 0 0 1 12.4 0"/><path d="M4.1 8.7a5.6 5.6 0 0 1 7.8 0"/></g><circle cx="8" cy="11.6" r="1.4" fill="currentColor"/></svg>`;

const CLOSE_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

const INFERRED_TITLE = "Worked out by Trainsheet from GPS; not yet reported by the railroad";

// The train's cars, drawn right under its status: live where the railroad
// reports them, otherwise what typically runs on the route. Tapping a car
// opens a card about its model under the drawing; the card leads to the
// model's full page.
function consistSection(t) {
  const c = consistOf(t);
  if (!c) return "";
  const a = AGENCIES[t.agency];
  const open = state.car?.id === t.id ? state.car.i : null;
  let strip = consistHtml(c, a.color);
  if (open != null) strip = strip.replace(`data-car="${open}" `, `data-car="${open}" aria-pressed="true" `);
  return `<div class="consist">
    <div class="consist-strip${open != null ? " has-open" : ""}">${strip}</div>
    ${open != null ? modelCard(t, c, open) : ""}</div>`;
}

// ---------- Train models ----------

// Fact sheets for each model (data/models.json), loaded on first use.
let modelsData = null;
function models() {
  if (!modelsData) {
    modelsData = {};
    fetch("data/models.json?v=dev").then((r) => r.json()).then((d) => {
      modelsData = d;
      if (state.car || state.railroad) renderDetail();
    }).catch((err) => console.warn("models", err));
  }
  return modelsData;
}
function modelOf(c, i) {
  const all = models();
  return modelIds(c, i).map((id) => all[id]).find(Boolean) || null;
}

const factText = {
  topSpeedMph: (v) => (state.units === "km" ? `${Math.round(v * KM_PER_MI)} km/h` : `${v} mph`),
  powerHp: (v) => (state.units === "km" ? `${Math.round(v * 0.7457).toLocaleString()} kW` : `${v.toLocaleString()} hp`),
  seats: (v) => `${v}`,
  lengthFt: (v) => (state.units === "km" ? `${(v * 0.3048).toFixed(1)} m` : `${Math.round(v)} ft`),
};
const FACT_LABELS = { built: "Built", fleet: "Fleet", topSpeedMph: "Top speed", powerHp: "Power", seats: "Seats", lengthFt: "Length" };
function facts(m, keys) {
  return keys.filter((k) => m[k] != null && m[k] !== "")
    .map((k) => `<div><dt>${FACT_LABELS[k]}</dt><dd>${esc(factText[k] ? factText[k](m[k]) : m[k])}</dd></div>`).join("");
}

// The card under the drawing: what the car is, and a few numbers.
function modelCard(t, c, i) {
  const m = modelOf(c, i), car = c.cars[i];
  const name = m?.model || car?.type?.name || "This car";
  const sub = m ? [m.type, m.built].filter(Boolean).join(" · ") : "";
  const keys = m?.powerHp ? ["topSpeedMph", "powerHp", "fleet"] : ["seats", "topSpeedMph", "fleet"];
  return `<div class="model-card">
    <div class="model-card-head">
      <div><strong>${esc(name)}</strong>${car?.number ? ` <span class="model-num">${esc(car.number)}</span>` : ""}${sub ? `<span>${esc(sub)}</span>` : ""}</div>
      <button type="button" class="icon-btn sm" data-car-close aria-label="Close">${CLOSE_ICON}</button>
    </div>
    ${m ? `<dl class="facts">${facts(m, keys)}</dl>` : ""}
    <button type="button" class="link-btn" data-model-more>More about the ${esc(m?.model || car?.type?.name || "car")} ›</button>
  </div>`;
}

// The model's full page, in place of the train's: a large drawing, every
// fact, a short history and its source, and whether the cars shown are this
// train's own or only what usually runs.
function renderModelPage(t, el) {
  const c = consistOf(t);
  const i = state.car.i, m = c && modelOf(c, i), car = c?.cars[i];
  if (!c || !car) { state.car = null; return renderDetail(); }
  const a = AGENCIES[t.agency];
  const width = Math.min(560, Math.max(240, el.clientWidth - 8));
  const why = !c.typical ? ""
    : c.reported ? `${a.short}’s feed names one car, ${c.reported.number} (${c.reported.name}); the rest is what typically runs on this line.`
    : `${a.short} doesn’t report this train’s cars; this is what typically runs on this route.`;
  const source = m?.source ? (() => { try { const h = new URL(m.source).hostname.replace(/^www\./, ""); return /wikipedia/.test(h) ? "Wikipedia" : h; } catch { return "Source"; } })() : null;
  el.innerHTML = `
    <button type="button" class="link-btn back-link" data-model-back>‹ ${esc(t.backLabel || (t.number ? `Train ${t.number}` : trainTitle(t)))}</button>
    <div class="model-page">
      <div class="model-art">${carSvg(c, i, a.color, width)}</div>
      <h2>${esc(m?.model || car.type?.name || "This car")}</h2>
      <p class="model-sub">${esc([m?.type, m?.builder].filter(Boolean).join(" · ") || car.type?.name || "")}${car.number && !t.fleet ? ` · No. ${esc(car.number)}` : ""}</p>
      ${m ? `<dl class="facts wide">${facts(m, ["built", "fleet", "topSpeedMph", "powerHp", "seats", "lengthFt"])}</dl>` : ""}
      ${m?.about ? `<p class="model-about">${esc(m.about)}</p>` : ""}
      ${source ? `<p class="model-source">Source: <a href="${esc(m.source)}" target="_blank" rel="noopener">${esc(source)}</a></p>` : ""}
      ${c.typical && !t.fleet ? `<div class="model-note"><strong>Car count and type may not be accurate.</strong> ${esc(why)}${c.summary ? ` Typical for this route: ${esc(c.summary)}.` : ""}</div>` : ""}
    </div>`;
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

function departureRow({ id, color, badge, title, sub, time, tz, status, statusCls, inferred, track }) {
  const when = time
    ? `<span class="when"><strong>${fmtTime(new Date(time).toISOString(), tz)}</strong><span>${fmtIn(time)}</span></span>`
    : '<span class="when"><strong>Next</strong><span>stop</span></span>';
  const inner = `${when}
    ${plate(badge, color, "sm")}
    <span class="what"><span class="title">${esc(title)}</span><span class="sub">${track ? `<strong class="track">Track ${esc(track)}</strong> · ` : ""}${esc(sub || "")}</span></span>
    ${status ? `<span class="status ${statusCls}${inferred ? " inferred" : ""}"${inferred ? ` title="${INFERRED_TITLE}"` : ""}>${esc(status)}</span>` : "<span></span>"}`;
  return id
    ? `<button class="dep" data-select="${esc(id)}">${inner}</button>`
    : `<div class="dep">${inner}</div>`;
}

const WHEELCHAIR_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="11" cy="4" r="2" fill="currentColor"/><path d="M10 7.5v6h5.5l2.5 5.5M10 10.5h5M7.8 11.3a5.5 5.5 0 1 0 7.7 6.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// A clock time in a given zone, in the chosen 12- or 24-hour style.
const clockIn = (ms, tz) => {
  try { return new Date(ms).toLocaleTimeString([], { ...clockOptions(), timeZone: tz }); } catch { return ""; }
};
// The station's local time, when it isn't what the page's times are shown in.
function localTimeNote(st) {
  if (!st.tz || state.timeZone === "station") return "";
  const now = Date.now(), shown = clockIn(now, state.timeZone || undefined), there = clockIn(now, st.tz);
  return there && there !== shown ? `Local time ${there}` : "";
}

function renderStation() {
  const st = state.stations.get(state.station);
  const el = $("train-detail");
  if (!st) return;
  const trains = [...state.trains.values()].filter(inLists);
  const arrivals = state.stationView === "arr";
  const extras = state.stationExtras?.id === st.id ? state.stationExtras : null;

  // Live trains: MBTA predictions where available, then trains on the map
  // that stop here. Departures leave out trains ending here; arrivals leave
  // out trains starting here.
  const rows = [];
  const listed = new Set();
  for (const p of state.predictions || []) {
    const time = arrivals ? p.arr : p.dep;
    if (!time) continue;
    const t = p.trainId && state.trains.get(p.trainId);
    if (t) listed.add(t.id);
    rows.push({
      sort: time,
      html: departureRow({
        id: t?.id, color: AGENCIES.mbta.color, badge: p.number || "MBTA",
        title: arrivals && t?.origin ? `from ${t.origin}` : p.headsign ? `to ${p.headsign}` : p.route,
        sub: p.route, time, tz: p.tz, status: p.status || "", statusCls: "neutral", track: p.track,
      }),
    });
  }
  for (const d of trainsDue(st, trains)) {
    if (listed.has(d.train.id) || (state.predictions && d.train.agency === "mbta")) continue;
    if (arrivals ? d.originates : d.terminates) continue;
    listed.add(d.train.id);
    const t = d.train, a = AGENCIES[t.agency];
    const time = (arrivals ? d.arr : d.dep) ?? d.time;
    const late = d.here ? { text: "At station", cls: "good" } : lateText(d.lateMin);
    rows.push({
      sort: time ?? Date.now(),
      html: departureRow({
        id: t.id, color: a.color, badge: t.number || a.short,
        title: arrivals ? (t.origin ? `from ${t.origin}` : trainTitle(t)) : t.destination ? `to ${t.destination}` : trainTitle(t),
        sub: [a.short, t.route].filter(Boolean).join(" · "),
        time, tz: d.tz, status: late.text, statusCls: late.cls, inferred: Boolean(t.inferred) && !d.here,
        track: d.track || (t.agency === "njt" && extras?.tracks?.get(String(t.number))) || null,
      }),
    });
  }
  rows.sort((x, y) => x.sort - y.sort);

  const loading = st.agencies.includes("mbta") && state.predictions === null;
  // Served by: each railroad (opening its page), its lines folded under it
  // (each opening the line's page). Lines come from its timetables and the
  // routes of trains stopping here (Amtrak's, whose stations name no lines);
  // "City Terminal Zone" is an LIRR scheduling zone, not a line riders know.
  const catalog = allLines(), onLines = new Map(); // railroad|line -> { agency, name, running }
  const addLine = (agency, name) => {
    if (!name || name === "City Terminal Zone") return;
    const k = lineKey(name);
    const l = catalog.find((x) => x.agency === agency && sameLine(lineKey(x.name), k)) || { agency, name, running: 0 };
    onLines.set(`${agency}|${lineKey(l.name)}`, l);
  };
  for (const m of st.members) for (const l of m.lines || []) addLine(m.agency, l);
  for (const t of state.trains.values()) if (t.route && t.stops?.some((s) => st.keys.has(s.key))) addLine(t.agency, t.route);
  const lineRow = (l) => {
    const a = AGENCIES[l.agency], k = lineKey(l.name);
    // The line's own color where its trains carry one (GO's, MBTA's).
    const color = [...state.trains.values()].find((t) => t.agency === l.agency && t.routeColor && t.route && sameLine(lineKey(t.route), k))?.routeColor || a.color;
    return `<li><button type="button" class="rr-line" data-open-line="${esc(l.name)}" data-line-railroad="${l.agency}"><span class="served-name"><span class="line-swatch" style="background:${color}"></span><span>${esc(l.name)}</span></span><span class="sub">${l.running ? `${l.running} running` : "none running"} ›</span></button></li>`;
  };
  const servedBy = st.members.map((m) => {
    const a = AGENCIES[m.agency];
    const lines = [...onLines.values()].filter((l) => l.agency === m.agency).sort((x, y) => y.running - x.running || x.name.localeCompare(y.name));
    const open = state.servedOpen.has(m.agency);
    const sub = [m.daily ? `${m.daily} train${m.daily === 1 ? "" : "s"} a weekday` : a.kind === "intercity" ? "Intercity trains" : "",
      lines.length ? `${lines.length} line${lines.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
    const name = `<span class="dot" style="background:${a.color}"></span><span><strong>${esc(a.name)}</strong>${sub ? `<br><span class="sub">${esc(sub)}</span>` : ""}</span>`;
    return `<li class="sb${open ? " open" : ""}">
      <div class="sb-row">
        ${lines.length
          ? `<button type="button" class="sb-toggle" data-served-toggle="${m.agency}" aria-expanded="${open}">${name}<svg class="chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
          : `<button type="button" class="sb-toggle" data-railroad="${m.agency}">${name}<span class="sb-go">›</span></button>`}
      </div>
      ${open ? `<ul class="sb-lines"><li><button type="button" class="rr-line" data-railroad="${m.agency}"><span class="served-name"><span>All of ${esc(a.short)}</span></span><span class="sub">›</span></button></li>${lines.map(lineRow).join("")}</ul>` : ""}
    </li>`;
  }).join("");
  const local = localTimeNote(st);
  const access = st.access === 1 ? `<span class="access yes">${WHEELCHAIR_ICON}Step-free access</span>`
    : st.access === 0 ? `<span class="access no">${WHEELCHAIR_ICON}Not step-free</span>` : "";

  el.innerHTML = `
    <div class="hero">
      <div class="agency-name" style="color:var(--muted)">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2c4 0 8 .5 8 4v9.5a3.5 3.5 0 0 1-3.5 3.5l1.5 1.5v.5h-2l-2-2h-4l-2 2H6v-.5L7.5 19A3.5 3.5 0 0 1 4 15.5V6c0-3.5 4-4 8-4Zm0 2c-3.5 0-5.5.5-6 1.5V10h12V5.5C17.5 4.5 15.5 4 12 4ZM7.5 13a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/></svg>
        Station${st.place ? ` · ${esc(st.place)}` : ""}
      </div>
      <h2>${esc(st.name)}</h2>
      ${local || access ? `<p class="station-facts">${local ? `<span>${esc(local)}</span>` : ""}${access}</p>` : ""}
    </div>
    ${rrSection("served", "Served by", st.members.length, `<ul class="served-by">${servedBy}</ul>`)}
    ${noticesBlock(extras?.notices || [], null, "Station notices")}
    ${nextTrainsSection(rows, arrivals, loading)}`;
}

// ---------- Railroad and line pages ----------
// From the i beside each railroad: the map frames its network and lights up
// its track; the page shows what's running, its
// lines, its fleet, its busiest stations and where the data comes from. Each
// line has a page of its own, with just its track lit up.

function openRailroad(id, { fly = true, line = null } = {}) {
  if (!AGENCIES[id]) return;
  if (state.hidden.has(id)) {
    state.hidden.delete(id);
    store.set("tt-hidden", [...state.hidden]);
    redraw();
    redrawStations();
    redrawRail();
  }
  clearInterval(predictionTimer);
  Object.assign(state, { selected: null, station: null, predictions: null, car: null, returnTo: null, railroad: id, line });
  focusCache.key = null;
  $("back-btn").lastChild.textContent = line ? ` ${AGENCIES[id].short}` : " All trains";
  setFollow(false);
  setUrlSelection();
  applySelectionFilter();
  showDetailView(true);
  renderAll();
  if (fly) frameFocus();
  if (isPhone) setSheet("");
}
const openLine = (id, name, opts = {}) => openRailroad(id, { ...opts, line: name });

// "Framingham / Worcester Line" and "Framingham/Worcester Line" are one line,
// and a timetable's "Franklin / Foxboro Line" is the "Franklin Line" (short
// names like "S Line" must match exactly).
const lineKey = (l) => String(l).toLowerCase().replace(/\bline\b/g, "").replace(/[^a-z0-9]/g, "");
const sameLine = (x, y) => x === y || (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x)));
const onLine = (t, name) => Boolean(t.route) && lineKey(t.route) === lineKey(name);

// Every railroad's lines, for search: from its stations' timetables and the
// routes its trains report (a timetable's longer name for a running line
// folds into it), with how many trains are on each.
function allLines() {
  const out = [];
  for (const id of Object.keys(AGENCIES)) {
    const lines = new Map(); // key -> { name, running }
    for (const t of state.trains.values()) {
      if (t.agency !== id || !t.route) continue;
      const k = lineKey(t.route);
      if (!lines.has(k)) lines.set(k, { name: t.route, running: 0 });
      lines.get(k).running++;
    }
    for (const st of state.stations.values()) {
      for (const m of st.members) {
        if (m.agency !== id) continue;
        for (const l of m.lines || []) {
          const k = lineKey(l);
          if (!l || l === "City Terminal Zone" || lines.has(k) || [...lines].some(([r, x]) => x.running && sameLine(k, r))) continue;
          lines.set(k, { name: l, running: 0 });
        }
      }
    }
    for (const l of lines.values()) out.push({ agency: id, ...l });
  }
  return out;
}

// Railroads with one line (SunRail, ACE, Brightline): their line's page
// would only repeat the railroad's. Counted from their stations' timetables.
const lineCounts = new Map();
function singleLine(agency) {
  if (!lineCounts.has(agency) && state.stations.size) {
    const names = new Set();
    for (const st of state.stations.values()) for (const m of st.members) if (m.agency === agency) for (const l of m.lines || []) names.add(lineKey(l));
    lineCounts.set(agency, names.size);
  }
  return (lineCounts.get(agency) ?? 2) <= 1;
}

// A line's own color where its trains carry one (GO's, MBTA's), else its
// railroad's.
const lineColor = (id, name) => focusTrains().find((t) => onLine(t, name) && t.routeColor)?.routeColor || AGENCIES[id].color;

// The open page's trains: the railroad's, or the line's.
function focusTrains() {
  const { railroad: id, line } = state;
  return [...state.trains.values()].filter((t) => t.agency === id && (!line || onLine(t, line)));
}
function lineStations(id, name) {
  const k = lineKey(name);
  const listed = [...state.stations.values()].filter((st) => st.members.some((m) => m.agency === id && (m.lines || []).some((l) => sameLine(lineKey(l), k))));
  if (listed.length) return listed;
  // Railroads whose station lists don't name lines (Amtrak): the stops of
  // the line's train with the most of them.
  const longest = focusTrains().filter((t) => onLine(t, name)).sort((x, y) => (y.stops?.length || 0) - (x.stops?.length || 0))[0];
  return [...new Set((longest?.stops || []).map((s) => state.stationOfKey?.get(s.key)).filter(Boolean))].map((sid) => state.stations.get(sid)).filter(Boolean);
}

// Places along a line in order: from the one farthest from the middle, each
// next the nearest one left.
function orderAlong(items, posOf) {
  if (items.length < 3) return items;
  const P = items.map(posOf);
  const mid = { lon: P.reduce((s, p) => s + p.lon, 0) / P.length, lat: P.reduce((s, p) => s + p.lat, 0) / P.length };
  const kx = Math.cos((mid.lat * Math.PI) / 180);
  const d = (p, q) => Math.hypot((p.lon - q.lon) * kx, p.lat - q.lat);
  let start = 0;
  P.forEach((p, i) => { if (d(p, mid) > d(P[start], mid)) start = i; });
  const order = [start], left = new Set(P.keys());
  left.delete(start);
  while (left.size) {
    const last = P[order[order.length - 1]];
    let best = -1;
    for (const j of left) if (best < 0 || d(last, P[j]) < d(last, P[best])) best = j;
    order.push(best);
    left.delete(best);
  }
  return order.map((i) => items[i]);
}

// A line's stations in the order its trains stop at them: the longest stop
// list running now, with other trains' stops (a branch, a short turn) fitted
// in beside their neighbors. A station the timetable also lists on another
// line counts only if one of this line's trains stops there now (MBTA lists
// Fairmount stations under the Providence Line for detours); the rest go
// where they add the least distance. The busiest end comes first. With no
// train running, by position along the line.
function orderedLineStations(id, name) {
  const all = lineStations(id, name), k = lineKey(name);
  const runs = focusTrains().filter((t) => onLine(t, name))
    .map((t) => [...new Set((t.stops || []).map((s) => state.stationOfKey?.get(s.key)).filter(Boolean))])
    .filter((r) => r.length > 1).sort((x, y) => y.length - x.length);
  const inRuns = new Set(runs.flat());
  const ownOnly = (st) => !st.members.some((m) => m.agency === id && (m.lines || []).some((l) => !sameLine(lineKey(l), k)));
  const extra = all.filter((st) => !inRuns.has(st.id) && ownOnly(st));
  if (!runs.length) return orderAlong(extra.length > 1 ? extra : all, stationPos);
  const order = [...runs[0]];
  for (let run of runs.slice(1)) {
    // Run it the same way as the order so far.
    const known = run.filter((sid) => order.includes(sid));
    if (known.length > 1 && order.indexOf(known[0]) > order.indexOf(known[known.length - 1])) run = [...run].reverse();
    run.forEach((sid, i) => {
      if (order.includes(sid)) return;
      const prev = run.slice(0, i).reverse().find((x) => order.includes(x));
      const next = run.slice(i + 1).find((x) => order.includes(x));
      if (prev) order.splice(order.indexOf(prev) + 1, 0, sid);
      else if (next) order.splice(order.indexOf(next), 0, sid);
      else order.push(sid);
    });
  }
  // Stations no train is stopping at now: wherever they lengthen the line least.
  const pos = (sid) => stationPos(state.stations.get(sid));
  const d = (p, q) => Math.hypot((p.lon - q.lon) * Math.cos((p.lat * Math.PI) / 180), p.lat - q.lat);
  for (const st of extra) {
    const p = stationPos(st);
    let best = 0, cost = d(p, pos(order[0]));
    for (let i = 1; i <= order.length; i++) {
      const c = i === order.length ? d(pos(order[i - 1]), p)
        : d(pos(order[i - 1]), p) + d(p, pos(order[i])) - d(pos(order[i - 1]), pos(order[i]));
      if (c < cost) { cost = c; best = i; }
    }
    order.splice(best, 0, st.id);
  }
  const daily = (sid) => state.stations.get(sid)?.members.find((m) => m.agency === id)?.daily || 0;
  if (daily(order[order.length - 1]) > daily(order[0])) order.reverse();
  return order.map((sid) => state.stations.get(sid)).filter(Boolean);
}

// The track to light up: the railroad's whole network, or the line's, traced
// along the rails between the stops its running trains make and between its
// stations in order.
const focusCache = { key: null, features: [] };
function focusFeatures() {
  const { railroad: id, line } = state;
  if (!id || !state.railGeo) return [];
  // The line's color arrives with its trains, so it's part of the key.
  const color = line ? lineColor(id, line) : AGENCIES[id].color;
  const key = `${id}|${line || ""}|${color}`;
  if (focusCache.key === key) return focusCache.features;
  const props = { color };
  const features = line
    ? lineTrack(id, line).map((coordinates) => ({ type: "Feature", geometry: { type: "LineString", coordinates }, properties: props }))
    : state.railGeo.features.filter((f) => !f.properties.h && [f.properties.a, f.properties.b, f.properties.c].includes(id))
      .map((f) => ({ type: "Feature", geometry: f.geometry, properties: props }));
  if (features.length) Object.assign(focusCache, { key, features }); // else the rail index may not be ready yet
  return features;
}
function lineTrack(id, name) {
  const rail = state.rail;
  if (!rail) return [];
  const seqs = focusTrains().map((t) => (t.stops || []).map((s) => state.stopPos.get(s.key)).filter(Boolean)).filter((s) => s.length > 1);
  seqs.push(orderedLineStations(id, name).map(stationPos)); // stretches no train is on now
  const done = new Set(), out = [];
  for (const seq of seqs) {
    for (let i = 1; i < seq.length; i++) {
      const p = [seq[i - 1].lon, seq[i - 1].lat], q = [seq[i].lon, seq[i].lat];
      const k = [p, q].map((x) => x.map((v) => v.toFixed(4)).join()).sort().join("|");
      if (done.has(k)) continue;
      done.add(k);
      const path = rail.route(rail.snap(p, 1500, id), rail.snap(q, 1500, id), id);
      if (path?.coords.length > 1) out.push(path.coords);
      // Track newer than the map's rail data (South Shore's Monon Corridor):
      // a straight line between neighboring stations, so the line still shows.
      else if (Math.hypot((p[0] - q[0]) * 85, (p[1] - q[1]) * 111) < 25) out.push([p, q]);
    }
  }
  return out;
}

// Light up the open page's track (or clear it).
function applyFocus() {
  map.getSource("focus")?.setData({ type: "FeatureCollection", features: focusFeatures() });
}

// The lit-up track, stations and trains, framed beside the panel.
function frameFocus() {
  const { railroad: id, line } = state;
  const b = new maplibregl.LngLatBounds();
  for (const f of focusFeatures()) {
    const g = f.geometry;
    for (const c of g.type === "LineString" ? g.coordinates : g.coordinates.flat()) b.extend(c);
  }
  const stations = line ? lineStations(id, line) : [...state.stations.values()].filter((st) => st.agencies.includes(id));
  for (const st of stations) b.extend([stationPos(st).lon, stationPos(st).lat]);
  for (const t of focusTrains()) if (Number.isFinite(t.lat)) b.extend([t.lon, t.lat]);
  if (b.isEmpty()) return;
  const pad = panelPadding();
  let padding = { top: 60, right: 60, bottom: Math.max(60, pad.bottom + 20), left: Math.max(60, pad.left + 40) };
  // Where the margins leave no room to fit it, use smaller ones (else the map
  // wouldn't move at all).
  if (!map.cameraForBounds(b, { padding })) padding = { top: 20, right: 20, bottom: Math.min(padding.bottom, innerHeight / 3), left: Math.min(padding.left, innerWidth / 3) };
  map.stop(); // whatever was moving the map gives way
  map.fitBounds(b, { padding, maxZoom: 11, duration: 900 });
}

// A page section under a heading that folds it away (with its count, so a
// folded section still says something).
function rrSection(key, title, count, body) {
  const open = !state.rrCollapsed.has(key);
  return `<section class="rr-sec${open ? "" : " collapsed"}">
    <h3 class="section-title"><button type="button" class="notices-toggle" data-rr-section="${key}" aria-expanded="${open}">
      ${esc(title)} <span class="rr-count">${count}</span>
      <svg class="chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button></h3>
    ${open ? body : ""}
  </section>`;
}

// A stand-in train for a line's typical consist (or, given one car's number,
// the consist that car runs in), so its cars draw and open model pages like
// a live train's.
const fleetTrain = (id, route, number) => ({ id: `fleet:${id}:${route || ""}:${number || ""}`, agency: id, route: route || null,
  number: null, fleet: true, backLabel: state.line || AGENCIES[id].name, cars: number ? { numbers: [number], complete: false } : null, stops: null });

// The model page for a car tapped in a page's fleet.
function fleetModelPage(id, el) {
  // A car seen on a running train is drawn from that train, while it runs.
  const live = state.car.train && state.trains.get(state.car.train);
  return renderModelPage(live ? { ...live, fleet: true, backLabel: state.line || AGENCIES[id].name } : fleetTrain(id, state.car.fleet, state.car.number), el);
}

// Every car type running on these lines: from their typical trains, the
// trains running now (Amtrak's equipment goes by train, not line) and, for a
// whole railroad, its fleet roster. Each is drawn once and opens its model
// page; locomotives first, then powered cars, then coaches.
function equipmentList(id, lineNames, trains, roster) {
  const a = AGENCIES[id], kinds = new Map(); // type key -> { route, number, trainId, i, c }
  const add = (c, from) => c?.cars.forEach((car, i) => {
    const k = car.type?.key;
    if (k && !kinds.has(k)) kinds.set(k, { ...from, i, c });
  });
  for (const name of lineNames.length ? lineNames : [null]) add(consistOf(fleetTrain(id, name)), { route: name });
  for (const t of trains) add(consistOf(t), { route: t.route, trainId: t.id });
  if (roster) {
    for (const { number } of fleetSamples(id)) add(consistOf(fleetTrain(id, lineNames[0] ?? null, number)), { route: lineNames[0] ?? null, number });
  }
  const rank = (k) => ({ diesel: 0, electric: 0, emu: 1 })[kinds.get(k).c.cars[kinds.get(k).i].type.kind] ?? 2;
  const html = [...kinds.keys()].sort((x, y) => rank(x) - rank(y)).map((k) => {
    const { route, number, trainId, i, c } = kinds.get(k);
    const m = modelOf(c, i), car = c.cars[i];
    const sub = [m?.type, m?.fleet].filter(Boolean).join(" · ");
    return `<button class="rr-car" data-fleet-car data-route="${esc(route || "")}" data-number="${esc(number || "")}" data-train="${esc(trainId || "")}" data-i="${i}">
      ${carSvg(c, i, a.color, 128)}
      <span><span class="title">${esc(m?.model || car.type?.name || "Car")}</span>${sub ? `<br><span class="sub">${esc(sub)}</span>` : ""}</span>
    </button>`;
  }).join("");
  return { html, count: kinds.size };
}

const statTile = (n, label, cls = "") => `<div class="rr-stat ${cls}"><strong>${n}</strong><span>${label}</span></div>`;
function trainStats(trains) {
  const late = trains.filter((t) => t.delayMin > 5).length;
  const onTime = trains.filter((t) => t.delayMin != null && t.delayMin <= 5).length;
  return `<div class="rr-stats">
      ${statTile(trains.length, trains.length === 1 ? "train running" : "trains running")}
      ${statTile(onTime, "on time", "good")}
      ${statTile(late, "over 5 min late", late ? "warn" : "")}
    </div>`;
}
function runningList(a, trains, withLine) {
  const running = [...trains].sort((x, y) => String(x.route || "").localeCompare(String(y.route || "")) ||
    String(x.number).localeCompare(String(y.number), undefined, { numeric: true }));
  return `<div class="rr-trains">${running.length ? running.slice(0, 40).map((t) => `<button class="result" data-select="${esc(t.id)}">
        ${plate(t.number || a.short, a.color, "sm")}
        <span><span class="title">${esc(t.destination ? `to ${t.destination}` : trainTitle(t))}</span><br><span class="sub">${esc([withLine && t.route, t.nextStop && `next ${t.nextStop}`].filter(Boolean).join(" · "))}</span></span>
        ${t.statusText ? `<span class="status ${statusClass(t)}">${esc(t.statusText)}</span>` : "<span></span>"}
      </button>`).join("") + (running.length > 40 ? `<p class="sub">and ${running.length - 40} more</p>` : "")
      : `<p class="empty">No ${esc(a.short)} trains are reporting here right now.</p>`}</div>`;
}
// A line's stations joined by a line in its color, like a train's stops.
function lineDiagram(id, list, color) {
  const a = AGENCIES[id];
  return `<ol class="stops line-stops" style="--line-color:${color}">${list.map((st) => {
    const d = st.members.find((m) => m.agency === id)?.daily;
    return `<li class="link" data-station="${esc(st.id)}" role="button" tabindex="0" title="${esc(st.name)} station">
      <span class="stop-dot" aria-hidden="true"></span><span>${esc(st.name)}</span><span class="time">${d ? `${d} a weekday` : ""}</span></li>`;
  }).join("")}</ol>`;
}

function stationButtons(id, list) {
  const a = AGENCIES[id];
  return `<div class="rr-stations">${list.map((st) => {
    const d = st.members.find((m) => m.agency === id)?.daily;
    return `<button class="result" data-station="${esc(st.id)}">
      <span class="station-icon" style="--c:${a.color}"></span>
      <span><span class="title">${esc(st.name)}</span><br><span class="sub">${esc([st.place, d ? `${d} ${a.short} trains a weekday` : ""].filter(Boolean).join(" · "))}</span></span>
      <span></span></button>`;
  }).join("")}</div>`;
}

function renderRailroad() {
  if (state.line) return renderLine();
  const id = state.railroad, a = AGENCIES[id], el = $("train-detail");
  if (state.car?.page && state.car.fleet != null) return fleetModelPage(id, el);
  const src = SOURCES.find((s) => s.agencies.includes(id));
  const avail = src ? sourceAvailability(src) : { ok: false };
  const status = state.sourceStatus[src?.id];
  const trains = focusTrains();
  const estimated = trains.filter((t) => t.estimated).length;
  const stations = [...state.stations.values()].filter((st) => st.agencies.includes(id));

  // Lines: from its stations' timetables and the routes its trains report.
  const lines = new Map(); // key -> { name, running }
  for (const st of stations) {
    for (const m of st.members) {
      if (m.agency !== id) continue;
      for (const l of m.lines || []) if (l && l !== "City Terminal Zone" && !lines.has(lineKey(l))) lines.set(lineKey(l), { name: l, running: 0 });
    }
  }
  for (const t of trains) {
    if (!t.route) continue;
    const k = lineKey(t.route);
    if (!lines.has(k)) lines.set(k, { name: t.route, running: 0 });
    lines.get(k).running++;
  }
  // A timetable's longer name for a running line folds into it.
  const runningKeys = [...lines].filter(([, l]) => l.running).map(([k]) => k);
  for (const [k, l] of lines) if (!l.running && runningKeys.some((r) => sameLine(k, r))) lines.delete(k);
  const lineList = [...lines.values()].sort((x, y) => y.running - x.running || x.name.localeCompare(y.name));
  const fleet = equipmentList(id, lineList.map((l) => l.name), trains, true);

  const source = !avail.ok ? avail.reason || "Not connected"
    : estimated && estimated === trains.length ? "Positions estimated from predicted times"
    : trains.length ? "Live GPS positions" : "No trains reporting right now";
  const updated = status?.at ? ` · updated ${fmtAgo(status.at)}` : "";
  // Busiest: most of its trains on a weekday (else its timetable's stops a week).
  const busy = (st) => { const m = st.members.find((x) => x.agency === id); return [m?.daily || 0, m?.trips || 0]; };
  const busiest = [...stations].sort((x, y) => busy(y)[0] - busy(x)[0] || busy(y)[1] - busy(x)[1]).slice(0, 5);

  el.innerHTML = `
    <div class="hero">
      <div class="agency-name" style="color:${a.color}"><span class="dot" style="background:${a.color}"></span>${a.kind === "intercity" ? "Intercity" : "Commuter rail"} · ${esc(a.region)}</div>
      <h2>${esc(a.name)}</h2>
      <p class="station-facts"><span>${esc(source)}${esc(updated)}</span></p>
    </div>
    ${trainStats(trains)}
    ${lineList.length > 1 ? rrSection("lines", "Lines", lineList.length,
      `<ul class="rr-lines">${lineList.map((l) => `<li><button type="button" class="rr-line" data-line="${esc(l.name)}"><span>${esc(l.name)}</span><span class="sub">${l.running ? `${l.running} running` : "none running"} ›</span></button></li>`).join("")}</ul>`) : ""}
    ${rrSection("running", "Running now", trains.length, runningList(a, trains, true))}
    ${fleet.count ? rrSection("fleet", "Fleet", fleet.count, `<p class="rr-hint">Tap one to read about it.</p><div class="rr-cars">${fleet.html}</div>`) : ""}
    ${busiest.length ? rrSection("stations", "Busiest stations", busiest.length, `<p class="rr-hint">Of its ${stations.length}, by trains a weekday.</p>${stationButtons(id, busiest)}`) : ""}
    ${src ? `<p class="estimate-note">Data: <a href="${esc(src.credit.href)}" target="_blank" rel="noopener">${esc(src.credit.label)}</a></p>` : ""}`;
}

// A line's page: what's running on it, its stations in order and its fleet.
function renderLine() {
  const id = state.railroad, name = state.line, a = AGENCIES[id], el = $("train-detail");
  // The line's typical train, drawn and tappable like a train page's cars.
  const typical = fleetTrain(id, name);
  if (state.car?.page && state.car.id === typical.id) return renderModelPage(typical, el);
  const trains = focusTrains();
  const stations = orderedLineStations(id, name);
  // Keep the cars strip where it was scrolled across redraws.
  const strip = el.querySelector(".consist-strip");
  // (Not "data-line": that marks a tappable line row.)
  const keepStrip = el.dataset.stripOf === typical.id ? strip?.scrollLeft || 0 : 0;
  el.dataset.stripOf = typical.id;
  el.innerHTML = `
    <div class="hero">
      <div class="agency-name" style="color:${a.color}"><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</div>
      <h2>${esc(name)}</h2>
      ${stations.length ? `<p class="station-facts"><span>${stations.length} stations · ${esc(stations[0].name)} – ${esc(stations[stations.length - 1].name)}</span></p>` : ""}
      ${consistSection(typical)}
    </div>
    ${trainStats(trains)}
    ${rrSection("running", "Running now", trains.length, runningList(a, trains, false))}
    ${stations.length ? rrSection("line-stations", "Stations", stations.length, lineDiagram(id, stations, lineColor(id, name))) : ""}`;
  const shown = el.querySelector(".consist-strip");
  if (shown) shown.scrollLeft = keepStrip;
}

// A station's next trains: a folding section whose heading also switches
// between departures and arrivals.
function nextTrainsSection(rows, arrivals, loading) {
  const open = !state.rrCollapsed.has("next");
  return `<section class="rr-sec${open ? "" : " collapsed"}">
    <div class="deps-head">
      <h3 class="section-title"><button type="button" class="notices-toggle" data-rr-section="next" aria-expanded="${open}">
        Next trains <span class="rr-count">${Math.min(rows.length, 14)}</span>
        <svg class="chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button></h3>
      ${open ? `<div class="segmented two sm" id="station-view">
        <button data-station-view="dep" aria-pressed="${!arrivals}">Departures</button>
        <button data-station-view="arr" aria-pressed="${arrivals}">Arrivals</button>
      </div>` : ""}
    </div>
    ${open ? `<div class="deps">
      ${rows.length ? rows.slice(0, 14).map((r) => r.html).join("")
        : `<p class="empty">${loading ? "Loading live trains…" : `No live trains are reporting ${arrivals ? "an arrival" : "a departure"} here right now.`}</p>`}
    </div>
    <p class="estimate-note">Times are live predictions from each railroad.</p>` : ""}
  </section>`;
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

function startTracking(t, stopKey, fromKey = null) {
  if (state.tracked.some((r) => r.id === t.id)) return;
  if (state.tracked.length >= MAX_TRACKED) return toast("You can track up to three trains at once.");
  const stop = stopKey ? t.stops?.find((s) => s.key === stopKey) : null;
  state.tracked.push({
    id: t.id, agency: t.agency, number: t.number, route: t.route,
    stopKey: stop?.key || null, stopName: stop?.name || null,
    fromKey, fromName: fromKey ? t.stops?.find((s) => s.key === fromKey)?.name || null : null,
    eta: stop ? Date.parse(stop.time) : null, lastSeen: Date.now(),
  });
  saveTracked();
  checkTracked();
  applySelectionFilter();
  renderAll();
}

function untrack(id, message) {
  state.tracked = state.tracked.filter((r) => r.id !== id);
  saveTracked();
  applySelectionFilter();
  if (message) toast(message);
  renderAll();
}

// Under the train's name: where it's being tracked to (stopped from the
// tracked card's × or the stop's circle). Trains with a stop list are tracked
// from a stop's circle; the rest (most GPS-only railroads) keep a button that
// tracks without a destination.
function trackButton(t) {
  const rec = state.tracked.find((r) => r.id === t.id);
  if (rec) return `<span class="tracking-note">Tracking${rec.fromName ? ` from ${esc(rec.fromName)}` : ""}${rec.stopName ? ` to ${esc(rec.stopName)}` : ""}</span>`;
  if (t.stops?.some((s) => s.status !== "past")) return "";
  return `<button class="btn primary small" data-track="${esc(t.id)}">Track this train</button>`;
}

// Each stop's circle on the stop list. On a stop still ahead it's a button
// that tracks the train until there; on the stop it's tracked to, tapping
// it again stops tracking.
// Each stop's circle on the stop list: a button for tracking. The first tap
// marks where the rider got on (it can be a stop the train has left), the
// second where they're getting off; the destination's circle, tapped again,
// stops tracking.
function stopDot(s, { isDest, isFrom, picking }) {
  if (!s.key) return '<span class="stop-dot" aria-hidden="true"></span>';
  const label = isDest ? `Stop tracking to ${s.name}` : isFrom ? `Not from ${s.name}`
    : picking ? `Getting off at ${s.name}` : `Got on at ${s.name}`;
  return `<button type="button" class="stop-dot" data-track-to="${esc(s.key)}" aria-pressed="${Boolean(isDest || isFrom)}" aria-label="${esc(label)}" title="${esc(label)}"></button>`;
}

function trackTo(t, key) {
  const rec = state.tracked.find((r) => r.id === t.id);
  const pick = state.trackPick?.id === t.id ? state.trackPick : null;
  const at = (k) => t.stops.findIndex((x) => x.key === k);
  if (!pick) {
    if (rec?.stopKey === key) return untrack(t.id); // the destination again: stop
    state.trackPick = { id: t.id, from: key };       // where they got on
    return renderDetail();
  }
  if (key === pick.from) { state.trackPick = null; return renderDetail(); }
  // An earlier stop: that's where they got on instead.
  if (at(key) < at(pick.from)) { state.trackPick = { id: t.id, from: key }; return renderDetail(); }
  state.trackPick = null;
  const stop = t.stops[at(key)], start = t.stops[at(pick.from)];
  if (!rec) return startTracking(t, key, pick.from);
  // Already tracked: this ride replaces the last.
  Object.assign(rec, { stopKey: stop.key, stopName: stop.name, fromKey: start.key, fromName: start.name, eta: Date.parse(stop.time) || null });
  saveTracked();
  checkTracked();
  renderAll();
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
      if (late.text) status = `<span class="status ${late.cls}${t.inferred ? " inferred" : ""}"${t.inferred ? ` title="${INFERRED_TITLE}"` : ""}>${late.text}</span>`;
      if (Date.now() - t.updated > STALE_MS && !t.estimated) warn = `<span class="stale">⚠ Position ${fmtAgo(t.updated)}</span>`;
    } else {
      where = rec.stopName ? `to <strong>${esc(rec.stopName)}</strong>` : "";
      warn = `<span class="stale">Not reporting · last seen ${fmtAgo(rec.lastSeen)}</span>`;
    }
    // Live Activity: a countdown to the stop it's tracked to, and how far
    // along the ride it is (from where they got on to that stop, by time).
    let eta = "", pct = null;
    if (t?.stops?.length) {
      const dest = (rec.stopKey && t.stops.find((s) => s.key === rec.stopKey)) || t.stops[t.stops.length - 1];
      const board = (rec.fromKey && t.stops.find((s) => s.key === rec.fromKey)) || t.stops[0]; // where they got on
      const start = Date.parse(board.time), end = Date.parse(dest.time);
      if (start && end && end > start) pct = Math.max(0, Math.min(1, (Date.now() - start) / (end - start)));
      const min = end ? Math.round((end - Date.now()) / 60000) : null;
      if (min != null) eta = min <= 0 ? "Now" : min < 60 ? `${min}<small>min</small>` : `${Math.floor(min / 60)}<small>h</small> ${min % 60}<small>m</small>`;
    }
    const color = t?.routeColor || a.color;
    return `<div class="track-card live" style="--c:${color}" role="button" tabindex="0" data-track-open="${esc(rec.id)}">
      <div class="la-top">${plate(rec.number || a.short, a.color, "xs")}<span class="la-route">${esc(rec.route || AGENCIES[rec.agency]?.name || "")}</span>${eta ? `<span class="la-eta">${eta}</span>` : ""}
        <button class="tc-x" data-untrack="${esc(rec.id)}" aria-label="Stop tracking ${esc(trainLabel(rec))}" title="Stop tracking">×</button></div>
      ${where || status || warn ? `<div class="la-where">${[where, status, warn].filter(Boolean).join(" · ")}</div>` : ""}
      ${pct != null ? `<div class="la-track" aria-hidden="true"><span class="la-fill" style="width:${(pct * 100).toFixed(1)}%"></span><span class="la-end"></span><span class="la-dot" style="left:${(pct * 100).toFixed(1)}%"></span></div>` : ""}
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
  renderAgencies();
  renderResults();
  renderCredits();
  if (state.selected || state.station || state.railroad) renderDetail();
  // A line opened before its trains loaded is traced once they have.
  if (state.railroad && focusCache.key !== `${state.railroad}|${state.line || ""}|${state.line ? lineColor(state.railroad, state.line) : AGENCIES[state.railroad].color}`) applyFocus();
}


// ---------- Selection ----------

let stationsShownFor = null; // railroad whose stations alone show (its pages)
function applySelectionFilter() {
  if (!map.getLayer("tt-trains")) return;
  const id = state.selected || "", sid = state.station || "";
  // The selected train and every tracked train get a ping, and their plates
  // win any collision and show at every zoom. Only the selected train's
  // marker is enlarged; tracked trains keep their normal size.
  const ids = [...new Set([id, ...state.tracked.map((r) => r.id)].filter(Boolean))];
  const highlighted = ["in", ["get", "id"], ["literal", ids]];
  const selected = ["==", ["get", "id"], id];
  map.setFilter("tt-ping", highlighted);
  map.setLayoutProperty("tt-trains", "icon-size", trainIconSize(selected));
  map.setLayoutProperty("tt-labels", "text-variable-anchor-offset", plateOffset(selected));
  map.setFilter("tt-labels", state.labels === "none" ? highlighted : ["any", highlighted, [">=", ["zoom"], 8]]);
  map.setLayoutProperty("tt-labels", "symbol-sort-key", ["case", highlighted, -1, ["get", "labelOrder"]]);
  for (const l of ["tt-station-ping", "tt-station-shadow", "tt-station-selected", "tt-footprint-selected"]) {
    map.setFilter(l, ["==", ["get", "id"], sid]);
  }
  applyStationCallouts();
  applyFocus();
  // Stations are filtered to the railroad on its pages.
  const only = state.railroad || null;
  if (only !== stationsShownFor) {
    stationsShownFor = only;
    redrawStations();
  }
  ping(Boolean(ids.length || sid));
  // Which trains show can depend on the selection and tracking (visible()).
  redraw();
}

// A circle that grows and fades from the selected train or station, then
// rests (hidden, back at the small size) before the next one. A still circle
// if motion is reduced.
let pingRaf = null;
const PING_MS = 1300, PING_REST_MS = 600;
function ping(on) {
  cancelAnimationFrame(pingRaf);
  const layers = ["tt-ping", "tt-station-ping"].filter((l) => map.getLayer(l));
  if (!on || !layers.length) return;
  // Pings start at the marker's edge; the selected train's marker is enlarged.
  const disc = () => discRadiusAt(map.getZoom());
  const radius = (l, extra) => l === "tt-ping"
    ? ["case", ["==", ["get", "id"], state.selected || ""], disc() * SELECTED_SCALE + extra, disc() + extra]
    : disc() + extra;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (const l of layers) {
      map.setPaintProperty(l, "circle-radius", radius(l, 6));
      map.setPaintProperty(l, "circle-opacity", 0.25);
    }
    return;
  }
  let last = 0;
  const step = (now) => {
    if (now - last > 33 && !document.hidden) {
      last = now;
      const t = now % (PING_MS + PING_REST_MS);
      const resting = t > PING_MS;
      const k = resting ? 0 : t / PING_MS;
      const grow = 1 - (1 - k) ** 3; // ease out
      const opacity = resting ? 0 : 0.4 * (1 - k) ** 1.5;
      for (const l of layers) {
        map.setPaintProperty(l, "circle-radius", radius(l, grow * 18));
        map.setPaintProperty(l, "circle-opacity", opacity);
      }
    }
    pingRaf = requestAnimationFrame(step);
  };
  pingRaf = requestAnimationFrame(step);
}

function setUrlSelection() {
  const url = new URL(location.href);
  url.searchParams.delete("train");
  url.searchParams.delete("station");
  url.searchParams.delete("railroad");
  url.searchParams.delete("line");
  if (state.selected) url.searchParams.set("train", state.selected);
  if (state.railroad) url.searchParams.set("railroad", state.railroad);
  if (state.line) url.searchParams.set("line", state.line);
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
  if (state.trackPick?.id !== id) state.trackPick = null;
  state.railroad = null;
  state.line = null;
  $("back-btn").lastChild.textContent = " All trains";
  if (state.selected !== id) state.car = null;
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
      center: [targetOf(t).lon, targetOf(t).lat], // where it's drawn (on the track)
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
// A station's notices, and its NJ Transit departure board for the tracks
// (through the relay).
async function refreshStationExtras(st) {
  const njt = st.members.find((m) => m.agency === "njt" && m.code);
  const [notices, board] = await Promise.all([
    stationNotices(st).catch(() => []),
    njt && RELAY ? fetch(`${RELAY.replace(/\/$/, "")}/njt-board/${encodeURIComponent(njt.code)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
  ]);
  if (state.station !== st.id) return;
  const tracks = new Map((board?.items || []).filter((x) => x.track).map((x) => [String(x.trainID), x.track]));
  state.stationExtras = { id: st.id, notices, tracks };
  renderDetail();
}

function selectStation(id, { fly = true } = {}) {
  const st = state.stations.get(id);
  if (!st) return;
  state.selected = null;
  state.railroad = null;
  state.line = null;
  state.station = id;
  state.predictions = null;
  setFollow(false);
  setUrlSelection();
  applySelectionFilter();
  showDetailView(true);
  renderDetail();
  clearInterval(predictionTimer);
  if (state.stationExtras?.id !== id) state.stationExtras = null;
  refreshStationExtras(st);
  if (st.agencies.includes("mbta")) refreshPredictions(st);
  predictionTimer = setInterval(() => {
    if (st.agencies.includes("mbta")) refreshPredictions(st);
    refreshStationExtras(st);
  }, 30000);
  if (fly) {
    map.flyTo({ center: [stationPos(st).lon, stationPos(st).lat], zoom: Math.max(map.getZoom(), 12), padding: panelPadding(), duration: 900 });
  }
  if (isPhone) setSheet("");
}

function closeDetail() {
  clearInterval(predictionTimer);
  const back = state.returnTo;
  state.returnTo = null;
  $("back-btn").lastChild.textContent = " All trains";
  // Back to the station a train was opened from, or the train a station was,
  // or the railroad page either was.
  if (back?.railroad && !state.railroad) return openRailroad(back.railroad, { fly: false, line: back.line || null });
  // Back to the train a line or railroad page was opened from.
  if (state.railroad && back?.train && state.trains.has(back.train)) return select(back.train, { fly: false });
  // Back from a line's page to its railroad's.
  if (state.line) return openRailroad(state.railroad);
  if (state.selected && typeof back === "string" && state.stations.has(back)) return selectStation(back, { fly: false });
  if (state.station && back?.train && state.trains.has(back.train)) {
    state.station = null;
    return select(back.train, { fly: false });
  }
  state.station = null;
  state.railroad = null;
  state.line = null;
  state.car = null;
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
  // A train or station under the pointer (or its callout) wins over the track.
  const over = ["tt-trains", ...STATION_LAYERS, "tt-station-selected-label"].filter((l) => map.getLayer(l));
  const near = [[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]];
  if (hoverStation || map.queryRenderedFeatures(near, { layers: over }).length) {
    if (popup._railHover) popup.remove();
    popup._railHover = false;
    return;
  }
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

// The station callout (its name in a tag above it) shows on the selected
// station and on the one under the pointer, so clicking a hovered station
// doesn't change its label. The callout replaces its plain label.
let hoverStation = null;
function applyStationCallouts() {
  if (!map.getLayer("tt-station-selected-label")) return;
  const ids = [state.station, hoverStation].filter(Boolean);
  map.setFilter("tt-station-selected-label", ["in", ["get", "id"], ["literal", ids]]);
  map.setFilter("tt-station-labels", ["!", ["in", ["get", "id"], ["literal", ids]]]);
}
function hoverStationTo(id) {
  if (id === hoverStation) return;
  hoverStation = id;
  if (id && popup._railHover) { popup.remove(); popup._railHover = false; } // the track's popup gives way
  applyStationCallouts();
}

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
    if (canHover) hoverStationTo(e.features[0].properties.id);
  });
  map.on("mouseleave", layer, () => {
    map.getCanvas().style.cursor = "";
    hoverStationTo(null);
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
    .setHTML(`<div class="t">${plate(t.number || a.short, a.color, "xs")}<span>${esc(trainTitle(t))}</span></div>
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

function openCar(fig) {
  const i = Number(fig.dataset.car);

  // On a line's page, the cars are its typical train's.
  const id = state.selected || (state.line ? fleetTrain(state.railroad, state.line).id : null);
  state.car = state.car?.id === id && state.car.i === i ? null : { id, i, page: false };
  renderDetail();
}
on("train-detail", "keydown", (e) => {
  if (e.target.closest?.("[data-track-to]")) return; // the pin is its own button
  const stationLi = e.target.closest?.("li[data-station]");
  if (stationLi && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); return stationLi.click(); }
  const stopLink = e.target.closest?.("[data-stop-station]");
  if (stopLink && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); return openStop(stopLink); }
  const fig = e.target.closest?.("[data-car]");
  if (fig && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openCar(fig); }
});
function openStop(li) {
  const t = state.trains.get(state.selected);
  selectStation(li.dataset.stopStation);
  if (!t) return;
  state.returnTo = { train: t.id }; // "back" from this station goes to the train
  $("back-btn").lastChild.textContent = ` ${t.number ? `Train ${t.number}` : "Train"}`;
}
// Hovering a stop's circle previews the trip to it: the line from the train
// and the stops on the way, in a lighter shade of the line's color.
let previewing = null;
on("train-detail", "mouseover", (e) => {
  const dot = e.target.closest("button.stop-dot");
  if (dot === previewing) return;
  previewing = dot;
  for (const li of document.querySelectorAll(".stops li.pv-from, .stops li.pv-ride, .stops li.pv-dest")) li.classList.remove("pv-from", "pv-ride", "pv-dest");
  if (!dot) return;
  const rows = [...dot.closest(".stops").children];
  // Once they've tapped where they got on: the ride from there to here.
  const start = rows.findIndex((li) => li.classList.contains("pick-from"));
  const to = rows.indexOf(dot.closest("li"));
  if (start < 0 || to <= start) return;
  rows.forEach((li, i) => {
    if (i === start) li.classList.add("pv-from");
    else if (i > start && i < to) li.classList.add("pv-ride");
    else if (i === to) li.classList.add("pv-dest");
  });
});
on("train-detail", "click", (e) => {
  const pin = e.target.closest("[data-track-to]");
  if (pin) {
    const t = state.trains.get(state.selected);
    if (t) trackTo(t, pin.dataset.trackTo);
    return;
  }
  const stopLink = e.target.closest("[data-stop-station]");
  if (stopLink) return openStop(stopLink);
  const view = e.target.closest("[data-station-view]");
  if (view) { state.stationView = view.dataset.stationView; return renderDetail(); }
  const fig = e.target.closest("[data-car]");
  if (fig) return openCar(fig);
  // A car in a railroad page's fleet: straight to its model page.
  const kind = e.target.closest("[data-fleet-car]");
  if (kind && state.railroad) {
    const { route, number, train, i } = kind.dataset;
    state.car = { id: `fleet:${state.railroad}`, i: Number(i), page: true, fleet: route, number: number || null, train: train || null };
    renderDetail();
    $("train-detail").scrollTop = 0;
    return;
  }
  if (e.target.closest("[data-car-close]")) { state.car = null; return renderDetail(); }
  if (e.target.closest("[data-model-more]") && state.car) { state.car.page = true; renderDetail(); $("train-detail").scrollTop = 0; return; }
  if (e.target.closest("[data-model-back]") && state.car) {
    if (state.car.fleet != null) state.car = null; // back to the railroad page
    else state.car.page = false;
    return renderDetail();
  }
  const lineBtn = e.target.closest("button[data-line]");
  if (lineBtn && state.railroad) return openLine(state.railroad, lineBtn.dataset.line);
  const servedToggle = e.target.closest("[data-served-toggle]");
  if (servedToggle) {
    const id = servedToggle.dataset.servedToggle;
    state.servedOpen.has(id) ? state.servedOpen.delete(id) : state.servedOpen.add(id);
    return renderDetail();
  }
  const openLineBtn = e.target.closest("[data-open-line]"), railroadBtn = e.target.closest("[data-railroad]");
  if (openLineBtn || railroadBtn) {
    const fromTrain = state.selected && state.trains.get(state.selected);
    if (openLineBtn) openLine(openLineBtn.dataset.lineRailroad, openLineBtn.dataset.openLine);
    else openRailroad(railroadBtn.dataset.railroad);
    // "back" from a line or railroad opened from a train goes to the train
    if (fromTrain) {
      state.returnTo = { train: fromTrain.id };
      $("back-btn").lastChild.textContent = ` ${fromTrain.number ? `Train ${fromTrain.number}` : "Train"}`;
    }
    return;
  }
  const section = e.target.closest("[data-rr-section]");
  if (section) {
    const key = section.dataset.rrSection;
    state.rrCollapsed.has(key) ? state.rrCollapsed.delete(key) : state.rrCollapsed.add(key);
    store.set("tt-rr-collapsed", [...state.rrCollapsed]);
    return renderDetail();
  }
  if (e.target.closest("[data-notices-toggle]")) {
    state.noticesCollapsed = !state.noticesCollapsed;
    store.set("tt-notices-collapsed", state.noticesCollapsed);
    return renderDetail();
  }
  const track = e.target.closest("[data-track]");
  if (track) {
    const t = state.trains.get(track.dataset.track);
    if (t) startTracking(t, null);
    return;
  }
  const stop = e.target.closest("[data-untrack]");
  if (stop) return untrack(stop.dataset.untrack);
  const b = e.target.closest("[data-select]");
  if (b) {
    const from = state.station, railroad = state.railroad, line = state.line;
    select(b.dataset.select);
    // "back" from this train goes to the station, railroad or line it was opened from
    state.returnTo = railroad ? { railroad, line } : from;
    $("back-btn").lastChild.textContent = railroad ? ` ${AGENCIES[railroad].short}` : from ? " Station" : " All trains";
  }
  const st = e.target.closest("[data-station]");
  if (st) {
    const railroad = state.railroad, line = state.line;
    selectStation(st.dataset.station);
    if (railroad) {
      state.returnTo = { railroad, line };
      $("back-btn").lastChild.textContent = ` ${AGENCIES[railroad].short}`;
    }
  }
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
  const rr = e.target.closest("[data-railroad]");
  if (rr) return openRailroad(rr.dataset.railroad);
  const ln = e.target.closest("[data-open-line]");
  if (ln) return openLine(ln.dataset.lineRailroad, ln.dataset.openLine);
  const b = e.target.closest("[data-select]");
  const st = e.target.closest("[data-station]");
  if (b) select(b.dataset.select);
  else if (st) selectStation(st.dataset.station);
});

on("agencies", "click", (e) => {
  const toggle = e.target.closest("[data-toggle]");
  const info = e.target.closest("[data-railroad]");
  if (toggle) {
    const id = toggle.dataset.toggle;
    state.hidden.has(id) ? state.hidden.delete(id) : state.hidden.add(id);
    store.set("tt-hidden", [...state.hidden]);
    redraw();
    redrawStations();
    redrawRail();
    renderAll();
  } else if (info) {
    openRailroad(info.dataset.railroad);
  }
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

function applyUnits() {
  for (const b of $("units-choice")?.children || []) b.setAttribute("aria-pressed", String(b.dataset.units === state.units));
}
on("units-choice", "click", (e) => {
  const b = e.target.closest("[data-units]");
  if (!b) return;
  state.units = b.dataset.units;
  store.set("tt-units", state.units);
  applyUnits();
  renderAll();
});

function applyLabels() {
  for (const b of $("labels-choice")?.children || []) b.setAttribute("aria-pressed", String(b.dataset.labels === state.labels));
}
on("labels-choice", "click", (e) => {
  const b = e.target.closest("[data-labels]");
  if (!b) return;
  state.labels = b.dataset.labels;
  store.set("tt-labels", state.labels);
  applyLabels();
  applySelectionFilter();
  redraw();
});
on("estimated-toggle", "change", (e) => {
  state.hideEstimated = e.target.checked;
  store.set("tt-hide-estimated", state.hideEstimated);
  redraw();
  renderAll();
});
on("only-tracked-toggle", "change", (e) => {
  state.onlyTracked = e.target.checked;
  store.set("tt-only-tracked", state.onlyTracked);
  redraw();
  renderAll();
});
on("clock-toggle", "change", (e) => {
  state.clock24 = e.target.checked;
  store.set("tt-clock24", state.clock24);
  renderAll();
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


on("heading-toggle", "change", (e) => {
  state.inferHeading = e.target.checked;
  store.set("tt-infer-heading", state.inferHeading);
  computePositions();
  animateTo();
  renderAll();
});

// Time zones to show times in: the viewer's own (the default), each stop's
// local time, or one of the zones the railroads run in.
const TIME_ZONE_CHOICES = [
  ["station", "Each station's local time"],
  ["America/St_Johns", "Newfoundland"], ["America/Halifax", "Atlantic"], ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"], ["America/Denver", "Mountain"], ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"], ["America/Anchorage", "Alaska"], ["Pacific/Honolulu", "Hawaii"], ["UTC", "UTC"],
];
// The listed zone that keeps the same clock as `zone` (America/Detroit ->
// Eastern), judged by its offsets in winter and summer; or null.
function listedZone(zone) {
  const clock = (z, m) => new Date(Date.UTC(new Date().getUTCFullYear(), m, 15, 12)).toLocaleString("en-US", { timeZone: z, hour: "numeric", minute: "numeric", hourCycle: "h23" });
  try {
    return TIME_ZONE_CHOICES.find(([v]) => v === zone)?.[0] ||
      TIME_ZONE_CHOICES.find(([v]) => v !== "station" && v !== "UTC" && clock(v, 0) === clock(zone, 0) && clock(v, 6) === clock(zone, 6))?.[0] || null;
  } catch {
    return null;
  }
}
// Until a zone is picked, times follow the device and the menu checks the
// listed zone that matches it; a device zone that matches none of them gets
// its own entry at the top.
function initTimeZones() {
  const select = $("tz-choice");
  if (!select) return;
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const match = own ? listedZone(own) : null;
  const opts = match ? TIME_ZONE_CHOICES
    : [["", `Your time zone${own ? ` (${own.split("/").pop().replace(/_/g, " ")})` : ""}`], ...TIME_ZONE_CHOICES];
  select.innerHTML = opts.map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join("");
  if (state.timeZone && !opts.some(([v]) => v === state.timeZone)) state.timeZone = "";
  select.value = state.timeZone || match || "";
}
on("tz-choice", "change", (e) => {
  state.timeZone = e.target.value;
  store.set("tt-tz", state.timeZone);
  renderAll();
});

on("infer-toggle", "change", (e) => {
  state.inferDelays = e.target.checked;
  store.set("tt-infer", state.inferDelays);
  applyInference();
  renderAll();
});

function toggleMenu(open = $("settings-menu").hidden) {
  const menu = $("settings-menu"), btn = $("settings-btn");
  menu.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  if (!open) return;
  // Pin the menu under the gear (or over it, where there's more room), kept
  // inside the window; taller than the room it has, it scrolls.
  const r = btn.getBoundingClientRect();
  menu.style.maxHeight = "";
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const below = innerHeight - r.bottom - 8 - 12, above = r.top - 8 - 12;
  const under = h <= below || below >= above;
  const room = under ? below : above;
  menu.style.maxHeight = `${Math.max(160, room)}px`;
  menu.style.left = `${Math.max(12, Math.min(r.right - w, innerWidth - w - 12))}px`;
  menu.style.top = `${under ? r.bottom + 8 : Math.max(12, r.top - 8 - Math.min(h, room))}px`;
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
applyUnits();
setChecked("stations-toggle", state.showStations);
setChecked("estimated-toggle", state.hideEstimated);
setChecked("clock-toggle", state.clock24);
setChecked("only-tracked-toggle", state.onlyTracked);
applyLabels();
setChecked("infer-toggle", state.inferDelays);
setChecked("heading-toggle", state.inferHeading);
initTimeZones();

// The guided tour (js/tour.js), from Settings or the list's footer.
function takeTour() {
  toggleMenu(false);
  startTour({ state, map, select, selectStation, closeDetail, setSheet, isPhone, targetOf, visible,
              padding: panelPadding });
}
on("tour-btn", "click", takeTour);
on("tour-menu-btn", "click", takeTour);

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
const wantedRailroad = new URL(location.href).searchParams.get("railroad");
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

// ---------- Loading screen ----------
// Until the map, its track and the first round of every railroad's trains
// are in, railroads' typical trains roll by one after another, each chosen
// at random (never the same twice in a row), leading end first at a steady
// speed whatever its length. Gives up waiting after 15 seconds.
const LOADING_TRAINS = [
  ["amtrak", "Acela"], ["amtrak", "Northeast Regional"], ["amtrak", "California Zephyr"], ["amtrak", "Pacific Surfliner"],
  ["amtrak", "Amtrak Cascades"], ["amtrak", "Wolverine"], ["amtrak", "Crescent"], ["via", "Corridor"], ["via", "Canadian"],
  ["brightline"], ["lirr", "Babylon"], ["mnr", "New Haven"], ["mbta"], ["njt"], ["septa"], ["metra", "BNSF"], ["metra", "ME"],
  ["caltrain"], ["metrolink"], ["go"], ["marc", "Penn Line"], ["trirail"], ["frontrunner"], ["smart"], ["capmetro"], ["rtd"],
];
const loadingStart = Date.now();
let mapLoaded = false; // map.loaded() turns false whenever the trains layer updates
map.once("load", () => (mapLoaded = true));
{
  const el = $("loading-train");
  let last = -1;
  const nextTrain = () => {
    let i;
    do i = Math.floor(Math.random() * LOADING_TRAINS.length); while (i === last);
    last = i;
    const [agency, route] = LOADING_TRAINS[i];
    const c = consistOf({ id: "loading", agency, route });
    if (!c) return;
    el.innerHTML = consistHtml(c, AGENCIES[agency].color);
    el.style.setProperty("--pass", `${((innerWidth + el.scrollWidth) / 450).toFixed(1)}s`);
    // Run the pass again from the start for this train.
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  };
  if (el) {
    nextTrain();
    el.addEventListener("animationend", nextTrain);
  }
}
const loadingWait = setInterval(() => {
  const sources = Object.values(state.sourceStatus);
  const ready = mapLoaded && state.railGeo && sources.length && sources.every((x) => x.status !== "loading");
  const waited = Date.now() - loadingStart;
  if ((!ready && waited < 15000) || waited < 1200) return; // shown long enough to see the train
  clearInterval(loadingWait);
  $("loading").classList.add("done");
  setTimeout(() => $("loading").remove(), 500);
}, 200);

// Handy for poking at the live state from the browser console.
// For debugging and audits from the console.
window.trainsheet = { state, map, checkTracked, select, selectStation, openRailroad, openLine, closeDetail, modelOf, focusFeatures, orderedLineStations, allLines };

start();
