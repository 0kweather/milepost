// Which side of the train to sit on: where the sun will be, and which side
// the views are on. The sun's side comes from the train's heading along the
// track and where the sun is at each point it passes (worked out here, no
// data needed). The views come from a list of stretches (data/views.json,
// built by scripts/build_views.py): each is a line along the track, and
// either the side its view is on going the way the line is drawn, or what
// the view is of ("toward": a point, like a skyline, or a line, like a
// river's middle), from which the side is worked out at each point passed.
//
// The ride arrives as points every few minutes: [{ at (ms), lat, lon, bearing }].

const DEG = Math.PI / 180;
const VIEW_NEAR_M = 3000;          // how close the track must pass to a stretch's line
const VIEW_MIN_KM = 5;             // how far along a stretch a ride must go, unless it says
const LOW_SUN = 2;                 // degrees: below this the sun doesn't come in the windows
const MIN_RUN_MS = 12 * 60 * 1000; // shorter spells of sun on one side are left out

// The sun's direction (degrees clockwise from north) and height above the
// horizon (degrees). Within a fraction of a degree, plenty for which side
// of a train it's on.
export function sunAt(ms, lat, lon) {
  const d = ms / 86400000 - 10957.5; // days since noon, Jan 1 2000 (UTC)
  const g = (357.529 + 0.98560028 * d) * DEG;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const e = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = 280.46061837 + 360.98564736629 * d;
  const H = (gmst + lon) * DEG - ra;
  const phi = lat * DEG;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { az: (az / DEG + 360) % 360, alt: alt / DEG };
}

// Which side something in direction `toward` is on, for a train heading
// `heading`: "left", "right", or null when it's nearly ahead or behind.
function sideOf(toward, heading) {
  const rel = (((toward - heading) % 360) + 360) % 360;
  if (rel > 20 && rel < 160) return "right";
  if (rel > 200 && rel < 340) return "left";
  return null;
}
const other = (side) => (side === "left" ? "right" : "left");

// Where the sun is over a ride, as spells: [{ place, from, to }] (times in
// ms), place being "left" or "right", "ahead" or "behind" (in the
// windshield or behind the train: neither side gets it), or "down" (below
// the horizon, or too low to come in the windows). Every ride gets an
// answer, even a short one: spells briefer than a quarter of the ride (12
// minutes at most) are smoothed over, and if that leaves nothing, the
// longest spell stands.
function placeOf(toward, heading) {
  const rel = (((toward - heading) % 360) + 360) % 360;
  if (rel <= 20 || rel >= 340) return "ahead";
  if (rel >= 160 && rel <= 200) return "behind";
  return rel < 180 ? "right" : "left";
}
export function sunSpells(points) {
  const raw = [];
  for (const p of points) {
    if (p.bearing == null) continue;
    const sun = sunAt(p.at, p.lat, p.lon);
    const place = sun.alt > LOW_SUN ? placeOf(sun.az, p.bearing) : "down";
    const last = raw[raw.length - 1];
    if (last && last.place === place) last.to = p.at;
    else {
      if (last) last.to = p.at; // a spell lasts until the next one starts
      raw.push({ place, from: p.at, to: p.at });
    }
  }
  if (!raw.length) return [];
  const span = raw[raw.length - 1].to - raw[0].from;
  const minRun = Math.min(MIN_RUN_MS, span / 4);
  let kept = raw.filter((s) => s.to - s.from >= minRun);
  if (!kept.length) kept = [raw.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a))];
  // Neighbours in the same place merge, and the gaps left by dropped
  // spells close up.
  const out = [];
  for (const s of kept) {
    const last = out[out.length - 1];
    if (last && last.place === s.place) last.to = s.to;
    else out.push({ ...s });
  }
  out[0].from = raw[0].from;
  out[out.length - 1].to = raw[raw.length - 1].to;
  for (let i = 1; i < out.length; i++) out[i].from = out[i - 1].to;
  return out;
}

// Distance (m) from a point to a line (or a single point), how far along
// the line its nearest point is, and the direction to that nearest point
// (degrees clockwise from north), on a flat projection around the point.
function nearLine(p, line) {
  const kx = Math.cos(p.lat * DEG) * 111320, ky = 110540;
  const toward = (x, y) => ((Math.atan2(x, y) / DEG) + 360) % 360;
  if (line.length === 1) {
    const x = (line[0][0] - p.lon) * kx, y = (line[0][1] - p.lat) * ky;
    return { dist: Math.hypot(x, y), along: 0, dir: toward(x, y) };
  }
  let best = { dist: Infinity, along: 0, dir: 0 }, run = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = [(line[i - 1][0] - p.lon) * kx, (line[i - 1][1] - p.lat) * ky];
    const [bx, by] = [(line[i][0] - p.lon) * kx, (line[i][1] - p.lat) * ky];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, len = Math.sqrt(len2);
    const f = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const x = ax + f * dx, y = ay + f * dy, dist = Math.hypot(x, y);
    if (dist < best.dist) best = { dist, along: run + f * len, dir: toward(x, y) };
    run += len;
  }
  return best;
}

// Each stretch's bounding box, padded by how near the track must pass, so
// most of a long ride's points are ruled out without measuring.
const boxes = new WeakMap();
function boxOf(v) {
  if (!boxes.has(v)) {
    const lons = v.line.map((c) => c[0]), lats = v.line.map((c) => c[1]);
    const pad = (v.near || VIEW_NEAR_M) / 110000;
    const mid = (Math.min(...lats) + Math.max(...lats)) / 2;
    boxes.set(v, { w: Math.min(...lons) - pad / Math.cos(mid * DEG), e: Math.max(...lons) + pad / Math.cos(mid * DEG), s: Math.min(...lats) - pad, n: Math.max(...lats) + pad });
  }
  return boxes.get(v);
}

// The views this ride passes: [{ name, side, from, to, dark }], in order.
// `dark`: the sun is down for the whole stretch.
// A view "toward" something is on whichever side it's on at each point
// passed, so a ride that curves around it (a mountain, a bay) gets a spell
// on each side; brief spells (under five minutes) join their neighbours.
// "reach" (km) leaves out points too far from it to see. Skylines say
// "night": lit up, they're still worth the seat after dark.
const BRIEF_MS = 5 * 60 * 1000;
export function viewsOnRide(points, views) {
  const out = [];
  const darkAt = (x) => sunAt(x.p.at, x.p.lat, x.p.lon).alt < -4;
  for (const v of views || []) {
    const b = boxOf(v);
    const near = points.filter((p) => p.lon >= b.w && p.lon <= b.e && p.lat >= b.s && p.lat <= b.n)
      .map((p) => ({ p, ...nearLine(p, v.line) })).filter((x) => x.dist <= (v.near || VIEW_NEAR_M));
    // Passing over or across it isn't riding along it.
    if (near.length < 2 || Math.abs(near[near.length - 1].along - near[0].along) < (v.minKm ?? VIEW_MIN_KM) * 1000) continue;
    if (!v.toward) {
      const side = near[near.length - 1].along > near[0].along ? v.side : other(v.side);
      out.push({ name: v.name, note: v.note || "", side, from: near[0].p.at, to: near[near.length - 1].p.at, dark: !v.night && near.every(darkAt) });
      continue;
    }
    let runs = [];
    for (const x of near) {
      const t = nearLine(x.p, v.toward);
      const side = x.p.bearing == null || (v.reach && t.dist > v.reach * 1000) ? null : sideOf(t.dir, x.p.bearing);
      if (!side) continue;
      const last = runs[runs.length - 1];
      if (last && last.side === side) { last.to = x.p.at; last.pts.push(x); }
      else runs.push({ side, from: x.p.at, to: x.p.at, pts: [x] });
    }
    if (!runs.length) continue;
    const long = runs.filter((r) => r.to - r.from >= BRIEF_MS);
    runs = long.length ? long : [runs.reduce((a, r) => (r.pts.length > a.pts.length ? r : a))];
    const merged = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && last.side === r.side) { last.to = r.to; last.pts.push(...r.pts); }
      else merged.push({ ...r, pts: [...r.pts] });
    }
    for (const r of merged) out.push({ name: v.name, note: v.note || "", side: r.side, from: r.from, to: r.to, dark: !v.night && r.pts.every(darkAt) });
  }
  // A view listed as two stretches (two approaches to a city, say) reads
  // as one when the ride passes them back to back on the same side.
  out.sort((a, b) => a.from - b.from);
  const joined = [];
  for (const v of out) {
    const same = joined.find((w) => w.name.startsWith(v.name) || v.name.startsWith(w.name));
    if (same && same.side === v.side && v.from <= same.to + 10 * 60 * 1000) {
      same.to = Math.max(same.to, v.to);
      same.dark = same.dark && v.dark;
      if (v.name.length > same.name.length) same.name = v.name;
    } else joined.push({ ...v });
  }
  return joined;
}
