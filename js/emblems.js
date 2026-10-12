// Railroad logos on the drawings, placed and sized as on the real equipment.
// The logo files (img/logos/) are the railroads' own logos as published on
// Wikimedia Commons (public domain), cleaned of everything but their
// drawing; the "-white" versions, for dark paint, are the same with every
// color set to white.
//
// Drawings are in feet with y up; a logo is drawn in a y-down box centered
// on its spot, h feet tall. A car drawn mirrored (the back half of a married
// pair, a cab car at the rear) passes c.mirrored so the logo still reads
// left to right.

// key: [width / height, has a white version]
const LOGOS = {
  amtrak: [9.34, true], "amtrak-mark": [2.36, true], "amtrak-word": [11.41, true],
  acela: [2.52, true], via: [2.25, true], "via-mark": [3.64, true], brightline: [4.07, true], mta: [0.91, false], mbta: [1, false],
  njt: [4.44, true], "njt-word": [4.98, true], septa: [1, true], "septa-word": [3.98, false],
  "mta-inverse": [0.91, false], metra: [3.68, true], caltrain: [1.77, false],
  metrolink: [7.75, true], rtd: [2.2, false], capmetro: [4.14, false], trirail: [4.4, false],
  smart: [3.31, false], frontrunner: [12.85, true],
};
const BY_AGENCY = { lirr: "mta", mnr: "mta" };

const n = (v) => Math.round(v * 1000) / 1000;
function image(key, x, y, h, dark) {
  if (!LOGOS[key]) return "";
  const [aspect, white] = LOGOS[key];
  const w = h * aspect;
  const file = `${key}${dark && white ? "-white" : ""}.svg`;
  return `<image href="img/logos/${file}?v=dev" x="${n(x - w / 2)}" y="${n(y - h / 2)}" width="${n(w)}" height="${n(h)}"/>`;
}

// The logo a railroad's equipment carries, or null.
export function logoOf(c) {
  const key = BY_AGENCY[c.agency] || c.agency || "amtrak";
  return LOGOS[key] ? key : null;
}

// How wide a logo of height h is, in feet (0 if the railroad has none).
export const logoWidth = (c, h, key = logoOf(c)) => (key === "amtrak-stack" ? h * 1.25 : key ? LOGOS[key][0] * h : 0);

// The railroad's logo centered at (x, y), h feet tall.
//   dark: it sits on dark paint (white version where there is one);
//   logo: a particular logo instead of the railroad's usual one, or
//     "amtrak-stack" for the wordmark over the travelmark (Phase VII
//     locomotives);
//   skip: agencies to leave out.
export function badge(c, x, y, h, { dark = false, logo = null, skip = [] } = {}) {
  const key = logo || logoOf(c);
  if (!key || skip.includes(c.agency)) return "";
  const body = key === "amtrak-stack"
    ? image("amtrak-word", 0, -h * 0.36, h * 0.2, dark) + image("amtrak-mark", 0, h * 0.14, h * 0.62, dark)
    : image(key, 0, 0, h, dark);
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${c.mirrored ? -1 : 1} -1)">${body}</g>`;
}

// Where a car's logo goes, from its window rows and doors: the tallest clear
// band of side (below the windows, between rows, or above them), at x (or
// as near it as the doors allow). rows: [[y, h], ...]; doors: [[x0, x1, y0,
// y1]]; returns { x, y, h } or null.
export function spotOnCar(c, { x, sill, top, rows, doors = [], maxH = 1.3, minH = 0.8, logo = null }) {
  const spans = rows.map(([y, h]) => [y, y + h]).sort((a, b) => a[0] - b[0]);
  const bands = [];
  if (!spans.length) bands.push([sill, top]);
  else {
    bands.push([sill, spans[0][0]]);
    for (let i = 1; i < spans.length; i++) {
      const reach = Math.max(...spans.slice(0, i).map((s) => s[1]));
      if (spans[i][0] > reach) bands.push([reach, spans[i][0]]);
    }
    bands.push([Math.max(...spans.map((s) => s[1])), top]);
  }
  let best = null;
  for (const [a, b] of bands) {
    const h = Math.min(maxH, (b - a) * 0.7);
    if (h >= minH && (!best || h > best.h)) best = { y: (a + b) / 2, h, a, b };
  }
  if (!best) return null;
  // A wide logo shrinks to fit between the doors rather than wander off.
  const w = (h) => logoWidth(c, h, logo || logoOf(c)) + 0.6;
  const blocked = doors.filter(([, , y0, y1]) => y0 < best.b && y1 > best.a).map(([a, b]) => [a, b]);
  const clear = (cx, h) => cx - w(h) / 2 > 1 && cx + w(h) / 2 < c.L - 1 && blocked.every(([a, b]) => cx + w(h) / 2 <= a || cx - w(h) / 2 >= b);
  for (let h = best.h; h >= minH * 0.8; h -= 0.2) {
    for (let step = 0; step < 60; step++) {
      for (const cx of [x + step * 0.5, x - step * 0.5]) if (clear(cx, h)) return { x: cx, y: best.y, h };
    }
  }
  return null;
}
