// Rail geometry for the map: a spatial index over the passenger rail lines,
// snapping train and station positions onto the nearest track, and
// shortest-path routing along the track (so trains placed from the timetable
// and slide animations follow the rails instead of cutting across curves).

const DEG = Math.PI / 180;
export const SNAP_M = 1500;        // how far a train may be from track and still snap to it
const OWN_TRACK_SLACK_M = 150;     // prefer the train's own railroad's track if about as close
const CELL = 0.02;                 // spatial index cell, degrees

function dist(a, b) {
  // Equirectangular is plenty accurate at these distances.
  const x = (b[0] - a[0]) * DEG * Math.cos(((a[1] + b[1]) / 2) * DEG);
  const y = (b[1] - a[1]) * DEG;
  return Math.sqrt(x * x + y * y) * 6371000;
}

function bearing(a, b) {
  const y = Math.sin((b[0] - a[0]) * DEG) * Math.cos(b[1] * DEG);
  const x = Math.cos(a[1] * DEG) * Math.sin(b[1] * DEG) - Math.sin(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.cos((b[0] - a[0]) * DEG);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// A polyline with distances, for placing things part-way along a route.
export class Path {
  constructor(coords) {
    this.coords = coords;
    this.cum = [0];
    for (let i = 1; i < coords.length; i++) this.cum.push(this.cum[i - 1] + dist(coords[i - 1], coords[i]));
    this.length = this.cum[this.cum.length - 1];
  }

  // { point, bearing } at a distance along the path (clamped).
  at(d) {
    const { coords, cum } = this;
    if (coords.length < 2) return { point: coords[0], bearing: null };
    d = Math.max(0, Math.min(this.length, d));
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const t = (d - cum[lo]) / (cum[hi] - cum[lo] || 1);
    const a = coords[lo], b = coords[hi];
    return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearing: bearing(a, b) };
  }
}

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(priority, value) {
    const a = this.items;
    a.push([priority, value]);
    for (let i = a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export class RailIndex {
  constructor(geojson) {
    this.lines = [];
    this.grid = new Map();
    for (const f of geojson.features) {
      const g = f.geometry;
      const parts = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
      for (const coords of parts) {
        if (coords.length < 2) continue;
        const cum = [0];
        for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + dist(coords[i - 1], coords[i]));
        const p = f.properties || {};
        const nets = [p.a, p.b, p.c].filter(Boolean);
        // Hidden pieces (parallel duplicates) carry routes but aren't drawn,
        // so nothing snaps to them.
        const li = this.lines.push({ coords, cum, nets, hidden: !!p.h }) - 1;
        for (let i = 0; i < coords.length - 1; i++) {
          const [x0, y0] = coords[i], [x1, y1] = coords[i + 1];
          for (let gx = Math.floor(Math.min(x0, x1) / CELL); gx <= Math.floor(Math.max(x0, x1) / CELL); gx++) {
            for (let gy = Math.floor(Math.min(y0, y1) / CELL); gy <= Math.floor(Math.max(y0, y1) / CELL); gy++) {
              const k = `${gx}:${gy}`;
              if (!this.grid.has(k)) this.grid.set(k, []);
              this.grid.get(k).push([li, i]);
            }
          }
        }
      }
    }
    this.buildGraph();
  }

  // Lines meet at shared end points (junctions); index them as a graph so
  // trains can be routed along the track instead of in straight lines.
  buildGraph() {
    const nodeKey = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
    this.nodeOf = new Map();
    this.adj = [];
    const node = (p) => {
      const k = nodeKey(p);
      if (!this.nodeOf.has(k)) {
        this.nodeOf.set(k, this.adj.length);
        this.adj.push([]);
      }
      return this.nodeOf.get(k);
    };
    this.lines.forEach((l, li) => {
      l.n0 = node(l.coords[0]);
      l.n1 = node(l.coords[l.coords.length - 1]);
      this.adj[l.n0].push(li);
      if (l.n1 !== l.n0) this.adj[l.n1].push(li);
    });
    this.routeCache = new Map();
  }

  // Points along a line between two distances (either direction), inclusive.
  slice(li, from, to) {
    const { coords, cum } = this.lines[li];
    const out = [this.at(li, from).point];
    if (from <= to) {
      for (let i = 0; i < coords.length; i++) if (cum[i] > from && cum[i] < to) out.push(coords[i]);
    } else {
      for (let i = coords.length - 1; i >= 0; i--) if (cum[i] < from && cum[i] > to) out.push(coords[i]);
    }
    out.push(this.at(li, to).point);
    return out;
  }

  // Shortest path along the track between two snapped points ({ line, along }).
  // Track used by the given network is preferred; other track costs 4x, so a
  // route only borrows it to bridge a gap. Returns a Path, or null if the two
  // points aren't connected within a sensible detour.
  route(a, b, net = null) {
    if (!a || !b) return null;
    const ck = `${a.line}:${Math.round(a.along / 20)}|${b.line}:${Math.round(b.along / 20)}|${net}`;
    if (this.routeCache.has(ck)) return this.routeCache.get(ck);
    const path = this.#route(a, b, net);
    if (this.routeCache.size > 2000) this.routeCache.clear();
    this.routeCache.set(ck, path);
    return path;
  }

  #route(a, b, net) {
    if (a.line === b.line) return new Path(this.slice(a.line, a.along, b.along));
    const La = this.length(a.line), Lb = this.length(b.line);
    const lineB = this.lines[b.line];
    const straight = dist(this.at(a.line, a.along).point, this.at(b.line, b.along).point);
    const maxCost = straight * 3 + 5000;
    const cost = new Map(), prev = new Map(); // node -> cost, node -> [fromNode, line]
    const heap = new MinHeap();
    const push = (n, c, from, line) => {
      if (c < (cost.get(n) ?? Infinity) && c <= maxCost) {
        cost.set(n, c);
        prev.set(n, [from, line]);
        heap.push(c, n);
      }
    };
    const lineA = this.lines[a.line];
    push(lineA.n0, a.along, -1, a.line);
    push(lineA.n1, La - a.along, -1, a.line);
    let best = Infinity, bestEnd = null;
    while (heap.size) {
      const [c, n] = heap.pop();
      if (c > (cost.get(n) ?? Infinity)) continue;
      if (c >= best) break;
      if (n === lineB.n0 && c + b.along < best) { best = c + b.along; bestEnd = n; }
      if (n === lineB.n1 && c + Lb - b.along < best) { best = c + Lb - b.along; bestEnd = n; }
      for (const li of this.adj[n]) {
        if (li === a.line || li === b.line) continue;
        const l = this.lines[li];
        const w = this.length(li) * (!net || l.nets.includes(net) ? 1 : 4);
        push(l.n0 === n ? l.n1 : l.n0, c + w, n, li);
      }
    }
    if (bestEnd == null) return null;
    // Walk back from the end node to the start, collecting lines.
    const legs = [];
    for (let n = bestEnd; ; ) {
      const [from, li] = prev.get(n);
      if (from === -1) break;
      legs.push([li, from, n]);
      n = from;
    }
    legs.reverse();
    const startNode = legs.length ? legs[0][1] : bestEnd;
    const coords = this.slice(a.line, a.along, startNode === lineA.n0 ? 0 : La);
    for (const [li, from] of legs) {
      const l = this.lines[li];
      const seg = from === l.n0 ? l.coords : [...l.coords].reverse();
      coords.push(...seg.slice(1));
    }
    coords.push(...this.slice(b.line, bestEnd === lineB.n0 ? 0 : Lb, b.along).slice(1));
    return new Path(coords);
  }

  // Closest point on the rail network: { line, along (meters), dist, bearing }.
  // With a network id, that railroad's own track wins if it's nearly as close
  // (so an LIRR train at Penn Station doesn't land on the NJ Transit track).
  snap(p, maxM = SNAP_M, net = null) {
    let own = null;
    const gx = Math.floor(p[0] / CELL), gy = Math.floor(p[1] / CELL);
    let best = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [li, i] of this.grid.get(`${gx + dx}:${gy + dy}`) || []) {
          if (this.lines[li].hidden) continue;
          const { coords, cum } = this.lines[li];
          const a = coords[i], b = coords[i + 1];
          // Project in a local flat frame.
          const kx = Math.cos(p[1] * DEG);
          const ax = (b[0] - a[0]) * kx, ay = b[1] - a[1];
          const px = (p[0] - a[0]) * kx, py = p[1] - a[1];
          const len2 = ax * ax + ay * ay;
          const t = len2 ? Math.max(0, Math.min(1, (px * ax + py * ay) / len2)) : 0;
          const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          const d = dist(p, q);
          if (d > maxM) continue;
          const hit = () => ({ line: li, along: cum[i] + (cum[i + 1] - cum[i]) * t, dist: d, bearing: bearing(a, b) });
          if (!best || d < best.dist) best = hit();
          if (net && this.lines[li].nets.includes(net) && (!own || d < own.dist)) own = hit();
        }
      }
    }
    return own && own.dist <= (best?.dist ?? Infinity) + OWN_TRACK_SLACK_M ? own : best;
  }

  // Point and travel bearing at a distance along a line (clamped to its ends).
  at(li, along) {
    const { coords, cum } = this.lines[li];
    along = Math.max(0, Math.min(cum[cum.length - 1], along));
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= along) lo = mid;
      else hi = mid;
    }
    const seg = cum[hi] - cum[lo] || 1;
    const t = (along - cum[lo]) / seg;
    const a = coords[lo], b = coords[hi];
    return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearing: bearing(a, b) };
  }

  length(li) {
    const c = this.lines[li].cum;
    return c[c.length - 1];
  }
}

// The reported position, moved onto the nearest track (no time correction).
export function snapToTrack(t, rail) {
  // Trains placed from the timetable (no GPS) are somewhere between two
  // stations; put them that far along the track between them. Express runs
  // can skip many stops, where a straight line would cut far off the rails.
  if (t.leg && rail) {
    const a = rail.snap(t.leg.from, SNAP_M, t.agency), b = rail.snap(t.leg.to, SNAP_M, t.agency);
    const path = rail.route(a, b, t.agency);
    if (path && path.length > 0) {
      const { point, bearing: br } = path.at(path.length * t.leg.f);
      return { lon: point[0], lat: point[1], bearing: br };
    }
  }
  const s = rail?.snap([t.lon, t.lat], SNAP_M, t.agency);
  if (!s) return null;
  const { point, bearing: b } = rail.at(s.line, s.along);
  // Keep the feed's heading, but line it up with the track it's on.
  const bearingOut = t.bearing == null ? null : angleDiff(b, t.bearing) < 90 ? b : (b + 180) % 360;
  return { lon: point[0], lat: point[1], bearing: bearingOut };
}
