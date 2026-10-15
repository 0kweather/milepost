// Which side of the train to sit on: where the sun will be, and which side
// the views are on. The sun's side comes from the train's heading along the
// track and where the sun is at each point it passes (worked out here, no
// data needed). The views come from a short hand-made list of stretches
// (data/views.json): each is a line through the places the track passes,
// and the side its view is on going the way the line is drawn.
//
// The ride arrives as points every few minutes: [{ at (ms), lat, lon, bearing }].

const DEG = Math.PI / 180;
const VIEW_NEAR_M = 3000;          // how close the track must pass to a stretch's line
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

// Spells of sun on one side: [{ side, from, to }] (times in ms). Brief
// spells, and the sun straight ahead or behind, are smoothed over.
export function sunSpells(points) {
  const raw = [];
  for (const p of points) {
    if (p.bearing == null) continue;
    const sun = sunAt(p.at, p.lat, p.lon);
    const side = sun.alt > LOW_SUN ? sideOf(sun.az, p.bearing) : null;
    const last = raw[raw.length - 1];
    if (last && last.side === side) last.to = p.at;
    else raw.push({ side, from: p.at, to: p.at });
  }
  // A short spell joins its neighbours; then neighbours on the same side merge.
  const spells = raw.filter((s) => s.side && s.to - s.from >= MIN_RUN_MS);
  const out = [];
  for (const s of spells) {
    const last = out[out.length - 1];
    if (last && last.side === s.side) last.to = s.to;
    else out.push({ ...s });
  }
  return out;
}

// Distance (m) from a point to a stretch's line, and how far along the line
// its nearest point is, on a flat projection around the point.
function nearLine(p, line) {
  const kx = Math.cos(p.lat * DEG) * 111320, ky = 110540;
  let best = { dist: Infinity, along: 0 }, run = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = [(line[i - 1][0] - p.lon) * kx, (line[i - 1][1] - p.lat) * ky];
    const [bx, by] = [(line[i][0] - p.lon) * kx, (line[i][1] - p.lat) * ky];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, len = Math.sqrt(len2);
    const f = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const dist = Math.hypot(ax + f * dx, ay + f * dy);
    if (dist < best.dist) best = { dist, along: run + f * len };
    run += len;
  }
  return best;
}

// The views this ride passes: [{ name, side, from, to, dark }], in order.
// `dark`: the sun is down for the whole stretch.
export function viewsOnRide(points, views) {
  const out = [];
  for (const v of views || []) {
    const near = points.map((p) => ({ p, ...nearLine(p, v.line) })).filter((x) => x.dist <= VIEW_NEAR_M);
    // Passing over or across it isn't riding along it.
    if (near.length < 2 || Math.abs(near[near.length - 1].along - near[0].along) < 5000) continue;
    const forward = near[near.length - 1].along > near[0].along;
    const dark = near.every((x) => sunAt(x.p.at, x.p.lat, x.p.lon).alt < -4);
    out.push({ name: v.name, note: v.note || "", side: forward ? v.side : other(v.side), from: near[0].p.at, to: near[near.length - 1].p.at, dark });
  }
  return out.sort((a, b) => a.from - b.from);
}
