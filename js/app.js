import { AGENCIES, SOURCES, fetchSource, advanceEstimated } from "./sources.js";

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
  selected: null,
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
    ? { text: "#eceef1", halo: "rgba(21,23,27,0.92)", rail: "#8d9ab0", railCommuter: "#66728a", railCasing: "rgba(0,0,0,0.5)" }
    : { text: "#1b1d21", halo: "rgba(255,255,255,0.95)", rail: "#5d6675", railCommuter: "#8d95a3", railCasing: "rgba(255,255,255,0.9)" };
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
    const pos = state.display.get(t.id) || t;
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
        bearing: t.bearing ?? 0,
        hasBearing: t.bearing != null,
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

// Slides markers from where they're drawn to where the feed says they are.
let anim = null;
function animateTo() {
  const from = new Map(state.display);
  const start = performance.now();
  const targets = new Map([...state.trains.values()].map((t) => [t.id, t]));
  for (const id of [...state.display.keys()]) if (!targets.has(id)) state.display.delete(id);
  cancelAnimationFrame(anim);
  if (document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (const t of targets.values()) state.display.set(t.id, { lat: t.lat, lon: t.lon });
    redraw();
    return;
  }
  const step = (now) => {
    const k = Math.min(1, (now - start) / ANIM_MS);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    for (const t of targets.values()) {
      const f = from.get(t.id);
      // Teleport if new or the jump is huge (e.g., a feed glitch).
      if (!f || Math.abs(f.lat - t.lat) + Math.abs(f.lon - t.lon) > 1) state.display.set(t.id, { lat: t.lat, lon: t.lon });
      else state.display.set(t.id, { lat: f.lat + (t.lat - f.lat) * e, lon: f.lon + (t.lon - f.lon) * e });
    }
    redraw();
    if (k < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}

function mergeTrains() {
  state.trains = new Map();
  for (const list of Object.values(state.bySource)) for (const t of list) state.trains.set(t.id, t);
  animateTo();
  renderAll();
  if (state.follow && state.selected) {
    const t = state.trains.get(state.selected);
    if (t) map.easeTo({ center: [t.lon, t.lat], duration: ANIM_MS });
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
  if (RELAY) {
    try {
      const res = await fetch(`${RELAY.replace(/\/$/, "")}/status`);
      state.relayFeeds = (await res.json()).feeds;
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

// Trains placed by timetable keep moving between refreshes.
setInterval(() => {
  if (document.hidden) return;
  let moved = false;
  for (const t of state.trains.values()) moved = advanceEstimated(t) || moved;
  if (moved) animateTo();
}, 5000);

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
  if (!matches.length) {
    el.innerHTML = `<div class="empty">No moving trains match “${esc(state.query)}”.</div>`;
    return;
  }
  el.innerHTML = matches.slice(0, 60).map(({ t }) => {
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
    ["Position", `${t.estimated ? "Estimated" : "GPS"} · ${fmtAgo(t.updated)}`],
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

function renderAll() {
  renderLiveCount();
  renderAgencies();
  renderResults();
  renderCredits();
  if (state.selected) renderDetail();
}

setInterval(renderLiveCount, 5000);

// ---------- Selection ----------

function applySelectionFilter() {
  if (!map.getLayer("tt-halo")) return;
  const id = state.selected || "";
  map.setFilter("tt-halo", ["==", ["get", "id"], id]);
  map.setFilter("tt-label-selected", ["==", ["get", "id"], id]);
  map.setFilter("tt-labels", ["!=", ["get", "id"], id]);
}

function setUrlTrain(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("train", id);
  else url.searchParams.delete("train");
  history.replaceState(null, "", url);
}

function select(id, { fly = true } = {}) {
  state.selected = id;
  setUrlTrain(id);
  applySelectionFilter();
  $("view-list").hidden = !!id;
  $("view-train").hidden = !id;
  delete $("train-detail").dataset.scrollTop;
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

function panelPadding() {
  if (matchMedia("(max-width: 720px)").matches) return { bottom: window.innerHeight * 0.46, top: 0, left: 0, right: 0 };
  return { left: 360, top: 0, bottom: 0, right: 0 };
}

function setFollow(on) {
  state.follow = on;
  $("follow-btn").setAttribute("aria-pressed", String(on));
}

// ---------- Events ----------

map.on("click", "tt-trains", (e) => {
  const f = e.features?.[0];
  if (f) select(f.properties.id);
});

map.on("click", (e) => {
  const hit = map.queryRenderedFeatures(e.point, { layers: ["tt-trains"] });
  if (!hit.length && state.selected && !state.follow) select(null);
});

const canHover = matchMedia("(hover: hover)").matches;
const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: "hover-card" });
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

$("back-btn").addEventListener("click", () => select(null));
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
  if (b) select(b.dataset.select);
});

$("agencies").addEventListener("click", (e) => {
  const toggle = e.target.closest("[data-toggle]");
  const zoom = e.target.closest("[data-zoom]");
  if (toggle) {
    const id = toggle.dataset.toggle;
    state.hidden.has(id) ? state.hidden.delete(id) : state.hidden.add(id);
    store.set("tt-hidden", [...state.hidden]);
    redraw();
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
