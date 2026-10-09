import { AGENCIES, SOURCES, fetchSource, advanceEstimated } from "./sources.js";
import { loadStations, trainsDue, mbtaPredictions, meters } from "./stations.js";
import { RailIndex, estimatePosition } from "./estimate.js";

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
  est: new Map(),        // train id -> estimated { lat, lon, bearing, basis }
  rail: null,            // RailIndex, loaded when estimating
  stopPos: new Map(),    // station member key -> { lat, lon }
  follow: false,
  query: "",
  relayFeeds: null,      // feeds the relay can serve (null = no relay)
};

// ---------- Theme ----------

const prefersDark = matchMedia("(prefers-color-scheme: dark)");
let theme = store.get("tt-theme", null) || (prefersDark.matches ? "dark" : "light");
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
        stationFill: "#1c1f24", stationText: "#b9bfc8" }
    : { text: "#1b1d21", halo: "rgba(255,255,255,0.95)", rail: "#5d6675", railCommuter: "#8d95a3", railCasing: "rgba(255,255,255,0.9)",
        stationFill: "#ffffff", stationText: "#4a505a" };
}

function addLayers() {
  addImages();
  const colors = themeColors();
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;

  // Passenger rail network (USDOT NTAD), visible at every zoom. Lines with
  // Amtrak service draw a little heavier than commuter-only lines.
  map.addSource("rail", { type: "geojson", data: "data/rail.geojson", tolerance: 0.6 });
  const railWidth = (extra = 0) => ["interpolate", ["linear"], ["zoom"],
    3, ["case", ["==", ["get", "k"], "a"], 1.1 + extra, 0.7 + extra],
    7, ["case", ["==", ["get", "k"], "a"], 1.8 + extra, 1.3 + extra],
    12, ["case", ["==", ["get", "k"], "a"], 3.2 + extra, 2.6 + extra]];
  map.addLayer({
    id: "tt-rail-casing",
    type: "line",
    source: "rail",
    minzoom: 6,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": colors.railCasing, "line-width": railWidth(2) },
  }, firstSymbol);
  map.addLayer({
    id: "tt-rail",
    type: "line",
    source: "rail",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": ["case", ["==", ["get", "k"], "a"], colors.rail, colors.railCommuter],
      "line-width": railWidth(),
    },
  }, firstSymbol);
  // Other tracks (freight, yards) from the basemap, faintly, when zoomed in.
  map.addLayer({
    id: "tt-rail-other",
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    minzoom: 9,
    filter: ["==", ["get", "class"], "rail"],
    paint: { "line-color": colors.railCommuter, "line-opacity": 0.45, "line-width": 1 },
  }, "tt-rail-casing");

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
    type: "circle",
    source: "stations",
    minzoom: 8,
    filter: ["!", ["get", "major"]],
    paint: stationPaint(["interpolate", ["linear"], ["zoom"], 8, 2.2, 12, 5, 15, 7]),
  });
  map.addLayer({
    id: "tt-stations-major",
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
  map.addLayer({
    id: "tt-station-labels",
    type: "symbol",
    source: "stations",
    minzoom: 8,
    layout: {
      // Big stations are named a little earlier than small ones.
      "text-field": ["step", ["zoom"], ["case", ["get", "major"], ["get", "name"], ""], 11, ["get", "name"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10.5, 14, 13],
      "text-variable-anchor": ["top", "bottom", "right", "left"],
      "text-radial-offset": 0.8,
      "text-padding": 4,
      "symbol-sort-key": ["case", ["get", "major"], 0, 1],
    },
    paint: { "text-color": colors.stationText, "text-halo-color": colors.halo, "text-halo-width": 1.4 },
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
  const labelText = ["step", ["zoom"],
    ["get", "label"],
    8.5, ["format",
      ["get", "label"], {},
      ["case", [">", ["length", ["get", "subtitle"]], 0], ["concat", "\n", ["get", "subtitle"]], ""],
      { "font-scale": 0.85, "text-font": ["literal", ["Noto Sans Regular"]] }]];
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
    minzoom: 5.5,
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

function stationCollection() {
  const features = [];
  for (const st of state.stations.values()) {
    const shown = st.agencies.filter(agencyShown);
    if (!shown.length) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [st.lon, st.lat] },
      properties: {
        id: st.id,
        name: st.name,
        major: st.major && shown.some((a) => AGENCIES[a].kind === "intercity"),
        color: AGENCIES[shown[0]].color,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function redrawStations() {
  map.getSource("stations")?.setData(stationCollection());
}

// Where to draw a train: its estimated position in live-estimate mode,
// otherwise exactly what the feed reported.
function targetOf(t) {
  return (state.estimate && state.est.get(t.id)) || t;
}

function computeEstimates() {
  state.est.clear();
  if (!state.estimate) return;
  const stationAt = (key) => state.stopPos.get(key);
  const now = Date.now();
  for (const t of state.trains.values()) {
    const e = estimatePosition(t, state.rail, stationAt, now);
    if (e) state.est.set(t.id, e);
  }
}

// Slides markers from where they're drawn to where they should be.
let anim = null;
function animateTo(duration = ANIM_MS, linear = false) {
  const from = new Map(state.display);
  const start = performance.now();
  const targets = new Map([...state.trains.values()].map((t) => [t.id, targetOf(t)]));
  for (const id of [...state.display.keys()]) if (!targets.has(id)) state.display.delete(id);
  cancelAnimationFrame(anim);
  if (document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (const [id, p] of targets) state.display.set(id, { lat: p.lat, lon: p.lon });
    redraw();
    return;
  }
  const step = (now) => {
    const k = Math.min(1, (now - start) / duration);
    const e = linear ? k : k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    for (const [id, p] of targets) {
      const f = from.get(id);
      // Teleport if new or the jump is huge (e.g., a feed glitch).
      if (!f || Math.abs(f.lat - p.lat) + Math.abs(f.lon - p.lon) > 1) state.display.set(id, { lat: p.lat, lon: p.lon });
      else state.display.set(id, { lat: f.lat + (p.lat - f.lat) * e, lon: f.lon + (p.lon - f.lon) * e });
    }
    redraw();
    if (k < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}

function mergeTrains() {
  state.trains = new Map();
  for (const list of Object.values(state.bySource)) for (const t of list) state.trains.set(t.id, t);
  computeEstimates();
  animateTo();
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
  if (state.estimate) setEstimate(true);
  loadStations()
    .then((stations) => {
      state.stations = stations;
      for (const st of stations.values()) for (const m of st.members) state.stopPos.set(m.key, { lat: m.lat, lon: m.lon });
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
let ticks = 0;
setInterval(() => {
  if (document.hidden) return;
  ticks++;
  let moved = false;
  if (ticks % 3 === 0) for (const t of state.trains.values()) moved = advanceEstimated(t) || moved;
  if (state.estimate) {
    computeEstimates();
    animateTo(2000, true);
    if (state.follow && state.selected) {
      const t = state.trains.get(state.selected);
      if (t) map.easeTo({ center: [targetOf(t).lon, targetOf(t).lat], duration: 2000, easing: (x) => x });
    }
    if (state.selected && ticks % 5 === 0) renderDetail();
  } else if (moved) {
    animateTo();
  }
}, 2000);

async function setEstimate(on) {
  state.estimate = on;
  store.set("tt-estimate", on);
  $("estimate-toggle").checked = on;
  if (on && !state.rail) {
    try {
      state.rail = new RailIndex(await (await fetch("data/rail.geojson")).json());
    } catch (err) {
      console.warn("rail index", err); // still estimates, just in straight lines
    }
  }
  computeEstimates();
  animateTo();
  renderAll();
}

$("estimate-toggle").addEventListener("change", (e) => setEstimate(e.target.checked));

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
    ["Position", state.est.get(t.id)
      ? `Estimated now (${state.est.get(t.id).basis})`
      : `${t.estimated ? "Estimated" : "GPS"} · ${fmtAgo(t.updated)}`],
    ["Last report", state.est.get(t.id) ? fmtAgo(t.updated) : null],
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
    </div>
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

function renderAll() {
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
      center: [t.lon, t.lat],
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
    map.flyTo({ center: [st.lon, st.lat], zoom: Math.max(map.getZoom(), 12), padding: panelPadding(), duration: 900 });
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
  $("follow-btn").setAttribute("aria-pressed", String(on));
}

// ---------- Events ----------

const canHover = matchMedia("(hover: hover)").matches;
const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: "hover-card" });

const STATION_LAYERS = ["tt-stations-major", "tt-stations-minor", "tt-station-labels"];

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
      .setLngLat([st.lon, st.lat])
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

$("back-btn").addEventListener("click", closeDetail);
$("train-detail").addEventListener("click", (e) => {
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
$("follow-btn").addEventListener("click", () => {
  setFollow(!state.follow);
  const t = state.trains.get(state.selected);
  if (state.follow && t) map.easeTo({ center: [t.lon, t.lat], padding: panelPadding() });
});

$("search").addEventListener("input", (e) => {
  state.query = e.target.value;
  renderResults();
  if (isPhone && state.query) setSheet("expanded");
});
$("search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("results").querySelector("[data-select]")?.click();
  if (e.key === "Escape") {
    e.target.value = "";
    state.query = "";
    renderResults();
  }
});

$("results").addEventListener("click", (e) => {
  const b = e.target.closest("[data-select]");
  const st = e.target.closest("[data-station]");
  if (b) select(b.dataset.select);
  else if (st) selectStation(st.dataset.station);
});

$("agencies").addEventListener("click", (e) => {
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

$("kind-filter").addEventListener("click", (e) => {
  const b = e.target.closest("[data-kind]");
  if (!b) return;
  state.kind = b.dataset.kind;
  for (const x of $("kind-filter").children) x.setAttribute("aria-selected", String(x === b));
  redraw();
  redrawStations();
  renderAll();
});

$("theme-btn").addEventListener("click", () => {
  theme = theme === "dark" ? "light" : "dark";
  store.set("tt-theme", theme);
  document.documentElement.dataset.theme = theme;
  // diff:false forces a full reload so "style.load" fires and our layers are
  // re-added; a diffed swap silently drops them.
  map.setStyle(STYLES[theme], { diff: false });
});

// Phone bottom sheet: collapsed / normal / expanded.
function setSheet(mode) {
  const p = $("panel");
  p.classList.toggle("collapsed", mode === "collapsed");
  p.classList.toggle("expanded", mode === "expanded");
  document.body.classList.toggle("sheet-collapsed", mode === "collapsed");
  document.body.classList.toggle("sheet-expanded", mode === "expanded");
}
$("sheet-handle").addEventListener("click", () => {
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
window.traintracker = { state, map };

start();
