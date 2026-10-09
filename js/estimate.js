// "Estimate live location": moves each train from where its feed last saw it
// to where it most likely is now.
//
// Feeds report positions anywhere from seconds to ~10 minutes late (Amtrak's
// GPS updates are the slowest). For each train we pick the best evidence:
//
//  1. Predicted arrival at the next station (Amtrak, VIA, Brightline, LIRR,
//     Metro-North): the train must cover the distance from its last fix to
//     that station by the predicted time, so slide it that fraction of the way.
//  2. Speed and heading (most GPS feeds): dead-reckon forward for the time
//     since the fix, slowing the assumed speed the longer we extrapolate.
//
// Either way the train moves along the actual track (USDOT rail lines) rather
// than in a straight line, and it never runs past the next station it's due at.

const DEG = Math.PI / 180;
const MAX_EXTRAPOLATE_S = 15 * 60; // older fixes are left where they are
const SNAP_M = 400;                // how far a fix may be from track to snap
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
        const li = this.lines.push({ coords, cum }) - 1;
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
  }

  // Closest point on any rail line: { line, along (meters), dist, bearing }.
  snap(p, maxM = SNAP_M) {
    const gx = Math.floor(p[0] / CELL), gy = Math.floor(p[1] / CELL);
    let best = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [li, i] of this.grid.get(`${gx + dx}:${gy + dy}`) || []) {
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
          if (d <= maxM && (!best || d < best.dist)) {
            best = { line: li, along: cum[i] + (cum[i + 1] - cum[i]) * t, dist: d, bearing: bearing(a, b) };
          }
        }
      }
    }
    return best;
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

function onTrack(rail, p) {
  const snap = rail?.snap(p);
  return snap ? rail.at(snap.line, snap.along).point : p;
}

function lerp(a, b, f) {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

// Returns { lat, lon, bearing, basis } for "now", or null to leave the train
// at its reported position.
export function estimatePosition(t, rail, stationAt, now = Date.now()) {
  if (t.estimated) return null; // already placed from the timetable
  const age = (now - t.updated) / 1000;
  if (!(age > 5) || age > MAX_EXTRAPOLATE_S) return null;
  const from = [t.lon, t.lat];
  const fromSnap = rail?.snap(from);

  // Next station the train is due at, if its feed lists stops with times.
  let next = null;
  if (t.stops?.length) {
    // Stopped at (or creeping into) its next station: it's dwelling, leave it.
    const upcoming = t.stops.find((s) => s.status !== "past" && stationAt(s.key));
    if (upcoming && (t.speedMph || 0) < 5) {
      const p = stationAt(upcoming.key);
      if (dist(from, [p.lon, p.lat]) < 1500) return null;
    }
    for (const s of t.stops) {
      if (s.status === "past") continue;
      const time = Date.parse(s.time);
      const pos = stationAt(s.key);
      if (!pos || Number.isNaN(time)) continue;
      if (time > t.updated - 60000) {
        next = { time, pos: [pos.lon, pos.lat], name: s.name };
        break;
      }
    }
  }

  // Never assume the train went faster than it plausibly could: a bit over its
  // reported speed, but at least 60 mph (it may have just left a station).
  const capMeters = age * Math.max(27, ((t.speedMph || 0) / 2.23694) * 1.3);

  if (next) {
    const total = next.time - t.updated;
    let f = total <= 0 ? 1 : Math.max(0, Math.min(1, (now - t.updated) / total));
    const toSnap = rail?.snap(next.pos, 800);
    // A station hundreds of km away with a fix only minutes old means the stop
    // list is off; don't trust it.
    if (dist(from, next.pos) / Math.max(60, total / 1000) < 75) { // under ~170 mph
      const span = fromSnap && toSnap && fromSnap.line === toSnap.line
        ? Math.abs(toSnap.along - fromSnap.along) : dist(from, next.pos);
      if (span * f > capMeters) f = capMeters / span;
      if (fromSnap && toSnap && fromSnap.line === toSnap.line) {
        const { point, bearing: b } = rail.at(fromSnap.line, fromSnap.along + (toSnap.along - fromSnap.along) * f);
        return {
          lon: point[0], lat: point[1],
          bearing: toSnap.along >= fromSnap.along ? b : (b + 180) % 360,
          basis: `due at ${next.name} ${f >= 1 ? "now" : "soon"}`,
        };
      }
      // Different track pieces (a junction in between): go straight, then
      // settle onto the nearest track.
      const p = onTrack(rail, lerp(from, next.pos, f));
      return { lon: p[0], lat: p[1], bearing: bearing(from, next.pos), basis: `due at ${next.name}` };
    }
  }

  // Dead reckoning from speed and heading.
  const mps = (t.speedMph || 0) / 2.23694;
  if (mps < 1 || t.bearing == null) return null;
  // Assume the train keeps its speed for a couple of minutes, then hedge
  // (it may stop at a station or slow down), so long gaps don't fling it far.
  const effective = age <= 120 ? age : 120 + (age - 120) * 0.5;
  const meters = Math.min(mps * effective, capMeters);
  if (fromSnap) {
    const forward = angleDiff(fromSnap.bearing, t.bearing) < 90;
    const along = fromSnap.along + (forward ? meters : -meters);
    const { point, bearing: b } = rail.at(fromSnap.line, along);
    return { lon: point[0], lat: point[1], bearing: forward ? b : (b + 180) % 360, basis: "speed and heading" };
  }
  const R = 6371000;
  const lat = t.lat + ((meters * Math.cos(t.bearing * DEG)) / R) / DEG;
  const lon = t.lon + ((meters * Math.sin(t.bearing * DEG)) / (R * Math.cos(t.lat * DEG))) / DEG;
  const [x, y] = onTrack(rail, [lon, lat]);
  return { lat: y, lon: x, bearing: t.bearing, basis: "speed and heading" };
}
