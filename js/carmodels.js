// Each model's drawing, in feet (see carart.js): x from the left coupler face,
// y up from the top of the rail. ctx: { L, agency, color, lead, cabL, cabR,
// coupledL, coupledR, pan }. A model draws its cab on the left; the caller
// mirrors single-cab equipment that runs at the back of a train.

import {
  C, lines, slats, rect, circle, path, line, poly, win, door, windowRow, truck, pantograph, coupledEnd,
  bodyOutline, stripes, flutes, underframe,
} from "./carart.js?v=dev";
import { badge, spotOnCar } from "./emblems.js?v=dev";

let clipSeq = 0;

// The railroad's logo on a car side, where the real one is (see
// js/emblems.js). spec.badge: the spots, each { x, y, h, dark, logo } (one,
// a list, or a function of the car giving either), or false/null for a car
// with no logo on its side. Without one it goes in the clearest band of side
// near the middle of the car, clear of the doors. spec.badgeDark: it sits on
// dark paint (a boolean, or a function of the car); spec.badgeLogo: which
// logo goes there (or a function of the car) when not the railroad's own.
function spots(c, b) {
  return [].concat(typeof b === "function" ? b(c) : b).filter(Boolean);
}
function carBadge(c, spec, { rows, doors, sill, top }) {
  const dark = typeof spec.badgeDark === "function" ? spec.badgeDark(c) : !!spec.badgeDark;
  const b = typeof spec.badge === "function" ? spec.badge(c) : spec.badge;
  if (b === false || b === null) return "";
  if (b) return spots(c, b).map((o) => badge(c, o.x, o.y, o.h, { dark: o.dark ?? dark, logo: o.logo, skip: o.skip })).join("");
  const lo = c.cabL && spec.cabLen ? (spec.end ?? 0.7) + spec.cabLen + 2 : 0;
  const x = Math.max(lo + 4, c.agency === "amtrak" || c.agency === "via" ? c.L * 0.3 : c.L / 2);
  const near = rows.filter(([y, h, xs]) => !xs || xs.some(([a, b]) => b > x - 12 && a < x + 12));
  const logo = (typeof spec.badgeLogo === "function" ? spec.badgeLogo(c) : spec.badgeLogo) || null;
  const spot = spotOnCar(c, { x, sill, top: top(x), rows: near.map(([y, h]) => [y, h]), doors, logo });
  return spot ? badge(c, spot.x, spot.y, spot.h, { dark, logo }) : "";
}
// Clips livery to the body outline so stripes and swooshes can be drawn freely,
// then shades it for a little depth: darker toward the sill, a soft highlight
// along the upper side where it catches the light, the roof edge turning away.
// The bands follow the outline's own height, so every body shades alike.
function clipped(outline, inner) {
  const id = `ts-clip-${++clipSeq}`;
  const ys = outline.match(/-?\d+(\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 1);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  // Soft light from above: a shadow low on the side fading out by a third of
  // the way up, a faint highlight toward the top, a slight shadow where the
  // roof turns away. The strengths come from the page's theme (style.css).
  const stop = (o, color, v, fallback) => `<stop offset="${o}" stop-color="${color}" stop-opacity="${fallback}" style="stop-opacity:var(${v},${fallback})"/>`;
  const shade = `<linearGradient id="${id}-s" gradientUnits="userSpaceOnUse" x1="0" y1="${lo}" x2="0" y2="${hi}">` +
    stop(0, "#000", "--car-shade-low", 0.16) + '<stop offset="0.36" stop-color="#000" stop-opacity="0"/>' +
    '<stop offset="0.55" stop-color="#fff" stop-opacity="0"/>' + stop(0.8, "#fff", "--car-shade-high", 0.1) +
    '<stop offset="0.93" stop-color="#fff" stop-opacity="0"/>' + stop(1, "#000", "--car-shade-roof", 0.08) + '</linearGradient>';
  return `<clipPath id="${id}"><path d="${outline}"/></clipPath><defs>${shade}</defs>` +
    `<g clip-path="url(#${id})">${inner}<rect x="-5" y="${lo}" width="200" height="${hi - lo}" fill="url(#${id}-s)"/></g>`;
}
const outlineOf = (d, px = 0.8) => path(d, "none", px);


// The ends of a passenger car: diaphragm/coupler between cars; a plain end
// sill and coupler at the end of the train.
function carEnds(c, { floor = 4, top = 11.4 } = {}) {
  let s = "";
  if (c.coupledL) s += coupledEnd(0, -1, { floor, top });
  if (c.coupledR) s += coupledEnd(c.L, 1, { floor, top });
  return s;
}

// Married pairs: the first car of each pair faces forward with its cab on the
// left; its mate is drawn mirrored, so the two cabs sit at the pair's outer
// ends and pairs meet cab to cab, as they run.
// Single cars (pair 2) have a cab at each end.
const married = (draw) => (c) => {
  if (c.pair === 2) return draw({ ...c, cabL: true, cabR: true, single: true });
  if (!c.pair) return draw({ ...c, cabL: true, cabR: false });
  const m = { ...c, cabL: true, cabR: false, lead: false, mate: true, mirrored: !c.mirrored, coupledL: c.coupledR, coupledR: c.coupledL };
  return `<g transform="matrix(-1 0 0 1 ${c.L} 0)">${draw(m)}</g>`;
};

// A locomotive's pilot (plow) under its front end. fx: the front-most point of
// the body, which the plow sits flush with; it rakes back toward the rail.
// end = L draws the one at the far end of a double-ended locomotive.
function pilot(fx, sill, end = null) {
  const X = (v) => (end == null ? fx + v : end - fx - v);
  return path(poly([[X(0), sill + 0.05], [X(3.6), sill + 0.05], [X(3.1), 3.0], [X(2.5), 0.55], [X(0.8), 0.55], [X(0), 2.3]]), C.black);
}

// ===================== Amtrak =====================

// Amtrak Midwest routes (Illinois, Michigan, Missouri, Wisconsin): Chargers
// in the Midwest livery.
const MIDWEST_ROUTES = new Set(["Wolverine", "Blue Water", "Pere Marquette", "Hiawatha", "Lincoln Service", "Lincoln River Runner",
  "Missouri River Runner", "Carl Sandburg", "Illinois Zephyr", "Illini", "Saluki", "Borealis"]);
const AMTRAK = {
  blue: "#22579f",      // Phase VI mid-tone blue
  red: "#c8102e",
  platinum: "#c9cdd2",  // locomotive light gray
  roofBlue: "#1f4a86",
  navy: "#16305a",      // Phase VII dark blue
  sky: "#2c66b0",       // Phase VII light blue
};

// Other railroads' colors used across several models.
const MBTA = { purple: "#80276c", yellow: "#f2c230", silver: "#c8ccd1", roof: "#4f545a", black: "#1d1f22" };
const LIRR = { blue: "#1c3f94", yellow: "#f5c400" };
const MNR_BLUE = "#2352b0";
// GO Transit: the upper-level and hood green, the lime band, the dark gray
// skirt; the older locomotive scheme's green and cream.
const GO = { green: "#56963a", lime: "#8cc63f", skirt: "#383c42", teal: "#1f9a70", cream: "#f1eedc" };
// Lettering on a GO car side, h ft tall, reading left to right even on a
// mirrored car.
const goLetters = (c, x, y, h, text, fill, { weight = 600, spacing = 0 } = {}) =>
  `<text transform="translate(${x} ${y}) scale(${c.mirrored ? -1 : 1} -1)" y="${(h * 0.36).toFixed(2)}" font-size="${h}" text-anchor="middle" font-weight="${weight}" ` +
  `letter-spacing="${spacing}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" fill="${fill}">${text}</text>`;
// MARC: a blue band over an orange stripe on silver or stainless; the
// Chargers' blue is a deeper indigo.
const MARC = { blue: "#2b4fae", indigo: "#363c8e", orange: "#f26f21", silver: "#c4c8cd" };
// CT Rail (CTDOT): its locomotives black and red, the CTrail mark blown up
// on the side; the coaches stainless with the old New Haven's red NH.
const CTRAIL = { red: "#e3262b", black: "#1c1d20", nh: "#e0392e", band: "#2e3134" };
// South Shore Line (NICTD): stainless, an orange band edged in maroon; the
// maroon and orange of its old sign-shaped emblem.
const NICTD = { orange: "#e8661f", maroon: "#6e1a22" };
// SunRail: white, a rising sun in two yellows, orange swooshes, a sky-blue
// horizon over dark green land; its cab cars' ends a greenish yellow.
const SUNRAIL = { yellow: "#f5bd1a", gold: "#f9d860", orange: "#f08422", sky: "#a6c8ec", green: "#2c6553", cab: "#e3d02a" };
// The CTrail mark across a locomotive's side, from xa to xb between y0 and
// y1, the cab to the left: a lens of white toward the cab and one of red
// toward the rear, crossed by a black X (a broad stroke leaning back, a
// narrow one nearly upright), on the red forward paint and the black rear.
function ctMark(xa, xb, y0, y1) {
  const id = `ts-clip-${++clipSeq}`;
  const X = (u) => xa + u * (xb - xa), Y = (v) => y1 - v * (y1 - y0);
  const P = (u, v) => `${X(u).toFixed(2)} ${Y(v).toFixed(2)}`;
  const outline = `M${P(0.26, 0)}Q${P(-0.16, 0.5)} ${P(0.06, 1)}L${P(0.55, 1)}Q${P(1.42, 0.5)} ${P(0.62, 0)}Z`;
  // Stroke center lines: u at v (0 top, 1 bottom).
  const s1 = (v) => 0.68 - 0.53 * v, s2 = (v) => 0.31 + 0.08 * v;
  const band = (f, w) => `M${P(f(-0.1) - w, -0.1)}L${P(f(-0.1) + w, -0.1)}L${P(f(1.1) + w, 1.1)}L${P(f(1.1) - w, 1.1)}Z`;
  const red = `M${P(0.36, 0.61)}L${P(s1(-0.1), -0.1)}L${P(1.6, -0.1)}L${P(1.6, 1.1)}L${P(s2(1.1), 1.1)}Z`;
  return `<clipPath id="${id}"><path d="${outline}"/></clipPath><g clip-path="url(#${id})">` +
    rect(xa - 1, y0 - 1, xb - xa + 2, y1 - y0 + 2, "#f4f5f6") + path(red, CTRAIL.red) +
    path(band(s1, 0.05), CTRAIL.black) + path(band(s2, 0.03), CTRAIL.black) + "</g>";
}
// Reflective tape along a locomotive's frame: short yellow and white dashes.
function ctDashes(a, b, y) {
  let s = "";
  for (let x = a, k = 0; x < b - 0.6; x += 1.3, k++) s += rect(x, y, 0.62, 0.3, k % 2 ? "#eef0f2" : "#f2c400");
  return s;
}
// The Maryland flag MARC carries high on its equipment, w feet wide, centered
// at (x, y): Calvert quarters (gold and black pales) and Crossland quarters
// (red and white), too small to show the crosses.
function mdFlag(x, y, w) {
  const h = (w * 2) / 3, qw = w / 2, qh = h / 2, x0 = x - qw, y0 = y - qh;
  let s = "";
  for (const [qx, qy, calvert] of [[0, 1, true], [1, 1, false], [0, 0, false], [1, 0, true]]) {
    const ax = x0 + qx * qw, ay = y0 + qy * qh;
    if (calvert) {
      s += rect(ax, ay, qw, qh, "#f2b51c");
      for (let k = 1; k < 6; k += 2) s += rect(ax + (k * qw) / 6, ay, qw / 6, qh, "#1d1f22");
    } else {
      s += rect(ax, ay, qw, qh, "#ffffff") + rect(ax, ay + qh / 2, qw / 2, qh / 2, "#c8102e") + rect(ax + qw / 2, ay, qw / 2, qh / 2, "#c8102e");
    }
  }
  return s;
}

// A smooth curve through points (Catmull-Rom, as cubic Béziers), as path
// data starting with its first point.
function smoothPath(pts) {
  const f = (v) => Math.round(v * 100) / 100;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}
// A shape between two smooth edges, each given left to right: top, then
// bottom (they may share their end points, for a tapering swoosh).
const smoothBlob = (top, bottom, fill) => path(`${smoothPath(top)}L${smoothPath([...bottom].reverse()).slice(1)}Z`, fill);

// VRE (Virginia Railway Express). VRE's developer terms forbid using its
// logo without written permission, so none is drawn: no red diamond, and no
// "VRE" or "VIRGINIA RAILWAY EXPRESS" lettering; only the paint and stripes.
const VRE = { blue: "#2c4688", navy: "#202c5e", red: "#d3313d", silver: "#cdd0d5", orange: "#f26a21" };
// Sounder (Sound Transit): white over a wave of aqua and sea green breaking
// along the side, Sound Transit blue below.
const SOUNDER = { white: "#eeede8", aqua: "#4cbfcf", teal: "#3d9597", blue: "#25509b" };
// The wave: [x, top of the aqua, of the green, of the blue], left to right
// past both ends; the blue runs down to the bottom.
function sounderWave(L, pts) {
  let s = rect(0, 0, L, 18, SOUNDER.white);
  [SOUNDER.aqua, SOUNDER.teal, SOUNDER.blue].forEach((col, k) => {
    s += path(`${smoothPath(pts.map((p) => [p[0], p[k + 1]]))}L${L + 2} -1L-2 -1Z`, col);
  });
  return s;
}
// New Mexico Rail Runner Express: light gray, red and yellow.
const RR = { body: "#e1e4e8", red: "#c9202f", yellow: "#f5a81c" };

// --- Siemens ACS-64: 66 ft 8 in over couplers, 12 ft 6 in to the roof,
// trucks 9.9 m apart on 44 in wheels. A raked cab at each end; gray body,
// blue roof sweeping down over the cab, red sill stripe.
export function acs64(c) {
  const { L } = c, sill = 4.0, roof = 12.5;
  const rx = (v) => L - v;
  const pts = [[2.4, sill], [L - 2.4, sill], [rx(1.55), 5.0], [rx(1.3), 6.6], [rx(1.6), 8.6], [rx(2.1), 9.4], [rx(4.6), 11.9], ["q", rx(5.2), roof, rx(6.3), roof],
    [6.3, roof], ["q", 5.2, roof, 4.6, 11.9], [2.1, 9.4], [1.6, 8.6], [1.3, 6.6], [1.55, 5.0]];
  const d = poly(pts);
  const amtrak = c.agency !== "septa";
  const bodyColor = amtrak ? AMTRAK.platinum : "#c3c8ce";
  let s = "";
  // Pilots, couplers and underframe.
  s += pilot(1.3, sill) + pilot(1.3, sill, L);
  s += rect(22, 2.1, L - 44, sill - 2.1, "currentColor", 0, 'opacity="0.8" rx="0.2"');
  s += rect(26, 1.6, 6, 0.6, "currentColor", 0, 'opacity="0.65"');
  s += truck(L / 2 - 16.25, { wb: 9.2, d: 44, kind: "loco", top: sill }) + truck(L / 2 + 16.25, { wb: 9.2, d: 44, kind: "loco", top: sill });
  // Body and livery.
  let liv = rect(0, 0, L, roof + 1, bodyColor);
  liv += rect(0, roof - 0.62, L, 1, amtrak ? AMTRAK.roofBlue : "#2a5aa0");
  for (const [x, dir] of [[0, 1], [L, -1]]) {
    const X = (v) => x + dir * v;
    // Blue over the cab, sweeping back to the roof line; red edge beneath.
    const sweep = [[X(0), 9.0], [X(6.0), 9.15], ["q", X(10.5), 9.4, X(15.5), roof - 0.62], [X(0), roof + 1]];
    liv += path(poly(sweep), amtrak ? AMTRAK.roofBlue : "#2a5aa0");
    liv += path(`M${X(0)} 8.75L${X(6)} 8.9Q${X(10.5)} 9.15 ${X(15.5)} ${roof - 0.85}`, "none", 0, `stroke="${amtrak ? AMTRAK.red : "#c8102e"}" stroke-width="0.3"`);
    // Cab glass in its black surround.
    liv += path(poly([[X(2.0), 9.35], [X(4.55), 11.85], [X(7.9), 11.85], [X(7.9), 9.35]]), C.black);
    liv += path(poly([[X(2.35), 9.55], [X(4.55), 11.65], [X(5.2), 11.65], [X(5.2), 9.55]]), C.glass);
    liv += win(Math.min(X(5.7), X(7.6)), 9.65, 1.9, 1.85, 0.2);
  }
  liv += rect(0, sill + 0.28, L, 0.24, AMTRAK.red);
  s += path(d, bodyColor) + clipped(d, liv);
  // Crew doors behind each cab; tall louvered intake panels high on the
  // side, under the roof band: three behind the No. 1 cab, two behind the
  // No. 2 cab.
  for (const x of [8.4, L - 8.4 - 2.3]) s += door(x, sill + 0.35, 2.3, 7.0, { glassY: 0.74, glassH: 0.18 });
  for (const x of [11.6, 15.0, 18.4, L - 18.7, L - 15.3]) {
    s += rect(x, 9.3, 2.9, 2.5, "rgba(0,0,0,0.13)", 0.45, 'rx="0.1"');
    s += slats(x + 0.15, 9.45, 2.6, 2.2, 0.28, "rgba(0,0,0,0.16)");
  }
  // Roof: equipment between the pantographs; rear pantograph up.
  s += rect(L / 2 - 9, roof, 18, 0.45, C.steelDark, 0.5, 'rx="0.15"');
  s += pantograph(14.5, roof, { up: false }) + pantograph(L - 14.5, roof, { up: true, facing: -1 });
  // Amtrak: travelmark and name aft of the cab door. SEPTA: its logo high
  // on the body toward the No. 2 end.
  s += c.agency === "septa" ? badge(c, 56, 11.5, 1.6) : badge(c, L / 2 + 1, 8.65, 5.5, { logo: "amtrak-stack" }); // name over a big travelmark, mid-side
  s += outlineOf(d);
  return s;
}

// --- GE Genesis P42DC (and P32AC-DM): 69 ft long, 14 ft 4 in tall, trucks
// 43 ft 2.5 in apart on 40 in wheels. A sloped nose from the windshield to the
// pilot, upper sides that taper in above a crease, radiator fans at the back.
// Phase V (most P42s): platinum, the roof and the band above the crease blue,
// sweeping down over the cab to headlight height at the nose; red sill
// stripe; the name over the travelmark, big and blue, behind the cab.
// The P32AC-DMs (rebuilt 2018-21) wear the heritage scheme instead: silver,
// a black nose and cab, red, white and blue stripes along the side.
// CT Rail's P40DCs (6700-6711, ex-Amtrak, rebuilt 2018-24): red below the
// cab windows from the nose back to the CTrail mark mid-body, black behind
// it and above, the black coming down over the windshield to the upper
// headlights; a black sill band with yellow and white tape; the logo in
// white on the black behind the mark.
export function genesis(c, s0 = {}) {
  const { L } = c, sill = 4.4, roof = 14.33;
  const d = poly([[2.1, sill], [L - 1.0, sill], [L - 1.0, roof - 1.3], ["q", L - 1.0, roof, L - 2.3, roof], [8.2, roof], ["q", 7.0, roof, 6.5, 12.7],
    [4.35, 10.05], [1.25, 6.0], [1.3, 5.3]]);
  const amtrak = c.agency === "amtrak" || !c.agency;
  let s = "";
  // Pilot, coupler, fuel tank, trucks.
  s += pilot(1.25, sill);
  s += rect(L - 2.0, 2.0, 1.0, sill - 2.0, "currentColor", 0, 'opacity="0.85"');
  s += path(poly([[17.5, sill], [51.5, sill], [51.5, 2.4], ["q", 51.5, 1.5, 50.6, 1.5], [18.4, 1.5], ["q", 17.5, 1.5, 17.5, 2.4]]), "currentColor", 0, 'opacity="0.82"');
  s += rect(33, 2.9, 2.5, 0.9, C.steelDark, 0, 'opacity="0.8"'); // fuel gauge and filler
  s += truck(L / 2 - 21.6, { wb: 9.0, d: 40, kind: "loco", top: sill, shoe: s0.shoe }) + truck(L / 2 + 21.6, { wb: 9.0, d: 40, kind: "loco", top: sill, shoe: s0.shoe });
  const mnr = c.agency === "mnr", ct = c.agency === "ctrail", heritage = amtrak && s0.shoe;
  let liv = rect(0, 0, L, roof + 1, amtrak ? AMTRAK.platinum : mnr ? "#c3c8ce" : ct ? CTRAIL.black : c.color);
  if (ct) {
    liv += path(`M0 ${sill + 0.85}L0 9.0L3.4 9.0Q6.0 9.3 7.6 10.3L27 10.3L27 ${sill + 0.85}Z`, CTRAIL.red);
    liv += ctMark(22.3, 29.8, sill + 0.85, 10.3) + ctDashes(2.4, L - 1.5, sill + 0.4);
  }
  if (mnr) {
    // Metro-North's P32AC-DMs: silver all over; a blue stripe at headlight
    // height (a V across the nose) that broadens behind the cab door into a
    // band toward the back; a gray pinstripe below it.
    liv += path(`M0 7.9L${L} 7.9L${L} 9.9L38 9.9C28 9.9 22 8.35 15 8.35L0 8.35Z`, "#2a5aa8") + rect(0, 6.95, L, 0.13, "#6c7889");
  }
  if (heritage) {
    // Black over the nose and cab, its edge rising behind the cab windows to
    // the roof at the crew door; red over white over blue stripes; a black sill.
    liv += path(`M0 ${roof + 1}L0 8.4L4.5 8.4Q11.5 8.6 13.4 ${roof + 0.1}L13.4 ${roof + 1}Z`, C.black);
    liv += rect(0, 7.7, L, 0.6, AMTRAK.red) + rect(0, 6.9, L, 0.8, "#ffffff") + rect(0, 6.4, L, 0.5, AMTRAK.blue);
    liv += rect(0, sill, L, 0.35, C.black);
  } else if (amtrak) {
    // Blue above the crease, sweeping down past the cab to the nose.
    liv += path(`M0 ${roof + 1}L0 6.5L1.5 6.6C8 7.4 12 9.0 15 10.9S17.5 12.25 20 12.25L${L} 12.25L${L} ${roof + 1}Z`, AMTRAK.blue);
    liv += rect(0, sill + 0.25, L, 0.26, AMTRAK.red);
  }
  liv += line(7.6, 12.25, L - 1.0, 12.25, "rgba(0,0,0,0.28)", 0.6);           // crease where the sides taper in
  liv += path(poly([[4.25, 10.1], [6.45, 12.55], [7.35, 12.55], [7.35, 10.1]]), C.black);
  liv += path(poly([[4.6, 10.3], [6.4, 12.35], [7.0, 12.35], [7.0, 10.3]]), C.glass);
  liv += win(7.8, 10.4, 2.6, 1.7, 0.2) + win(10.7, 10.4, 1.6, 1.7, 0.2);       // cab side windows
  s += path(d, amtrak ? AMTRAK.platinum : ct ? CTRAIL.black : c.color) + clipped(d, liv);
  s += door(12.8, sill + 0.4, 2.2, 6.8, { glassY: 0.6, glassH: 0.2 });          // crew door
  // Radiator air intakes low at the back, a small grille under the cab
  // window, louvers up under the crease behind the cab and near the back.
  for (const [x, w, y, h] of [[44.5, 14, 5.3, 2.9], [7.4, 2.0, 5.9, 1.1], [16.6, 3.6, 10.5, 1.6], [20.6, 3.6, 10.5, 1.6], [24.6, 3.6, 10.5, 1.6], [46.5, 3.0, 10.8, 1.3]]) {
    s += rect(x, y, w, h, "rgba(0,0,0,0.22)", 0.4);
    s += slats(x, y, w, h);
  }
  // Roof: dynamic brake hatch, exhaust, two radiator fans at the back.
  s += rect(28, roof, 9, 0.3, C.steelDark, 0.4) + rect(41.5, roof, 1.6, 0.55, "currentColor") + rect(52, roof, 14, 0.25, C.steelDark, 0.4);
  for (const x of [55.5, 62]) s += path(`M${x - 2.4} ${roof + 0.25}Q${x} ${roof + 0.95} ${x + 2.4} ${roof + 0.25}Z`, C.steelDark, 0.4);
  // MTA disc behind the cab door; Phase V: name over travelmark behind the
  // cab; heritage: the small travelmark and name toward the back, above the stripes.
  s += mnr ? badge(c, 16.6, 10.0, 1.0) : ct ? badge(c, 34.6, 8.6, 1.05, { dark: true }) : heritage ? badge(c, 48, 9.3, 0.75) : badge(c, 21.8, 8.3, 3.9, { logo: "amtrak-stack" });
  s += outlineOf(d);
  return s;
}
export const p32 = (c) => genesis(c, { shoe: true });

// --- Budd Amfleet: 85 ft 4 in, 12 ft 8 in tall, the tube-shaped body of the
// Metroliner with a rounded roof and corrugated lower sides; low, wide
// windows (18 in tall on the Amfleet I, 22 in on the II), nine a side. The
// I has a vestibule at each end, the II and the cafe car one, at the A end.
// The cafe car's counter is mid-car: three windows toward the door, a blank
// stretch, four toward the far end.
// Class colors of the Phase VII band ends: green coach, light blue business;
// the cafe car has none.
const AMFLEET_CLASS = { coach: "#3fae49", business: "#5ec4ea", cafe: null };
function amfleet(c, { two = false, cab = false, cls = "coach" } = {}) {
  const { L } = c, x0 = 1.0, x1 = L - 1.0, sill = 4.05, roof = 12.67;
  const cafe = cls === "cafe", oneDoor = two || cafe;
  const d = bodyOutline(x0, x1, sill, roof, { endR: 2.0, endRL: cab && c.cabL ? 3.2 : 2.0 });
  const winH = two ? 1.83 : 1.5, winY = two ? 7.35 : 7.55, winW = two ? 5.6 : 5.3;
  // Window left edges and where the mid-car swoosh crosses the band
  // (bottom, top), measured from photos.
  const [wins, mid] = two ? [[...seq(13.8, 6.95, 4), ...seq(43.6, 6.95, 5)], [40.8, 44.9]]
    : cafe ? [[...seq(16.0, 7.0, 3), ...seq(52.0, 7.0, 4)], [41.6, 45.6]]
    : [[...seq(9.6, 6.85, 5), ...seq(45.95, 6.85, 4)], [42.6, 46.6]];
  let s = underframe(19, L - 19, sill, { boxes: 3 });
  s += truck(L / 2 - 29.75, { wb: 8.5, d: 36, kind: "pioneer", top: sill }) + truck(L / 2 + 29.75, { wb: 8.5, d: 36, kind: "pioneer", top: sill });
  let liv = rect(0, 0, L, roof + 1, C.steel);
  liv += rect(0, 11.05, L, 2, C.steelShade);                         // rounded roof
  liv += flutes(x0, x1, sill + 0.35, 6.75);                          // corrugated lower sides
  // Phase VII: a window band, dark blue from the A end to a white swoosh
  // near mid-car, lighter blue past it. At each door the band ends in the
  // class color behind a long white slash (wide at the top); a plain slash
  // where there is no door. A red line low on the side.
  const b0 = winY - 0.55, b1 = winY + winH + 0.6;
  const a = x0 + 3.5, b = oneDoor ? x1 - 0.15 : x1 - 3.6;           // band ends, clear of the doors
  // A white slash from (xb, bottom) to (xt, top), bowed a little.
  const slash = (xb, xt, w = 0.4) => {
    const cx = xb + (xt - xb) * 0.65, cy = (b0 + b1) / 2;
    return path(`M${xb - w / 2} ${b0}Q${cx - w / 2} ${cy} ${xt - w / 2} ${b1}L${xt + w / 2} ${b1}Q${cx + w / 2} ${cy} ${xb + w / 2} ${b0}Z`, "#ffffff");
  };
  const wedge = AMFLEET_CLASS[cls];
  liv += rect(a, b0, b - a, b1 - b0, AMTRAK.navy) + path(poly([[mid[0], b0], [b, b0], [b, b1], [mid[1], b1]]), AMTRAK.sky);
  liv += slash(mid[0], mid[1]);
  // A end: the class color (coach and business) behind the slash; plain
  // blue behind a long slash on the cafe car and at a cab.
  const [la, lb] = cafe ? [a + 0.4, a + 7.6] : two ? [a + 1.0, a + 5.5] : [a + 0.8, a + 4.8];
  if (wedge && !(cab && c.cabL)) liv += path(poly([[a, b0], [la, b0], [lb, b1], [a, b1]]), wedge);
  liv += slash(la, lb);
  // B end: the class color at an Amfleet I's second door; a plain slash at
  // a blind end.
  const [ra, rb] = oneDoor ? [b - 0.8, b - 4.6] : [b - 0.5, b - 4.9];
  if (wedge && !oneDoor) liv += path(poly([[ra, b0], [b, b0], [b, b1], [rb, b1]]), wedge);
  liv += slash(ra, rb);
  liv += rect(x0, sill + 0.2, x1 - x0, 0.22, AMTRAK.red);
  s += path(d, C.steel) + clipped(d, liv);
  for (const x of oneDoor ? [x0 + 0.6] : [x0 + 0.6, x1 - 3.2]) s += door(x, sill + 0.15, 2.6, 6.55, { glassY: 0.55, glassH: 0.32 });
  for (const x of wins) s += win(x, winY, winW, winH, 0.55);
  if (cafe) {
    // Small oval window and a "FOOD SERVICE CAR" plate over the band by the door.
    s += win(a + 0.3, b1 + 0.25, 1.3, 0.55, 0.27) + rect(a + 1.9, b1 + 0.2, 5.6, 0.62, "#e6e9ec", 0.4);
  }
  if (cab && c.cabL) {
    // Cab end: a cluster of horns and a beacon on the roof over the flat front.
    s += rect(x0 + 3.2, roof - 0.05, 1.5, 0.5, "currentColor", 0, 'rx="0.22"') + rect(x0 + 5.0, roof - 0.05, 0.5, 0.65, "#e8a33a", 0.4, 'rx="0.15"');
  }
  // The name over the travelmark, white in the band: behind the wedge on the
  // II, past the slash on the cafe car, by the B-end slash on the I.
  const logoX = two ? a + 8.0 : cafe ? a + 9.6 : b - 6.9;
  s += badge(c, logoX, winY + winH / 2, 1.5, { dark: true, logo: "amtrak-stack" });
  s += outlineOf(d) + carEnds(c);
  return s;
}
export const amfleet1 = (c) => amfleet(c);
export const amfleet2 = (c) => amfleet(c, { two: true });
export const amfleetBusiness = (c) => amfleet(c, { cls: "business" });
export const amfleetCafe = (c) => amfleet(c, { cls: "cafe" });
export const metrolinerCab = (c) => amfleet(c, { cab: true });

// ===================== Generic passenger cars =====================
// Most cars are described by a spec of real measurements rather than code:
//   roof, sill (ft above rail); end (gap from coupler face to body end);
//   endR (roof corner radius); drop: { a, b, y } low floor between trucks;
//   base, roofBand: colors; eave: where the roof curve begins;
//   flutes: [[y0, y1], ...] corrugated bands;
//   stripes: [[y, h, color], ...];
//   rows: [{ a, b, y, w, h, pitch, r }] window rows (a, b: ft along the car);
//   doors: [{ x, w, y, h, leaves }] (x: ft along the car);
//   trucks: { centers, wb, d, kind }, under: equipment between the trucks;
//   cab(c, spec): draws a driving cab at the left end.
export function coachCar(c, spec) {
  const { L } = c;
  const x0 = spec.end ?? 1.0, x1 = L - x0;
  const { roof, sill } = spec;
  const d = bodyOutline(x0, x1, sill, roof, { endR: spec.endR ?? 1.0, endRL: c.cabL && spec.cabR ? spec.cabR : spec.endR ?? 1.0, drop: spec.drop });
  const t = spec.trucks || {};
  const half = (t.centers ?? 59.5) / 2;
  let s = "";
  if (spec.under !== false) s += underframe(L / 2 - half + 7, L / 2 + half - 7, spec.drop ? spec.drop.y + 0.05 : sill, { depth: spec.drop ? 0.7 : 1.3, boxes: spec.drop ? 2 : 3 });
  s += truck(L / 2 - half, { wb: t.wb ?? 8.5, d: t.d ?? 36, kind: t.kind ?? "car", top: sill, shoe: t.shoe }) +
       truck(L / 2 + half, { wb: t.wb ?? 8.5, d: t.d ?? 36, kind: t.kind ?? "car", top: sill, shoe: t.shoe });
  let liv = rect(0, 0, L, roof + 1, spec.base ?? C.steel);
  if (spec.eave) liv += rect(0, spec.eave, L, roof - spec.eave + 1, spec.roofBand ?? C.steelShade);
  for (const [y0, y1] of spec.flutes || []) liv += flutes(x0, x1, y0, y1);
  liv += stripes(x0, x1, spec.stripes || [], 0);
  if (spec.livery) liv += spec.livery(c, { x0, x1 });
  s += path(d, spec.base ?? C.steel) + clipped(d, liv);
  const doors = spec.doors || [];
  for (const dr of doors) {
    s += door(dr.x, dr.y ?? sill + 0.15, dr.w, dr.h ?? 6.5, { leaves: dr.leaves ?? 1, glassY: dr.glassY ?? 0.55, glassH: dr.glassH ?? 0.3, glass: dr.glass ?? true, grabs: dr.grabs ?? true });
  }
  const skip = doors.map((dr) => [dr.x - 0.6, dr.x + dr.w + 0.6]);
  if (c.cabL && spec.cab) skip.push([x0, x0 + (spec.cabLen ?? 7)]);
  for (const r of spec.rows || []) s += windowRow(r.a, r.b, r.y, r.w, r.h, r.pitch, { r: r.r ?? 0.3, skip: [...skip, ...(r.skip || [])] });
  if (spec.extra) s += spec.extra(c, { x0, x1 });
  if (c.cabL && spec.cab) s += spec.cab(c, { x0, x1 });
  s += carBadge(c, spec, {
    rows: (spec.rows || []).map((r) => [r.y, r.h, [[r.a, r.b]]]),
    doors: doors.map((dr) => [dr.x - 0.5, dr.x + dr.w + 0.5, dr.y ?? sill + 0.15, (dr.y ?? sill + 0.15) + (dr.h ?? 6.5)]),
    sill: sill + 0.4, top: () => (spec.eave ?? roof - 0.6) - 0.3,
  });
  s += outlineOf(d) + carEnds(c, { floor: spec.diaphragm?.[0] ?? sill, top: spec.diaphragm?.[1] ?? roof - 1.3 });
  return s;
}


// --- Siemens Charger (SC-44, ALC-42, SCV-42; SCB-40 for Brightline): 71 ft 6 in,
// 14 ft 4 in tall, four axles on Siemens SF4 trucks. A steeply raked two-pane
// windshield over an upright nose. Behind the windshield a narrow cab window,
// the crew door, then along the side (SC-44, from photos): a small louvered
// panel high up, a tall louvered intake, a narrow grille, the big see-through
// X-braced grille, a louvered vent and a small window by the rear end; a dark
// gray skirt along the bottom of the body over the fuel tank.
// VIA's SCV-42 and Brightline's SCB-40 have a streamlined nose instead: a
// rounded tip low down, the windshield raked back in one long slope. Siemens
// gives 40.8 ft between truck centers and 44 in wheels.
// Phase VII (ALC-42): dark blue, the rear lighter blue behind a white swoosh
// rising from mid-side to the roof; a red cap over the cab edged in white,
// the white running on along the roof edge; a red sill band.
// A stripe framing a Charger's cab glass, as seen from the side: up the lower
// nose and as a cap over the cab roof (VIA yellow, Cascades tan).
const noseStripe = (color) =>
  path(poly([[1.5, 5.0], [2.15, 9.1], [2.65, 9.35], [3.5, 9.35], [2.7, 5.0]]), color) +
  path(poly([[4.95, 13.25], [5.7, 14.5], [12.0, 14.5], [12.0, 13.25]]), color);

export function charger(c, { phase7 = false } = {}) {
  const { L } = c, sill = 4.3, roof = 14.33;
  const cone = c.agency === "brightline", via = c.agency === "via";
  // VIA's SCV-42 and Brightline's SCB-40: the streamlined nose.
  const d = via || cone
    ? poly([[3.6, sill], [L - 1.0, sill], [L - 1.0, roof - 1.0], ["q", L - 1.0, roof, L - 2.0, roof], [11.1, roof], ["q", 8.7, roof, 7.3, 13.2],
      [1.7, 7.8], ["q", 0.95, 7.1, 1.0, 6.0], [1.4, 5.0]])
    : poly([[2.2, sill], [L - 1.0, sill], [L - 1.0, roof - 1.0], ["q", L - 1.0, roof, L - 2.0, roof], [7.4, roof], ["q", 5.6, roof, 5.0, 13.2],
      [2.65, 9.35], [2.15, 9.1], [1.75, 6.0], [1.55, 5.0]]);
  const amtrak = c.agency === "amtrak", route = c.route || "";
  // Amtrak's state-supported routes keep their sponsors' liveries.
  const scheme = cone ? "brightline" : c.agency === "via" ? "via" : c.agency === "mnr" ? "mnr" : c.agency === "marc" ? "marc" : !amtrak ? "plain"
    : MIDWEST_ROUTES.has(route) ? "midwest" : ["Capitol Corridor", "San Joaquins"].includes(route) ? "california"
    : route === "Pacific Surfliner" ? "surfliner" : route === "Amtrak Cascades" ? "cascades" : "phase7";
  const p7 = scheme === "phase7";
  const base = { phase7: AMTRAK.navy, brightline: "#d9dde2", via: "#585c61", midwest: "#c3c8ce", california: "#bfc4ca", surfliner: "#c3c8ce", mnr: "#c3c8ce",
    cascades: "#1d4a45", marc: MARC.silver }[scheme] || c.color;
  // Metro-North's SC-42DM also runs on third rail into Grand Central.
  const shoe = scheme === "mnr";
  let s = "";
  if (via || cone) {
    // A dark skirt over the coupler, the plow close to the rail.
    s += path(poly([[3.6, sill], [1.4, 5.0], [1.2, 2.0], ["q", 1.25, 0.8, 2.4, 0.75], [7.5, 0.75], [7.5, sill]]), "#3a3d41");
  } else {
    s += pilot(1.55, sill);
  }
  s += rect(L - 2.1, 2.0, 1.1, sill - 2.0, "currentColor", 0, 'opacity="0.85"');
  s += path(poly([[21, sill], [50.5, sill], [50.5, 2.3], ["q", 50.5, 1.4, 49.6, 1.4], [21.9, 1.4], ["q", 21, 1.4, 21, 2.3]]), "currentColor", 0, 'opacity="0.82"');
  s += truck(L / 2 - 20.4, { wb: 9.8, d: 44, kind: "loco", top: sill, shoe }) + truck(L / 2 + 20.4, { wb: 9.8, d: 44, kind: "loco", top: sill, shoe });
  let liv = rect(0, 0, L, roof + 1, base);
  switch (scheme) {
    case "cascades":
      // Amtrak Cascades (Airo ALC-42E): evergreen with a big cream panel from
      // behind the cab to the rear, its front edge sweeping forward at the
      // bottom; a white line and a copper band low on the side; copper,
      // edged in white, over the cab roof.
      liv += path(`M22 12.7Q17 11.5 16.2 7.6Q16 5.8 18.5 5.8L${L} 5.8L${L} 12.7Z`, "#efe9dc");
      liv += rect(0, 5.15, L, 0.4, "#7a4e34") + rect(0, 4.75, L, 0.2, "#f4f1ea");
      liv += path(poly([[4.95, 13.25], [5.7, 14.5], [12.5, 14.5], [12.5, 13.6], [5.6, 13.6]]), "#b08a5a") + rect(5.6, 13.4, 6.9, 0.2, "#f4f1ea");
      break;
    case "mnr":
      // Metro-North (SC-42DM): a royal blue cab whose blue sweeps down behind
      // the logo into a band along the side to the back, red under the band,
      // its front end slanting down to the sill; silver above and below;
      // white and black pinstripes along the sill.
      liv += path(`M0 ${sill}L18.2 ${sill}L21.9 6.05L${L} 6.05L${L} 7.9L25.5 7.9C21 7.9 18.2 10.8 17.6 ${roof + 1}L0 ${roof + 1}Z`, "#2150c8");
      liv += path(poly([[18.2, sill], [19.0, sill], [22.3, 5.55], [L, 5.55], [L, 6.05], [21.9, 6.05]]), AMTRAK.red);
      liv += rect(0, sill, L, 0.2, "#1d1f22") + rect(0, sill + 0.2, L, 0.12, "#f4f5f6");
      break;
    case "marc": {
      // MARC (SC-44, 80-87): silver over a dark gray skirt edged in white; an
      // indigo band over an orange stripe along the side, sweeping down the
      // nose ahead of the cab, broken by the big louver, the logo and the
      // grilles behind it; the roof dark behind the silver cab cap.
      const band = (x0, x1) => rect(x0, 8.2, x1 - x0, 1.35, MARC.indigo) + rect(x0, 7.55, x1 - x0, 0.65, MARC.orange);
      liv += rect(0, 0, L, 5.7, "#5b5f64") + rect(0, 5.7, L, 0.2, "#f4f5f6") + rect(16.5, 13.85, L, 1.5, "#33384a");
      liv += band(9.0, 29.0) + band(58.0, L);
      liv += path("M9.2 9.55Q6.0 9.55 2.3 5.9L4.1 5.9Q6.6 8.2 9.2 8.2Z", MARC.indigo) + path("M9.2 8.2Q6.6 8.2 4.1 5.9L5.6 5.9Q7.0 7.55 9.2 7.55Z", MARC.orange);
      break;
    }
    case "phase7": {
      // The lighter blue behind the swoosh; light gray roof over a white
      // roof-edge line; a red sill band under a thin white line.
      const swoosh = `M43 ${sill}Q45.5 11.5 54.5 13.85`;
      liv += path(`${swoosh}L${L} 13.85L${L} ${sill}Z`, AMTRAK.sky) + path(swoosh, "none", 0, 'stroke="#ffffff" stroke-width="0.5"');
      liv += rect(0, 13.85, L, 1.5, "#cfd4da") + rect(0, 13.7, L, 0.3, "#ffffff");
      liv += rect(0, sill, L, 0.5, AMTRAK.red) + rect(0, sill + 0.55, L, 0.13, "#ffffff");
      break;
    }
    case "brightline":
      // Brightline's SCB-40: silver, a big yellow panel slanting back along
      // the side, crossed by a white band; gray and white slants at the cab
      // and the rear; a charcoal roof and sill band; a thin white line along
      // the side, yellow over the black nose with its yellow streaks.
      liv += path(poly([[19.5, 12.9], [57.4, 12.9], [70.2, 5.3], [33.0, 5.3]]), "#ffd100") +
        path(poly([[22.8, 12.9], [27.7, 12.9], [46.5, 5.3], [41.6, 5.3]]), "#f4f5f6") +
        path(poly([[57.4, 12.9], [59.8, 12.9], [72.6, 5.3], [70.2, 5.3]]), "#9aa0a6") +
        path(poly([[59.8, 12.9], [62.8, 12.9], [75.6, 5.3], [72.6, 5.3]]), "#f4f5f6") +
        path(poly([[16.8, 12.9], [19.2, 12.9], [24.0, 5.3], [21.6, 5.3]]), "#9aa0a6");
      liv += rect(0, 12.9, L, 3, "#3a3d41") + rect(4.5, 0, L, 5.3, "#3a3d41");
      liv += line(9.6, 9.0, L - 1.0, 9.0, "#f4f5f6", 0.8);
      // The nose: black from the windshield down to a silver lower nose that
      // sweeps back to the sill under the cab; yellow streaks across the black.
      liv += path(`M0 0L0 ${roof + 1}L13.4 ${roof + 1}Q11.2 10.5 9.6 ${sill}L0 ${sill}Z`, "#1d1f22");
      for (let k = 0; k < 6; k++) liv += path(poly([[0.8 + k * 1.0, 6.4 + k * 1.05], [10.4 + k * 0.4, 9.6 + k * 0.7], [10.4 + k * 0.4, 9.9 + k * 0.7], [0.8 + k * 1.0, 6.75 + k * 1.05]]), "#ffd100");
      liv += path(`M0 0L0 7.0Q4.5 6.6 8.2 5.2Q9.4 4.7 10.2 ${sill}L10.2 0Z`, "#c3c8cd");
      liv += path(poly([[5.2, 9.6], [8.5, 12.9], [11.6, 12.9], [10.6, 9.6]]), C.glass) + win(12.7, 10.0, 1.4, 2.5, 0.25);
      break;
    case "via": {
      // VIA's SCV-42: charcoal over a darker sill band, a light gray roof.
      // The cab is light gray below a black band through its windows, set
      // off by a light line slanting up and back; yellow edges the
      // windshield and caps the cab roof. At the rear the coaches' bands
      // (yellow, charcoal, light gray) carry on, cut off on the same slant.
      const band = (y0, y1, col) => path(poly([[56.3 + (y0 - sill) * 1.22, y0], [L, y0], [L, y1], [56.3 + (y1 - sill) * 1.22, y1]]), col);
      liv += rect(0, 13.3, L, 2, "#c3c7cb") + path(poly([[0, 0], [12.6, 0], [12.6, sill], [23.4, 13.3], [0, 13.3]]), "#c8ccd0");
      liv += rect(5.0, 0, L, 5.45, "#3a3d41") + line(14.0, 5.45, 23.4, 13.3, "#e2e5e8", 1.2);
      liv += path(poly([[4.2, 9.0], [17.9, 9.0], [23.0, 13.3], [8.5, 13.3]]), "#24272b");
      liv += band(sill, 6.55, "#c8ccd0") + band(6.55, 6.8, "#f5c400") + band(6.8, 10.3, "#2b2e32") + band(10.3, 13.3, "#f5c400");
      liv += path(poly([[0.9, 8.3], [3.5, 8.3], [8.5, 13.3], [13.0, 13.3], [13.0, roof + 1], [5.0, roof + 1]]), "#f5c400");
      liv += path(poly([[4.9, 9.4], [8.4, 12.9], [11.7, 12.9], [11.7, 9.4]]), C.glass) + win(15.2, 10.0, 1.6, 2.6, 0.25) + win(57.0, 10.3, 1.8, 2.4, 0.25);
      break;
    }
    case "midwest": {
      // Amtrak Midwest (IDTX SC-44): a navy cab back to just behind the door,
      // edged in white; silver behind it, a navy halftone of dots fading out
      // behind the cab and in again high at the rear end; a white line sweeping
      // up from the sill and back along the side; a red stripe over the skirt.
      const navy = "#1c2a4c";
      liv += path(`M0 0L16.6 0L16.6 12.6Q16.6 ${roof} 18.2 ${roof + 1}L0 ${roof + 1}Z`, navy);
      liv += path(`M16.6 5.7L16.6 12.6Q16.6 ${roof} 18.2 ${roof + 1}`, "none", 0, 'stroke="#ffffff" stroke-width="0.22"');
      for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
        const r = 0.24 * (1 - i / 12);
        liv += circle(17.3 + i * 0.6 + (j % 2) * 0.3, 6.3 + j * 0.55, r, navy);
        if (j > 5) liv += circle(L - 1.4 - i * 0.6 - (j % 2) * 0.3, 6.3 + j * 0.55, r * 0.85, navy);
      }
      liv += path(`M19.5 5.75Q25 8.5 33 8.6L${L} 8.6`, "none", 0, 'stroke="#ffffff" stroke-width="0.22"');
      liv += rect(0, 0, L, 5.3, "#3a3f46") + rect(0, 5.3, L, 0.4, AMTRAK.red);
      break;
    }
    case "california":
    case "surfliner": {
      // Caltrans' Chargers (Capitol Corridor, San Joaquins, Pacific Surfliner):
      // a blue cab under a silver cap that sweeps back from the windshield
      // over the roof; a white stripe over the dark gray skirt.
      // Northern California: silver behind the cab, the blue ending in a
      // yellow-edged curve, a yellow-edged blue swoosh at the rear corner.
      // Surfliner: blue all over with a big light gray panel down the side,
      // its front end rounded and edged in white.
      const blue = scheme === "surfliner" ? "#2b3990" : "#22409a";
      if (scheme === "california") {
        liv += path(`M0 0L25.2 0L25.2 5.7Q21.0 7.2 21.0 9.3Q21.0 11.6 23.8 12.9L23.8 ${roof + 1}L0 ${roof + 1}Z`, blue);
        liv += path(`M25.2 5.7Q21.0 7.2 21.0 9.3Q21.0 11.6 23.8 12.9`, "none", 0, 'stroke="#f2c21b" stroke-width="0.45"');
        liv += path(`M${L} 5.7L65.5 5.7Q69 7.6 ${L} 11.2Z`, blue) + path(`M65.5 5.7Q69 7.6 ${L} 11.2`, "none", 0, 'stroke="#f2c21b" stroke-width="0.4"');
      } else {
        liv += rect(0, 0, L, roof + 1, blue);
        liv += path("M61.5 5.95L26 5.95Q22.4 5.95 22.4 9.2Q22.4 12.5 26 12.5L61.5 12.5Z", "#d6d9dd") +
          path("M26.3 5.95Q22.4 5.95 22.4 9.2Q22.4 12.5 26.3 12.5", "none", 0, 'stroke="#ffffff" stroke-width="0.3"');
      }
      liv += path(`M5.2 9.2Q7.0 12.6 12.0 12.9L${L} 12.9L${L} ${roof + 1}L4.0 ${roof + 1}Z`, "#dfe2e5");
      liv += rect(0, 0, L, 5.3, "#3a3f46") + rect(0, 5.3, L, 0.4, "#f4f5f6");
      break;
    }
    default:
      liv += rect(0, sill + 1.0, L, 0.35, "#ffffff", 0, 'opacity="0.85"');
  }
  // Cab glass in a black surround. VIA's SCV-42 has the Venture nose instead.
  // ALC-42: the windshield wraps back to about 7 ft, the body color behind it.
  // SC-44 (flanked by white and red on Phase VII); the state-supported
  // liveries show the wraparound windshield only, with a narrow cab side
  // window in the body color behind it.
  const wide = !["midwest", "california", "surfliner", "cascades", "marc"].includes(scheme);
  if (phase7 && !via && !cone) {
    liv += path(poly([[2.0, 9.0], [4.95, 13.25], [10.8, 13.25], [10.8, 9.0]]), C.black);
    liv += path(poly([[2.6, 9.35], [4.85, 12.95], [5.6, 12.95], [5.6, 9.35]]), C.glass) + win(6.3, 9.6, 3.8, 2.9, 0.25);
    // ALC-42 cab: the windshield wraps back to about 7 ft; behind it the
    // body color, a narrow side window and the mirror ahead of the door.
    // Phase VII: the red cap over the cab, edged in white.
    const side = scheme === "cascades" ? base : AMTRAK.navy;
    liv += rect(5.6, 8.4, 5.6, 4.85, side) + path(poly([[2.6, 9.35], [4.85, 12.95], [7.0, 12.95], [7.0, 9.5]]), C.glass);
    if (p7) {
      const cap = "M0.5 9.0L2.2 9.0Q6.5 9.3 8.6 11.2Q11.8 13.75 16 13.75";
      liv += path(`${cap}L16 ${roof + 1}L0 ${roof + 1}Z`, AMTRAK.red) + path(cap, "none", 0, 'stroke="#ffffff" stroke-width="0.3"');
      liv += path(poly([[2.6, 9.35], [4.85, 12.95], [7.0, 12.95], [7.0, 9.5]]), C.glass);
    }
    liv += win(10.0, 8.9, 1.15, 2.4, 0.25) + rect(11.35, 10.2, 0.5, 1.5, "#c9cdd2", 0, 'rx="0.15"');
    liv += line(7.2, 12.9, L - 1.0, 12.9, "rgba(0,0,0,0.25)", 0.6);
  } else if (!via && !cone) {
    liv += path(poly([[2.0, 9.0], [4.95, 13.25], [wide ? 10.8 : 7.3, 13.25], [wide ? 10.8 : 6.9, 9.0]]), C.black);
    if (p7) liv += rect(11.0, 8.6, 0.35, 5.2, "#ffffff") + rect(11.5, 8.6, 0.45, 5.2, AMTRAK.red);
    liv += path(poly([[2.6, 9.35], [4.85, 12.95], [5.6, 12.95], [5.6, 9.35]]), C.glass) + (wide ? win(6.3, 9.6, 3.8, 2.9, 0.25) : win(7.7, 9.5, 1.5, 2.6, 0.25));
    liv += line(7.2, 12.9, L - 1.0, 12.9, "rgba(0,0,0,0.25)", 0.6);
  }
  s += path(d, base) + clipped(d, liv);
  if (!wide && !phase7 && !via) s += rect(9.5, 10.4, 0.35, 1.7, "#b9bec4", 0.4);  // mirror
  s += door(cone ? 15.0 : 12.3, sill + 0.5, 2.5, 7.6, { glassY: 0.6, glassH: 0.3 });
  // VIA's SCV-42 and Brightline's SCB-40: a tall X-braced grille toward the
  // rear, a louvered panel beside it (painted over on Brightline's).
  const xGrille = (x, y, w, h, fill) => rect(x, y, w, h, fill, 0.4, 'rx="0.3"') + lines([[x + 0.3, y + 0.3, x + w - 0.3, y + h - 0.3], [x + 0.3, y + h - 0.3, x + w - 0.3, y + 0.3]], "rgba(150,155,160,0.8)", 1.2);
  if (via) {
    s += xGrille(50.7, 5.6, 5.9, 7.1, "rgba(20,22,25,0.75)") + rect(46.6, 6.7, 2.6, 5.6, "rgba(20,22,25,0.6)", 0.4, 'rx="0.3"') + slats(46.6, 6.7, 2.6, 5.6, 0.5);
  } else if (cone) {
    s += xGrille(46.4, 6.2, 7.3, 5.8, "rgba(20,22,25,0.3)") + rect(42.6, 6.7, 2.9, 4.3, "rgba(20,22,25,0.3)", 0.4, 'rx="0.3"') +
      rect(54.3, 10.1, 2.2, 2.1, "rgba(20,22,25,0.3)", 0.4, 'rx="0.2"');
  } else {
    // Side equipment, as on the SC-44: a small louvered panel high up, the tall
    // intake, a narrow grille, the see-through X-braced grille ahead of the
    // rear truck, a louvered vent and a small window.
    for (const [x, y, w, h] of [[24.6, 10.4, 2.4, 2.0], [29.0, 6.3, 4.7, 5.6], [48.2, 6.5, 2.6, 5.4], [58.8, 9.5, 3.6, 2.6]]) {
      s += rect(x, y, w, h, "rgba(20,22,25,0.45)", 0.4) + slats(x, y, w, h, 0.32);
    }
    s += rect(52.0, 5.7, 6.0, 6.6, "rgba(20,22,25,0.6)", 0.4) + lines([[52.2, 5.9, 57.8, 12.1], [52.2, 12.1, 57.8, 5.9]], "rgba(255,255,255,0.4)", 1.0);
    s += win(63.0, 9.8, 1.7, 2.1, 0.2);
  }
  // Roof: an exhaust hatch behind the cab, the cooling section over the rear.
  s += rect(16.5, roof - 0.05, 3.0, 0.35, C.steelDark, 0.4, 'rx="0.15"') + rect(47.5, roof - 0.05, 20.5, 0.3, C.steelDark, 0.4);
  // The railroad's logo. Phase VII: name over travelmark, just behind the
  // cab. Brightline: its wordmark on the yellow, over the white band. VIA:
  // enormous yellow letters mid-side, a big red maple leaf at the rear.
  // Metro-North: the white MTA disc on the blue behind the cab door. Midwest:
  // "Amtrak Midwest" mid-side; northern California: Caltrans' mark and name;
  // Surfliner: "Pacific Surfliner" on the gray panel; Cascades: its logo on
  // the cream. MARC: the big logo low on the silver between the louver and
  // the grilles, the Maryland flag high at the rear.
  const mark = {
    phase7: { x: 20.5, y: 8.2, h: 3.9, dark: true, logo: "amtrak-stack" },
    brightline: { x: 35.5, y: 9.6, h: 3.0 },
    via: { x: 34.8, y: 9.55, h: 5.4, logo: "via-word" },
    mnr: { x: 17.2, y: 7.7, h: 1.4, logo: "mta-inverse" },
    midwest: { x: 40.5, y: 10.2, h: 2.3, logo: "amtrak-midwest" },
    california: { x: 41, y: 9.9, h: 1.8, logo: "caltrans" },
    surfliner: { x: 42, y: 9.3, h: 1.9, logo: "surfliner" },
    cascades: { x: 33, y: 9.4, h: 3.6, logo: "cascades-dark" },
    marc: { x: 41.0, y: 8.1, h: 3.55 },
  }[scheme] || { x: 40, y: 9.0, h: 1.7 };
  s += badge(c, mark.x, mark.y, mark.h, mark);
  if (via) s += badge(c, 64.5, 7.7, 6.7, { logo: "via-leaf" });
  if (scheme === "marc") s += mdFlag(67.4, 11.4, 1.7);
  s += outlineOf(d);
  return s;
}
export const alc42 = (c) => charger(c, { phase7: true });

// --- Superliner (Pullman-Standard I, Bombardier II): 85 ft, 16 ft 2 in tall,
// a low floor between the trucks, the side door on the lower level just off
// mid-car. Upstairs, eleven big two-pane windows a side on 6 ft 9 in
// centers; a fluted roof and fluted bands on the lower level. Equipment
// lockers over one truck, a big louvered HVAC grille over the other, and a
// step well at each corner where the skirt drops. Phase IVb, which nearly
// all still wear: red, white, red pinstripes over a blue band at the upper
// floor, a red line under the lower windows; the logo, name over travelmark,
// just past the door.
const IVB_BLUE = "#26528a";
const SUPER_STRIPES = [[7.91, 0.68, IVB_BLUE], [8.59, 0.14, "#ffffff"], [8.73, 0.12, AMTRAK.red], [8.85, 0.16, "#ffffff"],
  [9.01, 0.12, AMTRAK.red], [3.46, 0.14, AMTRAK.red]];
// Upstairs window bays: centers 8.8 ft from the end, then every 6.75 ft.
const SUPER_BAYS = Array.from({ length: 11 }, (_, i) => 8.8 + 6.75 * i);
// A two-pane window: a mullion down the middle.
const pane2 = (x, y, w, h, r = 0.35) => win(x, y, w, h, r) + line(x + w / 2, y + 0.06, x + w / 2, y + h - 0.06, C.gasket, 0.9);
// A louvered grille: horizontal blades in a frame.
const louver = (x, y, w, h, gap = 0.3) => rect(x, y, w, h, C.steelShade, 0.5) +
  lines(Array.from({ length: Math.max(0, Math.round(h / gap) - 1) }, (_, k) => [x + 0.12, y + (k + 1) * gap, x + w - 0.12, y + (k + 1) * gap]), "rgba(0,0,0,0.45)", 0.6);
const superBase = {
  roof: 16.17, sill: 3.2, endR: 1.5, eave: 13.3, roofBand: "#cfd4d9", drop: { a: 18.6, b: 66.4, y: 1.35 },
  flutes: [[13.45, 16.1], [6.45, 7.85], [1.45, 3.3]], stripes: SUPER_STRIPES,
  trucks: { centers: 59.5, wb: 8.5, d: 36 }, diaphragm: [7.4, 13.0],
};
const superDoor = (x) => ({ x, w: 3.0, y: 1.45, h: 6.1, glassY: 0.62, glassH: 0.28 });
const superLogo = (x) => ({ x, y: 4.85, h: 1.25, logo: "amtrak-stack" });
// The lower level's ends and fittings, and the upstairs windows. bays:
// which upstairs bays have windows; low: lower windows [x, w, two-pane];
// grille: [x, w] the HVAC grille at the B end; side: extra grilles [x, w].
function superDetail(c, { x0, x1 }, { bays = SUPER_BAYS, low = [], grille = [76.0, 4.7], side = [] } = {}) {
  let s = "";
  for (const [e, k] of [[x0, 1], [x1, -1]]) {
    s += path(poly([[e, 3.2], [e, 1.7], [e + k * 2.9, 1.7], ["q", e + k * 3.5, 1.7, e + k * 3.5, 3.2]]), C.steel, 0.6);
    const a = Math.min(e + k * 0.8, e + k * 2.1);
    s += rect(a, 1.8, 1.3, 1.25, "#2a2d31") + lines([[a + 0.1, 2.2, a + 1.2, 2.2], [a + 0.1, 2.6, a + 1.2, 2.6]], C.steelDark, 0.8);
  }
  s += rect(4.6, 3.75, 6.8, 3.85, "none", 0.5) + line(8.0, 3.75, 8.0, 7.6, "currentColor", 0.5) + rect(13.6, 3.75, 4.6, 3.85, "none", 0.5); // lockers
  if (grille) s += louver(grille[0], 3.95, grille[1], 3.5);
  for (const [x, w] of side) s += louver(x, 4.0, w, 3.6);
  s += rect(81.6, 4.3, 2.0, 1.9, "none", 0.5);                                                   // hatch
  for (const [x, w, two] of low) s += two ? pane2(x, 3.85, w, 2.4) : win(x, 3.85, w, 2.4, 0.35);
  for (const m of bays) s += pane2(m - 2.7, 10.95, 5.4, 2.1, 0.45);
  return s;
}
// Coach. The sleeper shows the same side: the windows upstairs, a narrow and
// two wide lower windows short of the door.
const superLow = [[22.4, 2.6, false], [26.2, 5.5, true], [33.0, 5.4, true]];
export const superlinerCoach = (c) => coachCar(c, { ...superBase, badge: superLogo(53.7), doors: [superDoor(46.6)],
  extra: (c, g) => superDetail(c, g, { low: superLow }) });
export const superlinerSleeper = superlinerCoach;
// Dining car: the kitchen downstairs, no windows there; no windows upstairs
// over the door either (the dumbwaiter and service area); a narrow grille.
export const superlinerDiner = (c) => coachCar(c, { ...superBase, badge: superLogo(43.6), doors: [superDoor(36.5)],
  extra: (c, g) => superDetail(c, g, { bays: SUPER_BAYS.filter((_, i) => i !== 4 && i !== 5), grille: [79.2, 2.0] }) });
// Sightseer Lounge: in each bay a tall two-pane side window under a separate
// roof window curving up into the roof; the cafe's windows downstairs.
export const superlinerLounge = (c) => coachCar(c, { ...superBase, badge: superLogo(61.7), doors: [superDoor(54.6)],
  extra: (c, g) => {
    let s = superDetail(c, g, { bays: [], low: [[27.2, 4.9, true], [33.3, 5.2, true]], grille: [75.2, 4.8], side: [[66.4, 2.2]] });
    for (const m of SUPER_BAYS) {
      const x = m - 2.6, w = 5.2;
      s += pane2(x + 0.05, 9.7, w - 0.1, 3.2, 0.4);
      s += path(poly([[x, 13.4], [x + w, 13.4], [x + w, 15.0], ["q", x + w, 15.7, x + w - 0.9, 15.75], [x + 0.9, 15.75], ["q", x, 15.7, x, 15.0]]), C.glass, 0, `stroke="${C.gasket}" stroke-width="0.6" vector-effect="non-scaling-stroke"`);
      s += rect(x + 0.2, 14.4, w - 0.4, 1.0, C.glassLight, 0, 'rx="0.3"');
    }
    return s;
  } });

// --- Viewliner (Budd prototypes, Morrison-Knudsen/Amerail I, CAF II): 85 ft
// 4 in, 14 ft tall, single level, two-pane windows on about 6 ft 10 in
// centers. Sleepers and diners have a second, shorter row over the first
// (the upper berths' windows, the "view" in the name). Fluted below the
// windows, a red line low on the side.
// Viewliner I sleepers (the most numerous) in Phase IVb: a blue band through
// the lower windows under red, white, red pinstripes; the logo, name over
// travelmark, white on the band by the door. Viewliner II diners and baggage
// cars in the stripes they came in: red over white over blue across the
// windows, the logo on the stripes.
const VL2 = { red: "#d9352a", blue: "#2457b5" };
const VL2_STRIPES = (low) => [[7.3, 0.72, VL2.blue], [8.02, 0.73, "#ffffff"], [8.75, 0.72, VL2.red], [low, 0.15, VL2.red]];
const viewBase = { roof: 14.0, sill: 4.1, endR: 1.2, eave: 13.0, roofBand: "#cfd4d9", flutes: [[13.1, 13.95], [5.25, 7.25]],
  trucks: { centers: 59.5, wb: 8.5, d: 36 } };
const viewDoor = (x) => ({ x, w: 2.7, h: 6.8, glassY: 0.6, glassH: 0.28 });
// Lower and upper windows in columns: centers, width.
const viewWins = (centers, w) => centers.map((m) => pane2(m - w / 2, 7.55, w, 2.05) + pane2(m - w / 2, 10.6, w, 1.7, 0.3)).join("");
export const viewlinerSleeper = (c) => coachCar(c, { ...viewBase, doors: [viewDoor(81.1)],
  badge: { x: 76.3, y: 8.55, h: 1.7, dark: true, logo: "amtrak-stack" },
  stripes: [[5.0, 0.15, AMTRAK.red], [7.25, 2.6, IVB_BLUE], [9.92, 0.13, AMTRAK.red], [10.05, 0.17, "#ffffff"], [10.22, 0.13, AMTRAK.red]],
  extra: () => viewWins([4.6, 11.4, 18.2, 25.1, 31.9, 38.7, 47.2, 56.2, 63.1, 70.15], 5.45) });
// Diner: the kitchen at one end, windowless but for small vents high up; the
// door, a tall louver, then six columns of windows over the tables.
export const viewlinerDiner = (c) => coachCar(c, { ...viewBase, doors: [viewDoor(35.4)],
  badge: { x: 30.5, y: 8.8, h: 0.75, logo: "amtrak" }, stripes: VL2_STRIPES(5.0),
  extra: () => [9.5, 15.1, 30.3].map((x) => louver(x - 0.4, 11.3, 0.8, 1.2, 0.25)).join("") + louver(41.2, 7.5, 1.2, 4.85, 0.35) +
    viewWins([45.1, 52.1, 59.1, 66.1, 73.1, 80.1], 5.6) });
// Baggage car: no windows; a wide two-leaf door each side, off-center, with
// a small window in each leaf; mushroom vents on the roof.
const bagDoor = (x) => ({ x, w: 6.4, h: 7.55, leaves: 2, glassY: 0.58, glassH: 0.34, grabs: false });
export const viewlinerBaggage = (c) => coachCar(c, { ...viewBase, doors: [bagDoor(13.3), bagDoor(59.6)],
  badge: { x: 39.65, y: 8.78, h: 0.85, logo: "amtrak" }, stripes: VL2_STRIPES(4.85),
  extra: () => [2.2, 24.8, 46.4, 68.1].map((x) => path(poly([[x - 0.8, 13.95], [x - 0.8, 14.2], ["q", x - 0.8, 14.5, x, 14.5], ["q", x + 0.8, 14.5, x + 0.8, 14.2], [x + 0.8, 13.95]]), C.steelShade, 0.5)).join("") });

// ===================== Commuter bi-levels =====================
// bilevel(c, spec) draws a two-level car from measurements:
//   roof: roof height over the double-deck middle; ends: { h, len, ramp }:
//     roof height over the end sections, how far the low roof runs in from
//     each end, and the length of the S-shaped step up to the full roof;
//   sill: underside over the trucks; drop: { a, b, y } the lower level's
//     underside between the trucks (from a to b);
//   trucks: { centers, wb, d }; base: body color; paint(c, g): livery;
//   rows: [{ xs, y, w, h, r }] windows at explicit positions (ft from the
//     left coupler face; xs may be [start, pitch, count]);
//   doors: [{ x, w, y0, y1, leaves, glassY, glassH }];
//   chamfer: [low, high] Bombardier's octagonal body: lines where the
//     upper and lower bevels meet the vertical side;
//   roofItems: [[x, w, h]]; nose: the cab-end profile replacing the left
//     end when the car leads (points from the bottom up to the roof);
//   cab(c, g): cab details at the left end; extra(c, g).
// poly() points traced backward, curves included (a nose drawn bottom-up,
// walked top-down to close the outline).
function reversePath(pts) {
  const end = (p) => (p[0] === "q" ? [p[3], p[4]] : [p[0], p[1]]);
  const out = [end(pts[pts.length - 1])];
  for (let i = pts.length - 1; i > 0; i--) {
    const p = pts[i], to = end(pts[i - 1]);
    out.push(p[0] === "q" ? ["q", p[1], p[2], to[0], to[1]] : to);
  }
  return out;
}
const seq = (from, pitch, n) => Array.from({ length: n }, (_, i) => from + i * pitch);
export function bilevel(c, spec) {
  const { L } = c, x0 = spec.end ?? 0.7, x1 = L - x0;
  const { roof, sill } = spec;
  const e = spec.ends || { h: roof, len: 0, ramp: 0 };
  const cr = spec.cornerR ?? 0.7, mid = (e.h + roof) / 2;
  // Roofline with S-shaped steps where the low end roofs meet the full-height middle.
  const stepR = [], stepL = [];
  if (e.h < roof) {
    const xs = x1 - Math.max(e.len, cr), xm = xs - e.ramp / 2;
    stepR.push([xs, e.h], ["q", xm, e.h, xm, mid], ["q", xm, roof, xs - e.ramp, roof]);
    const ys = x0 + Math.max(e.len, cr), ym = ys + e.ramp / 2;
    stepL.push([ys + e.ramp, roof], ["q", ym, roof, ym, mid], ["q", ym, e.h, ys, e.h]);
  }
  const dr = spec.drop;
  const bottom = dr ? [[dr.a - 1.0, sill], ["q", dr.a - 0.4, sill, dr.a - 0.2, dr.y + 0.6], ["q", dr.a, dr.y, dr.a + 0.6, dr.y],
    [dr.b - 0.6, dr.y], ["q", dr.b, dr.y, dr.b + 0.2, dr.y + 0.6], ["q", dr.b + 0.4, sill, dr.b + 1.0, sill]] : [];
  const nose = c.cabL && spec.nose;
  const leftEnd = nose ? reversePath(nose) : [...stepL, [x0 + cr, e.h], ["q", x0, e.h, x0, e.h - cr]];
  const d = poly([nose ? nose[0] : [x0, sill], ...bottom, [x1, sill], [x1, e.h - cr], ["q", x1, e.h, x1 - cr, e.h], ...stepR, ...leftEnd]);
  const t = spec.trucks;
  let s = "";
  if (spec.drop) s += underframe(spec.drop.a + 2, spec.drop.b - 2, spec.drop.y + 0.05, { depth: 0.45, boxes: 3, tanks: false });
  if (!spec.noTrucks) for (const k of [-1, 1]) s += truck(L / 2 + (k * t.centers) / 2, { wb: t.wb, d: t.d, kind: t.kind ?? "car", top: sill, shoe: t.shoe });
  const g = { x0, x1, L, roof, sill, ends: e };
  let liv = rect(0, 0, L, roof + 1, spec.base ?? C.steel);
  if (spec.flutes) for (const [a, b, y0, y1, gap] of spec.flutes) liv += flutes(a, b, y0, y1, gap);
  if (spec.chamfer) liv += lines([[0, spec.chamfer[1], L, spec.chamfer[1]], [0, spec.chamfer[0], L, spec.chamfer[0]]], "rgba(0,0,0,0.16)", 0.6) +
    rect(0, spec.chamfer[1], L, roof, "rgba(255,255,255,0.10)") + rect(0, 0, L, spec.chamfer[0], "rgba(0,0,0,0.06)");
  if (spec.paint) liv += spec.paint(c, g);
  const cabZone = c.cabL && spec.cabLen ? [x0, x0 + spec.cabLen] : null;
  const cabZoneR = c.cabR && spec.cab && spec.cabLen ? x1 - spec.cabLen : null;
  for (const r of spec.rows || []) for (const x of r.xs) {
    if (cabZone && x < cabZone[1]) continue;
    if (cabZoneR != null && x + r.w > cabZoneR) continue;
    liv += win(x, r.y, r.w, r.h, r.r ?? 0.3);
  }
  s += path(d, spec.base ?? C.steel) + clipped(d, liv);
  for (const dr of spec.doors || []) {
    s += door(dr.x, dr.y0, dr.w, dr.y1 - dr.y0, { leaves: dr.leaves ?? 1, glassY: dr.glassY ?? 0.45, glassH: dr.glassH ?? 0.38, grabs: dr.grabs ?? true });
  }
  for (const [x, w, h, y = roof] of spec.roofItems || []) s += rect(x, y - 0.05, w, h, C.steelDark, 0.4, 'rx="0.2"');
  if (spec.extra) s += spec.extra(c, g);
  if (c.cabL && spec.cab) s += spec.cab(c, g);
  const full = [x0 + e.len + e.ramp, x1 - e.len - e.ramp];
  s += carBadge(c, spec, {
    rows: (spec.rows || []).map((r) => [r.y, r.h, r.xs.map((x) => [x, x + r.w])]),
    doors: (spec.doors || []).map((dr) => [dr.x - 0.5, dr.x + dr.w + 0.5, dr.y0, dr.y1]),
    sill: (spec.drop ? sill : sill + 0.4) + 0.2,
    top: (x) => (x > full[0] && x < full[1] ? roof : e.h) - 0.7,
  });
  // A cab at the right end too (double-ended cars): the left cab's details, mirrored.
  if (c.cabR && spec.cab && !spec.nose) s += `<g transform="matrix(-1 0 0 1 ${L} 0)">${spec.cab({ ...c, lead: false }, g)}</g>`;
  s += outlineOf(d) + carEnds(c, { floor: spec.diaphragm?.[0] ?? 4.25, top: spec.diaphragm?.[1] ?? e.h - 1.2 });
  return s;
}

// --- Bombardier BiLevel (Metrolink, FrontRunner, Tri-Rail; GO Transit
// design): 85 ft over couplers, 15 ft 11 in to the roof over the middle,
// 14 ft over the end sections, rising in a long S-curve to the full roof
// about 16 ft in from each end; trucks 64 ft apart, 8 ft 6 in wheelbase,
// 33 in wheels; lower floor 25 in above the rail. Octagonal body: bevels
// above the upper windows and below the lower ones. Two sets of bi-parting
// doors on the lower level each side, inboard of the trucks (one moved toward
// the middle since 1992), four lower windows between them, nine upper
// windows, three at each end level (the middle one widest).
const BOMB = {
  roof: 15.92, sill: 3.7, ends: { h: 14.1, len: 9.5, ramp: 6.5 }, cornerR: 0.9,
  drop: { a: 16.6, b: 68.4, y: 1.25 }, trucks: { centers: 64, wb: 8.5, d: 33 }, chamfer: [2.4, 14.15],
  // Metrolink: the name in teal above the end windows at one end.
  // FrontRunner: the name between the decks mid-car. Tri-Rail: its logo high
  // near one end. GO: the logo big on the white band, over the third lower
  // window. SunRail: its round emblem on the lower level between the B-end
  // door and end windows. Sounder: the Sound Transit mark in white low in
  // each end section, SOUNDER big under the lower windows. Rail Runner: its
  // name over the A-end windows (the cab car's at the far end).
  badge: (c) => ({ metrolink: { x: 7.4, y: 11.1, h: 0.95, logo: "metrolink-teal" }, frontrunner: { x: 42.5, y: 9.8, h: 0.95 }, trirail: { x: 44, y: 9.2, h: 1.7, logo: "trirail-onnavy" },
    go: { x: 41.8, y: 8.45, h: 2.3 }, sunrail: { x: 64.3, y: 6.0, h: 2.8 },
    sounder: [{ x: 13.5, y: 5.9, h: 0.9, dark: true }, { x: 67, y: 5.9, h: 0.9, dark: true }, { x: 38.4, y: 3.2, h: 3.5, logo: "sounder-word" }],
    railrunner: rrCarName(c.rrCab ? c.L - 12.1 : 12.1) })[c.agency],
  rows: [{ xs: seq(16.9, 5.55, 9), y: 11.6, w: 4.3, h: 2.3, r: 0.35 }, { xs: seq(27.6, 5.55, 4), y: 4.5, w: 4.3, h: 2.5, r: 0.35 },
    { xs: [1.4], y: 6.9, w: 3.9, h: 2.3, r: 0.3 }, { xs: [6.5], y: 6.9, w: 4.3, h: 2.3, r: 0.3 }, { xs: [11.7], y: 6.9, w: 2.9, h: 2.3, r: 0.3 },
    { xs: [68.6], y: 6.9, w: 3.1, h: 2.3, r: 0.3 }, { xs: [73.0], y: 6.9, w: 4.6, h: 2.3, r: 0.3 }, { xs: [79.0], y: 6.9, w: 3.4, h: 2.3, r: 0.3 }],
  doors: [{ x: 19.6, w: 4.4, y0: 1.55, y1: 8.7, leaves: 2, glassY: 0.45, glassH: 0.38 }, { x: 55.6, w: 4.4, y0: 1.55, y1: 8.7, leaves: 2, glassY: 0.45, glassH: 0.38 }],
  roofItems: [[3.0, 5.5, 0.35, 14.1], [76.5, 5.5, 0.35, 14.1]], diaphragm: [4.25, 13.2],
};
// Paint by railroad. FrontRunner: white, a blue sweep at one end and red at the
// other. Metrolink: white with blue and green ribbons. Tri-Rail: white, blue
// band with green and orange pinstripes. Others: white with a band in the
// railroad's color.
// Tri-Rail's "On Track" wrap (2023 on, on every car): navy fading to blue
// toward the bottom; orange, green and light blue stripes slanting across
// one end; chevrons pointing ahead near the middle and the other end.
const TRI = { orange: "#f39a2b", green: "#8cc63f", sky: "#5bc2e7", teal: "#1f8fb8" };
function triRailPaint(c, g) {
  const L = g.L, id = `ts-tri-${++clipSeq}`;
  let s = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="2" x2="0" y2="16">` +
    `<stop offset="0" stop-color="#1f74a8"/><stop offset="0.55" stop-color="#1d3f86"/><stop offset="1" stop-color="#1c2566"/></linearGradient></defs>`;
  s += rect(0, 0, L, 17, `url(#${id})`);
  [TRI.orange, TRI.green, TRI.sky].forEach((col, k) => {
    const x = 3 + k * 2.6;
    s += path(poly([[x, 17], [x + 2.2, 17], [x + 8.2, 0], [x + 6.0, 0]]), col);
  });
  const chevron = (x, w, col) => path(poly([[x, 14.5], [x + w, 14.5], [x + w + 3.6, 8.6], [x + w, 2.6], [x, 2.6], [x + 3.6, 8.6]]), col);
  s += chevron(21.5, 1.6, TRI.green) + chevron(23.6, 1.6, TRI.sky) + path(poly([[18.5, 8.6], [20.3, 10.4], [22.1, 8.6], [20.3, 6.8]]), TRI.orange);
  s += chevron(L - 24, 1.4, TRI.sky) + chevron(L - 21.4, 1.4, TRI.orange) + chevron(L - 18.8, 1.4, TRI.green);
  return s;
}
// Metrolink today (Rotem cars and the refurbished BiLevels): stainless, a
// teal band through the end windows that narrows to run between the decks,
// two light blue ribbons waving along it.
function metrolinkBand(L) {
  const T = "#0e8a86";
  let s = path(`M0 6.5L15.6 6.5Q16.4 6.5 16.6 7.45L${L - 16.6} 7.45Q${L - 16.4} 6.5 ${L - 15.6} 6.5L${L} 6.5L${L} 9.7L${L - 15.6} 9.7Q${L - 16.4} 9.7 ${L - 16.6} 8.9L16.6 8.9Q16.4 9.7 15.6 9.7L0 9.7Z`, T);
  const wave = (y, a, ph) => `M-2 ${y}C${8 + ph} ${y + a} ${16 + ph} ${y - a} ${26 + ph} ${y}S${44 + ph} ${y + a} ${54 + ph} ${y}S${72 + ph} ${y - a} ${L + 4} ${y}`;
  s += path(wave(8.3, 3.2, 0), "none", 0, 'stroke="#4fb3e2" stroke-width="0.45"') + path(wave(8.1, -2.6, 3), "none", 0, 'stroke="#9bd9e4" stroke-width="0.35"');
  return s;
}
// Sounder's BiLevels: the wave breaks twice in each end section and three
// times along the middle, troughs between the doors and the end windows.
const SOUNDER_BL_WAVE = [[-1, 9.6, 9.0, 7.5], [1.5, 10.9, 9.6, 7.9], [5, 11.7, 10.3, 8.9], [8, 10.9, 9.7, 8.6], [11, 9.6, 8.6, 7.8],
  [14, 9.2, 7.8, 7.2], [17, 10.0, 8.8, 8.2], [20, 10.9, 10.0, 9.2], [23, 11.4, 10.6, 10.2], [26, 11.3, 10.3, 9.7], [29, 9.9, 9.1, 7.9],
  [32.5, 9.4, 8.55, 7.7], [36.5, 10.0, 8.9, 8.4], [40, 10.85, 9.4, 8.9], [42.5, 11.0, 9.2, 7.6], [45.5, 9.5, 8.0, 7.0], [47.8, 8.5, 7.7, 7.0],
  [50, 9.1, 8.3, 7.0], [53, 10.2, 9.6, 8.5], [56, 11.25, 10.3, 9.3], [58.5, 11.1, 10.2, 9.4], [60.5, 10.7, 9.7, 9.1], [63.5, 8.2, 7.4, 6.8],
  [65.5, 8.2, 7.3, 6.8], [68, 9.0, 8.0, 7.2], [71, 10.3, 9.4, 8.8], [74, 11.1, 9.8, 9.0], [76.5, 10.6, 9.4, 8.4], [80, 8.9, 7.8, 7.1],
  [83, 9.4, 8.2, 7.5], [87, 9.6, 8.4, 7.6]];
// Rail Runner's BiLevels (coaches 1001-1013, cab cars 1101-1109): light
// gray with red and yellow swooshes rising toward the B end like the
// roadrunner's head and tail feathers. From the A end: a red band, lined in
// yellow, climbs from the bottom over the lower windows and hooks back down
// to a point by the B-end door; a thin red flame shoots up from it ahead of
// the A-end door; a second red band over yellow rises from it along the
// upper windows to a point over the B-end windows, under a red crest arcing
// over the last upper windows; a red swoosh along the bottom at each end.
// The cab cars carry it the other way round, the crest at the cab.
function railRunnerPaint(c, g) {
  let s = rect(0, 0, g.L, 18, RR.body);
  // The bottom swooshes: a thin tail from the A end, a broad one at the B end.
  s += smoothBlob([[9, 3.9], [14, 3.6], [18, 2.9], [23, 2.2], [30, 1.6]], [[9, 3.9], [14, 3.3], [18, 2.5], [23, 1.9], [30, 1.6]], RR.red);
  s += path(`${smoothPath([[54, 1.2], [59, 2.0], [64, 3.4], [70, 4.6], [75, 5.1], [80, 5.0], [86, 4.5]])}L86 -1L54 -1Z`, RR.red);
  // The lower band and its yellow lining, from the A end.
  const lowRed = [[-1, 3.0], [4, 3.3], [8, 3.9], [12, 4.4], [16, 4.9], [20, 5.4], [24, 5.9], [30, 6.8], [36, 7.3], [44, 7.6], [50, 7.6], [54, 7.2], [58, 6.0], [62, 4.6]];
  s += smoothBlob(lowRed, [[-1, 2.6], [4, 2.9], [8, 3.5], [12, 4.0], [16, 4.5], [20, 5.0], [24, 5.4], [30, 6.4], [36, 7.0], [44, 7.2],
    [49, 6.7], [53, 5.9], [57, 5.0], [62, 4.6]], RR.yellow);
  s += smoothBlob([[-1, 5.0], [4, 4.9], [8, 5.0], [12, 5.3], [16, 6.1], [20, 6.9], [24, 7.6], [30, 8.4], [38, 8.8], [46, 8.9], [52, 8.6], [56, 7.8], [59, 6.4], [62, 4.6]], lowRed, RR.red);
  // The flame ahead of the A-end door.
  s += smoothBlob([[4, 5.0], [9, 5.8], [13, 6.6], [17, 7.7], [21, 9.0], [24.5, 10.6]], [[4, 4.8], [9, 5.2], [13, 5.9], [17, 7.0], [21, 8.4], [24.5, 10.6]], RR.red);
  // The upper band over its yellow, to a point over the B-end windows.
  const upLow = [[18, 6.6], [24, 7.1], [30, 8.2], [36, 9.2], [40, 9.7], [48, 10.3], [56, 10.7], [62, 10.65], [68, 10.2], [72, 9.8], [76, 9.3], [80.5, 9.0]];
  s += smoothBlob(upLow, [[18, 6.6], [24, 6.9], [30, 7.75], [36, 8.6], [40, 9.2], [48, 9.8], [56, 9.7], [62, 9.4], [66, 8.9], [70, 8.3], [74, 7.6], [78, 7.0], [80.5, 9.0]], RR.yellow);
  s += smoothBlob([[18, 6.6], [24, 7.9], [30, 9.3], [36, 10.8], [40, 11.4], [50, 11.5], [60, 11.7], [68, 11.5], [72, 11.0], [76, 10.1], [80.5, 9.0]], upLow, RR.red);
  // The crest arcing over the last upper windows.
  s += smoothBlob([[44, 12.0], [50, 13.7], [55, 14.8], [60, 15.4], [65, 15.5], [69, 15.0], [72, 14.3], [74.5, 13.2], [76.5, 12.0]],
    [[44, 12.0], [50, 12.9], [55, 13.8], [60, 14.2], [64, 14.2], [67, 13.6], [70, 12.8], [73, 12.3], [76.5, 12.0]], RR.red);
  return c.rrCab ? `<g transform="matrix(-1 0 0 1 ${g.L} 0)">${s}</g>` : s;
}
// Rail Runner's name on its BiLevels, toward the A end over the end windows.
const rrCarName = (x) => [{ x, y: 10.0, h: 0.6, logo: "rail-runner" }, { x: x - 3.6, y: 10.8, h: 0.28, logo: "new-mexico" }];
function bombPaint(c, g) {
  if (c.agency === "trirail") return triRailPaint(c, g);
  if (c.agency === "railrunner") return railRunnerPaint(c, g);
  if (c.agency === "sounder") return sounderWave(g.L, SOUNDER_BL_WAVE);
  const L = g.L;
  let s = rect(0, 0, L, 17, "#eef0f2");
  switch (c.agency) {
    case "frontrunner": {
      // Blue at the A end, red at the other; each ends in a swoosh leaning
      // the same way, with two thin lines of its color inboard of it (the
      // other side of the car swaps red and blue).
      const sw = (d, col, k) => path(`${d(0)}L${k > 0 ? 0 : L} 0L${k > 0 ? 0 : L} 17Z`, col) +
        [0.95, 1.85].map((o) => path(d(o * k), "none", 0, `stroke="${col}" stroke-width="0.42"`)).join("");
      s += sw((o) => `M${5.5 + o} 17Q${12.5 + o} 5.5 ${23 + o} 0.5`, "#2463c7", 1);
      s += sw((o) => `M${L - 24.5 + o} 17Q${L - 16.5 + o} 7.5 ${L - 5 + o} 0.5`, "#c8202f", -1);
      return s;
    }
    case "metrolink":
      return rect(0, 0, L, 17, "#cdd2d7") + metrolinkBand(L);
    case "go":
      return goBilevelPaint(c, g);
    default:
      return s + rect(0, 9.4, L, 1.1, c.color || "#1f5fad");
  }
}
export const bombardierBilevel = (c) => (c.agency === "go" ? goBilevel(c) : c.agency === "sunrail" ? sunrailBilevel(c)
  : bilevel(c, { ...BOMB, base: "#eef0f2", paint: bombPaint }));
// Cab car: the mid-1990s full-width cab in the end section, a flat end with
// two windows, the engineer's side window behind the corner in place of the
// first end window.
// Sounder's cab end: white stripes slanting across the blue below the
// windows; Rail Runner's red and yellow; both seen edge-on as a ladder.
const BOMB_CAB_STRIPES = { sounder: [SOUNDER.blue, "#f4f4f2"], railrunner: [RR.red, RR.yellow] };
export const bombardierCab = (c) => bilevel(c.agency === "railrunner" ? { ...c, rrCab: true } : c, { ...BOMB, base: "#eef0f2", paint: bombPaint, cabLen: 5,
  cab: (c, { x0 }) => {
    let s = "";
    const st = BOMB_CAB_STRIPES[c.agency];
    if (st) for (let k = 0; k < 5; k++) s += rect(x0, 4.3 + k * 0.5, 0.45, 0.5, st[k % 2]);
    s += rect(x0, 6.8, 0.45, 2.8, C.black) + win(x0 + 0.8, 6.9, 3.0, 2.3, 0.3);
    return s;
  } });

// A smooth curve through key points [[x, y], ...], eased between them: y at x.
function eased(pts) {
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [xa, ya] = pts[i - 1], [xb, yb] = pts[i];
      if (x <= xb) return ya + ((yb - ya) * (1 - Math.cos((Math.PI * (x - xa)) / (xb - xa)))) / 2;
    }
    return pts[pts.length - 1][1];
  };
}
// Paint between two eased curves (key points as for eased(), or a number
// for a level edge), from x = a to b: a swoosh of livery.
function between(top, bot, fill, a = -1, b = 100) {
  const f = typeof top === "number" ? () => top : eased(top), g = typeof bot === "number" ? () => bot : eased(bot);
  const xs = [];
  for (let x = a; x < b; x += 1) xs.push(x);
  xs.push(b);
  return path(poly([...xs.map((x) => [x, f(x)]), ...xs.reverse().map((x) => [x, g(x)])]), fill);
}
// A ribbon w ft wide centered on the eased curve through pts.
const ribbon = (pts, w, fill, a, b) => between(pts.map(([x, y]) => [x, y + w / 2]), pts.map(([x, y]) => [x, y - w / 2]), fill, a, b);

// --- SunRail's BiLevels (Orlando; Bombardier, 2013 on: cab cars 2000-2012,
// coaches 3000-3009), on the standard plan. White; from the cab end, dark
// green, sky blue and orange bands sweep down toward the far end, the green
// running out at the B-end door; a broad yellow swoosh high over the cab
// end drops between the decks, and a thin one falls from the roof beside
// the cab end to pass under the upper windows. "SunRail" spaced out in black
// under the upper windows; the round emblem low near the B end. The cab
// cars' ends are yellow.
function sunrailPaint(c, g) {
  const L = g.L;
  let s = rect(0, 0, L, 17, "#f4f5f2");
  s += between([[0, 6.2], [24, 6.0], [50, 3.6], [70, 1.0]], 0, SUNRAIL.green);
  s += between([[0, 7.4], [24, 7.3], [52, 5.4], [L, 5.2]], [[0, 6.65], [24, 6.5], [52, 4.5], [L, 4.2]], SUNRAIL.sky);
  s += between([[0, 9.4], [22, 9.4], [50, 7.3], [L, 6.6]], [[0, 7.8], [22, 7.8], [50, 6.0], [L, 5.4]], SUNRAIL.orange);
  s += between([[0, 12.0], [20, 11.9], [34, 9.4], [60, 8.2], [L, 8.0]], [[0, 10.6], [20, 10.4], [34, 8.4], [60, 7.3], [L, 6.8]], SUNRAIL.yellow);
  s += ribbon([[10.5, 16.6], [17, 12.6], [28, 9.7], [40, 8.7], [60, 9.6], [L, 10.4]], 0.55, SUNRAIL.yellow, 10, L + 1);
  return s;
}
// The name spaced out under the upper windows, centered at x.
const sunrailName = (x) => (c) => goLetters(c, x + 0.65, 10.55, 1.15, "SunRail", "#1d1f22", { weight: 600, spacing: 1.3 });
const sunrailBilevel = (c) => bilevel(c, { ...BOMB, base: "#f4f5f2", paint: sunrailPaint, extra: sunrailName(42.5) });
// Cab car: the yellow end on the corner post; the engineer's side window.
const sunrailCab = (c) => bilevel(c, { ...BOMB, base: "#f4f5f2", paint: sunrailPaint, cabLen: 5, extra: sunrailName(35.5),
  cab: (c, { x0 }) => rect(x0, 3.75, 0.45, 10.2, SUNRAIL.cab) + win(x0 + 0.8, 6.9, 3.0, 2.5, 0.3) });

// --- GO Transit's BiLevels (GO 2000-2857, and Series IX 4000-4225 and
// 4500-4533 from 2015, built to the same plan). Current scheme: the upper
// level green up to the white roof, a white band between the levels with
// the logo big over the middle, lime through the lower windows, a dark gray
// skirt, METROLINX small in white at the B end. The newer cars have two
// windows in each end section, leaving out the one nearest the coupler.
const GO_BL_ROWS = BOMB.rows.filter((r) => r.xs[0] !== 1.4 && r.xs[0] !== 79.0);
// left: the roofline from the left end to the full-height roof, as path
// data; upper and lower: the green and the lime and skirt.
function goBilevelPaint(c, g, { left = "M-1 14.1L10.2 14.1Q13.45 14.1 13.45 15.01Q13.45 15.92 16.7 15.92", upper = null, lower = null } = {}) {
  const L = g.L;
  let s = rect(0, 0, L, 17, "#eef0f2") + (upper ?? rect(0, 9.9, L, 8, GO.green));
  // The white roof just showing over the green.
  s += path(`${left}L${L - 16.7} 15.92Q${L - 13.45} 15.92 ${L - 13.45} 15.01Q${L - 13.45} 14.1 ${L - 10.2} 14.1L${L + 1} 14.1`, "none", 0, 'stroke="#eef0f2" stroke-width="0.55"');
  return s + (lower ?? rect(0, 4.0, L, 3.0, GO.lime) + rect(0, 0, L, 4.0, GO.skirt));
}
const goMetrolinx = (c) => goLetters(c, c.L - 9.2, 5.6, 0.42, "METROLINX", "#ffffff", { spacing: 0.05 });
const goBilevel = (c) => bilevel(c, { ...BOMB, base: "#eef0f2", rows: GO_BL_ROWS, paint: bombPaint, extra: goMetrolinx });
// GO's crash-energy-management cab cars (300-380, 2015 on): a coach's body
// with the cab built on ahead of the end section, about 4 ft 4 in longer. The
// cab is a white fiberglass shell about 14 ft 7 in tall, its front almost
// upright and rounded over into the cab roof, one big windshield across it;
// behind it the roof rises gently to full height over the end section. The
// green comes down off the roof behind the cab and sweeps back along the
// side; the lime rises from under the cab to the lower windows.
const GO_CAB = 4.3;                                                  // the cab's added length
const goShift = (x) => x + GO_CAB;
const GO_CAB_NOSE = [[1.2, 3.7], [0.85, 4.4], [0.75, 9.2], ["q", 0.8, 12.9, 1.6, 14.0], ["q", 2.1, 14.6, 3.3, 14.6], [5.4, 14.6],
  ["q", 9.5, 14.6, 12.0, 15.25], ["q", 14.0, 15.92, 17.5, 15.92]];
export const goCab = (c) => bilevel(c, { ...BOMB, base: "#eef0f2", cabLen: 5, nose: GO_CAB_NOSE, noTrucks: true,
  rows: GO_BL_ROWS.map((r) => ({ ...r, xs: r.xs.map(goShift) })), doors: BOMB.doors.map((d) => ({ ...d, x: goShift(d.x) })),
  drop: { ...BOMB.drop, a: goShift(BOMB.drop.a), b: goShift(BOMB.drop.b) }, roofItems: [[goShift(76.5), 5.5, 0.35, 14.1]],
  badge: { x: goShift(41.8), y: 8.45, h: 2.3 },
  paint: (c, g) => {
    const L = g.L;
    if (!c.cabL) return goBilevelPaint(c, g);
    return goBilevelPaint(c, g, { left: "M-1 14.6L5.4 14.6Q9.5 14.6 12.0 15.25Q14.0 15.92 17.5 15.92",
      upper: path(`M${L + 1} 9.9L44 9.9C32 9.9 24 10.4 19 11.6C13.5 13.0 8.5 13.6 5.4 17L${L + 1} 17Z`, GO.green),
      lower: path(`M${L + 1} 7.0L24 7.0C16 7.0 10.5 5.4 6.2 4.0L${L + 1} 4.0Z`, GO.lime) +
        path(`M${L + 1} 4.0L6.2 4.0C5.5 3.5 5.1 2.5 4.8 0L${L + 1} 0Z`, GO.skirt) });
  },
  cab: () => {
    // Windshield seen edge-on round the front, the trapezoid cab side
    // window and its mirror; the horns on the cab roof; the plow.
    let s = path(poly([[0.8, 9.6], ["q", 0.84, 12.6, 1.5, 13.7], [2.05, 13.7], ["q", 1.45, 12.3, 1.45, 9.6]]), C.glass);
    s += path(poly([[2.1, 10.2], [2.6, 13.1], [4.4, 13.1], [4.4, 10.2]]), C.glass, 0, `stroke="${C.gasket}" stroke-width="0.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"`);
    s += rect(5.0, 10.7, 0.32, 1.7, C.steelDark, 0.4);
    s += rect(2.6, 14.55, 2.2, 0.3, C.steelDark, 0.4) + [2.8, 3.5, 4.2].map((x) => path(`M${x} 14.85L${x + 0.55} 14.85L${x + 0.45} 15.4L${x + 0.1} 15.4Z`, "#cfc6b0", 0.4)).join("");
    return s + pilot(1.0, 3.7);
  },
  extra: (c) => [10.5, 74.5].map((x) => truck(goShift(x), { wb: BOMB.trucks.wb, d: BOMB.trucks.d, top: BOMB.sill })).join("") + goMetrolinx(c) });

// --- Hyundai Rotem "Guardian" cab car (Metrolink 638-695, Tri-Rail 512-521):
// same 85 ft and 64 ft truck centers, but flat-topped at 15 ft 10 in with
// rounded shoulders; lower-level doors 23 ft 5 in and 26 ft 3 in from the car
// ends; nine upper windows, three lower ones and a sign board; two windows at
// each end level (one at the cab end, ahead of the door; the cab has a
// louvered intake behind its side window). The cab rides at upper-level height behind a crush zone,
// under a sloped fiberglass mask: from the roof down to 8 ft above the rail
// over 6 ft 8 in, then an upright lower face.
const ROTEM = {
  roof: 15.87, sill: 3.7, cornerR: 1.0,
  drop: { a: 16.6, b: 68.4, y: 1.25 }, trucks: { centers: 64, wb: 8.5, d: 33 },
  // Metrolink: the name big in teal over the band at the B end.
  badge: (c) => ({ metrolink: { x: c.L - 9.8, y: 12.2, h: 1.55, logo: "metrolink-teal" }, trirail: { x: 44, y: 9.4, h: 1.7, logo: "trirail-onnavy" } })[c.agency],
  rows: [{ xs: seq(18.9, 5.42, 9), y: 11.4, w: 4.4, h: 2.2, r: 0.4 }, { xs: seq(28.4, 5.42, 4), y: 4.6, w: 4.4, h: 2.1, r: 0.4 },
    { xs: [15.8, 73.5, 78.6], y: 6.9, w: 4.0, h: 2.2, r: 0.4 }],
  doors: [{ x: 21.1, w: 4.67, y0: 1.55, y1: 8.1, leaves: 2, glassY: 0.42, glassH: 0.42 }, { x: 56.4, w: 4.67, y0: 1.55, y1: 8.1, leaves: 2, glassY: 0.42, glassH: 0.42 }],
  diaphragm: [4.25, 13.6],
};
function rotemPaint(c, g) {
  if (c.agency === "trirail") return triRailPaint(c, g);
  const L = g.L;
  let s = rect(0, 0, L, 17, C.steel) + flutes(0, L, 2.0, 3.6, 0.3);
  if (c.agency === "metrolink") s += metrolinkBand(L);
  else s += rect(0, 9.3, L, 1.2, c.color || "#1f5fad");
  return s;
}
// Metrolink's cab cars: a wide teal stroke rising from the cab's teal face
// over the roof behind the cab window and back down to the band.
export const rotemCabCar = (c) => bilevel(c, { ...ROTEM, cabLen: 9,
  paint: (c, g) => rotemPaint(c, g) + (c.agency === "metrolink" ? path("M3 4.2C8 9 8.5 16.5 12 16.2S15.5 9.5 21 8.2", "none", 0, 'stroke="#0e8a86" stroke-width="2.2"') : ""),
  nose: [[0.9, 3.7], [0.9, 8.0], [7.6, 15.87]],
  cab: (c, { x0 }) => {
    const metrolink = c.agency === "metrolink";
    // Black mask over the slope; teal lower face (Metrolink); three-pane
    // windshield seen edge-on; trapezoid cab side window.
    let s = path(poly([[0.9, 8.0], [7.6, 15.87], [9.6, 15.87], [9.6, 11.0], [5.0, 8.0]]), "#17191c");
    s += path(poly([[0.9, 3.75], [0.9, 8.0], [5.0, 8.0], [3.6, 3.75]]), metrolink ? "#00a19a" : "#2d62b3");
    s += line(0.9, 8.0, 5.0, 8.0, "#ffffff", 1.2) + line(5.0, 8.0, 9.6, 11.0, "#ffffff", 1.0);
    s += path(poly([[3.6, 11.2], [5.75, 13.75], [6.4, 13.75], [6.4, 11.2]]), C.glass) + path(poly([[6.9, 11.3], [8.9, 11.3], [8.9, 13.6], [7.5, 13.6]]), C.glass);
    s += rect(10.0, 11.5, 2.4, 2.0, "rgba(20,22,25,0.55)", 0.4) + slats(10.0, 11.5, 2.4, 2.0, 0.3, "rgba(255,255,255,0.18)");
    return s + outlineOf(poly([[0.9, 3.7], [0.9, 8.0], [7.6, 15.87], [9.6, 15.87]]));
  } });
export const rotemCoach = (c) => bilevel(c, { ...ROTEM, paint: rotemPaint });

// --- MBTA bi-levels (Kawasaki BTC-4 and CTC-4, 1990-2006; Hyundai Rotem
// BTC-4D and CTC-5, 2012-2024, built to the same plan): 85 ft 4 in, 15 ft
// 6 in, stainless. Doors at the extreme ends of the car, at the end-section
// level over the trucks, with trap steps for low platforms. Nine big
// windows on each deck between the trucks; two small ones at mid level in
// one end section. A purple band between the decks, edged in yellow, that
// widens over the end sections (down over their windows, up to the door
// windows) and runs across the doors.
const MBTA_BL = {
  roof: 15.5, sill: 3.7, cornerR: 0.9, ends: { h: 15.2, len: 12.4, ramp: 2.0 },
  drop: { a: 17.4, b: 67.9, y: 1.3 }, trucks: { centers: 59.5, wb: 8.5, d: 33 },
  rows: [{ xs: seq(18.6, 5.5, 9), y: 11.0, w: 4.4, h: 2.4, r: 0.45 }, { xs: seq(18.6, 5.5, 9), y: 4.6, w: 4.4, h: 2.2, r: 0.45 },
    { xs: [6.6, 9.6], y: 7.3, w: 2.4, h: 2.0, r: 0.3 }],
  doors: [{ x: 1.35, w: 2.6, y0: 4.25, y1: 12.6, glassY: 0.55, glassH: 0.36 }, { x: 81.38, w: 2.6, y0: 4.25, y1: 12.6, glassY: 0.55, glassH: 0.36 }],
  roofItems: [[3.5, 7, 0.45, 15.2], [74.8, 7, 0.45, 15.2]], diaphragm: [4.25, 13.6],
  badge: { x: 43, y: 9.1, h: 1.6 },                                   // in the purple band between the decks
};
function mbtaBand(c, g) {
  const L = g.L, P = MBTA.purple, Y = MBTA.yellow;
  const pts = (list) => list.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y}`).join("");
  const top = [[0, 10.9], [13.0, 10.9], [13.3, 10.45], [L - 13.3, 10.45], [L - 13.0, 10.9], [L, 10.9]];
  const bot = [[L, 6.9], [L - 16.4, 6.9], [L - 16.7, 7.7], [16.7, 7.7], [16.4, 6.9], [0, 6.9]];
  let s = rect(0, 0, L, 17, C.steel) + line(0, 4.2, L, 4.2, "rgba(0,0,0,0.12)", 0.5);
  s += path(pts(top) + pts(bot).replace("M", "L") + "Z", P);
  s += path(pts(top) + pts(bot), "none", 0, `stroke="${Y}" stroke-width="0.22"`);
  return s;
}
const mbtaCabEnd = (c, { x0 }) => {
  let s = rect(x0, 4.3, 0.4, 10.5, "rgba(0,0,0,0.25)");
  return s;
};
export const mbtaBilevel = (c) => bilevel(c, { ...MBTA_BL, paint: mbtaBand });
export const mbtaCab = (c) => bilevel(c, { ...MBTA_BL, paint: mbtaBand, cab: mbtaCabEnd });

// A MARC cab car's end, seen edge-on: the blue and orange chevrons on its
// face show as a ladder of stripes at the corner. y0, y1: the chevron panel.
const marcCabEnd = (y0, y1) => (c, { x0 }) => {
  let s = rect(x0, 4.3, 0.4, 9, "rgba(0,0,0,0.25)");
  for (let k = 0; k < 4; k++) s += rect(x0, y0 + ((y1 - y0) * k) / 4, 0.42, (y1 - y0) / 4, k % 2 ? MARC.orange : MARC.blue);
  return s;
};

// --- MARC III (Kawasaki, 1999-2001; MARC 7800-7896, cab cars 7845-7858):
// the MBTA cars' body, with fewer, bigger windows: six two-pane windows
// upstairs and five below (an equipment locker under the first), a fluted
// panel between the decks and along the skirt; a big two-pane window in
// each end section at mid level; the door at each extreme end under a small
// transom. Paint: a blue band, edged below in orange, frames the upper
// windows and steps down at each end, slanting, to run along the end
// sections at mid level. The logo in white on the band at one end, the
// Maryland flag high at the other.
const MARC_KAW_UP = seq(22.55, 6.95, 6), MARC_KAW_LOW = seq(29.5, 6.95, 5);
const kawDoor = (x) => ({ x, w: 2.6, y0: 4.0, y1: 10.5, glassY: 0.5, glassH: 0.35 });
const MARC_KAW = { ...MBTA_BL,
  rows: [{ xs: MARC_KAW_UP, y: 11.0, w: 5.45, h: 2.4, r: 0.4 }, { xs: MARC_KAW_LOW, y: 4.6, w: 5.45, h: 2.2, r: 0.4 },
    { xs: [10.4, 69.5], y: 6.8, w: 5.45, h: 2.45, r: 0.4 }],
  doors: [kawDoor(1.35), kawDoor(81.38)],
  badge: { x: 78.0, y: 8.5, h: 1.15, dark: true },
  extra: (c, g) => {
    // Center mullions, the transoms over the doors, lockers on the lower level.
    let s = lines(MARC_KAW.rows.flatMap((r) => r.xs.map((x) => [x + r.w / 2, r.y + 0.08, x + r.w / 2, r.y + r.h - 0.08])), C.gasket, 0.9);
    s += win(1.65, 11.3, 2.0, 0.75, 0.15) + win(g.L - 3.65, 11.3, 2.0, 0.75, 0.15);
    s += rect(22.55, 4.8, 5.45, 1.8, "none", 0.45, 'rx="0.12"') + rect(11.4, 4.5, 3.6, 1.5, "none", 0.45, 'rx="0.12"');
    return s + rect(13.6, 11.4, 1.7, 0.55, "rgba(20,22,25,0.45)", 0.4) + slats(13.6, 11.4, 1.7, 0.55, 0.25);
  },
};
function marcKawPaint(c, g) {
  const L = g.L, ribs = (a, b, y0, y1) => lines(Array.from({ length: Math.floor((y1 - y0) / 0.32) + 1 }, (_, k) => [a, y0 + k * 0.32, b, y0 + k * 0.32]), C.steelShade, 0.8);
  let s = rect(0, 0, L, 17, C.steel) + ribs(21.0, L - 21.0, 7.1, 10.4) + ribs(18.6, L - 18.6, 1.6, 4.2);
  // One half of the band (the other is its mirror image): along the end
  // section, up the slant, along the upper windows to the middle.
  const half = path(poly([[3.95, 9.27], [15.9, 9.27], [19.5, 13.7], [L / 2, 13.7], [L / 2, 11.0], [21.6, 11.0], [18.4, 7.7], [3.95, 7.7]]), MARC.blue) +
    path(poly([[3.95, 7.7], [18.4, 7.7], [21.6, 11.0], [L / 2, 11.0], [L / 2, 10.6], [21.95, 10.6], [18.75, 7.16], [3.95, 7.16]]), MARC.orange);
  s += half + `<g transform="matrix(-1 0 0 1 ${L} 0)">${half}</g>`;
  return s + mdFlag(11.6, 11.6, 1.5);
}
export const marcKawasaki = (c) => bilevel(c, { ...MARC_KAW, paint: marcKawPaint });
export const marcKawasakiCab = (c) => bilevel(c, { ...MARC_KAW, paint: marcKawPaint, cab: marcCabEnd(7.0, 8.4) });

// --- Bombardier/Alstom MultiLevel (NJ Transit 7000-7767; MultiLevel III
// 8000s, the same body): 85 ft, 14 ft 6 in so it clears the Hudson tunnels.
// Low end roofs over the trucks rise to the full height over the two decks.
// Four single doors a side, all at the end-section level: one at each end
// with traps, one over each truck for high platforms only; between them a
// window and "NJ TRANSIT". Eight wide windows on each deck; NJ Transit's
// stripe between the decks the length of the middle, blue fading in at the
// front through magenta to orange fading out at the back.
const ML = {
  roof: 14.5, sill: 3.7, cornerR: 0.8, ends: { h: 13.5, len: 13.8, ramp: 3.0 },
  drop: { a: 18.6, b: 66.4, y: 1.3 }, trucks: { centers: 60.5, wb: 8.5, d: 36 },
  rows: [{ xs: seq(19.1, 6.0, 8), y: 9.35, w: 4.8, h: 2.55, r: 0.35 }, { xs: seq(19.1, 6.0, 8), y: 2.95, w: 4.8, h: 2.45, r: 0.35 },
    { xs: [8.6, 74.3], y: 7.2, w: 2.1, h: 2.3, r: 0.3 }],
  doors: [{ x: 1.3, w: 2.75, y0: 4.25, y1: 10.9, glassY: 0.55, glassH: 0.32 }, { x: 11.8, w: 2.75, y0: 4.25, y1: 10.9, glassY: 0.55, glassH: 0.32 },
    { x: 70.45, w: 2.75, y0: 4.25, y1: 10.9, glassY: 0.55, glassH: 0.32 }, { x: 80.95, w: 2.75, y0: 4.25, y1: 10.9, glassY: 0.55, glassH: 0.32 }],
  roofItems: [[4.5, 5.5, 0.4, 13.5], [75, 5.5, 0.4, 13.5]], diaphragm: [4.25, 12.5],
  badge: [{ x: 6.3, y: 8.35, h: 0.6, logo: "njt-word" }, { x: 78.7, y: 8.35, h: 0.6, logo: "njt-word" }],  // each end section
};
function njtPaint(c, g) {
  const L = g.L, id = `ts-njt-${++clipSeq}`;
  let s = rect(0, 0, L, 17, C.steel);
  s += `<defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="#22389a" stop-opacity="0"/>` +
    '<stop offset="0.06" stop-color="#22389a"/><stop offset="0.22" stop-color="#2a3d9a"/><stop offset="0.4" stop-color="#d0207f"/>' +
    '<stop offset="0.55" stop-color="#e8336e"/><stop offset="0.72" stop-color="#f26b2a"/><stop offset="0.9" stop-color="#f47c3c" stop-opacity="0.7"/>' +
    '<stop offset="1" stop-color="#f47c3c" stop-opacity="0"/></linearGradient></defs>';
  s += rect(18.0, 6.25, L - 36.0, 1.25, `url(#${id})`);
  return s;
}
// MARC IV (2014; MARC 8000-8094, cab cars 8045-8059): the same body.
// Stainless, a blue band over an orange stripe between the decks, through
// the end sections and their windows, stopping at the doors; the logo in
// white on the band beside the end window (at the cab end of a cab car),
// the Maryland flag over the other end window.
function marcMlPaint(c, g) {
  const L = g.L;
  let s = rect(0, 0, L, 17, C.steel);
  for (const [a, b] of [[0.7, 1.3], [4.05, 11.8], [14.55, 70.45], [73.2, 80.95], [83.7, L - 0.7]]) {
    s += rect(a, 7.7, b - a, 1.3, MARC.blue) + rect(a, 7.2, b - a, 0.5, MARC.orange);
  }
  return s + mdFlag(75.35, 10.3, 1.2);
}
const marcMlBadge = (x) => ({ x, y: 8.35, h: 0.95, dark: true });
export const multilevel = (c) => bilevel(c, { ...ML, ...(c.agency === "marc" ? { paint: marcMlPaint, badge: marcMlBadge(78.7) } : { paint: njtPaint }) });
export const multilevelCab = (c) => bilevel(c, { ...ML, ...(c.agency === "marc" ? { paint: marcMlPaint, badge: marcMlBadge(6.3), cab: marcCabEnd(5.55, 6.5) } : { paint: njtPaint,
  cab: (c, { x0 }) => rect(x0, 4.3, 0.4, 9, "rgba(0,0,0,0.25)") }) });

// --- Gallery cars (Metra: Nippon Sharyo 2002-05 and Amerail 1994-96 design):
// 85 ft, 15 ft 10 in, fluted stainless, the upper level a pair of balconies
// with their own row of windows over the lower ones, column for column: six
// each side of the bi-parting doors in the middle of the car at the low
// level, an air-conditioning grille over the doors. Between the decks, left
// of the doors, a long blue Metra panel with the white logo.
const GAL_L = seq(1.8, 5.7, 6), GAL_R = seq(50.5, 5.66, 6);
const GALLERY = {
  roof: 15.86, sill: 3.7, cornerR: 1.2,
  drop: { a: 15.5, b: 69.5, y: 1.35 }, trucks: { centers: 61, wb: 8.5, d: 33 },
  rows: [{ xs: [...GAL_L, ...GAL_R], y: 11.2, w: 4.4, h: 2.3, r: 0.45 }, { xs: [...GAL_L, ...GAL_R], y: 5.6, w: 4.4, h: 2.3, r: 0.45 }],
  doors: [{ x: 40.2, w: 4.6, y0: 1.5, y1: 9.3, leaves: 2, glassY: 0.5, glassH: 0.35 }],
  diaphragm: [4.25, 14.0], panel: [23.4, 12.2],
  badge: { x: 29.5, y: 9.5, h: 1.35, dark: true }, // on the blue Metra panel
  extra: (c, g) => rect(39.8, 11.3, 5.4, 2.0, "rgba(20,22,25,0.45)", 0.4) + slats(39.8, 11.3, 5.4, 2.0, 0.3, "rgba(255,255,255,0.2)"),
};
function galleryPaint(c, g, spec = GALLERY) {
  const L = g.L;
  let s = rect(0, 0, L, 17, C.steel) + flutes(0, L, 1.4, 5.4, 0.3) + flutes(0, L, 8.0, 11.0, 0.3) + flutes(0, L, 13.8, 14.9, 0.3);
  s += rect(0, 14.9, L, 2, C.steelShade);
  if (c.agency === "metra") s += rect(spec.panel[0], 8.5, spec.panel[1], 2.0, "#1f6fd0");
  return s;
}
// Metra cab ends: red and white chevrons on the end panels around the door;
// the engineer's small two-pane window high on the side.
const galleryCab = (c, { x0 }) => {
  let s = "";
  for (let k = 0; k < 6; k++) s += rect(x0, 3.8 + k * 1.9, 0.42, 0.95, k % 2 ? "#ffffff" : "#c8102e");
  s += win(x0 + 1.2, 11.9, 1.45, 1.8, 0.25) + win(x0 + 2.75, 11.9, 1.45, 1.8, 0.25);
  return s;
};
const galCabRows = [{ xs: GAL_L.slice(1).concat(GAL_R), y: 11.2, w: 4.4, h: 2.3, r: 0.45 }, GALLERY.rows[1]];
// VRE's Gallery IVs (Sumitomo/Nippon Sharyo; coaches 800-879, cab cars
// 710-730): Metra's body, its windows column for column, but a wider pair of
// doors (about 5 ft 7 in), a little left of the middle. Stainless; a dark
// blue band between the decks from the door's left to well past it (VRE
// letters its name on it, left off here: see VRE above), and at each end the
// flag stripes, blue, white, blue, white and red, cut on a slant: inboard of
// the end at the A end, out to the corner at the B end. No logo is drawn.
const VRE_GAL = { ...GALLERY, badge: false, doors: [{ x: 39.6, w: 5.6, y0: 1.5, y1: 9.3, leaves: 2, glassY: 0.5, glassH: 0.35 }] };
function vreFlag(a, b, slantRight) {
  const top = 10.35, cut = 1.3 / 1.65;
  let s = "";
  for (const [y, h, col] of [[10.0, 0.35, VRE.navy], [9.7, 0.3, "#f4f5f7"], [9.3, 0.4, VRE.navy], [9.0, 0.3, "#f4f5f7"], [8.7, 0.3, VRE.red]]) {
    const at = (yy) => (top - yy) * cut;
    s += path(poly(slantRight ? [[a, y], [b - at(y), y], [b - at(y + h), y + h], [a, y + h]] : [[a + at(y), y], [b, y], [b, y + h], [a + at(y + h), y + h]]), col);
  }
  return s;
}
const vrePaint = (c, g) => galleryPaint(c, g) + rect(23.5, 9.55, 36.0, 1.1, VRE.navy) + vreFlag(2.0, 7.6, true) + vreFlag(78.4, g.L, false);
// The cab end: orange and black stripes slanting across it, edge-on.
const vreGalleryCab = (c, { x0 }) => {
  let s = "";
  for (let k = 0; k < 13; k++) s += rect(x0, 3.9 + k * 0.8, 0.42, 0.8, k % 2 ? "#1d1f22" : VRE.orange);
  return s + win(x0 + 1.2, 11.9, 1.45, 1.8, 0.25) + win(x0 + 2.75, 11.9, 1.45, 1.8, 0.25);
};
export const gallery = (c) => bilevel(c, c.agency === "vre" ? { ...VRE_GAL, paint: vrePaint } : { ...GALLERY, paint: galleryPaint });
export const galleryCabCar = (c) => bilevel(c, { ...(c.agency === "vre" ? { ...VRE_GAL, paint: vrePaint, cab: vreGalleryCab } : { ...GALLERY, paint: galleryPaint, cab: galleryCab }),
  rows: c.cabL ? galCabRows : GALLERY.rows });
// Highliner II (Metra Electric, Nippon Sharyo 2012-16): the gallery body
// with motors, in married pairs. From the cab: the engineer's window and
// three balcony windows over four lower ones, the blue panel between the
// decks, the doors a little ahead of the middle, then four balcony windows
// over six lower ones. The single-arm pantograph sits on a lowered roof
// section at the inner end, with no upper windows beneath it.
const HL = { panel: [22.4, 11.0] };
// South Shore Line (NICTD 301-314, 2009, and 1201-1226 from Metra): the
// same cars; ahead of the doors a short plain panel with NICTD in maroon in
// place of Metra's blue one; a maroon band low on the cab ends.
const nictdHlCab = (c, { x0 }) => rect(x0, 6.4, 0.42, 1.0, NICTD.maroon) + rect(x0, 6.2, 0.42, 0.2, "#5a5f66") +
  win(x0 + 1.2, 11.9, 1.45, 1.8, 0.25) + win(x0 + 2.75, 11.9, 1.45, 1.8, 0.25);
export const highliner = married((c) => bilevel(c, { ...GALLERY, ...HL, paint: (c, g) => galleryPaint(c, g, HL) +
    (c.agency === "southshore" ? rect(27.1, 8.4, 6.8, 2.5, "#e3e6ea", 0.4, 'rx="0.15"') : ""),
  cab: c.agency === "southshore" ? nictdHlCab : galleryCab,
  rows: [{ xs: [7.1, 12.6, 18.1, 50.1, 55.9, 61.7, 67.5], y: 11.2, w: 4.3, h: 2.3, r: 0.45 },
    { xs: [1.5, 7.1, 12.7, 18.0, 50.1, 55.9, 61.7, 67.5, 73.3, 79.1], y: 5.6, w: 4.3, h: 2.3, r: 0.45 }],
  doors: [{ x: 37.0, w: 4.6, y0: 1.5, y1: 9.3, leaves: 2, glassY: 0.5, glassH: 0.35 }],
  badge: c.agency === "southshore" ? { x: 30.5, y: 9.65, h: 1.2, logo: "nictd" } : { x: 27.9, y: 9.5, h: 1.35, dark: true },
  extra: (c, g) => rect(36.6, 11.3, 5.4, 2.0, "rgba(20,22,25,0.45)", 0.4) + slats(36.6, 11.3, 5.4, 2.0, 0.3, "rgba(255,255,255,0.2)") +
    rect(g.L - 12.6, 14.6, 11.7, 1.3, "rgba(0,0,0,0.18)") + pantograph(g.L - 7.0, 14.6, { up: true, facing: -1 }) }));

// --- LIRR C3 (Kawasaki, 1997-99): 85 ft, only 14 ft 5.6 in tall. The ends
// over the trucks have lower roofs; a single-leaf sliding door in each end
// section right beside the high middle, high-platform only; a narrow window
// near each end. A fluted skirt along the lower deck; two blue stripes
// between the decks that spread apart over the end sections, one rising to
// the upper windows and one dropping below the end window, the MTA logo
// between them outboard of the door.
const C3 = {
  roof: 14.47, sill: 3.7, cornerR: 0.7, ends: { h: 13.6, len: 16.2, ramp: 1.6 },
  drop: { a: 17.8, b: 67.2, y: 1.3 }, trucks: { centers: 60, wb: 8.5, d: 36 },
  rows: [{ xs: seq(19.6, 3.35, 14), y: 10.75, w: 2.6, h: 2.05, r: 0.3 }, { xs: seq(19.6, 3.35, 14), y: 3.75, w: 2.6, h: 2.05, r: 0.3 },
    { xs: [1.9, 82.1], y: 8.3, w: 1.0, h: 2.2, r: 0.2 }],
  doors: [{ x: 13.5, w: 3.0, y0: 4.25, y1: 11.3, glassY: 0.5, glassH: 0.36 }, { x: 68.5, w: 3.0, y0: 4.25, y1: 11.3, glassY: 0.5, glassH: 0.36 }],
  roofItems: [[2.5, 9.0, 0.5, 13.6], [73.5, 9.0, 0.5, 13.6]], diaphragm: [4.25, 12.4],
  badge: [{ x: 11.0, y: 8.7, h: 0.9 }, { x: 74.0, y: 8.7, h: 0.9 }],  // in each end section, outboard of the door
};
function c3Paint(c, g) {
  const L = g.L, blue = "#3a62c6";
  let s = rect(0, 0, L, 17, "#c7ccd2") + flutes(19, L - 19, 1.4, 3.2, 0.28);
  // Each stripe: level across the middle, stepping out over the last few
  // feet of it to its end-section height, broken by the doors.
  for (const [mid, end] of [[8.85, 10.95], [7.45, 6.4]]) {
    s += rect(3.4, end, 9.9, 0.5, blue) + rect(L - 13.3, end, 9.9, 0.5, blue);
    s += path(`M16.7 ${end}L17.2 ${end}L19.6 ${mid}L${L - 19.6} ${mid}L${L - 17.2} ${end}L${L - 16.7} ${end}` +
      `L${L - 16.7} ${end + 0.5}L${L - 17.2} ${end + 0.5}L${L - 19.6} ${mid + 0.5}L19.6 ${mid + 0.5}L17.2 ${end + 0.5}L16.7 ${end + 0.5}Z`, blue);
  }
  s += rect(2.5, 4.6, 2.4, 1.8, "rgba(0,0,0,0.25)") + slats(2.5, 4.6, 2.4, 1.8, 0.3);
  return s;
}
export const c3 = (c) => bilevel(c, { ...C3, paint: c3Paint });
export const c3Cab = (c) => bilevel(c, { ...C3, paint: c3Paint,
  cab: (c, { x0 }) => rect(x0, 4.3, 0.42, 3.0, LIRR.yellow) });                  // yellow below the cab windows

// --- California Car (Morrison-Knudsen 1994-97) and Surfliner (Alstom
// 1998-2002): Superliner-sized bi-levels, 85 ft, 16 ft 2 in, but with two
// sets of automatic bi-parting doors a side on the lower level, one near each
// end inside the trucks, and the upper level running the full length.
// California Car: fluted stainless; a black band through the upper windows,
// navy through the lower ones under an orange-yellow stripe, orange wedges
// beside the doors, "Amtrak California" in white on the navy.
// Surfliner: blue from the roof down to a white stripe under the upper
// windows, "SURFLINER" spaced out in white along it; silver below with a blue
// and white pinstripe through the lower windows, a louvered panel at one end.
const CALCAR = {
  roof: 16.17, sill: 4.3, cornerR: 1.4,
  drop: { a: 15.8, b: 69.2, y: 1.35 }, trucks: { centers: 59.5, wb: 8.5, d: 36 },
  rows: [{ xs: seq(4.2, 5.55, 14), y: 10.4, w: 4.4, h: 2.8, r: 0.45 }, { xs: seq(24.4, 4.6, 8), y: 4.6, w: 3.4, h: 2.1, r: 0.35 }],
  doors: [{ x: 17.4, w: 4.4, y0: 1.45, y1: 8.2, leaves: 2, glassY: 0.42, glassH: 0.42 }, { x: 63.5, w: 4.4, y0: 1.45, y1: 8.2, leaves: 2, glassY: 0.42, glassH: 0.42 }],
  diaphragm: [8.4, 14.9],
};
function calPaint(c, g) {
  const L = g.L;
  let s = rect(0, 0, L, 17, "#c9cdd2") + flutes(0, L, 1.4, 4.0) + flutes(0, L, 7.95, 9.9) + flutes(0, L, 13.65, 15.0) + rect(0, 15.0, L, 2, C.steelShade);
  s += rect(0, 9.9, L, 3.75, "#1d1f22") + rect(0, 4.0, L, 3.5, "#1d2f5c") + rect(0, 7.5, L, 0.42, "#f3a41c");
  for (const dr of CALCAR.doors) {
    const a = dr.x - 0.1, b = dr.x + dr.w + 0.1;
    s += path(poly([[a, 7.5], [a - 1.8, 7.5], [a, 4.2]]), "#f26b21") + path(poly([[b, 7.5], [b + 1.8, 7.5], [b, 4.2]]), "#f26b21");
  }
  return s;
}
function surfPaint(c, g) {
  const L = g.L;
  return rect(0, 0, L, 17, "#c9cdd2") + flutes(0, L, 1.4, 4.2) + rect(0, 8.45, L, 8.5, "#2a4aa0") + rect(0, 8.45, L, 0.3, "#ffffff") +
    rect(0, 5.35, L, 0.18, "#2a4aa0") + rect(0, 5.53, L, 0.22, "#ffffff") + rect(0, 15.0, L, 2, "#253d7a") +
    rect(9.6, 4.6, 5.8, 3.3, "rgba(0,0,0,0.12)") + slats(9.6, 4.6, 5.8, 3.3, 0.3);
}
const calCab = (c, { x0 }) => {
  let s = rect(x0, 9.9, 0.42, 3.6, C.black) + win(x0 + 0.8, 10.6, 2.8, 2.6, 0.35);
  return s;
};
const calBadge = { x: 26.4, y: 5.75, h: 1.25, dark: true, logo: "amtrak-california" };
export const californiaCar = (c) => bilevel(c, { ...CALCAR, paint: calPaint, badge: calBadge });
export const californiaCab = (c) => bilevel(c, { ...CALCAR, paint: calPaint, cab: calCab, cabLen: 5, badge: calBadge });
// Surfliner: "SURFLINER" in white in the blue under the upper windows.
const surfBadge = { x: 42.5, y: 9.55, h: 1.1, logo: "surfliner-word" };
export const surfliner = (c) => bilevel(c, { ...CALCAR, paint: surfPaint, badge: surfBadge });
export const surflinerCab = (c) => bilevel(c, { ...CALCAR, paint: surfPaint, cab: calCab, cabLen: 5, badge: surfBadge });

// ===================== Single-level commuter coaches =====================
// The Comet II family (Bombardier): MBTA BTC-1A/1B, SEPTA's push-pull cars,
// Metro-North's Shoreliners. 85 ft, 13 ft to the roof, 51 in floor, smooth
// aluminum sides on a steel underframe, a vestibule with trap-door steps at
// each end, a row of near-square windows (one per seat pair). Shoreliner III
// and IV add a center door for high platforms; SEPTA's 2550s have one too.
// Cab cars: a flat end with a center door between the engineer's window and
// the other end window.
const COMET = {
  roof: 13.0, sill: 3.75, cornerR: 1.0, trucks: { centers: 59.5, wb: 8.5, d: 36 },
  rows: [{ xs: seq(6.3, 3.62, 20), y: 7.0, w: 2.75, h: 2.5, r: 0.3 }],
  doors: [{ x: 1.4, w: 2.6, y0: 3.95, y1: 10.95, glassY: 0.55, glassH: 0.3 }, { x: 81.0, w: 2.6, y0: 3.95, y1: 10.95, glassY: 0.55, glassH: 0.3 }],
  roofItems: [[34, 17, 0.45]], diaphragm: [4.25, 11.8],
};
const cometCenter = { x: 40.4, w: 4.2, y0: 3.95, y1: 10.95, leaves: 2, glassY: 0.55, glassH: 0.3 };
const skipAround = (xs, a, b) => xs.filter((x) => x + 2.75 < a || x > b);
function cometPaint(band, { stripe = null, pin = null } = {}) {
  return (c, g) => {
    const L = g.L;
    let s = rect(0, 0, L, 17, "#d3d7dc") + rect(0, 11.95, L, 2, C.steelShade) + rect(0, 0, L, 4.3, "#b8bdc3");
    for (let x = 5.6; x < L - 5; x += 7.24) s += line(x, 4.4, x, 6.6, "rgba(0,0,0,0.12)", 0.4);
    if (band) s += rect(0, 6.75, L, 3.0, band);
    if (stripe) s += rect(0, stripe[0], L, stripe[1], stripe[2]);
    if (pin) s += rect(0, pin[0], L, pin[1], pin[2]);
    return s;
  };
}
// Cab end: black frame around the end door and windows, lights.
const cometCab = (c, { x0 }) => {
  let s = rect(x0, 6.8, 0.42, 4.6, C.black);
  return s;
};
// MBTA's single-level coaches and cab cars (Bombardier, Pullman and MBB
// cars rebuilt alike): a tall purple band edged in yellow carrying twelve
// wide windows, the first one 11 ft from the end; the band crosses the end
// doors; a small T on the lower side mid-car.
const MBTA_SINGLE = {
  rows: [{ xs: seq(11.6, 5.6, 12), y: 7.75, w: 4.4, h: 2.0, r: 0.35 }],
  doors: [{ x: 1.6, w: 2.9, y0: 3.95, y1: 11.7, glassY: 0.6, glassH: 0.3 }, { x: 80.5, w: 2.9, y0: 3.95, y1: 11.7, glassY: 0.6, glassH: 0.3 }],
  roofItems: [[6.0, 2.6, 0.3], [76.4, 2.6, 0.3]],
};
const PAINT = {
  mbta: (c, g) => rect(0, 0, g.L, 17, "#d3d7dc") + rect(0, 11.95, g.L, 2, C.steelShade) + rect(0, 0, g.L, 4.3, "#b8bdc3") +
    rect(0, 7.5, g.L, 3.2, MBTA.purple) + rect(0, 10.6, g.L, 0.22, MBTA.yellow) + rect(0, 7.4, g.L, 0.22, MBTA.yellow),
  septa: cometPaint(null, { stripe: [9.9, 0.45, "#1f4fa3"], pin: [9.55, 0.3, "#e0352b"] }),
  ctdot: cometPaint("#c8102e"),
};
const single = (paint, { center = false, cab = false, spec = {} } = {}) => (c) => {
  const rows = center ? [{ ...COMET.rows[0], xs: skipAround(COMET.rows[0].xs, 39.4, 45.6) }] : spec.rows ?? COMET.rows;
  const badge = {
    mbta: { x: 45.5, y: 5.4, h: 1.1 },
  }[c.agency] ?? null;
  return bilevel(c, { ...COMET, ...spec, rows, doors: center ? [...COMET.doors, cometCenter] : spec.doors ?? COMET.doors, paint, cab: cab ? cometCab : null, cabLen: cab ? 4 : 0, badge });
};
export const mbtaSingle = single(PAINT.mbta, { spec: MBTA_SINGLE });
export const mbtaSingleCab = single(PAINT.mbta, { cab: true, spec: MBTA_SINGLE });
export const septaCoach = single(PAINT.septa);
export const septaCab = single(PAINT.septa, { cab: true });
// Metro-North's Shoreliners: five big windows each side of the center door
// in a wide blue band that stops short of the vestibules, the white MTA logo
// at each end of it.
const shorelinerMnr = (cab) => (c) => bilevel(c, { ...COMET,
  rows: [{ xs: [9.0, 15.1, 21.2, 27.3, 33.4, 46.6, 52.7, 58.8, 64.9, 71.0], y: 6.85, w: 5.0, h: 2.8, r: 0.5 }],
  doors: [...COMET.doors, cometCenter], cab: cab ? cometCab : null, cabLen: cab ? 4 : 0,
  paint: (c, g) => cometPaint(null)(c, g) + rect(4.4, 6.2, 35.5, 3.95, MNR_BLUE) + rect(45.1, 6.2, 35.5, 3.95, MNR_BLUE),
  badge: [{ x: 6.3, y: 8.2, h: 1.1, logo: "mta-inverse" }, { x: 78.7, y: 8.2, h: 1.1, logo: "mta-inverse" }],
});
// Shore Line East's own Shoreliner IIIs (CTDOT, 1991; off the line by the
// time the Mafersa coaches came): no center door, the row of windows in a
// red band. CTDOT's other Shoreliners run on Metro-North in its colors.
const ctShore = (c) => c.agency === "ctrail" || c.agency === "ctdot";
export const shoreliner = (c) => (ctShore(c) ? single(PAINT.ctdot) : shorelinerMnr(false))(c);
export const shorelinerCab = (c) => (ctShore(c) ? single(PAINT.ctdot, { cab: true }) : shorelinerMnr(true))(c);

// --- Mafersa coaches (CT Rail cab cars 1701-1719, coaches 1730-1774; built
// in Brazil in 1991-92 for VRE, CTDOT's since 2004): 85 ft 4 in, 13 ft 3.5 in
// to the roof, 51.5 in floor, Budd-style stainless: fluted below the
// windows, smooth above, a fluted roof with a louvered A/C hatch at each end.
// A vestibule at each end with a trap-door step. CTDOT's dress: a black
// window band from door to door with twelve wide windows and a short one by
// the B end; the New Haven's NH in red at the A end of the band, the round
// Connecticut Commuter Rail emblem at the B end; "CONNECTICUT DEPARTMENT OF
// TRANSPORTATION" on a red letterboard over the middle. Cab cars have the
// cab at the B end, its end face striped red and white; no CTrail logo on
// either.
const MAF = { roof: 13.29, sill: 3.9, cornerR: 1.2, trucks: { centers: 59.5, wb: 8.5, d: 36 }, end: 0.6, diaphragm: [4.3, 12.0], badge: false };
const MAF_WIN = { y: 7.1, w: 4.45, h: 2.4, r: 0.3 };
// x positions laid out from the A end; bLeft: the B end drawn on the left.
function mafersa(c, { cab = false } = {}) {
  const { L } = c, bLeft = cab;
  const X = (x, w = 0) => (bLeft ? L - x - w : x);
  const door = (x) => ({ x: X(x, 2.5), w: 2.5, y0: 4.05, y1: 11.0, glassY: 0.55, glassH: 0.33 });
  const letters = (x, y, h, t, fill, more = "") =>
    `<text transform="translate(${x.toFixed(2)} ${y}) scale(${c.mirrored ? -1 : 1} -1)" y="${(h * 0.36).toFixed(2)}" font-size="${h}" text-anchor="middle" fill="${fill}" ${more}>${t}</text>`;
  const paint = (c, g) => {
    let p = rect(0, 0, L, 17, "#d6dade") + flutes(0, L, 4.2, 6.6, 0.26) + rect(0, 11.9, L, 2, C.steelShade) + flutes(0, L, 12.1, 13.3, 0.3);
    p += rect(4.2, 6.85, L - 8.4, 2.9, CTRAIL.band, 0, 'rx="0.15"');
    // NH, the N over the H, in a slab serif.
    const font = 'font-weight="900" font-family="Rockwell, Roboto Slab, Georgia, serif"';
    p += letters(X(6.1), 8.95, 1.75, "N", CTRAIL.nh, font) + letters(X(6.1), 7.62, 1.75, "H", CTRAIL.nh, font);
    p += circle(X(78.2), 8.3, 0.75, "#ffffff", 0, `stroke="${CTRAIL.nh}" stroke-width="0.2"`) + rect(X(78.2) - 0.42, 8.22, 0.84, 0.16, "#2b2d30");
    p += rect(L / 2 - 13, 10.05, 26, 1.45, CTRAIL.nh, 0, 'rx="0.72"') +
      letters(L / 2, 10.77, 0.95, "CONNECTICUT DEPARTMENT OF TRANSPORTATION", "#262626",
        'textLength="24" lengthAdjust="spacingAndGlyphs" font-weight="700" font-family="Arial Narrow, Helvetica Neue, Arial, sans-serif"');
    return p;
  };
  // Trap-door steps under the vestibules, their risers striped red and white.
  const trap = (x) => {
    let s = rect(x + 0.15, 1.5, 2.2, 2.45, "currentColor", 0, 'opacity="0.75"');
    for (const y of [1.65, 2.45, 3.25]) {
      s += rect(x + 0.3, y, 1.9, 0.4, "#f2f2f2");
      for (let k = 0; k < 4; k++) s += path(poly([[x + 0.3 + k * 0.5, y], [x + 0.55 + k * 0.5, y], [x + 0.75 + k * 0.5, y + 0.4], [x + 0.5 + k * 0.5, y + 0.4]]), CTRAIL.nh);
    }
    return s;
  };
  const louver = (x) => rect(x, 12.4, 3.0, 0.62, C.steelDark, 0.4, 'rx="0.15"') + slats(x, 12.4, 3.0, 0.62, 0.7, "rgba(0,0,0,0.35)");
  return bilevel(c, { ...MAF, paint,
    rows: [{ ...MAF_WIN, xs: seq(8.0, 5.55, 12).map((x) => X(x, MAF_WIN.w)) }, { ...MAF_WIN, xs: [X(74.35, 1.4)], w: 1.4 }],
    doors: [door(1.25), door(81.6)],
    cabLen: cab ? 3.5 : 0,
    // The striped cab end seen edge-on; the horns on the roof over it.
    cab: cab ? (c, { x0 }) => {
      let s = rect(x0, 3.9, 0.42, 9.0, "#f2f2f2");
      for (let y = 4.1; y < 12.6; y += 1.1) s += rect(x0, y, 0.42, 0.55, CTRAIL.nh);
      return s + rect(x0 + 1.0, MAF.roof - 0.1, 1.6, 0.45, C.steelDark, 0.4, 'rx="0.15"');
    } : null,
    extra: (c, g) => underframe(18.5, 66.8, MAF.sill, { depth: 1.25, boxes: 3 }) + trap(X(1.25, 2.5)) + trap(X(81.6, 2.5)) + louver(X(5.4, 3.0)) + louver(X(76.9, 3.0)),
  });
}
export const mafersaCoach = (c) => mafersa(c);
export const mafersaCab = (c) => mafersa(c, { cab: true });

// ===================== Electric multiple units =====================

// A flat EMU cab end seen from the side: the front's paint on the corner post,
// the engineer's side window, lights on the lead car.
const emuEnd = (front, { win: w = [1.45, 7.0, 1.35, 2.9] } = {}) => (c, { x0 }) => {
  let s = "";
  for (const [y, h, fill] of front) s += rect(x0, y, 0.42, h, fill);
  s += win(x0 + w[0], w[1], w[2], w[3], 0.25);
  return s;
};

// --- Bombardier M7 (LIRR 7001-7836) and M7A (Metro-North): 85 ft, 12 ft
// 10.5 in to the roof, floor 4 ft 3 in, trucks 59 ft 6 in apart on 36 in
// wheels. Two single-leaf sliding doors a side, each about 17 ft in from its
// end of the car; wide, low windows: a tall narrow one for the engineer, one
// more ahead of the front door, six between the doors, two at the inner end.
// Plain stainless sides, the MTA logo beside each door on the car-end side;
// third-rail shoes (over-running on the LIRR, under-running on Metro-North).
// LIRR ends: black above a yellow band; Metro-North M7A: blue over a band of
// white chevrons.
const M7 = {
  roof: 12.88, sill: 3.55, cornerR: 1.1, trucks: { centers: 59.5, wb: 8.5, d: 36, shoe: true }, end: 0.6,
  rows: [{ xs: [7.9, ...seq(25.8, 5.75, 6), 72.5, 78.2], y: 7.0, w: 4.6, h: 2.35, r: 0.55 }],
  doors: [{ x: 17.6, w: 4.5, y0: 4.2, y1: 11.15, glassY: 0.48, glassH: 0.38 }, { x: 62.9, w: 4.5, y0: 4.2, y1: 11.15, glassY: 0.48, glassH: 0.38 }],
  roofItems: [[5.5, 10, 0.5], [69.5, 10, 0.5]], diaphragm: [4.25, 11.4], cabLen: 4,
  badge: [{ x: 15.0, y: 8.3, h: 0.85 }, { x: 70.0, y: 8.3, h: 0.85 }],
};
const m7Paint = (c, g) => rect(0, 0, g.L, 17, "#d0d4d9") + rect(0, 11.9, g.L, 2, C.steelShade) + rect(0, 0, g.L, 3.85, "#2a2d31");
const m7Cab = (front) => emuEnd(front, { win: [1.8, 7.0, 2.0, 3.6] });
export const m7 = married((c) => bilevel(c, { ...M7, paint: m7Paint,
  cab: m7Cab([[7.0, 5.9, C.black], [4.7, 1.8, LIRR.yellow]]) }));
export const m7a = married((c) => bilevel(c, { ...M7, paint: m7Paint,
  cab: m7Cab([[7.0, 5.9, MNR_BLUE], [5.2, 1.8, "#eef1f5"], [5.75, 0.3, MNR_BLUE], [6.35, 0.3, MNR_BLUE]]) }));

// --- Kawasaki M8 (Metro-North New Haven Line, 9101-9580): 85 ft, married
// pairs with a pantograph on the even car at the inner end, 25/12.5 kV
// overhead plus third rail. Doors and windows placed as on the M7, the six
// between the doors set in one dark band. Stainless sides; red cab ends whose
// red runs back along the roof edge to the front door; a broad red stripe
// under the windows, dark gray from the cab back to the first window.
// The cars CTDOT assigned to Shore Line East (2022-26) carry, in place of
// the MTA logo, a black panel with the CTrail logo over "SHORE LINE EAST".
export const m8 = married((c) => bilevel(c, {
  badge: c.agency === "ctrail" ? { x: 15.6, y: 9.1, h: 0.55, dark: true }
    : { x: 15.4, y: 8.7, h: 0.9 },                                    // cab side of the front door
  roof: 13.0, sill: 3.55, cornerR: 1.2, trucks: { centers: 59.5, wb: 8.5, d: 36, shoe: true }, end: 0.6,
  rows: [{ xs: [9.6], y: 7.6, w: 4.0, h: 2.3, r: 0.35 }, { xs: seq(25.8, 5.75, 6), y: 7.6, w: 5.1, h: 2.3, r: 0.2 },
    { xs: [72.5, 78.2], y: 7.6, w: 4.4, h: 2.3, r: 0.35 }],
  doors: [{ x: 17.6, w: 4.5, y0: 4.2, y1: 11.15, glassY: 0.48, glassH: 0.38 }, { x: 62.9, w: 4.5, y0: 4.2, y1: 11.15, glassY: 0.48, glassH: 0.38 }],
  roofItems: [[18.0, 26, 0.6]], diaphragm: [4.25, 11.5], cabLen: 4,
  paint: (c, g) => {
    const L = g.L;
    return rect(0, 0, L, 17, "#c5c9ce") + rect(0, 12.0, L, 2, "#a9afb6") + rect(0, 0, L, 3.85, "#2a2d31") +
      rect(25.6, 7.45, 34.25, 2.6, "#1d2024", 0, 'rx="0.3"') +
      [[13.6, 17.6], [22.1, 62.9], [67.4, L]].map(([a, b]) => rect(a, 5.75, b - a, 1.45, "#c8102e")).join("") +   // not across the doors
      path("M0 5.75L13.6 5.75Q15.4 6.475 13.6 7.2L0 7.2Z", "#3a3f45") +
      path("M0 12.15L16.0 12.15Q17.4 12.15 17.4 13.6L0 13.6Z", "#c8102e") +
      (c.agency === "ctrail" ? rect(13.85, 8.05, 3.5, 1.6, CTRAIL.black) + goLetters(c, 15.6, 8.42, 0.3, "SHORE LINE EAST", "#ffffff", { weight: 500, spacing: 0.04 }) : "");
  },
  cab: emuEnd([[3.55, 9.45, "#c8102e"]], { win: [1.8, 7.6, 2.2, 3.2] }),
  extra: (c, g) => (c.mate || c.single ? pantograph(g.L - 10, 13.0, { up: true, facing: -1 }) + rect(g.L - 16, 12.95, 4, 0.5, C.steelDark, 0.4) : ""),
}));

// --- Kawasaki M9 (LIRR 9001-9202): the M7's successor, same size, doors
// and windows. A tall cab side window, then black and yellow stripes leaning
// back, a gray band and a dark blue panel (one window in it) to just short of
// the logo, its trailing edge raked and darker; blue around the front windows.
const M9_BLUE = "#2b2e83";
const leanBack = (x, w) => poly([[x, 3.0], [x + w, 3.0], [x + w + 1.75, 13.5], [x + 1.75, 13.5]]);
export const m9 = married((c) => bilevel(c, { ...M7,
  paint: (c, g) => m7Paint(c, g) + path(leanBack(6.3, 6.1), M9_BLUE) + path(leanBack(11.7, 0.7), "#1a1c4f") +
    path(leanBack(5.3, 1.0), "#a2a8b0") + path(leanBack(4.85, 0.45), LIRR.yellow) + path(leanBack(4.4, 0.45), C.black),
  cab: emuEnd([[7.3, 5.6, M9_BLUE]], { win: [1.2, 7.3, 2.5, 3.7] }) }));

// --- Budd M3 (LIRR, 1984-86): 85 ft, two sets of bi-parting doors a side
// about 17 ft in from each end. Windows in strips of four panes in a dark
// frame: one strip between the cab window and the front door, three between
// the doors, one at the inner end; a white panel with the logo just inside
// each door. Stainless sides with a few belt-line ribs; the cab end yellow
// below the windows.
const M3_STRIPS = [4.8, 27.3, 37.5, 47.7, 71.2];
export const m3 = married((c) => bilevel(c, {
  badge: [{ x: 23.2, y: 8.45, h: 1.0 }, { x: 59.0, y: 8.45, h: 1.0 }],  // on the white panels inside the doors
  roof: 12.6, sill: 3.55, cornerR: 1.1, trucks: { centers: 59.5, wb: 8.5, d: 36, shoe: true }, end: 0.6,
  rows: [{ xs: M3_STRIPS.flatMap((x) => seq(x + 0.2, 2.35, 4)), y: 7.3, w: 2.15, h: 2.3, r: 0.15 }],
  doors: [{ x: 17.2, w: 4.6, y0: 4.2, y1: 11.0, leaves: 2, glassY: 0.48, glassH: 0.38 }, { x: 63.2, w: 4.6, y0: 4.2, y1: 11.0, leaves: 2, glassY: 0.48, glassH: 0.38 }],
  roofItems: [[6, 12, 0.45]], diaphragm: [4.25, 11.2], cabLen: 4,
  paint: (c, g) => {
    let s = rect(0, 0, g.L, 17, "#d0d4d9") + rect(0, 11.6, g.L, 2, C.steelShade) + rect(0, 0, g.L, 3.85, "#2a2d31");
    s += lines([[0, 7.05, g.L, 7.05], [0, 5.3, g.L, 5.3], [0, 5.0, g.L, 5.0]], "rgba(0,0,0,0.18)", 0.5);
    for (const x of M3_STRIPS) s += rect(x, 7.15, 9.6, 2.6, "#2a2e33", 0, 'rx="0.2"');
    for (const x of [22.4, 58.2]) s += rect(x, 7.3, 4.2, 2.3, "#f2f3f5", 0, 'rx="0.15"');
    return s;
  },
  cab: emuEnd([[4.3, 2.4, c.agency === "mnr" ? "#1f4fa3" : LIRR.yellow]], { win: [1.0, 7.3, 2.0, 3.4] }),
}));

// --- Nippon Sharyo single-level cars (South Shore Line, NICTD): 1-48
// (1982-83, 1992) with a cab at each end, 101-110 (2001) with one, and the
// unpowered trailers 201-210 (1992). 85 ft, trucks 59 ft 6 in apart on an
// 8 ft 2.5 in wheelbase, 36 in wheels; fluted stainless. A single-leaf door
// right at each end, its trap and steps for low platforms showing below the
// sill; bi-parting high-level doors in the middle; five wide windows each
// side of them. An orange band edged in maroon runs through the windows; the
// old "South Shore Line" emblem on it beside the middle doors, NICTD in
// orange in a gap on the other side. Flat stainless cab ends, orange lines
// under the front windows and at the headlights. Every powered car raises
// its own single-arm pantograph on a low deck over one end; an air-
// conditioning unit on the roof at the other.
const NS_WIN = [9.9, 15.5, 21.1, 26.7, 32.3];
function nsCar(c, { trailer = false } = {}) {
  const L = c.L, trap = (x) => ({ x, w: 2.7, y0: 4.0, y1: 11.1, glassY: 0.5, glassH: 0.36 });
  return bilevel({ ...c, cabL: !trailer, cabR: !trailer }, {
    roof: 13.5, sill: 3.9, cornerR: 1.0, trucks: { centers: 59.5, wb: 8.2, d: 36 }, end: 0.6,
    rows: [{ xs: [...NS_WIN, ...NS_WIN.map((x) => L - x - 3.8)], y: 7.1, w: 3.8, h: 2.5, r: 0.55 }],
    doors: [trap(1.5), { x: 40.7, w: 3.6, y0: 4.0, y1: 11.1, leaves: 2, glassY: 0.5, glassH: 0.36 }, trap(L - 4.2)],
    roofItems: trailer ? [[12.5, 8.5, 0.6], [L - 21, 8.5, 0.6]] : [[2.4, 10.4, 0.3], [L - 21, 8.5, 0.6]],
    diaphragm: [4.25, 11.6],
    badge: [{ x: 38.45, y: 8.4, h: 0.82, logo: "southshore" }, { x: 46.55, y: 8.4, h: 0.95, logo: "nictd-orange" }],
    paint: (c, g) => {
      let s = rect(0, 0, L, 17, "#d3d7dc") + flutes(0, L, 4.3, 6.9, 0.27) + flutes(0, L, 9.8, 12.4, 0.27) + rect(0, 12.4, L, 2, C.steelShade);
      for (const [a, b] of [[0, 44.6], [48.5, L]]) s += rect(a, 7.9, b - a, 1.0, NICTD.orange) + rect(a, 7.8, b - a, 0.1, NICTD.maroon) + rect(a, 8.9, b - a, 0.1, NICTD.maroon);
      return s;
    },
    cab: (c, { x0 }) => rect(x0, 7.0, 0.42, 0.28, NICTD.orange) + rect(x0, 4.75, 0.42, 0.28, NICTD.orange),
    extra: (c, g) => {
      // The trap stairwells under the end doors; equipment boxes; the pantograph.
      let s = "";
      for (const x of [1.5, L - 4.2]) s += rect(x + 0.1, 1.5, 2.5, 2.4, "#3a3f45", 0.5) + lines([[x + 0.2, 2.3, x + 2.5, 2.3], [x + 0.2, 3.1, x + 2.5, 3.1]], C.steelDark, 0.6);
      s += underframe(16.5, 68.5, 3.9, { depth: 1.4, boxes: trailer ? 2 : 4 });
      if (!trailer) s += pantograph(7.6, 13.75, { up: true, facing: -1 });
      return s;
    },
  });
}
export const nsEmu = married((c) => nsCar(c));
export const nsTrailer = (c) => nsCar(c, { trailer: true });

// --- GE Silverliner IV (SEPTA, 1974-76): 85 ft, trucks 59 ft 6 in apart,
// fluted stainless above and below the window band, a smooth panel along
// the bottom. Single doors right at each end with trap steps; a blanked-off
// plug (with one window) where center doors were planned; eleven wide,
// round-cornered windows filling a blue-over-red band, which carries the
// SEPTA mark and name in white at each end. A long resistor-grid hump on
// the roof; the even car of a pair carries the pantograph on a lowered
// stretch at its inner end. Flat ends with black air scoops at the top
// corners.
export const silverliner4 = married((c) => bilevel(c, {
  roof: 13.5, sill: 3.6, cornerR: 0.8, trucks: { centers: 59.5, wb: 8.5, d: 36 }, end: 0.6,
  rows: [{ xs: [9.3, 14.9, 20.5, 26.1, 31.7, 40.35, 49.0, 54.6, 60.2, 65.8, 71.4], y: 8.1, w: 4.3, h: 1.9, r: 0.6 }],
  doors: [{ x: 1.4, w: 2.8, y0: 4.1, y1: 11.9, glassY: 0.56, glassH: 0.38 }, { x: 80.8, w: 2.8, y0: 4.1, y1: 11.9, glassY: 0.56, glassH: 0.38 }],
  diaphragm: [4.25, 11.8], cabLen: 4,
  badge: [{ x: 5.4, y: 9.05, h: 1.5, logo: "septa-mark-white" }, { x: c.L - 7.95, y: 9.05, h: 1.5, logo: "septa-mark-white" }],
  paint: (c, g) => {
    const L = g.L;
    let s = rect(0, 0, L, 17, "#d0d4d9") + flutes(0, L, 4.9, 8.0, 0.27) + flutes(0, L, 10.1, 12.6, 0.27) + rect(0, 12.6, L, 2, C.steelShade);
    s += rect(4.3, 9.05, L - 8.6, 1.05, "#2a43b8") + rect(4.3, 8.0, L - 8.6, 1.05, "#e0352b") + rect(0, 0, L, 3.9, "#2a2d31");
    s += lines([[39.8, 4.9, 39.8, 12.6], [45.2, 4.9, 45.2, 12.6]], "rgba(0,0,0,0.3)", 0.5);
    // The name beside each mark.
    for (const x of [7.85, L - 5.5]) s += `<text transform="translate(${x} 9.05) scale(${c.mirrored ? -1 : 1} -1)" y="0.29" font-size="0.8" text-anchor="middle" font-weight="700" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" fill="#ffffff">SEPTA</text>`;
    return s;
  },
  cab: (c, g) => emuEnd([[4.3, 7.6, "#3a3f45"], [7.3, 1.4, "#1f4fa3"], [6.6, 0.7, "#e0352b"]])(c, g) + path(poly([[g.x0, 12.9], [g.x0 + 1.4, 13.5], [g.x0, 13.5]]), C.black),
  extra: (c, g) => {
    const L = g.L, pan = !!(c.mate || c.single);
    const a = 6.5, b = pan ? L - 19 : L - 6.5;
    let s = rect(a, 13.45, b - a, 0.95, "#8d949c", 0.4) + slats(a, 13.45, b - a, 0.95, 0.5, "rgba(0,0,0,0.35)");
    if (pan) s += pantograph(L - 10.5, 13.5, { up: true, facing: -1 });
    return s;
  },
}));

// --- Hyundai Rotem Silverliner V (SEPTA 701-882; RTD Denver 4001-4066):
// 85 ft 1.5 in, 12 ft 7 in body with a long HVAC unit on the roof; smooth
// stainless. SEPTA: three doors a side at the quarter points (a double door
// near the cab, a single near the inner end), a blue-over-red band sweeping
// up from the ends into a stripe along the window tops. RTD: two bi-parting
// high-level doors, 28 ft from the cab end and 20 ft from the inner end;
// behind the cab a narrow window then two wide ones, four between the doors,
// three at the inner end; a blue band under the windows with red and yellow
// lines running out of RTD's mountain peaks at the inner end, the small
// white "RTD" on the band near the cab.
export const silverliner5 = married((c) => {
  const rtd = c.agency === "rtd";
  const doors = rtd
    ? [{ x: 28.2, w: 4.4, y0: 4.2, y1: 11.0, leaves: 2, glassY: 0.45, glassH: 0.4 }, { x: 61.2, w: 4.2, y0: 4.2, y1: 11.0, leaves: 2, glassY: 0.45, glassH: 0.4 }]
    : [{ x: 18.4, w: 4.6, y0: 4.0, y1: 11.0, leaves: 2, glassY: 0.45, glassH: 0.4 }, { x: 63.0, w: 2.7, y0: 4.0, y1: 11.0, glassY: 0.45, glassH: 0.4 }];
  const rows = rtd
    ? [{ xs: [8.3], y: 7.3, w: 2.7, h: 2.9, r: 0.45 }, { xs: [12.0, 18.4], y: 7.3, w: 5.2, h: 2.9, r: 0.45 },
      { xs: [36.6, 42.1, 47.6, 53.1], y: 7.3, w: 4.4, h: 2.9, r: 0.45 }, { xs: [70.4, 75.0, 79.6], y: 7.3, w: 3.9, h: 2.9, r: 0.45 }]
    : [{ xs: [4.8, 9.6, 14.0, 24.4, 29.8, 35.2, 40.6, 46.0, 51.4, 56.8, 67.4, 72.3, 77.2], y: 7.25, w: 3.6, h: 2.5, r: 0.45 }];
  return bilevel(c, {
    roof: 12.6, sill: 3.6, cornerR: 1.3, trucks: { centers: 59.5, wb: 8.5, d: 36 }, end: 0.6,
    rows, doors, diaphragm: [4.25, 11.3], cabLen: 4,
    // SEPTA: the wordmark low on the side behind the first doors. RTD: a
    // small white "RTD" on the blue band near the cab.
    badge: rtd ? { x: 8.6, y: 6.15, h: 0.55, dark: true } : { x: 30, y: 5.0, h: 1.2, logo: "septa-word" },
    paint: (c, g) => {
      const L = g.L;
      let s = rect(0, 0, L, 17, "#d3d7dc") + rect(0, 11.7, L, 2, C.steelShade) + rect(0, 0, L, 4.0, "#2a2d31");
      if (rtd) {
        // The red and yellow lines start high on the band at the peaks and
        // ease down to its bottom edge by the cab.
        s += rect(0, 5.15, L, 1.45, "#1f3fa0");
        s += path(`M0 5.2L${L - 5} 6.15L${L - 5} 6.3L0 5.35Z`, "#e0352b") + path(`M0 5.4L${L - 5} 5.85L${L - 5} 5.97L0 5.52Z`, "#f2b81c");
        // Peaks: thick chevrons standing on the band, yellow nearest the end.
        const peak = (x, y, w, col) => path(poly([[x + w, 5.15], [x + w - 0.5, 5.15], [x, y - 0.6], [x - w * 0.6 + 0.45, y - (y - 5.15) * 0.6], [x - w * 0.6, y - (y - 5.15) * 0.6], [x, y]]), col);
        return s + peak(L - 4.0, 7.0, 1.6, "#f2b81c") + peak(L - 4.9, 6.75, 1.0, "#f26b21") + peak(L - 5.6, 6.55, 0.75, "#e0352b");
      }
      const sweep = (x, k) => `M${x} 5.3L${x + k * 12} 5.3Q${x + k * 16.5} 5.4 ${x + k * 18} 10.0L${x + k * 18.5} 10.25L${x + k * 18.5} 10.55Q${x + k * 15.5} 7.4 ${x + k * 11} 7.1L${x} 7.1Z`;
      s += path(sweep(0, 1), "#e0352b") + path(sweep(L, -1), "#e0352b");
      s += rect(0, 9.95, L, 0.32, "#1f4fa3") + rect(0, 10.3, L, 0.22, "#e0352b");
      s += path("M0 6.3L12 6.3Q15.6 6.5 17.6 9.95L16.6 9.95Q14.6 7.0 11 7.0L0 7.0Z", "#1f4fa3") + path(`M${L} 6.3L${L - 12} 6.3Q${L - 15.6} 6.5 ${L - 17.6} 9.95L${L - 16.6} 9.95Q${L - 14.6} 7.0 ${L - 11} 7.0L${L} 7.0Z`, "#1f4fa3");
      return s;
    },
    cab: rtd ? (c, g) => emuEnd([[4.2, 8.0, "#c9cdd2"]], { win: [2.3, 7.0, 2.0, 3.3] })(c, g) : emuEnd([[5.3, 1.8, "#e0352b"], [7.1, 1.0, "#1f4fa3"]]),
    extra: (c, g) => {
      const L = g.L;
      let s;
      if (rtd) {
        // Destination signs over a window in each end section; the roof
        // pod runs between the doors, louvered at both ends.
        s = rect(19.2, 10.65, 3.9, 0.55, C.glass, 0.4, 'rx="0.25"') + rect(70.7, 10.65, 3.1, 0.55, C.glass, 0.4, 'rx="0.25"');
        s += path(`M21.4 12.55Q21.6 13.85 23.0 13.85L63.8 13.85Q65.2 13.85 65.4 12.55Z`, "#a7aeb6", 0.4) + slats(22.6, 12.65, 7.5, 1.0, 0.45, "rgba(0,0,0,0.32)") + slats(58.8, 12.65, 5.0, 1.0, 0.45, "rgba(0,0,0,0.32)");
        if (c.mate || c.single) s += pantograph(L - 12.5, 12.6, { up: true, facing: -1 });
        return s;
      }
      s = path(`M8.5 12.55L9.8 13.5L42 13.5L42.6 12.55Z`, "#9aa1a9", 0.4) + slats(30, 12.6, 11, 0.85, 0.5, "rgba(0,0,0,0.3)");
      if (c.mate || c.single) s += pantograph(L - 9.5, 12.6, { up: true, facing: -1 });
      return s;
    },
  });
});

// --- Stadler KISS (Caltrain, 2022-24): seven-car sets, 598 ft 11 in over
// couplers, 9 ft 10 in wide, 15 ft 10.6 in tall. Each car: an upper and lower
// deck between the trucks, an intermediate level over each truck under a
// roof 1 ft lower. Four doors a side: low double doors at each end of the
// double deck (in use) and wide single plug doors in the end sections (for
// future high platforms). The decks' windows sit in black glazing bands, the
// upper one tucked under a red roof band that runs the length of the car;
// a red line at lower-floor level over a gray skirt. The cab cars' long
// raked noses carry the red down over the cab, back to the first door.
const KISS = {
  roof: 15.88, sill: 3.2, cornerR: 0.9, ends: { h: 14.8, len: 12.7, ramp: 1.7 }, trucks: { centers: 63.8, wb: 8.5, d: 36 },
  diaphragm: [4.25, 13.6],
};
const KISS_RED = "#e1251b";
// Red roof band with a pale line under it; black glazing bands; the red line
// and gray skirt from x0 on (a cab car's begin in a swoosh up from the sill).
function kissPaint(c, g, { up, low, x0 = 0 }) {
  const L = g.L;
  let s = rect(0, 0, L, 17, "#eef0f2") + rect(0, 12.9, L, 4, KISS_RED) + rect(0, 12.62, L, 0.28, "#c3c8ce");
  s += rect(x0, 0, L - x0, 4.25, "#7d858e") + rect(x0, 4.25, L - x0, 0.25, KISS_RED);
  s += rect(up[0], 11.7, up[1] - up[0], 2.75, "#16181b", 0, 'rx="0.5"') + rect(low[0], 4.4, low[1] - low[0], 2.75, "#16181b", 0, 'rx="0.6"');
  return s;
}
const kissDoors = (lo, hi) => [
  ...hi.map((x) => ({ x, w: 5.4, y0: 4.2, y1: 11.85, glassY: 0.4, glassH: 0.35, grabs: false })),
  ...lo.map((x) => ({ x, w: 5.0, y0: 1.6, y1: 9.4, leaves: 2, glassY: 0.33, glassH: 0.48 }))];
const kissBox = (x, y, w, h) => rect(x, y, w, h, "none", 0.45, 'rx="0.4"');
export const kiss = (c) => bilevel({ ...c, cabL: false, cabR: false }, { ...KISS, drop: { a: 17.0, b: c.L - 17.0, y: 1.5 },
  paint: (c, g) => kissPaint(c, g, { up: [20.7, 63.0], low: [28.0, 55.7] }),
  rows: [{ xs: seq(22.5, 5.75, 7), y: 11.95, w: 4.2, h: 2.25, r: 0.35 }, { xs: seq(28.3, 5.75, 5), y: 4.6, w: 4.0, h: 2.3, r: 0.4 }],
  doors: kissDoors([21.4, 57.2], [9.9, 68.3]), badge: { x: 3.6, y: 8.9, h: 2.0 },  // the disc at one end
  roofItems: [[10.0, 2.8, 1.0, 14.8], [70.6, 2.2, 1.0, 14.8], [74.4, 4.6, 1.0, 14.8]],
  extra: (c, g) => kissBox(75.1, 6.3, 2.9, 3.4) + (c.pan ? pantograph(g.L - 6.5, 14.8, { up: true, facing: -1 }) : "") });
export const kissCab = (c) => {
  const L = c.L;
  return bilevel({ ...c, cabL: true }, { ...KISS, noTrucks: true, drop: { a: 25.5, b: 74.5, y: 1.5 },
    paint: (c, g) => kissPaint(c, g, { up: [29.7, 70.2], low: [36.9, 63.4], x0: 29.5 }) +
      path("M0 5.1L7.9 5.1Q12.5 5.4 15.5 9.5Q17.5 12.6 19.8 12.9L19.8 17L0 17Z", KISS_RED) +
      path("M25.2 1.4Q26.6 4.25 29.5 4.25L29.5 4.5Q26.2 4.5 24.6 1.4Z", KISS_RED) + path("M25.6 1.4Q26.9 4.0 29.5 4.25L29.5 0L25.6 0Z", "#7d858e"),
    nose: [[1.65, 3.2], [1.65, 6.0], ["q", 1.8, 7.6, 2.6, 8.9], [5.6, 12.7], ["q", 8.4, 15.88, 12.9, 15.88]],
    rows: [{ xs: seq(30.9, 5.75, 7), y: 11.95, w: 4.0, h: 2.25, r: 0.35 }, { xs: seq(37.0, 5.6, 5), y: 4.6, w: 3.9, h: 2.3, r: 0.4 }],
    doors: kissDoors([30.1, 64.9], [19.2, 75.7]), cabLen: 6, badge: [{ x: 27.3, y: 8.9, h: 2.0 }, { x: 86.9, y: 8.9, h: 2.0 }],
    roofItems: [[19.2, 4.6, 1.0], [76.5, 3.3, 1.0, 14.8], [81.5, 4.9, 1.0, 14.8]],
    extra: () => truck(18.3, { wb: 8.5, d: 36, top: 3.2 }) + truck(80.1, { wb: 8.5, d: 36, top: 3.2 }),
    cab: () => path(poly([[4.6, 8.0], [8.3, 8.0], [8.3, 10.6], [5.7, 10.6]]), C.glass) + win(9.9, 7.9, 3.0, 2.7, 0.4),
  });
};

// --- Nippon Sharyo DMU (SMART, 101-118): 85 ft, 14 ft 7 in, 10 ft 5 in wide;
// one Cummins engine under each car. Two-car A+B sets coupled gangway to
// gangway, a raked gangwayless cab nose at each outer end. Two double doors
// a side, about 19 ft from the cab and 17 ft from the inner end: behind the
// cab its side window and one more, six windows between the doors, two
// beyond. A charcoal window band with a thin gold stripe below, stainless
// above and below it, a green line along the sill; a green roof, its
// radiator grilles flush in it, wrapping over the cab.
export const smartDmu = married((c) => bilevel(c, {
  badge: false,                                                       // SMART's logo is on the fronts only
  roof: 14.58, sill: 3.9, cornerR: 1.2, trucks: { centers: 58, wb: 8.5, d: 36 }, end: 0.6,
  nose: [[1.0, 3.9], [1.0, 6.4], ["q", 1.1, 7.6, 1.8, 8.6], [4.6, 13.4], ["q", 5.3, 14.58, 6.8, 14.58]],
  rows: [{ xs: [11.3], y: 7.2, w: 4.4, h: 3.2, r: 0.35 }, { xs: seq(27.9, 5.45, 6), y: 7.2, w: 4.2, h: 3.2, r: 0.35 }, { xs: [73.1, 78.9], y: 7.2, w: 4.3, h: 3.2, r: 0.35 }],
  doors: [{ x: 19.4, w: 4.9, y0: 4.25, y1: 11.3, leaves: 2, glassY: 0.4, glassH: 0.45 }, { x: 62.5, w: 4.9, y0: 4.25, y1: 11.3, leaves: 2, glassY: 0.4, glassH: 0.45 }],
  roofItems: [[12.2, 8.0, 0.25], [28.8, 14.8, 0.25], [69.6, 8.8, 0.25]], diaphragm: [4.25, 12.4], cabLen: 7,
  paint: (c, g) => {
    const L = g.L;
    return rect(0, 0, L, 17, "#cfd3d8") + rect(0, 13.8, L, 3, "#2e7a4a") +
      rect(0, 6.85, L, 4.05, "#2b2e31") + rect(0, 6.55, L, 0.28, "#c9a227") + rect(0, 3.75, L, 0.4, "#2e7a4a") +
      path("M0 6.55L0 16L7.5 16Q6.0 13.0 4.6 10.9L4.6 6.55Z", "#2e7a4a");
  },
  cab: (c) => {
    let s = path(poly([[1.9, 8.9], [4.4, 12.9], [5.6, 12.9], [5.6, 8.9]]), C.glass) + win(6.0, 7.5, 2.9, 2.8, 0.35);
    return s;
  },
}));

// --- Stadler GTW 2/6 (CapMetro 101-106, 201-204): 134 ft 2 in over
// couplers: two low-floor passenger sections hung from a short power module
// in the middle that holds two Cummins engines. Each section has one truck
// at its cab end and rests on the module at the other. Fiberglass cab
// fronts; on each side of a section the cab side window, two windows, one
// wide low-floor double door, then five windows to the module.
// CapMetro's current paint (2024 on): the cab end red back to the door,
// with "CapMetro" in white low on the side; silver beyond, a gray roof and
// a dark skirt.
const CAPMETRO_RED = "#e2251f";
export const gtwCar = (c) => bilevel({ ...c, cabL: true }, {
  roof: 12.8, sill: 2.4, cornerR: 1.0, end: 0.6, noTrucks: true,
  nose: [[1.0, 2.4], [1.0, 5.6], ["q", 1.1, 6.8, 1.8, 7.8], [3.6, 11.9], ["q", 4.2, 12.8, 5.6, 12.8]],
  rows: [{ xs: [11.6, 16.8, 30.2, 35.9, 41.5, 47.2, 52.8], y: 5.6, w: 4.3, h: 3.8, r: 0.45 }],
  doors: [{ x: 23.0, w: 5.2, y0: 2.1, y1: 9.6, leaves: 2, glassY: 0.3, glassH: 0.55 }],
  roofItems: [[20, 8, 0.6], [38, 6, 0.6]], diaphragm: [2.6, 11.2], cabLen: 6, badge: { x: 16.6, y: 4.0, h: 1.9, dark: true },
  paint: (c, g) => rect(0, 0, g.L, 17, "#c9cdd2") + rect(0, 11.8, g.L, 2, "#9aa1a9") +
    path("M0 0L28.4 0L28.4 11.8L27.6 12.8L0 12.8Z", CAPMETRO_RED) + path("M28.4 0L29.2 0L29.2 11.0L28.4 11.8Z", "#a8231f") + rect(0, 0, g.L, 2.6, "#3a3f45"),
  cab: (c) => {
    let s = path(poly([[1.7, 7.9], [3.4, 11.2], [4.5, 11.2], [4.5, 7.9]]), C.glass) + win(5.6, 6.0, 4.2, 4.0, 0.6);
    return s;
  },
  extra: () => truck(9.2, { wb: 6.9, d: 30, top: 2.4 }),
});
// --- Stadler FLIRT DMU (Metrolink's Arrow, San Bernardino-Redlands): two
// passenger sections, about 71 ft, either side of a power module, sharing its
// trucks at the inner ends. Low floor, a long sloped cab: the cab side window
// in the nose, a crew door behind it, two windows, one double door a side,
// then a long run of windows in a black band to the power module.
// Arrow: white; blue over the roof and down the nose in a curve that meets
// the roof again behind the cab; a green stripe along the sill; the
// Metrolink name over the first windows.
const ARROW = { white: "#f4f5f6", blue: "#2a62d4", green: "#3fb54a" };
export const flirtCar = (c) => bilevel({ ...c, cabL: true }, {
  roof: 13.4, sill: 3.0, cornerR: 1.0, end: 0.6, noTrucks: true,
  nose: [[1.0, 3.0], [1.0, 5.8], ["q", 1.1, 7.0, 2.0, 8.0], [5.2, 12.4], ["q", 6.0, 13.4, 7.6, 13.4]],
  rows: [{ xs: [13.0, 16.7], y: 6.2, w: 3.4, h: 3.6, r: 0.4 }, { xs: seq(26.9, 5.25, 8), y: 6.2, w: 4.6, h: 3.6, r: 0.4 }],
  doors: [{ x: 9.0, w: 2.3, y0: 3.4, y1: 10.6, glassY: 0.55, glassH: 0.32, grabs: false }, { x: 20.9, w: 4.6, y0: 3.0, y1: 10.2, leaves: 2, glassY: 0.4, glassH: 0.45 }],
  roofItems: [[20, 10, 0.5], [44, 8, 0.5]], diaphragm: [3.2, 11.8], cabLen: 9, badge: { x: 16.6, y: 11.15, h: 0.85 },
  paint: (c, g) => rect(0, 0, g.L, 17, ARROW.white) + rect(0, 3.35, g.L, 0.75, ARROW.green) + rect(26.3, 5.9, g.L - 26.3, 4.2, "#1d2126", 0, 'rx="0.4"') +
    path(`M0 4.1L1.4 4.1Q4.6 4.6 6.2 8.6Q7.4 11.8 9.4 12.45L${g.L} 12.45L${g.L} 17L0 17Z`, ARROW.blue),
  cab: () => path(poly([[1.9, 8.1], [4.9, 12.0], [5.6, 12.0], [3.0, 8.1]]), C.glass) + path(poly([[5.3, 8.5], [6.5, 11.5], [8.5, 11.5], [8.5, 8.5]]), C.glass),
  extra: () => truck(9.5, { wb: 8.2, d: 33, top: 3.0 }),
});
export function flirtPower(c) {
  const { L } = c, roof = 13.4, sill = 3.4;
  const d = poly([[0.4, sill], [L - 0.4, sill], [L - 0.4, roof - 0.6], ["q", L - 0.4, roof, L - 1.0, roof], [1.0, roof], ["q", 0.4, roof, 0.4, roof - 0.6]]);
  let s = truck(L / 2, { wb: 8.2, d: 33, kind: "loco", top: sill });
  const liv = rect(0, 0, L, 15, ARROW.white) + rect(0, 3.35, L, 0.75, ARROW.green) + rect(0, 12.45, L, 3, ARROW.blue);
  s += path(d, ARROW.white) + clipped(d, liv);
  s += rect(2.0, 6.2, L - 4.0, 4.2, "rgba(20,22,25,0.55)", 0.4) + slats(2.0, 6.2, L - 4.0, 4.2, 0.35, "rgba(255,255,255,0.18)");
  s += rect(1.5, roof - 0.05, L - 3, 0.8, C.steelDark, 0.4, 'rx="0.2"') + rect(L / 2 - 0.3, roof + 0.7, 0.6, 0.8, "currentColor");
  return s + outlineOf(d);
}

// The power module: a short, tall box over its own truck, with a gangway
// through the middle and radiators and exhausts on the roof.
export function gtwPower(c) {
  const { L } = c, roof = 13.4, sill = 3.4;
  const d = poly([[0.4, sill], [L - 0.4, sill], [L - 0.4, roof - 0.6], ["q", L - 0.4, roof, L - 1.0, roof], [1.0, roof], ["q", 0.4, roof, 0.4, roof - 0.6]]);
  let s = truck(L / 2, { wb: 7.2, d: 33, kind: "loco", top: sill });
  let liv = rect(0, 0, L, 15, "#c9cdd2") + rect(0, 0, L, 4.0, "#3a3f45") + rect(0, 12.2, L, 2, "#9aa1a9");
  s += path(d, "#d3d7dc") + clipped(d, liv);
  s += rect(2.0, 6.2, L - 4.0, 4.0, "rgba(20,22,25,0.55)", 0.4) + slats(2.0, 6.2, L - 4.0, 4.0, 0.35, "rgba(255,255,255,0.18)");
  s += rect(1.5, roof - 0.05, L - 3, 0.8, C.steelDark, 0.4, 'rx="0.2"') + rect(L / 2 - 0.3, roof + 0.7, 0.6, 0.8, "currentColor");
  return s + outlineOf(d);
}

// ===================== Siemens Venture =====================
// Siemens Venture (Brightline, Amtrak Midwest and California, VIA, Amtrak
// Airo): 85 ft, 14 ft, 51 in floor, trucks 59 ft 6 in apart. Convex sides,
// sealed gangways, single-leaf plug doors at the car ends, nine large
// windows a side (about 4 ft 10 in wide, 6 ft 10 in apart), air-conditioning
// under raised roof covers at both ends. Amtrak's cab cars carry a
// Charger-like nose, VIA's a streamlined one.
// Brightline: each coach one bright color over the whole side, a big yellow
// panel slanting across the middle. Midwest: silver, a navy window band at
// the door end breaking up into a halftone of dots, a wide red band low on
// the side. San Joaquins (Caltrans): silver, a blue window band, a low band
// of blues and purple with yellow ends, yellow doors. VIA: light gray, a
// charcoal window band under a yellow one. Cascades (Airo): evergreen, mocha
// through the windows over a cream band, brown and white sill stripes.
const BRIGHT = ["#1fa64a", "#e5473b", "#5b4fb8", "#38a3dc"]; // green, red, purple, blue
// Five Smart coaches (green, red, purple in turn) behind the locomotive, then
// the two blue Premium coaches.
const brightColor = (c) => ((c.index ?? 1) >= 6 ? 3 : ((c.index ?? 1) + 2) % 3);
const VENTURE = {
  roof: 14.0, sill: 3.9, cornerR: 1.4, trucks: { centers: 59.5, wb: 8.5, d: 36 }, end: 0.6,
  rows: [{ xs: seq(11.5, 6.8, 9), y: 7.3, w: 4.85, h: 2.5, r: 0.45 }],
  roofItems: [[1.4, 16, 0.3], [67.6, 16, 0.3]], diaphragm: [4.25, 12.6],
};
function venturePaint(c, g) {
  const L = g.L;
  let s = rect(0, 0, L, 17, "#cdd1d6") + rect(0, 0, L, 4.9, "rgba(0,0,0,0.12)") + rect(0, 12.7, L, 3, "rgba(0,0,0,0.07)");
  switch (c.agency) {
    case "brightline": {
      // The coach's color over the whole side (each coach in a set its own),
      // a big yellow panel slanting across the middle and over onto the
      // roof, a charcoal roof and skirt.
      const col = BRIGHT[brightColor(c)];
      s += rect(0, 0, L, 17, col) + rect(0, 12.9, L, 3, "#3a3d41") + rect(0, 0, L, 4.8, "#3a3d41");
      s += path(poly([[L * 0.3, 4.8], [L * 0.64, 4.8], [L * 0.72, 12.9], [L * 0.38, 12.9]]), "#ffd100") + rect(L * 0.48, 12.9, L * 0.16, 2, "#ffd100");
      return s;
    }
    case "via":
      // VIA's Venture: light gray; a thin yellow line under a charcoal window
      // band; a yellow band above it up to the stainless roof.
      return s + rect(0, 6.42, L, 0.23, "#f5c400") + rect(0, 6.65, L, 3.97, "#2b2e32") + rect(0, 10.62, L, 2.28, "#f5c400");
    case "amtrak":
      if (c.route === "Amtrak Cascades") {
        // Airo: white and brown stripes over the skirt, a green strip, a cream
        // band under the windows, mocha through them, evergreen to the roof;
        // a small Mount Rainier high by the door.
        return s + rect(0, 0, L, 4.3, "#2a2e33") + rect(0, 4.3, L, 0.3, "#f4f1ea") + rect(0, 4.6, L, 0.6, "#5a3a2c") + rect(0, 5.2, L, 0.5, "#1f4a40") +
          rect(0, 5.7, L, 1.3, "#efe9dc") + rect(0, 7.0, L, 3.2, "#5b3b36") + rect(0, 10.2, L, 2.6, "#1f4a40") +
          path(`M${L - 15} 10.6L${L - 12.6} 11.9L${L - 11.8} 11.6L${L - 10} 10.6Z`, "#e8efe9") +
          path(`M${L - 13.6} 11.35L${L - 12.6} 11.9L${L - 11.8} 11.6L${L - 11.1} 11.2L${L - 12.2} 11.45Z`, "#7fb3a3");
      }
      if (c.route === "San Joaquins") {
        // Yellow doors; a blue window band between them; a low band of
        // slanted blues and purple ending in yellow by each door.
        const band = [["#f5c21b", 0], ["#3aa6e0", 9], ["#6a4fc2", 26], ["#2348c4", 38], ["#3aa6e0", 56], ["#f5c21b", 73]];
        s += rect(0, 3.9, L, 2.2, "#f5c21b");
        band.forEach(([col, x], i) => { if (i) s += path(`M${x} 3.9L${L} 3.9L${L} 6.1L${x + 1.9} 6.1Z`, col); });
        s += rect(L - 6.5, 3.9, 6.5, 2.2, "#f5c21b") + rect(0, 3.9, 4.6, 2.2, "#f5c21b");
        return s + rect(9.2, 7.15, L - 17.7, 2.95, "#2348c4") + rect(1.2, 4.25, 2.9, 7.05, "#f5c21b") + rect(L - 4.1, 4.25, 2.9, 7.05, "#f5c21b");
      }
      {
        // Amtrak Midwest: navy through the windows at the door end, breaking
        // into a halftone of dots; a wide red band low down.
        const navy = "#1c2a4c";
        s += rect(0, 4.5, L, 1.4, "#d4202c") + rect(L - 15, 6.9, 15, 3.5, navy);
        for (let i = 0; i < 16; i++) for (let j = 0; j < 7; j++) {
          s += circle(L - 15.3 - i * 0.62 - (j % 2) * 0.31, 7.15 + j * 0.5, 0.26 * (1 - i / 16), navy);
        }
        return s;
      }
    default:
      return s + rect(0, 6.9, L, 3.3, "#2a2d31") + rect(0, 4.4, L, 0.3, c.color || "#1f5fad");
  }
}
const ventureDoor = (x) => ({ x, w: 2.9, y0: 4.25, y1: 11.3, glassY: 0.55, glassH: 0.32, grabs: false });
// VIA's Venture coaches: nine big windows, then a blank stretch (washroom)
// before the door at that end; "VIA RAIL CANADA" spaced out in white along
// the middle of the yellow band, a small VIA logo by the other door.
const VIA_VENTURE_ROWS = [{ xs: seq(10.95, 6.5, 9), y: 7.15, w: 4.75, h: 2.75, r: 0.45 }];
// Logos: Cascades on the cream by the door; San Joaquins: its name high in
// the middle, Caltrans' mark under the windows by a door; Midwest: "Amtrak
// Midwest" high at the far end from the door.
const ventureBadge = (c) => (c.route === "Amtrak Cascades" ? { x: c.L - 8.6, y: 6.35, h: 1.1, logo: "cascades-dark" }
  : c.route === "San Joaquins" ? [{ x: 42.5, y: 11.3, h: 1.1, logo: "san-joaquins" }, { x: 13.4, y: 6.6, h: 0.75, logo: "caltrans" }]
  : c.agency === "amtrak" ? { x: 20, y: 11.6, h: 1.25, logo: "amtrak-midwest" }
  : { via: [{ x: 43.0, y: 11.76, h: 0.75, dark: true, logo: "via-rail-canada" }, { x: 8.1, y: 8.3, h: 0.8, logo: "via-mark" }],
      brightline: { x: 6.5, y: 5.6, h: 0.8, dark: true } }[c.agency]);
export const venture = (c) => bilevel(c, { ...VENTURE, paint: venturePaint, badge: ventureBadge,
  rows: c.agency === "via" ? VIA_VENTURE_ROWS : VENTURE.rows,
  doors: c.agency === "via" ? [ventureDoor(2.4), ventureDoor(78.0)]
    : c.agency === "brightline" || c.route === "San Joaquins" ? [ventureDoor(1.2), ventureDoor(80.9)] : [ventureDoor(80.9)] });
// The Venture cab car (VIA's corridor trains, Amtrak Cascades' Airo, Amtrak
// Midwest, San Joaquins): a Charger-like cab, an upright nose under a steeply
// raked wraparound windshield, a cab side window behind it, a long blank cab
// section over the front truck, then the door and seven windows; the coupler
// and pilot exposed. A cap in the railroad's color edges the windshield and
// runs back along the roof (VIA yellow, Cascades tan).
// VIA's cab car: a streamlined nose, a rounded tip low down and the
// windshield raked back in one long slope.
const VIA_VENTURE_NOSE = [[3.4, 3.9], [1.3, 4.7], [0.9, 5.8], ["q", 0.85, 6.9, 1.6, 7.6], [7.2, 12.9], ["q", 8.6, 14.0, 11.0, 14.0]];
const VENTURE_NOSE = [[2.2, 3.9], [1.55, 4.9], [1.75, 6.0], [2.15, 9.1], [2.65, 9.35], [5.0, 13.0], ["q", 5.6, 14.0, 7.4, 14.0]];
const CAP = { via: "#f5c400", "Amtrak Cascades": "#b08a5a" };
function ventureCabPaint(c, g) {
  const L = g.L;
  let s = venturePaint(c, g);
  if (c.agency === "via") {
    // VIA: the yellow band and the light gray below the window band end on
    // slants well back from the cab; mid gray frames the charcoal window
    // band ahead of them, over a dark skirt. The cab is light gray below a
    // black band through its side window and door, behind a light line
    // curving up and back; yellow edges the windshield and caps the cab
    // roof.
    s += path(poly([[0, 10.62], [42.4, 10.62], [44.6, 12.9], [0, 12.9]]), "#6b6f74") +
      path(poly([[0, 0], [31.4, 0], [31.4, 3.9], [37.4, 6.65], [0, 6.65]]), "#6b6f74") +
      path(poly([[5.0, 0], [31.4, 0], [31.4, 3.9], [33.6, 4.9], [5.0, 4.9]]), "#3a3d41");
    s += path(poly([[0, 0], [16.3, 0], [16.3, 3.9], [17.4, 9.2], [0, 9.2]]), "#c8ccd0") +
      path(poly([[3.9, 9.2], [17.4, 9.2], ["q", 18.0, 12.2, 23.6, 12.9], [7.9, 12.9]]), "#24272b") +
      path("M16.3 3.9L17.4 9.2Q18.0 12.2 23.6 12.9", "none", 0, 'stroke="#e2e5e8" stroke-width="1.2" vector-effect="non-scaling-stroke"');
    s += path(poly([[0.9, 7.8], [2.4, 7.8], [7.9, 12.9], [13.0, 12.9], [13.0, 15], [5.0, 15]]), "#f5c400");
    return s;
  } else if (c.route === "Amtrak Cascades") {
    // Evergreen cab section; the cream band runs forward past the door and
    // ends in a rounded tip.
    s += rect(0, 5.2, 26, 7.6, "#1f4a40") + path("M27 5.7L21.8 5.7Q20.4 5.7 20.6 7.0Q21.4 8.6 24 8.7L27 8.7Z", "#efe9dc");
  } else if (c.route === "San Joaquins") {
    // Blue cab under a silver cap swept back from the windshield.
    s += path(`M0 0L20 0L20 6.1L17 12.8L0 12.8Z`, "#22409a") + path("M5.2 9.2Q7.0 12.4 12.0 12.8L20 12.8L20 15L4 15Z", "#dfe2e5") + rect(23.4, 4.25, 2.9, 7.05, "#f5c21b");
  } else if (c.agency === "amtrak") {
    // Midwest: a navy cab section fading into dots behind it.
    s += rect(0, 4.5, 19, 10, "#1c2a4c") + rect(0, 4.5, 19, 1.4, "#d4202c");
    for (let i = 0; i < 10; i++) for (let j = 0; j < 12; j++) s += circle(19.3 + i * 0.62 + (j % 2) * 0.31, 6.4 + j * 0.55, 0.26 * (1 - i / 10), "#1c2a4c");
  }
  const cap = CAP[c.agency] || CAP[c.route];
  if (cap) s += path(poly([[1.5, 5.0], [2.15, 9.1], [2.65, 9.35], [3.5, 9.35], [2.7, 5.0]]), cap) + path(poly([[4.9, 12.9], [5.5, 14.5], [14, 14.5], [14, 12.9]]), cap);
  s += path(poly([[2.0, 8.9], [4.9, 12.95], [7.3, 12.95], [6.9, 8.9]]), C.black); // the windshield surround
  return s;
}
// VIA's cab car.
const viaVentureCab = (c) => bilevel({ ...c, cabL: true }, { ...VENTURE, paint: ventureCabPaint, cabLen: 12,
  // The air-conditioning cover at the cab end sits behind the sloping nose.
  roofItems: [[14, 12, 0.3], [67.6, 16, 0.3]],
  // VIA: nine windows a little closer set than the coaches'.
  rows: [{ xs: seq(23.5, 6.0, 9), y: 7.15, w: 4.4, h: 2.75, r: 0.45 }],
  // VIA: yellow letters on the window band just behind the cab, a big red
  // maple leaf by the far door. Cascades: the name in white high behind
  // the cab.
  badge: (c) => (c.agency === "via" ? [{ x: 21.0, y: 8.8, h: 1.6, logo: "via-word" }, { x: 78.2, y: 7.1, h: 5.4, logo: "via-leaf" }]
    : c.route === "Amtrak Cascades" ? { x: 21, y: 11.4, h: 1.9, dark: true, logo: "cascades" } : undefined),
  badgeLogo: (c) => (MIDWEST_ROUTES.has(c.route) ? "amtrak-midwest" : c.route === "San Joaquins" ? "amtrak-california" : null),
  nose: VIA_VENTURE_NOSE,
  doors: [ventureDoor(13.2), ventureDoor(80.9)],
  cab: (c) => {
    // VIA's: the side window in the black band ahead of the crew door.
    let s = c.agency === "via" ? path(poly([[4.4, 9.6], [7.3, 12.4], [11.8, 12.4], [11.8, 9.6]]), C.glass)
      : path(poly([[1.9, 7.6], [7.0, 12.2], [9.6, 12.2], [9.6, 7.6]]), C.glass) + win(10.2, 8.6, 1.7, 2.8, 0.25);
    // Skirt over the coupler, down near the rail.
    return s + path(poly([[3.4, 3.9], [1.3, 4.7], [1.15, 2.6], ["q", 1.2, 1.5, 2.4, 1.4], [7.5, 1.4], [7.5, 3.9]]), "#3a3d41");
  } });
export const ventureCab = (c) => c.agency === "via" ? viaVentureCab(c) : bilevel({ ...c, cabL: true }, { ...VENTURE, paint: ventureCabPaint, cabLen: 0,
  // VIA: its yellow logo on the charcoal behind the cab, the red maple leaf at
  // the far end. Cascades: its logo in white on the cab section. San Joaquins:
  // Caltrans' mark behind the cab; Midwest: the logo in white on the navy.
  badge: (c) => (c.agency === "via" ? [{ x: 21, y: 8.6, h: 1.5, logo: "via-mark" }, { x: c.L - 4.6, y: 8.3, h: 4.6, logo: "via-leaf" }]
    : c.route === "Amtrak Cascades" ? { x: 16.0, y: 10.4, h: 2.4, dark: true, logo: "cascades" }
    : c.route === "San Joaquins" ? [{ x: 42.5, y: 11.3, h: 1.1, logo: "san-joaquins" }, { x: 29, y: 6.6, h: 0.75, logo: "caltrans" }]
    : { x: 13.5, y: 10.6, h: 1.4, dark: true, logo: "amtrak-midwest" }),
  nose: VENTURE_NOSE, roofItems: [[14, 12, 0.3], [67.6, 16, 0.3]],
  rows: [{ xs: seq(30.3, 6.8, 7), y: 7.3, w: 4.85, h: 2.5, r: 0.45 }],
  doors: [ventureDoor(23.4), ventureDoor(80.9)],
  cab: () => path(poly([[2.6, 9.25], [4.8, 12.65], [5.6, 12.65], [5.6, 9.25]]), C.glass) + win(8.2, 9.4, 1.9, 2.4, 0.25) + pilot(1.55, 3.9) });

// ===================== VIA Rail's Budd stainless fleet =====================
// Budd lightweights built for Canadian Pacific (1954-55), rebuilt for head-end
// power: 85 ft, 10 ft wide, 13 ft 6.75 in tall; fluted stainless below the
// windows and on the roof, a smooth band through the windows and a smooth
// letterboard above them. Skyline and Park domes stand 15 ft 10 in.
// Today's VIA scheme: a bright blue stripe along the letterboard, VIA's logo
// in the window band near one end, the Government of Canada wordmark low
// on the side near the vestibule (the Park cars stay plain stainless).
const BUDD = { roof: 13.56, sill: 3.9, cornerR: 1.1, trucks: { centers: 59.5, wb: 8.5, d: 36 }, end: 0.6, diaphragm: [4.25, 12.3],
  badge: { x: 79.4, y: 8.5, h: 1.4 } };
const buddSteel = (L) => rect(0, 0, L, 17, "#d5d9de") + flutes(0, L, 4.1, 6.6, 0.26) + rect(0, 11.9, L, 2, "#c3c9d0") + flutes(0, L, 12.0, 13.4, 0.3) +
  line(0, 10.55, L, 10.55, "rgba(0,0,0,0.18)", 0.5) + line(0, 6.65, L, 6.65, "rgba(0,0,0,0.18)", 0.5);
const buddPaint = (c, g) => buddSteel(g.L) + rect(0, 10.75, g.L, 1.15, "#2266cc");
const canadaMark = (x) => ({ x, y: 5.95, h: 3.2, dark: true, logo: "canada" });
const buddDoor = (x) => ({ x, w: 2.6, y0: 4.0, y1: 11.0, glassY: 0.55, glassH: 0.3 });
// Coach (rebuilt): one vestibule; two small windows by it, then eight big
// picture windows.
export const buddCoach = (c) => bilevel(c, { ...BUDD, paint: buddPaint, doors: [buddDoor(1.3)],
  badge: [canadaMark(12.5), { x: 81.4, y: 8.5, h: 2.2 }],
  rows: [{ xs: [6.8, 12.8], y: 7.15, w: 2.4, h: 2.75, r: 0.35 }, { xs: seq(17.0, 8.0, 8), y: 7.15, w: 5.0, h: 2.75, r: 0.35 }] });
// Manor sleeper: big section windows (with small upper-berth windows above)
// at one end, bedroom windows in the middle, smaller roomette windows at the
// other end; one vestibule.
export const buddSleeper = (c) => bilevel(c, { ...BUDD, paint: buddPaint, doors: [buddDoor(1.3)],
  badge: [canadaMark(12.5), { x: 50.5, y: 8.6, h: 1.5 }],
  rows: [{ xs: [6.4, 11.2, 16.0], y: 7.15, w: 4.0, h: 2.75, r: 0.35 }, { xs: [7.4, 12.2, 17.0], y: 10.1, w: 2.0, h: 0.6, r: 0.15 },
    { xs: [22.4, 27.0, 31.6, 36.2, 40.8, 45.4], y: 7.4, w: 3.2, h: 2.4, r: 0.3 }, { xs: seq(52.4, 3.95, 8), y: 7.6, w: 2.4, h: 2.1, r: 0.3 }] });
// Dining car: a run of dining-room windows, a kitchen end with a few small ones.
export const buddDiner = (c) => bilevel(c, { ...BUDD, paint: buddPaint, doors: [buddDoor(81.1)],
  badge: [canadaMark(70.0), { x: 79.4, y: 8.5, h: 1.4 }],
  rows: [{ xs: seq(4.4, 5.0, 10), y: 7.15, w: 4.2, h: 2.75, r: 0.35 }, { xs: [57.5, 64.2, 71.0], y: 8.6, w: 1.6, h: 1.4, r: 0.2 }] });
// Baggage car: fluted the full height, two wide doors a side, no windows.
export const buddBaggage = (c) => bilevel(c, { ...BUDD,
  paint: (c, g) => rect(0, 0, g.L, 17, "#d5d9de") + flutes(0, g.L, 4.1, 11.6, 0.26) + flutes(0, g.L, 12.0, 13.4, 0.3) + rect(0, 10.75, g.L, 1.15, "#2266cc"),
  doors: [{ x: 17.5, w: 6.5, y0: 4.0, y1: 11.3, glass: false, grabs: false }, { x: 61.0, w: 6.5, y0: 4.0, y1: 11.3, glass: false, grabs: false }],
  rows: [] });
// Skyline: a short dome over the middle of the car, coach seats and a
// coffee-shop end below.
function dome(a, b, roof, top, { rear = false } = {}) {
  let s = path(poly([[a, roof - 0.05], [a + 3.6, top - 0.5], ["q", a + 4.4, top, a + 5.6, top], [b - 5.6, top], ["q", b - 4.4, top, b - 3.6, top - 0.5], [b, roof - 0.05]]), "#d5d9de", 0.8);
  // Wraparound dome glass: tall panes along the side, angled end panes.
  s += path(poly([[a + 1.0, roof + 0.25], [a + 3.8, top - 0.75], [a + 5.0, top - 0.75], [a + 5.0, roof + 0.25]]), C.glass);
  for (let x = a + 5.6; x < b - 6.4; x += 2.6) s += rect(x, roof + 0.3, 2.2, top - roof - 1.1, C.glass, 0, 'rx="0.2"') + rect(x + 0.1, top - 1.4, 2.0, 0.45, C.glassLight);
  s += path(poly([[b - 1.0, roof + 0.25], [b - 3.8, top - 0.75], [b - 5.0, top - 0.75], [b - 5.0, roof + 0.25]]), C.glass);
  return s;
}
// The dome sits toward the plain end; under and ahead of it small windows,
// at the vestibule end a lounge with big picture windows.
export const skyline = (c) => bilevel(c, { ...BUDD, paint: buddPaint, doors: [buddDoor(81.1)],
  badge: [canadaMark(65.4), { x: 70.0, y: 8.5, h: 1.7 }],
  rows: [{ xs: [1.6], y: 7.5, w: 1.1, h: 2.2, r: 0.3 }, { xs: [4.7, 11.9], y: 7.5, w: 2.9, h: 2.2, r: 0.3 },
    { xs: [15.6, 21.1, 25.6, 29.5, 34.0, 44.3], y: 7.5, w: 2.5, h: 2.2, r: 0.3 },
    { xs: [47.6], y: 7.15, w: 6.3, h: 2.75, r: 0.35 }, { xs: [56.0], y: 7.15, w: 6.5, h: 2.75, r: 0.35 }, { xs: [64.6], y: 7.15, w: 3.2, h: 2.75, r: 0.35 },
    { xs: [72.0], y: 7.15, w: 2.7, h: 2.75, r: 0.35 }],
  extra: () => dome(19.2, 52.8, 13.56, 15.83) });
// Park car: sleeping rooms up front, a lounge under a dome, and a round
// "bullet" observation end with wraparound windows and a tail sign. Drawn
// with the round end on the left; mirrored when it runs last, as it does.
export const parkCar = (c) => {
  const L = c.L, roof = 13.56, sill = 3.9;
  // Plain stainless today; the logo in the window band by the vestibule.
  // Big lounge windows toward the round end, small ones under the dome,
  // three bedroom windows toward the vestibule.
  return bilevel({ ...c, cabL: true }, { ...BUDD, paint: (c, g) => buddSteel(g.L), doors: [buddDoor(81.1)], cabLen: 0,
    badge: { x: 78.3, y: 8.6, h: 1.7 },
    nose: [[5.0, sill], ["q", 0.6, sill, 0.6, 8.6], ["q", 0.6, roof, 6.0, roof]],
    rows: [{ xs: [8.4, 13.2], y: 7.15, w: 3.4, h: 2.75, r: 0.35 }, { xs: [19.8], y: 7.15, w: 4.4, h: 2.75, r: 0.35 }, { xs: [26.0], y: 7.2, w: 2.1, h: 2.7, r: 0.3 },
      { xs: [32.4, 37.3, 41.7, 46.4], y: 7.6, w: 2.7, h: 2.0, r: 0.3 }, { xs: [54.4, 63.8, 72.7], y: 7.4, w: 2.9, h: 2.4, r: 0.3 }],
    cab: () => path("M1.2 7.1Q1.2 6.95 1.6 6.95L5.6 6.95L5.6 10.0L1.6 10.0Q1.2 10.0 1.2 9.8Z", C.glass) + rect(1.0, 10.6, 1.0, 1.0, "#c8102e", 0, 'rx="0.2"'),
    extra: () => dome(18.9, 50.4, roof, 15.83) });
};
// Budd RDC (VIA's Sudbury-White River cars): 85 ft, 14 ft 7 in over the roof
// equipment, fluted stainless, a diesel engine under each end driving the
// inner axle of its truck; roof radiators and exhausts. VIA removed one cab
// from each car (the end is plated over) and added a yellow sill stripe;
// they carry the blue letterboard stripe too.
export const rdc = (c) => bilevel({ ...c, cabL: true }, { ...BUDD, roof: 13.5, badge: false, // VIA's logo is on the ends
  paint: (c, g) => buddPaint(c, g) + rect(0, 4.1, g.L, 0.4, "#f5c400"),
  doors: [buddDoor(1.6), buddDoor(80.8)], cabLen: 0,
  rows: [{ xs: seq(8.0, 4.55, 15), y: 7.3, w: 3.4, h: 2.5, r: 0.35 }],
  roofItems: [[6.5, 13, 0.8], [65.5, 13, 0.8]],
  cab: (c) => rect(0.65, 7.2, 0.35, 2.4, C.glass),
  extra: (c, g) => rect(20, 2.0, 12, 1.8, "currentColor", 0, 'opacity="0.8" rx="0.2"') + rect(53, 2.0, 12, 1.8, "currentColor", 0, 'opacity="0.8" rx="0.2"') +
    rect(12.5, 14.25, 0.5, 0.9, "currentColor") + rect(72.0, 14.25, 0.5, 0.9, "currentColor") });

// NC By Train (Piedmont) coaches: rebuilt 1950s and 1960s streamlined cars,
// 85 ft, smooth-sided, a vestibule at each end. Silver with a blue band from
// the eave down past the windows, a thin red stripe low on the side and
// "North Carolina" (with stars) under the windows by one end.
export const ncdotCoach = (c) => bilevel(c, { ...BUDD, doors: [buddDoor(1.3), buddDoor(81.1)],
  badge: { x: 12.5, y: 5.6, h: 0.9, logo: "north-carolina" },
  paint: (c, g) => rect(0, 0, g.L, 17, "#c9cdd2") + rect(0, 6.7, g.L, 5.3, "#2440a0") + rect(0, 4.35, g.L, 0.22, "#c8102e") + rect(0, 12.0, g.L, 2, "#b3b9c0") +
    path(poly([[5.8, 5.3], [6.1, 6.0], [6.4, 5.3], [5.75, 5.75], [6.45, 5.75]]), "#c8102e"),
  rows: [{ xs: seq(7.0, 5.12, 14), y: 7.4, w: 4.2, h: 2.6, r: 0.35 }] });

// ===================== VIA Rail's Renaissance cars =====================
// Built in Britain for Channel Tunnel night trains (Nightstar), about 75 ft,
// lower and narrower than North American cars, with a rounded roof and
// plug doors at each end. VIA (the Ocean): teal from the windows up to a
// navy roof, a yellow line under the windows, navy below it.
const REN = { navy: "#1e3466", teal: "#2ea3ad", yellow: "#f5c400" };
function renaissance(c, { rows }) {
  return coachCar(c, {
    roof: 12.6, sill: 3.8, endR: 1.4, eave: 11.7, end: 0.5,
    base: REN.navy, roofBand: "#1c2c58",
    stripes: [[6.6, 5.1, REN.teal], [6.2, 0.4, REN.yellow]],
    rows, doors: [{ x: 1.1, w: 2.3, h: 7.0 }, { x: c.L - 3.4, w: 2.3, h: 7.0 }],
    trucks: { centers: 52, wb: 8.4, d: 33 }, diaphragm: [4.25, 11.2],
    badge: { x: 7.6, y: 10.8, h: 1.0, dark: true },
  });
}
// Coach: a big window for every two rows of seats. Sleeper: one window to
// each compartment.
export const renaissanceCoach = (c) => renaissance(c, { rows: [{ a: 5, b: c.L - 5, y: 7.0, w: 4.6, h: 2.6, pitch: 6.6, r: 0.4 }] });
export const renaissanceSleeper = (c) => renaissance(c, { rows: [{ a: 5, b: c.L - 5, y: 7.3, w: 3.0, h: 2.2, pitch: 6.6, r: 0.35 }] });
export const renaissanceDiner = (c) => renaissance(c, { rows: [{ a: 5, b: c.L - 5, y: 6.9, w: 4.4, h: 2.6, pitch: 5.4, r: 0.4 }] });

// ===================== Acela =====================
// Alstom Avelia Liberty (Amtrak 2100-2155 power cars): a power car at each
// end of nine articulated coaches, 676 ft in all. The power car: a long
// pointed nose rising under a raked windshield to a louvered roof hood,
// the crew door near mid-car, trucks 30 ft apart. White, with the hood and
// the band above the windows blue; a deep red skirt; at the back a blue
// lower band that dissolves forward in a halftone; the nose skirt charcoal.
// Coaches: blue above and below a white window band, red skirt; seven big
// windows and a door at one end; a truck shared at each joint (Jakobs
// articulation): each coach draws half of the shared truck at either end
// and its neighbor draws the other half.
export function acelaPower(c) {
  const { L } = c, sill = 2.7, roof = 14.17, back = 13.3;
  const d = poly([[1.6, 1.7], [11, 1.8], [15.5, 3.2], [25.5, 3.2], [27, sill], [L - 0.6, sill], [L - 0.6, back - 0.6], ["q", L - 0.6, back, L - 1.2, back],
    [49.6, back], [48.9, roof], [27, roof], ["q", 22, roof, 18.5, 13.3], ["q", 15, 12.2, 12.5, 10.6], [5.3, 6.4], ["q", 1.3, 5.5, 0.4, 4.6],
    ["q", 0, 3.4, 0.4, 2.3], ["q", 0.7, 1.75, 1.6, 1.7]]);
  let s = "";
  for (const x of [20.4, 50.7]) s += truck(x, { wb: 9.33, d: 40, kind: "loco", top: 3.6 });
  let liv = rect(0, 0, L, 16, "#f1f2f4") + rect(0, 10.6, L, 6, "#2f5fa6");
  // Light gray sweeping down the nose under the cab; the charcoal nose skirt;
  // the red skirt from the door back.
  liv += path("M0 0L0 5.2Q9 6.4 17.5 8.2Q24 6.0 28.5 4.0L28.5 0Z", "#dfe3e8");
  liv += path("M0 0L0 2.6Q13 3.0 26.8 4.0L26.8 0Z", "#3f444b") + rect(26.8, 0, L, 4.0, "#c8102e");
  // At the back, blue below the white band, dissolving forward in dots.
  let dots = "";
  for (let x = L - 20; x < L - 7; x += 0.7) for (let y = 4.35; y < 7.0; y += 0.7) {
    const r = Math.min(0.36, 0.04 + ((x - (L - 20)) / 13) * 0.32);
    dots += `M${(x - r).toFixed(2)} ${y.toFixed(2)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0`;
  }
  liv += path(dots, "#2f5fa6") + rect(L - 7.2, 4.0, 7.2, 2.6, "#2f5fa6");
  // The raked windshield, blue above it.
  liv += path(poly([[4.0, 5.9], [13.5, 11.4], [14.6, 10.3], [6.1, 5.5]]), C.black);
  s += path(d, "#f1f2f4") + clipped(d, liv);
  s += path(poly([[19.4, 8.2], [23.0, 8.0], [23.0, 10.2], [20.3, 10.2]]), C.glass, 0.5);         // cab side window
  s += door(26.7, 4.1, 2.4, 6.2, { glass: false });                                           // crew door
  // Louvered hood along the roof; the pantograph in the well behind it.
  for (const x of [25.5, 31.0, 36.5, 42.0]) s += rect(x, 11.3, 5.0, 2.3, "rgba(0,0,0,0.16)", 0.4) + slats(x, 11.3, 5.0, 2.3, 0.4, "rgba(0,0,0,0.3)");
  s += pantograph(52.0, back, { up: true, facing: -1 }).replace(/currentColor/g, "#c8102e");
  s += outlineOf(d) + carEnds(c, { floor: 4.0, top: 12.6 });
  s += badge(c, 40, 7.3, 3.0, { logo: "acela" });                    // the Acela logo, behind the crew door
  return s;
}
export function acelaCoach(c) {
  const { L } = c, sill = 4.0, roof = 14.0, x0 = 0.3, x1 = L - 0.3;
  // Shared trucks at the joints; the coaches next to the power cars have their own truck at that end.
  const first = c.index === 1, last = c.count != null && c.index === c.count - 2;
  // The red skirt hangs below the floor between the trucks.
  const d = bodyOutline(x0, x1, sill, roof, { endR: 1.2, drop: { a: first ? 13.5 : 8.0, b: last ? L - 13.5 : L - 8.0, y: 2.0 } });
  let s = "";
  s += first ? truck(6.0, { wb: 9.0, d: 36, kind: "car", top: sill }) : truck(0, { wb: 9.0, d: 36, kind: "car", top: sill });
  s += last ? truck(L - 6.0, { wb: 9.0, d: 36, kind: "car", top: sill }) : truck(L, { wb: 9.0, d: 36, kind: "car", top: sill });
  let liv = rect(0, 0, L, 16, "#2f5fa6") + rect(0, 6.5, L, 4.75, "#f4f5f7") + rect(0, 0, L, 4.0, "#c8102e");
  // The white door, blue dots scattered along the band toward it.
  liv += rect(x1 - 3.6, 4.0, 3.0, 7.25, "#f4f5f7");
  let dots = "";
  for (let x = x1 - 13; x < x1 - 3.8; x += 0.6) for (let y = 6.8; y < 11.0; y += 0.6) {
    const r = 0.03 + ((x - (x1 - 13)) / 9.2) * 0.2 * (1 - (y - 6.8) / 5);
    dots += `M${(x - r).toFixed(2)} ${y.toFixed(2)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0`;
  }
  liv += path(dots, "#2f5fa6");
  s += path(d, "#2f5fa6") + clipped(d, liv);
  for (let i = 0; i < 7; i++) s += win(4.6 + i * 6.15, 7.3, 4.85, 3.0, 0.45);
  s += door(x1 - 3.4, 4.15, 2.6, 7.0, { glassY: 0.55, glassH: 0.3, grabs: false });
  s += badge(c, 2.6, 12.5, 0.8, { logo: "amtrak-mark", dark: true });  // small travelmark high at the end
  s += outlineOf(d) + carEnds(c, { floor: 4.25, top: 12.6 });
  return s;
}

// ===================== Talgo =====================
// Talgo Series 8 (Amtrak Cascades): short articulated cars, about 43 ft,
// riding on one wheel pair under each joint instead of trucks; low bodies,
// one door at one end. Cascades colors: evergreen, copper and cream.
export function talgo(c) {
  const { L } = c, sill = 2.6, roof = 11.0, x0 = 0.3, x1 = L - 0.3;
  const d = bodyOutline(x0, x1, sill, roof, { endR: 1.0 });
  let s = "";
  for (const x of [0, L]) s += rect(x - 1.3, 1.8, 2.6, 2.6, "currentColor", 0, 'opacity="0.85" rx="0.3"') + circle(x, 1.5, 1.5, "currentColor") + circle(x, 1.5, 1.2, "none", 0, `stroke="${C.steelDark}" stroke-width="0.5"`);
  let liv = rect(0, 0, L, 13, "#1f4d3a") + rect(0, 5.6, L, 3.6, "#efe6d2") + rect(0, 9.2, L, 0.5, "#a0522d");
  s += path(d, "#1f4d3a") + clipped(d, liv);
  for (let x = 5.6; x < L - 6; x += 6.2) s += win(x, 5.9, 4.6, 2.8, 0.4);
  s += door(1.2, 2.8, 2.4, 6.6, { glassY: 0.55, glassH: 0.3, grabs: false });
  return s + outlineOf(d) + carEnds(c, { floor: 2.8, top: 10.0 });
}

// ===================== Auto Train =====================
// Johnstown America auto carriers (Amtrak 9200-9279): 89 ft, about 20 ft
// tall, fully enclosed: unpainted aluminum side sheets between posts about
// 4 ft apart, a slotted skirt along the bottom over the flatcar's side sill,
// an arched roof corrugated across the car, bi-fold doors in the ends. A thin
// red line over the skirt; the logo, name over travelmark, high on the side
// toward one end.
export function autorack(c) {
  const { L } = c, sill = 2.6, roof = 19.9, eave = 17.6, skirt = 4.3, x0 = 0.6, x1 = L - 0.6;
  const d = poly([[x0, sill], [x1, sill], [x1, roof - 0.5], ["q", x1, roof, x1 - 0.6, roof], [x0 + 0.6, roof], ["q", x0, roof, x0, roof - 0.5]]);
  let s = rect(x0 + 0.4, 2.0, x1 - x0 - 0.8, 0.6, "currentColor", 0, 'opacity="0.85"');      // flatcar side sill
  s += truck(L / 2 - 32.5, { wb: 5.8, d: 36, kind: "car", top: 2.4 }) + truck(L / 2 + 32.5, { wb: 5.8, d: 36, kind: "car", top: 2.4 });
  let liv = rect(0, 0, L, 21, "#d3d7db") + rect(0, eave, L, 3, "#bfc4ca") + rect(0, sill, L, skirt - sill, "#a9afb6");
  const posts = [], ribs = [], slots = [];
  for (let x = x0 + 2.2; x < x1 - 1; x += 4.2) posts.push([x, skirt, x, eave]);
  for (let x = x0 + 0.3; x < x1; x += 0.35) ribs.push([x, eave + 0.1, x, roof]);
  for (let x = x0 + 0.9; x < x1 - 0.5; x += 1.05) slots.push([x, sill + 0.25, x, skirt - 0.3]);
  liv += lines(posts, "rgba(0,0,0,0.2)", 0.7) + lines(ribs, "rgba(0,0,0,0.12)", 0.4) + lines(slots, "#3a3f45", 1.4);
  liv += line(0, eave, L, eave, "rgba(0,0,0,0.25)", 0.6) + rect(0, skirt + 0.1, L, 0.18, AMTRAK.red);
  s += path(d, "#d3d7db") + clipped(d, liv) + outlineOf(d);
  s += badge(c, 30.5, 11.6, 4.3, { logo: "amtrak-stack" });          // high on the side, toward one end
  return s;
}

// ===================== Full-width carbody locomotives =====================
// cabUnit(c, spec): a locomotive whose body runs the full width of the frame,
// cab on the left. spec:
//   roof, sill: ft above rail. nose: the front profile from the bottom of the
//     body up to the start of the roof, as poly() points (curves allowed);
//     top: more roofline points after the nose (steps, raised sections);
//     rearR: rear roof corner radius.
//   paint(c, sp): livery, clipped to the body. glass: cab glass polygons;
//     sideWin: cab side windows [[x, y, w, h]].
//   doors: [[x, w, y0, y1]]; steps hung below the body;
//   grilles: [[x, y, w, h, gap]]; panels: [[x, y, w, h]] outlined access doors;
//   tank: [x0, x1, bottom]; reservoir: [x0, x1]; trucks: { centers, wb, d, shoe };
//   roofItems: [[x, w, h]];
//   fans: [x, ...]; horn: x; extra(c, sp);
//   badge: the railroad's logo, { x, y, h, dark, logo, skip } (one, a list,
//     or a function of the car).
export function cabUnit(c, spec) {
  const { L } = c, { roof, sill } = spec;
  const rearR = spec.rearR ?? 1.2, endX = L - 1.0;
  const nose = spec.nose;
  const d = poly([...nose, ...(spec.top || []), [endX - rearR, roof], ["q", endX, roof, endX, roof - rearR], [endX, sill]]);
  let s = "";
  // Pilot and plow, coupler; rear end sill and coupler.
  const fx = Math.min(...nose.map((p) => (p[0] === "q" ? p[3] : p[0])));
  s += pilot(fx, sill);
  s += rect(L - 2.1, 2.0, 1.1, sill - 2.0, "currentColor", 0, 'opacity="0.85"');
  // Fuel tank and main reservoirs between the trucks.
  if (spec.tank) {
    const [t0, t1, tb = 1.4] = spec.tank;
    s += path(poly([[t0, sill], [t1, sill], [t1, tb + 0.9], ["q", t1, tb, t1 - 0.9, tb], [t0 + 0.9, tb], ["q", t0, tb, t0, tb + 0.9]]), "currentColor", 0, 'opacity="0.82"');
    s += line(t0 + 0.6, tb + 0.9, t1 - 0.6, tb + 0.9, "rgba(255,255,255,0.12)", 0.6);
  }
  if (spec.reservoir) {
    const [r0, r1] = spec.reservoir;
    s += rect(r0, sill - 1.75, r1 - r0, 0.75, C.steelDark, 0.4, 'rx="0.37"');
  }
  const tr = spec.trucks;
  for (const k of [-1, 1]) s += truck(L / 2 + (k * tr.centers) / 2, { wb: tr.wb, d: tr.d, kind: "loco", top: sill, shoe: tr.shoe });
  let liv = rect(0, 0, L, roof + 1, spec.base ?? C.steel);
  if (spec.paint) liv += spec.paint(c, { ...spec, L });
  for (const g of spec.glass || []) liv += path(poly(g), C.glass) + path(poly(g), "none", 0, `stroke="${C.gasket}" stroke-width="0.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"`);
  for (const w of spec.sideWin || []) liv += win(...w, 0.2);
  s += path(d, spec.base ?? C.steel) + clipped(d, liv);
  for (const [x, y, w, h] of spec.panels || []) s += rect(x, y, w, h, "none", 0.45, 'rx="0.12"');
  for (const [x, w, y0, y1] of spec.doors || []) s += door(x, y0, w, y1 - y0, { glassY: 0.7, glassH: 0.2 });
  for (const [x, y, w, h, gap = 0.4] of spec.grilles || []) s += rect(x, y, w, h, "rgba(20,22,25,0.55)", 0.4) + slats(x, y, w, h, gap, "rgba(255,255,255,0.18)");
  for (const [x, w, h] of spec.roofItems || []) s += rect(x, roof - 0.05, w, h, C.steelDark, 0.4, 'rx="0.12"');
  for (const x of spec.fans || []) s += path(`M${x - 2} ${roof}Q${x} ${roof + 0.8} ${x + 2} ${roof}Z`, C.steelDark, 0.4);
  if (spec.horn != null) s += rect(spec.horn, roof - 0.05, 1.1, 0.35, "currentColor") + rect(spec.horn + 0.1, roof + 0.3, 0.25, 0.35, "currentColor") + rect(spec.horn + 0.6, roof + 0.3, 0.25, 0.45, "currentColor");
  if (spec.extra) s += spec.extra(c, { ...spec, L });
  if (spec.badge) s += spots(c, spec.badge).map((o) => badge(c, o.x, o.y, o.h, { dark: o.dark, logo: o.logo, skip: o.skip })).join("");
  s += outlineOf(d);
  return s;
}

// Reflective tape along a sill: short white dashes.
const tape = (x0, x1, y, step = 1.2) => {
  const segs = [];
  for (let x = x0 + 0.4; x < x1 - 0.4; x += step) segs.push([x, y, x + 0.55, y]);
  return lines(segs, "#f4f4f4", 0.9);
};

// --- MBTA (HSP46, F40PH-3C): a yellow-edged diagonal runs from the roof
// behind the cab down to the sill. Ahead of it the cab is purple above a
// yellow line, black below. Behind it the hood is silver over a purple band
// along the bottom; toward the rear the band steps up clear of the sill,
// with silver below it. A big white "T" disc on the hood, a dark gray roof.
//   diag: [x at the sill, x at the roof]; skirt: top of the black sill
//   strip; band: top of the purple band; cabLine: the yellow line under
//   the cab windows, running down to nose [x, y] at the front;
//   rear: { up, low, top, bot }: where the band's top and bottom step up,
//   and to what; hood: where the gray roof starts; T: [x, y, r].
function mbtaPaint(c, { L, roof, diag, skirt, band, cabLine, nose, rear = null, hood, T = null }) {
  const { purple: P, yellow: Y, black: K } = MBTA;
  const xd = (y) => diag[0] + ((diag[1] - diag[0]) * (y - skirt)) / (roof - skirt);
  const top = roof + 1, yl = (pts) => path(pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(""), "none", 0, `stroke="${Y}" stroke-width="0.24" stroke-linejoin="round"`);
  let s = rect(0, 0, L, top, MBTA.silver) + path(poly([[xd(hood), hood], [L, hood], [L, top], [xd(top), top]]), MBTA.roof);
  s += rect(0, skirt, L, band - skirt, P);
  if (rear) {
    s += path(poly([[rear.low + 0.6, skirt], [L, skirt], [L, rear.bot], [rear.low, rear.bot]]), MBTA.silver);
    s += path(poly([[rear.up + 0.6, band], [rear.up, rear.top], [L, rear.top], [L, band]]), P);
  }
  s += path(poly([[0, nose[1]], [nose[0], nose[1]], [nose[0] + 3.0, cabLine], [xd(cabLine), cabLine], [xd(top), top], [0, top]]), P);
  s += path(poly([[0, 0], [xd(0), 0], [xd(cabLine), cabLine], [nose[0] + 3.0, cabLine], [nose[0], nose[1]], [0, nose[1]]]), K);
  s += rect(0, 0, L, skirt, K) + tape(0, L, skirt - 0.3);
  s += yl([[nose[0] - 0.4, nose[1] - 0.25], [nose[0], nose[1]], [nose[0] + 3.0, cabLine], [xd(cabLine), cabLine]]) + yl([[xd(skirt), skirt], [xd(top), top]]);
  s += yl([[xd(band), band], [rear ? rear.up + 0.6 : L, band], ...(rear ? [[rear.up, rear.top], [L, rear.top]] : [])]);
  if (rear) s += yl([[rear.low + 0.6, skirt], [rear.low, rear.bot], [L, rear.bot]]);
  s += rect(0, skirt - 0.06, L, 0.12, Y);
  if (T) s += tDisc(...T);
  return s;
}
// The MBTA "T": a white disc with a black ring and a black T.
const tDisc = (x, y, r) => circle(x, y, r, "#ffffff", 0, `stroke="#1d1f22" stroke-width="${(r * 0.12).toFixed(2)}"`) +
  rect(x - r * 0.55, y + r * 0.22, r * 1.1, r * 0.3, "#1d1f22") + rect(x - r * 0.15, y - r * 0.6, r * 0.3, r * 0.85, "#1d1f22");

// --- MotivePower HSP46 (MBTA 2000-2039): 71 ft over couplers, 15 ft 4.5 in,
// trucks 45 ft apart on 40 in wheels. Upright nose under a raked two-pane
// windshield; a two-pane cab side window, then the crew door with its ladder;
// a louvered box low under the cab window; dynamic-brake vents on the roof
// shoulder behind the cab; tall radiator intakes at the rear.
export const hsp46 = (c) => cabUnit(c, {
  roof: 15.37, sill: 4.4, rearR: 1.0,
  nose: [[1.95, 4.4], [1.55, 5.3], [1.5, 10.2], [1.75, 10.55], [3.05, 13.85], ["q", 3.4, 15.37, 5.2, 15.37]],
  glass: [[[1.95, 10.75], [3.05, 13.6], [3.6, 13.6], [3.6, 10.75]]],
  sideWin: [[4.8, 10.7, 2.4, 2.5], [7.4, 10.7, 1.8, 2.5]],
  doors: [[10.4, 2.1, 5.0, 13.4]],
  // Louvered box under the cab window; roof-shoulder vents behind the cab;
  // at the rear a double door with two louvers, then a wide intake panel
  // with two tall louvers framed in a V.
  grilles: [[4.9, 5.4, 3.4, 1.8, 0.3], [13.6, 13.55, 3.6, 1.0, 0.35], [22.6, 13.5, 3.6, 1.0, 0.35], [26.6, 13.5, 3.6, 1.0, 0.35],
    [59.0, 5.9, 2.2, 4.5, 0.3], [62.5, 5.9, 1.8, 4.5, 0.3], [48.3, 5.4, 4.1, 7.2, 0.3], [52.8, 5.4, 3.9, 7.2, 0.3]],
  panels: [[19.3, 5.2, 3.0, 7.4], [58.6, 5.1, 6.2, 6.2], [47.0, 5.1, 11.2, 7.7]],
  tank: [23, 48, 1.5], reservoir: [33.5, 46],
  trucks: { centers: 45, wb: 9.33, d: 40 },
  roofItems: [[46, 1.6, 0.45]], fans: [56, 61, 66], horn: 4.2,
  paint: (c, sp) => c.agency === "mbta" || !c.agency
    ? mbtaPaint(c, { L: sp.L, roof: sp.roof, diag: [14.4, 21.4], skirt: 5.1, band: 8.3, cabLine: 8.3, nose: [1.6, 6.3], hood: 12.6,
      rear: { up: 41.8, low: 46.0, top: 10.5, bot: 6.8 }, T: [30.5, 9.2, 3.5] })
    : genericPaint(c, sp),
  extra: (c, sp) => lines([[47.2, 12.7, 52.6, 5.3], [57.9, 12.7, 52.6, 5.3]], "rgba(0,0,0,0.45)", 0.6),
});

// Plain agency paint for a diesel without a researched livery.
const genericPaint = (c, sp) => rect(0, 0, sp.L, sp.sill + 1.0, "#2a2d31") + rect(0, sp.sill + 1.0, sp.L, 0.45, c.color || "#1f5fad");

// The MPXpress carbody shared by the MP36PH-3C, MP40PH-3C and MP54AC.
const MPX = {
  roof: 15.5, sill: 4.55, rearR: 1.1,
  nose: [[2.0, 4.55], ["q", 0.6, 4.9, 0.6, 6.4], ["q", 0.7, 8.4, 1.9, 9.1], [3.5, 10.1], [4.7, 12.6], ["q", 5.6, 15.5, 9.5, 15.5]],
  glass: [[[4.0, 10.4], [4.95, 12.45], [6.1, 12.45], [6.1, 10.4]], [[6.3, 10.45], [6.3, 12.45], [8.5, 12.45], [8.5, 10.6]]],
  sideWin: [[9.8, 10.2, 2.8, 1.7]],
  doors: [[13.3, 1.9, 5.0, 12.9]],
  tank: [33.1, 48.2, 1.5], reservoir: [21.9, 32.6],
  trucks: { centers: 42.83, wb: 9.33, d: 40 }, horn: 10.6,
};

// --- MotivePower MP36PH-3C (Metra 401-427, Caltrain 923-928, UTA FrontRunner
// 1-21, MBTA 010-011, MARC 10-35): 68 ft, 15 ft 6 in, Blomberg trucks 42 ft 10 in apart,
// 9 ft 4 in wheelbase, 40 in wheels. A long, bulbous nose ahead of a raked
// windshield set well back (front and corner panes); the cab side window,
// then the cab door 13 ft back from the nose, with a louvered box below the
// window. Intakes high along the hood behind the dynamic brake; a fifth
// roof fan at the very rear cools the HEP genset.
export const mp36 = (c) => cabUnit(c, {
  // Metra: a big white logo on the blue toward the rear and a small blue one
  // under the cab window. FrontRunner: the name small toward the rear. MBTA
  // units carry the T disc in their paint. MARC: the logo big on the hood,
  // breaking the band.
  badge: (c) => ({ metra: [{ x: 43.8, y: 7.0, h: 3.7, dark: true }, { x: 10.7, y: 7.5, h: 0.95 }], frontrunner: { x: 47, y: 9.3, h: 0.75 },
    marc: { x: 42.4, y: 7.8, h: 4.0 },
    // Rail Runner: its name spaced out along the hood behind the roadrunner,
    // NEW MEXICO small over RAIL and EXPRESS under RUNNER. VRE: none (see VRE).
    railrunner: [{ x: 47.5, y: 9.5, h: 1.2, logo: "rail-runner" }, { x: 40.4, y: 10.9, h: 0.42, logo: "new-mexico" }, { x: 52.7, y: 8.2, h: 0.4, logo: "rr-express" }] })[c.agency],
  ...MPX,
  grilles: [[9.0, 5.1, 3.2, 1.3, 0.25], [27.5, 12.4, 9.8, 1.6, 0.36], [37.8, 11.9, 8.4, 2.6, 0.38], [46.6, 11.9, 7.9, 2.6, 0.38], [54.7, 11.9, 11.5, 2.6, 0.38]],
  panels: [[8.6, 4.75, 4.0, 2.0], [29.3, 5.0, 5.9, 3.8], [53.5, 5.0, 6.6, 3.8]],
  roofItems: [[33, 1.6, 0.6]], fans: [46.7, 51.1, 55.5, 59.9, 64.1],
  paint: (c, sp) => {
    const L = sp.L;
    switch (c.agency) {
      case "metra": {
        // Metra's current scheme: black from the windows up, an orange stripe
        // split by a dark red pinstripe that sweeps up over the rear corner and
        // down the nose; below it blue at the rear fading to silver over the
        // cab; red and white chevrons on the nose; a white line at the sill.
        const id = `ts-metra-${++clipSeq}`;
        let s = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="23" y1="0" x2="37" y2="0"><stop offset="0" stop-color="#d4d7db"/><stop offset="1" stop-color="#2459aa"/></linearGradient></defs>`;
        s += rect(0, 0, L, sp.roof + 1, "#1d1f22") + rect(0, 4.8, L, 4.4, `url(#${id})`) + rect(0, 4.55, L, 0.25, "#e9eaec");
        for (let k = 0; k < 2; k++) s += path(poly([[3.6 - k * 1.7, 9.0], [4.5 - k * 1.7, 9.0], [0, 5.9 - k * 1.5], [0, 5.0 - k * 1.5]]), "#c8102e");
        s += path(`M${L} 14.9Q${L - 4} 11.1 ${L - 12} 10.95L14 10.2Q7 10.2 4 9.45Q1.6 8.8 0 7.6L0 6.8Q1.8 7.9 4.2 8.45Q7 8.9 10 8.9L${L} 8.9Z`, "#f26b21");
        s += path(`M${L} 13.2Q${L - 4.5} 10.15 ${L - 12} 10.0L14 9.6Q7 9.55 4.1 8.95Q1.7 8.35 0 7.2`, "none", 0, 'stroke="#a3161f" stroke-width="0.2"');
        return s;
      }
      case "caltrain": {
        // Silver with a black roof, a red stripe along the top of the side, a red
        // sweep around the headlights on the nose, red sill line.
        let s = rect(0, 0, L, sp.roof + 1, "#c9cdd2") + rect(0, 13.9, L, 2, "#26292d");
        s += rect(0, 12.9, L, 0.55, "#c8102e") + rect(0, 0, L, 5.3, "#1d1f22") + rect(0, 5.3, L, 0.32, "#c8102e");
        s += path("M0 5.9Q7.6 5.9 9.0 8.0Q9.6 9.9 7.6 10.45L0 10.45Z", "#c8102e");
        return s;
      }
      case "frontrunner": {
        // White; on this side a blue cab and a red rear, each ending in a
        // swoosh that leans back toward the roof, with two thin lines of its
        // color running beside it (the other side swaps red and blue).
        const sw = (x, k, col) => {
          const d = (o) => `M${x + o} 16.5Q${x + 5.5 + o} 7.5 ${x + 15 + o} 4.2`;
          let t = path(`${d(0)}L${k > 0 ? 0 : L} 4.2L${k > 0 ? 0 : L} 16.5Z`, col);
          for (const o of [0.95, 1.85]) t += path(d(o * k), "none", 0, `stroke="${col}" stroke-width="0.42"`);
          return t;
        };
        let s = rect(0, 0, L, sp.roof + 1, "#eef0f2") + sw(23.0, 1, "#2463c7") + sw(48.5, -1, "#c8202f");
        return s + rect(0, 0, L, 4.9, "#1d1f22");
      }
      case "mbta": {
        // MBTA 010-011: a yellow-edged line along the side at the window sills,
        // purple above it ahead of a diagonal behind the cab, purple below it
        // behind; a purple band along the bottom as far back as the diagonal's
        // foot; silver elsewhere, a dark roof over the hood, a small T disc.
        const { purple: P, yellow: Y } = MBTA, xd = (y) => 33.8 - ((y - 6.4) * 5.4) / 8.2, top = sp.roof + 1;
        let s = rect(0, 0, L, top, MBTA.silver) + path(poly([[xd(14.4), 14.4], [L, 14.4], [L, top], [xd(top), top]]), MBTA.roof);
        s += path(poly([[0, 4.9], [38.4, 4.9], [37.8, 6.4], [0, 6.4]]), P) + path(poly([[xd(6.4), 6.4], [L, 6.4], [L, 10.7], [xd(10.7), 10.7]]), P);
        s += path(poly([[0, 10.7], [xd(10.7), 10.7], [xd(top), top], [0, top]]), P) + rect(0, 0, L, 4.9, MBTA.black) + tape(0, L, 4.65);
        s += lines([[0, 10.7, L, 10.7], [0, 6.4, 37.8, 6.4], [37.8, 6.4, 38.4, 4.9], [xd(6.4), 6.4, xd(top), top], [0, 4.9, L, 4.9]], Y, 1.0);
        return s + tDisc(24.1, 8.6, 1.0);
      }
      case "marc": {
        // MARC: silver under a dark gray roof that drops behind the cab; a
        // white line over the black underframe. A blue band over an orange
        // stripe runs the length of the side, broken for the logo, and sweeps
        // down the nose to the headlights; the Maryland flag high at the rear.
        const band = (x0, x1) => rect(x0, 7.5, x1 - x0, 1.5, MARC.blue) + rect(x0, 6.95, x1 - x0, 0.55, MARC.orange);
        let s = rect(0, 0, L, sp.roof + 1, MARC.silver) + path(`M0 12.85L15.4 12.85L15.9 12.0L${L} 12.0L${L} 17L0 17Z`, "#3a4048");
        s += rect(0, 0, L, 4.85, "#26292d") + rect(0, 4.85, L, 0.14, "#eef0f2");
        s += band(10.4, 34.2) + band(50.6, L);
        s += path("M10.5 9.0Q3.5 9.0 0.4 6.2L0.4 5.0Q3.5 7.5 10.5 7.5Z", MARC.blue) + path("M10.5 7.5Q3.5 7.5 0.4 5.0L0.4 4.4Q3.5 6.95 10.5 6.95Z", MARC.orange);
        return s + mdFlag(64.5, 10.9, 1.4);
      }
      case "vre": {
        // VRE (V50-V69): blue from the roof down to five stripes along the
        // side, white, blue, white, blue and white over red, silver below;
        // behind the cab the stripes step down about a foot, each slanting
        // down a little ahead of the one above, and run on lower to the nose.
        const jog = (y) => 44.2 + 2.0 * (10.5 - y);
        const above = (y, col) => path(`M-1 17L${L + 1} 17L${L + 1} ${y}L${jog(y)} ${y}L${jog(y) - 1.6} ${y - 1.2}L-1 ${y - 1.2}Z`, col);
        let s = rect(0, 0, L, sp.roof + 1, VRE.silver);
        for (const [y, col] of [[8.33, VRE.red], [8.74, "#f4f5f7"], [9.0, VRE.blue], [9.48, "#f4f5f7"], [9.75, VRE.blue], [10.23, "#f4f5f7"], [10.5, VRE.blue]]) s += above(y, col);
        return s + rect(0, 0, L, 4.85, "#26292d") + rect(0, 4.85, L, 0.14, "#eef0f2");
      }
      case "railrunner": return railRunnerLoco(c, sp);
      default: return genericPaint(c, sp);
    }
  },
  extra: (c) => (c.agency === "railrunner" ? goLetters(c, 11.1, 8.0, 1.1, "NMRX", "#1d1f22", { weight: 500 }) : ""),
});

// --- Rail Runner's MP36PH-3Cs (101-109): light gray, black below the
// sill. On the nose a red wing of feathers, two lined in yellow, sweeping
// back from the headlights to points under the windshield. Along the hood
// the roadrunner's head: a long yellow beak edged in red pointing ahead,
// the eye, a crest of feathers spiking back toward the radiators, and the
// neck sweeping down to the sill in red with two yellow stripes.
function railRunnerLoco(c, sp) {
  const L = sp.L;
  let s = rect(0, 0, L, sp.roof + 1, RR.body);
  // The nose wing.
  s += path("M0.6 4.8Q2.4 8.6 7.4 10.15Q5.6 8.6 5.9 8.2Q6.3 7.6 7.1 7.4Q6.0 6.6 6.2 5.9Q6.4 5.2 6.9 4.8Z", RR.red);
  s += path("M1.7 4.8Q3.6 7.6 7.0 8.25Q5.4 7.3 4.6 4.8Z", RR.yellow) + path("M3.4 4.8Q5.0 6.9 7.1 7.4Q5.8 6.3 5.6 4.8Z", RR.red);
  s += path("M4.6 4.8Q5.7 5.6 6.9 4.8Z", RR.yellow);
  // The neck, from the back of the head down to the sill, and its stripes.
  s += path(`${smoothPath([[29.5, 4.8], [27.1, 6.2], [24.8, 7.6], [22.8, 8.9], [21.0, 10.6], [22.4, 12.7], [25.0, 14.3]])}` +
    "L28.8 14.6L27.0 13.4L31.3 13.9L28.9 12.85L32.1 12.6L29.8 12.0L31.4 11.3" +
    `L${smoothPath([[31.4, 11.3], [33.4, 10.5], [37.6, 8.4], [43.5, 6.3], [53, 4.8]]).slice(1)}Z`, RR.red);
  s += smoothBlob([[24.4, 9.4], [27.5, 9.0], [33, 7.7], [38.5, 6.2], [44.2, 4.8]], [[24.4, 9.4], [26, 8.9], [30, 7.4], [35, 6.0], [39.6, 4.8]], RR.yellow);
  s += smoothBlob([[25.3, 8.3], [27.5, 7.6], [31, 6.4], [36.6, 4.8]], [[25.3, 8.3], [26.8, 7.4], [30, 6.0], [33.6, 4.8]], RR.yellow);
  // The beak: yellow, edged in red above and below.
  s += path("M15.4 7.15Q18.6 9.3 21.6 10.9L23.1 8.85Q19.0 7.6 15.4 7.15Z", RR.red) + path("M16.0 7.35Q18.8 8.95 21.7 10.25L22.6 9.1Q19.0 8.0 16.0 7.35Z", RR.yellow);
  // The eye.
  s += path("M22.2 10.75Q24.2 12.15 26.4 11.3Q24.3 10.0 22.2 10.75Z", "#ffffff") + circle(24.2, 11.0, 0.55, "#1d1f22") + circle(24.25, 11.05, 0.17, "#4f7fb5");
  return s + rect(0, 0, L, 4.85, "#1d1f22");
}

// --- GO Transit (Metrolinx) MPXpress units, on the same carbody. GO's
// current scheme (MP54ACs): white, the hood green from the roof down to
// about 10 ft, its lower edge sweeping up over the back of the cab; a lime
// band low along the side tapering away to the sill behind the cab door; a
// white line at the sill; the logo big behind the cab and METROLINX small
// toward the rear.
function goLocoPaint(c, sp) {
  const L = sp.L;
  let s = rect(0, 0, L, sp.roof + 1, "#eef0f2");
  s += path(`M${L + 1} 10.1L40 10.1C30 10.1 23 10.5 19 11.8C16.6 12.6 15.2 13.8 14.4 16.6L${L + 1} 16.6Z`, GO.green);
  s += path(`M${L + 1} 4.9L15.8 4.9C20.5 4.95 24 6.9 32 6.9L${L + 1} 6.9Z`, GO.lime);
  return s;
}

// --- MotivePower MP54AC (GO 647, rebuilt from an MP40PH-3C, and 667-682,
// 2017-2018): twin Cummins gensets in place of the EMD engine, cooled through
// a row of raised hood modules behind the cab, each with a big mesh grille on
// its sloped top edge over a louvered strip; radiator fans on the roof.
const MP54_MODS = [17.0, 23.6, 30.2, 36.8, 43.0, 49.3, 55.4, 63.4, 67.0];
export const mp54ac = (c) => cabUnit(c, {
  ...MPX,
  badge: { x: 20.0, y: 7.9, h: 2.45 },
  grilles: [[9.0, 5.1, 3.2, 1.3, 0.25],
    ...MP54_MODS.slice(0, -1).flatMap((a, i) => {
      const b = MP54_MODS[i + 1], w = b - a - 0.8;
      // The seventh module carries two grilles side by side.
      const top = i === 6 ? [[a + 0.4, 13.65, w / 2 - 0.1, 1.45, 0.22], [a + 0.5 + w / 2, 13.65, w / 2 - 0.1, 1.45, 0.22]] : [[a + 0.4, 13.65, w, 1.45, 0.22]];
      return [...top, [a + 0.5, 12.55, w - 0.2, 0.6, 0.28]];
    })],
  panels: [[8.6, 4.75, 4.0, 2.0], [27.0, 5.3, 3.6, 6.5], [45.9, 5.3, 3.3, 6.5], [54.4, 5.2, 6.4, 6.6]],
  roofItems: [[19.5, 2.2, 0.35], [44.5, 1.8, 0.5]], fans: [26.9, 33.5, 39.9, 52.4, 59.4],
  paint: goLocoPaint,
  // Module outlines along the top of the hood.
  extra: (c, sp) => lines([[MP54_MODS[0], 12.25, MP54_MODS.at(-1), 12.25], ...MP54_MODS.slice(0, -1).map((x) => [x, 12.25, x, sp.roof])], "rgba(0,0,0,0.3)", 0.5) +
    goLetters(c, 58.4, 7.65, 0.5, "METROLINX", "#3d4247", { spacing: 0.06 }),
});

// --- MotivePower MP40PH-3C (GO 600-666 except 647, 2007-2014): one EMD
// 16-710 engine, so the MP36's hood: a dynamic-brake louver behind the cab,
// a slatted intake panel, then three big radiator grilles on the sloped top
// at the rear. Still in GO's previous scheme: green with a cream band along
// the hood that sweeps down the cab side to the nose, the cab top and the
// front of the nose cream (the white "V" seen from the front), the logo in
// green on the band toward the rear and "Ontario" under the cab window.
// Sounder's MP40PH-3Cs (921-923, 2013): white over Sound Transit blue, a
// thin band of aqua over green around the nose under the windshield and
// along the cab side, rising behind the cab into the wave breaking along the
// hood; SOUNDER big on the blue mid-hood, the Sound Transit mark small under
// the cab window.
const SOUNDER_MP40_WAVE = [[-1, 10.15, 9.8, 9.45], [11.5, 10.15, 9.8, 9.45], [12.9, 10.7, 10.25, 9.8], [14.6, 12.2, 11.5, 10.6], [18, 8.6, 7.7, 6.8],
  [22.5, 12.0, 11.0, 9.8], [27.5, 8.6, 7.6, 6.6], [32.5, 12.0, 11.0, 9.9], [38, 8.7, 7.7, 6.7], [43.5, 12.0, 11.0, 9.9], [49, 8.7, 7.7, 6.7],
  [54.5, 11.8, 10.9, 9.8], [60, 8.8, 7.8, 6.8], [65, 11.4, 10.5, 9.4], [70, 10.0, 9.0, 8.0]];
export const mp40ph = (c) => cabUnit(c, {
  ...MPX,
  badge: (c) => (c.agency === "sounder" ? [{ x: 30.0, y: 6.5, h: 2.6, logo: "sounder-word" }, { x: 11.2, y: 8.4, h: 0.55, dark: true }]
    : { x: 56.0, y: 8.45, h: 2.5, logo: "go-teal" }),
  grilles: [[9.0, 5.1, 3.2, 1.3, 0.25], [17.8, 13.5, 7.8, 0.9, 0.3], [17.8, 12.35, 7.8, 0.6, 0.3], [29.6, 11.9, 8.0, 2.6, 0.36],
    [40.4, 13.4, 8.1, 1.8, 0.38], [48.9, 13.4, 8.1, 1.8, 0.38], [57.4, 13.4, 8.1, 1.8, 0.38], [40.4, 12.35, 25.1, 0.6, 0.3]],
  panels: [[8.6, 4.75, 4.0, 2.0], [29.3, 5.0, 5.9, 3.8], [53.5, 5.0, 6.6, 3.8]],
  roofItems: [[33, 1.6, 0.6]], fans: [46.7, 51.1, 55.5, 59.9, 64.1],
  paint: (c, sp) => {
    const L = sp.L;
    if (c.agency === "sounder") return sounderWave(L, SOUNDER_MP40_WAVE) + rect(0, 0, L, 4.85, "#1d1f22");
    let s = rect(0, 0, L, sp.roof + 1, GO.teal);
    s += path(`M${L + 1} 10.0L21 10.0C16 10.0 8 7.2 4.4 4.55L9.2 4.55C12 6.0 16 6.9 21 6.9L${L + 1} 6.9Z`, GO.cream);
    s += path("M-1 6.6L0.9 7.3L14.6 16.6L-1 16.6Z", GO.cream) + rect(0, 4.55, L, 0.3, GO.cream);
    return s;
  },
  extra: (c) => (c.agency === "sounder" ? "" : goLetters(c, 9.6, 8.6, 0.85, "Ontario", "#ffffff", { weight: 500 })),
});

// --- EMD F125 "Spirit" (Metrolink 903-942): 69 ft, 14 ft 6.5 in, trucks
// 42 ft 4 in apart, 9 ft 7 in wheelbase, 40 in wheels. Vossloh body: an
// upright lower face under a windshield raked back at about 45 degrees into
// a big rounded cab roof; a small cab side window, then the crew door; a
// black louvered shoulder on the roof behind the cab; tall radiator intakes
// across the rear quarter, their frames braced in a "VM".
// Paint: gray, a black cab and roof; a teal band low along the side over a
// black one and a white sill line, sweeping up the nose under a gray swoosh;
// the name in teal just ahead of the radiators.
export const f125 = (c) => cabUnit(c, {
  badge: { x: 48, y: 10.25, h: 0.9, logo: "metrolink-teal" },
  roof: 14.54, sill: 4.5, rearR: 1.2,
  nose: [[2.45, 4.5], [1.5, 5.3], [1.35, 8.4], [1.7, 9.4], [5.1, 13.5], ["q", 5.8, 14.54, 7.6, 14.54]],
  glass: [[[2.0, 9.75], [4.8, 12.95], [5.6, 12.95], [5.6, 12.3], [3.3, 9.75]]],
  sideWin: [[6.9, 10.8, 1.8, 2.1]],
  doors: [[9.9, 2.0, 5.0, 12.9]],
  grilles: [[53.5, 6.9, 13.5, 5.6, 0.36], [5.0, 5.1, 3.8, 1.6, 0.3], [12.8, 13.2, 7.5, 1.1, 0.36], [22.6, 7.0, 2.2, 3.1, 0.3]],
  panels: [[22.2, 6.6, 3.0, 6.0], [36.0, 6.6, 3.0, 6.0]],
  tank: [21, 48, 1.5], reservoir: [34, 47],
  trucks: { centers: 42.33, wb: 9.58, d: 40 },
  roofItems: [[51.5, 16, 0.3], [24, 1.6, 0.5]], fans: [56, 61, 66], horn: 8.0,
  // The radiator frames' "VM" braces, in teal.
  extra: (c) => c.agency !== "metrolink" ? "" : lines([[54.2, 12.3, 56.4, 7.1], [56.4, 7.1, 58.6, 12.3], [59.6, 7.1, 61.5, 12.3], [61.5, 12.3, 62.6, 9.5],
    [62.6, 9.5, 63.7, 12.3], [63.7, 12.3, 65.6, 7.1]], "#0e9a95", 1.6),
  paint: (c, sp) => {
    const L = sp.L;
    if (c.agency !== "metrolink") return genericPaint(c, sp);
    let s = rect(0, 0, L, sp.roof + 1, "#b4b9bf") + rect(0, 13.85, L, 2, "#1d1f22");
    s += path("M0 9.4Q7 9.6 11 12.4Q12.8 13.6 15.5 13.85L15.5 16L0 16Z", "#1d1f22");
    s += rect(0, 6.7, L, 2.7, "#0e9a95") + rect(0, 0, L, 6.7, "#1d1f22") + rect(0, 5.0, L, 0.32, "#eef0f2");
    return s;
  },
});

// --- Brookville BL36PH (Tri-Rail 818-829): 67 ft 3.5 in, 14 ft 8 in, 40 in
// wheels. A faceted nose: upright lower face, three flat windshield panes
// raked back under a chamfered brow; six big louvered panels along the top
// half of the hood side.
// Tri-Rail's 2023 wrap: a blue cab; behind it green, orange and light blue
// chevrons pointing ahead, the crew door in the orange; a slate-blue hood
// with the TRI-RAIL name big in white, and near the rear smaller chevrons
// round an orange diamond, then light blue, orange and green slashes.
const TRI_LOCO = { blue: "#2f62b5", hood: "#29497f", green: "#8cc63f", orange: "#f39a2b", sky: "#5bb6e6" };
export const bl36 = (c) => cabUnit(c, {
  badge: { x: 36.5, y: 9.6, h: 2.1, logo: "trirail-onnavy" },        // mid-hood, white lettering on the blue
  roof: 14.67, sill: 4.55, rearR: 0.9,
  nose: [[2.2, 4.55], [1.45, 5.3], [1.55, 9.7], [1.85, 10.15], [3.45, 13.35], [4.4, 14.25], [5.6, 14.67]],
  glass: [[[2.15, 10.45], [3.4, 13.0], [4.0, 13.0], [4.0, 10.45]]],
  sideWin: [[4.9, 10.6, 3.0, 2.2]],
  doors: [[9.1, 2.0, 5.0, 13.4]],
  grilles: [...[0, 1, 2, 3, 4, 5].map((i) => [15.2 + i * 8.55, 10.9, 8.3, 3.5, 0.32]), [5.2, 5.5, 2.6, 1.6, 0.3]],
  panels: [[20, 5.6, 3.0, 4.8], [38, 5.6, 3.0, 4.8]],
  tank: [21, 46, 1.5], reservoir: [32, 45],
  trucks: { centers: 41.5, wb: 9.0, d: 40 },
  roofItems: [[40, 1.4, 0.6], [48, 16, 0.3]], fans: [52, 57, 62], horn: 5.4,
  paint: (c, sp) => {
    const L = sp.L, T = TRI_LOCO;
    if (c.agency !== "trirail") return genericPaint(c, sp);
    // Everything ahead of a chevron line: [x at the sill, at mid-height, at the roof].
    const ahead = ([b, m, t], col) => path(poly([[0, 0], [b, 0], [b, 4.6], [m, 9.6], [t, 14.7], [t, 17], [0, 17]]), col);
    let s = rect(0, 0, L, sp.roof + 1, T.hood) + rect(0, 10.6, L, 5, "rgba(255,255,255,0.08)");
    s += ahead([14.8, 12.3, 13.2], T.sky) + ahead([13.4, 10.6, 12.2], T.orange) + ahead([10.8, 8.4, 11.0], T.green) + ahead([6.7, 7.4, 8.1], T.blue);
    // Rear: chevrons round a diamond, then three slashes to the end.
    const chev = (x, w, col) => path(poly([[x + w, 5.6], [x + w + 1.0, 5.6], [x + 1.0, 8.2], [x + w + 1.0, 10.8], [x + w, 10.8], [x, 8.2]]), col);
    s += chev(49.2, 2.2, T.sky) + chev(50.1, 1.4, T.green) + path(poly([[51.1, 8.2], [52.0, 6.8], [52.9, 8.2], [52.0, 9.6]]), T.orange);
    [T.green, T.orange, T.sky].forEach((col, k) => {
      const x = 56.5 + k * 2.6;
      s += path(poly([[x, 4.6], [x + 1.6, 4.6], [x + 4.4, 10.9], [x + 2.8, 10.9]]), col);
    });
    s += rect(0, 0, L, 5.25, "#1d1f22") + rect(0, 5.25, L, 0.28, "#e8eaed");
    return s;
  },
});

// --- EMD F40PH: 56 ft 2 in (VIA's F40PH-2); MBTA's F40PH-3C is about 8 ft
// longer, with a separate HEP genset. 15 ft 7.5 in to the cab roof, Blomberg
// trucks on 40 in wheels. A low short nose ahead of the cab, a two-window cab
// front, and a body as wide as the cab behind it, with an inertial-filter
// grille high behind the cab and radiator intakes and fans at the rear.
function f40(c, { mbta = false } = {}) {
  const roof = 15.62, sill = 4.65, hood = 15.05;
  return cabUnit(c, {
    // VIA: a big logo at the rear end of the silver.
    badge: (c) => (c.agency === "via" ? { x: 51.3, y: 8.45, h: 3.0 } : { x: 48, y: 8.75, h: 2.0, skip: ["mbta"] }),
    roof: hood, sill, rearR: 0.9,
    nose: [[2.45, sill], [2.45, 8.3], ["q", 2.5, 8.85, 3.1, 8.95], [6.0, 9.45], [6.3, 9.75], [7.55, 14.75], ["q", 7.75, roof, 8.7, roof], [13.6, roof], [13.75, hood]],
    glass: [[[6.55, 10.35], [7.45, 14.2], [8.0, 14.2], [8.0, 10.35]]],
    sideWin: [[8.4, 11.4, 1.15, 2.6], [9.65, 11.4, 1.35, 2.6]],
    doors: [[11.15, 2.1, sill + 0.2, 14.4]],
    // MBTA's F40PH-3Cs: a dynamic-brake vent behind the cab, then three
    // banks of intakes high along the hood.
    grilles: mbta ? [[16.1, 12.3, 5.2, 1.4, 0.32], [30.9, 11.7, 6.2, 2.1, 0.32], [38.6, 11.7, 13.0, 2.1, 0.36], [55.0, 11.7, 5.9, 2.1, 0.36]]
      : [[14.3, 12.6, 8.5, 2.0, 0.32], [c.L - 16.5, 10.6, 13.5, 3.6, 0.36]],
    panels: mbta ? [[29.3, 5.1, 2.8, 6.3], [32.3, 5.1, 2.8, 6.3], [35.3, 5.1, 2.8, 6.3]]
      : [[23.5, 5.2, 3.0, 7.0], [27.0, 5.2, 3.0, 7.0], [31.0, 5.2, 3.0, 7.0]],
    tank: [17.5, c.L - 17.5, 1.5], reservoir: [c.L / 2 - 4, c.L / 2 + 6],
    trucks: { centers: c.L - 23.2, wb: 9.0, d: 40 },
    roofItems: [[c.L - 26, 1.6, 0.45]], fans: [c.L - 13.5, c.L - 8.3, c.L - 3.6], horn: 9.6,
    paint: (c, sp) => {
      const L = sp.L;
      if (mbta || c.agency === "mbta") return mbtaPaint(c, { L, roof: sp.roof, diag: [16.6, 24.0], skirt: 5.0, band: 7.7, cabLine: 8.1, nose: [2.5, 6.4],
        hood: 13.4, rear: { up: 43.0, low: 47.0, top: 8.9, bot: 5.75 }, T: [30.6, 8.3, 2.7] });
      if (c.agency === "via") {
        // VIA: a teal cab and upper body under a dark top, a silver lower
        // body sweeping down to the sill under the cab, yellow speed lines
        // fanning forward along it (lower ones longer and thicker), a
        // yellow sill stripe.
        const gold = "#f0a51c";
        let v = rect(0, 0, L, sp.roof + 1, "#1f6f7a") + rect(7.0, 14.2, L, 2, "#26353b");
        v += path(`M${L} 0L${L} 11.15L20 11.15C14 11.1 8 8.6 4.1 5.0L4.1 0Z`, "#a7aeb4");
        for (const [x0, x1, y, h] of [[25.4, L, 10.75, 0.15], [19.5, 36.3, 10.3, 0.2], [15.3, 30.8, 9.7, 0.3], [12.1, 25.0, 9.0, 0.4],
          [9.5, 23.0, 8.1, 0.5], [8.3, 20.0, 7.3, 0.55], [7.5, 17.9, 6.3, 0.6], [7.0, 16.3, 5.5, 0.4]]) {
          v += path(poly([[x0, y + h / 2], [x0 + 1.2, y], [x1, y], [x1, y + h], [x0 + 1.2, y + h]]), gold);
        }
        return v + rect(0, 4.65, L, 0.3, gold);
      }
      return genericPaint(c, sp);
    },
  });
}
export const f40ph = (c) => f40(c);
export const f40c = (c) => f40(c, { mbta: true });

// --- EMD F59PHI (Amtrak California 2001-2015, NCDOT): 58 ft 7 in, Blomberg
// trucks 35 ft 7 in apart on 40 in wheels. A rounded fiberglass cab: the nose
// curves up into a steeply raked two-pane windshield, and the cab roof stands
// a little above the body behind it.
// Sounder's F59PHIs (901-911): white over Sound Transit blue, a thin band
// of aqua over green from the nose along the cab, then the wave breaking
// four times along the body; SOUNDER big on the blue mid-side, the Sound
// Transit mark in white toward the rear; the fuel tank blue too.
const SOUNDER_F59_WAVE = [[-1, 8.45, 8.15, 7.7], [11.5, 8.45, 8.15, 7.7], [14.4, 9.25, 8.8, 8.3], [17.0, 10.05, 9.6, 8.4], [19.5, 9.3, 8.8, 7.2],
  [22.6, 7.7, 7.1, 5.9], [25.9, 10.3, 8.7, 6.8], [28.8, 9.7, 8.7, 8.0], [32.4, 8.65, 7.9, 7.0], [35.3, 9.7, 8.6, 7.6], [38.6, 10.65, 9.75, 8.9],
  [41.7, 9.8, 8.7, 7.8], [45.3, 8.8, 7.65, 6.6], [48.9, 10.35, 9.4, 7.7], [51.8, 11.2, 9.9, 8.85], [54.7, 10.0, 8.6, 7.2], [57.4, 8.7, 7.6, 6.7],
  [60, 8.7, 7.6, 6.7]];
export const f59 = (c) => cabUnit(c, {
  // Piedmont's carry "North Carolina" in a big upright serif mid-side.
  badge: (c) => (c.route === "Piedmont" ? { x: 37.0, y: 8.7, h: 1.6, logo: "north-carolina" }
    : c.agency === "sounder" ? [{ x: 38.4, y: 6.7, h: 2.6, logo: "sounder-word" }, { x: 51.5, y: 6.7, h: 0.95, dark: true }]
    : { x: 38.5, y: 9.6, h: 1.3 }),
  roof: 15.0, sill: 4.6, rearR: 0.9,
  nose: [[2.4, 4.6], ["q", 1.5, 4.9, 1.45, 6.4], ["q", 1.5, 8.6, 2.6, 10.0], [5.2, 14.4], ["q", 5.8, 15.55, 7.4, 15.55], [12.4, 15.55], ["q", 13.2, 15.55, 13.4, 15.0]],
  glass: [[[2.95, 10.45], [5.05, 14.0], [5.8, 14.0], [5.8, 10.45]]],
  sideWin: [[6.5, 11.4, 2.6, 2.3]],
  doors: [[10.0, 2.1, 5.1, 14.2]],
  grilles: [[14.0, 12.4, 9.0, 2.0, 0.32], [c.L - 15.5, 10.4, 13.0, 3.6, 0.36]],
  panels: [[25, 5.4, 3.0, 6.6], [29, 5.4, 3.0, 6.6]],
  tank: [17.5, c.L - 17, 1.5], reservoir: [c.L / 2 - 4, c.L / 2 + 6],
  trucks: { centers: 35.58, wb: 9.0, d: 40 },
  fans: [c.L - 12.8, c.L - 7.8, c.L - 3.4], horn: 9.0,
  extra: (c, sp) => {
    if (c.agency !== "sounder") return "";
    const [t0, t1, tb] = sp.tank;
    return path(poly([[t0, sp.sill], [t1, sp.sill], [t1, tb + 0.9], ["q", t1, tb, t1 - 0.9, tb], [t0 + 0.9, tb], ["q", t0, tb, t0, tb + 0.9]]), SOUNDER.blue);
  },
  paint: (c, sp) => {
    const L = sp.L;
    if (c.agency === "sounder") return sounderWave(L, SOUNDER_F59_WAVE);
    if (c.agency === "amtrak" && c.route === "Piedmont") {
      // Piedmont (NCDOT): silver; a blue cab and roof sweeping down in a
      // white-edged curve to the sill behind the cab; dark gray along the top
      // of the rear body; a yellow line wandering up the side toward the rear;
      // red and yellow stripes over the dark underframe.
      const swoop = "Q24 13.6 19 9.8Q16.4 7.6 15.4 5.4";
      return rect(0, 0, L, 17, "#c4c8cd") + rect(35, 11.4, L - 35, 6, "#383c43") +
        path(`M0 5.4L0 17L35 17L35 15.6${swoop}Z`, "#2440a0") + path(`M35 15.6${swoop}`, "none", 0, 'stroke="#ffffff" stroke-width="0.3"') +
        path(`M22 5.75Q36 5.9 42 7.5T${L - 4} 9.6`, "none", 0, 'stroke="#f2b81c" stroke-width="0.2"') +
        rect(0, 0, L, 5.0, "#1d1f22") + rect(0, 5.0, L, 0.32, "#c8102e") + rect(0, 5.32, L, 0.14, "#f2b81c");
    }
    // Amtrak California: gray body, navy cab and underside, yellow bottom stripe, black roof.
    return rect(0, 0, L, 17, "#bfc4ca") + rect(0, 14.3, L, 3, "#1d1f22") + path(`M0 5.4L0 14.3L12.8 14.3Q14.2 9.5 20 7.6L${L} 7.6L${L} 5.4Z`, "#1d2f5c") +
      rect(0, 5.1, L, 0.3, "#f5b81c") + rect(0, 0, L, 5.1, "#1d2f5c");
  },
});

// --- EMD GP40MC (MBTA 1115-1139): a road-switcher hood unit, not a cowl. A
// wide-nose four-window cab at the front; a narrower long hood behind it
// with side walkways and handrails; flared radiators and three 48 in fans
// at the rear. About 64 ft, 15 ft 5 in over the cab, 40 in wheels.
// CT Rail's GP40-3Hs (6694-6699, rebuilt from GP40s for Shore Line East) are
// drawn on it: black, a red band low along the nose and cab, the long hood
// red from the cab back to the CTrail mark, black behind it; white
// handrails, the logo under the cab window.
export function gp40(c) {
  const { L } = c, deck = 4.85, cabRoof = 15.4, hood = 13.95;
  let s = "";
  // Frame, pilots, walkway edge.
  s += pilot(1.2, 3.65) + pilot(1.2, 3.65, L);
  s += path(poly([[18, 3.5], [L - 19, 3.5], [L - 19, 2.3], ["q", L - 19, 1.5, L - 19.8, 1.5], [18.8, 1.5], ["q", 18, 1.5, 18, 2.3]]), "currentColor", 0, 'opacity="0.82"');
  for (const k of [-1, 1]) s += truck(L / 2 + k * 18.75, { wb: 9.0, d: 40, kind: "loco", top: 3.7 });
  const frame = poly([[1.2, 3.7], [L - 1.2, 3.7], [L - 1.2, deck], [1.2, deck]]);
  // Cab and nose, long hood.
  const cab = poly([[2.6, deck], [2.6, 9.0], ["q", 2.7, 9.6, 3.4, 9.7], [6.4, 10.0], [6.9, 14.8], ["q", 7.0, cabRoof, 7.8, cabRoof], [13.4, cabRoof], ["q", 14.2, cabRoof, 14.2, 14.6], [14.2, deck]]);
  const hoodD = poly([[14.2, deck], [14.2, hood - 0.5], ["q", 14.2, hood, 14.7, hood], [L - 16.5, hood], [L - 16.0, hood + 0.55], [L - 3.6, hood + 0.55], ["q", L - 3.2, hood + 0.55, L - 3.2, hood], [L - 3.2, deck]]);
  const mbta = c.agency === "mbta", ct = c.agency === "ctrail";
  // MBTA: the cab purple with a yellow-edged silver band at nose height.
  // On the hood a yellow-edged diagonal runs from the roof behind the cab
  // down to a purple band along the middle of the hood; ahead of it purple,
  // behind it silver, and the purple runs down to the deck as far back as
  // a second, short diagonal. Black hood top; "MBTA" spaced out over the
  // band, a small T disc on it.
  const paint = mbta ? (w) => {
    const P = MBTA.purple, Y = MBTA.yellow, d = (y) => 21.5 + ((27.8 - 21.5) * (hood - y)) / (hood - 6.65);
    let p = rect(0, 0, L, 17, MBTA.silver) + rect(14.2, 12.2, L, 5, MBTA.black);
    p += rect(0, 6.65, L, 2.5, P) + path(poly([[0, 0], [33.4, 0], [33.4, deck], [30.9, 6.65], [0, 6.65]]), P);
    p += path(poly([[0, 9.15], [d(9.15), 9.15], [d(12.2), 12.2], [14.2, 12.2], [14.2, 17], [0, 17]]), P);
    p += rect(0, 7.9, 14.2, 2.1, MBTA.silver) + rect(0, 7.85, 14.2, 0.14, Y) + rect(0, 9.95, 14.2, 0.14, Y);
    p += lines([[d(12.2), 12.2, d(6.65), 6.65], [30.9, 6.65, 33.4, deck]], Y, 1.0) + rect(d(9.15), 9.08, L, 0.14, Y) + rect(30.9, 6.58, L, 0.14, Y);
    return p + w;
  } : ct ? (w) => rect(0, 0, L, 17, CTRAIL.black) + rect(0, deck, 14.2, 1.65, CTRAIL.red) + rect(14.2, deck, 13, hood - 0.3 - deck, CTRAIL.red) +
    ctMark(26.6, 40.6, deck, hood - 0.3) + w
    : (w) => rect(0, 0, L, 17, c.color || "#1f5fad") + w;
  s += path(frame, C.black) + (ct ? ctDashes(2.0, L - 2.0, 3.95) : rect(1.2, 3.75, L - 2.4, 0.4, MBTA.yellow, 0, 'opacity="0.9"'));
  s += path(hoodD, MBTA.silver) + clipped(hoodD, paint(mbta ? tDisc(32.5, 7.9, 0.62) +
    '<text transform="translate(32.3 10.05) scale(1 -1)" font-size="1.1" text-anchor="middle" letter-spacing="0.75" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" fill="#a52a4a">MBTA</text>' : ""));
  // Hood doors, radiator grilles, dynamic brake, fans.
  for (let x = 16; x < L - 22; x += 4.2) s += rect(x, deck + 0.6, 3.6, hood - deck - 1.6, "none", 0.4, 'rx="0.1"');
  // Dynamic-brake grille, then radiator intakes high along the rear of the hood.
  for (const [x, y, w] of [[30.1, 12.3, 6.5], [39.4, 11.9, 11.8], [55.5, 11.9, 5.1]]) s += rect(x, y, w, hood - 0.25 - y, "rgba(0,0,0,0.3)", 0.4) + slats(x, y, w, hood - 0.25 - y, 0.36, "rgba(255,255,255,0.22)");
  s += rect(24, hood - 0.05, 6, 0.6, C.steelDark, 0.4);
  for (const x of [L - 13.5, L - 9.2, L - 5.2]) s += path(`M${x - 1.9} ${hood + 0.55}Q${x} ${hood + 1.25} ${x + 1.9} ${hood + 0.55}Z`, C.steelDark, 0.4);
  s += path(cab, MBTA.silver) + clipped(cab, paint("") + path(poly([[6.7, 10.6], [7.2, 14.4], [7.9, 14.4], [7.9, 10.6]]), C.glass) + win(8.6, 11.3, 2.0, 2.4, 0.2) + win(11.0, 11.3, 2.4, 2.4, 0.2));
  if (ct) s += badge(c, 10.6, 7.6, 1.0, { dark: true });
  s += outlineOf(hoodD) + outlineOf(cab) + outlineOf(frame);
  // Handrails along the walkway.
  const posts = [];
  for (let x = 15; x < L - 3; x += 6.2) posts.push([x, deck, x, deck + 3.1]);
  posts.push([14.4, deck + 3.1, L - 2.0, deck + 3.1], [L - 2.0, deck, L - 2.0, deck + 3.1], [2.0, deck, 2.0, deck + 3.1], [2.0, deck + 3.1, 2.6, deck + 3.1]);
  s += lines(posts, ct ? "#e9ecef" : "currentColor", 0.6);
  s += rect(8.5, cabRoof - 0.05, 1.1, 0.35, "currentColor");
  return s;
}

// --- MotivePower MP32PH-Q (SunRail 100-110, 2013-17): MARC's GP40WH-2s
// rebuilt on their GP40 frames. The narrow long hood stays, with walkways
// and handrails along it, but a full-width MPXpress cab replaces the old
// one: the same bulbous nose and raked windshield, a two-pane side window,
// then the cab door, a louvered box low under the window. About 65 ft,
// 15 ft 6 in over the cab, the hood about 14 ft; trucks 37 ft 6 in apart,
// 9 ft wheelbase, 40 in wheels. Behind the cab a tall louvered box, then a
// lower stretch of hood; a dynamic-brake grille, grid radiator intakes high
// along the rear of the hood, five roof fans.
// SunRail: white; a big yellow sun rising behind dark green hills and a
// sky-blue horizon at the rear of the hood, its rays reaching the roof; an
// orange band and yellow pinstripes sweeping up from the nose along the
// hood; a black frame and white handrails; the cab roof now dark gray.
export function mp32(c) {
  const { L } = c, deck = 4.85, cabRoof = 15.5, hood = 14.0, cabEnd = 18.3, box = 14.35;
  let s = "";
  // Pilots, fuel tank, trucks.
  s += pilot(0.8, 3.65) + pilot(1.2, 3.65, L);
  s += path(poly([[27.3, 3.5], [39.8, 3.5], [39.8, 2.3], ["q", 39.8, 1.5, 39.0, 1.5], [28.1, 1.5], ["q", 27.3, 1.5, 27.3, 2.3]]), "currentColor", 0, 'opacity="0.82"');
  for (const k of [-1, 1]) s += truck(L / 2 + k * 18.75, { wb: 9.0, d: 40, kind: "loco", top: 3.7 });
  const frame = poly([[1.0, 3.7], [L - 1.2, 3.7], [L - 1.2, deck], [1.0, deck]]);
  // The MPXpress nose and cab, the louvered box behind it, the dip, the hood.
  const body = poly([[2.0, deck], ["q", 0.6, deck + 0.35, 0.6, 6.7], ["q", 0.7, 8.7, 1.9, 9.4], [3.5, 10.4], [4.7, 12.6], ["q", 5.6, cabRoof, 9.5, cabRoof],
    [cabEnd - 0.4, cabRoof], ["q", cabEnd, cabRoof, cabEnd, cabRoof - 0.4], [cabEnd, box], [24.6, box], [25.4, 13.4], [28.6, 13.4], [29.4, hood],
    [L - 3.7, hood], ["q", L - 3.2, hood, L - 3.2, hood - 0.5], [L - 3.2, deck]]);
  let p = rect(0, 0, L, 17, "#f4f5f2");
  if (c.agency === "sunrail" || !c.agency) {
    const sun = [41, 6.0], horizon = [[0, 4.95], [12, 5.5], [27, 6.8], [41, 7.5], [52, 7.2], [61, 6.3], [L, 6.2]], hz = eased(horizon);
    const orange = [[0, 5.6], [13, 8.0], [27, 9.4], [41, 9.6], [61, 8.0], [L, 7.9]];
    // Waves of yellow toward the rear, over and under the orange; the sun's
    // rays, alternately deep and pale, fanned over the horizon in front.
    p += ribbon([[48, 10.7], [56, 11.0], [L, 10.3]], 1.9, SUNRAIL.gold, 47, L + 1) + ribbon([[46, 7.4], [L, 7.1]], 0.7, SUNRAIL.yellow, 46, L + 1);
    const P = (a, r) => [sun[0] + r * Math.cos(a), sun[1] + r * Math.sin(a)];
    for (let k = 0; k < 19; k++) {
      const a = Math.PI * (0.04 + (0.92 * k) / 18);
      p += path(poly([P(a - 0.13, 4.5), P(a, k % 2 ? 9.5 : 12.5), P(a + 0.13, 4.5)]), k % 2 ? SUNRAIL.gold : SUNRAIL.yellow);
    }
    p += circle(sun[0], sun[1], 5.0, SUNRAIL.yellow);
    p += ribbon(orange, 1.1, SUNRAIL.orange) + ribbon(orange.map(([x, y]) => [x, y - 0.9]), 0.22, SUNRAIL.yellow, 0, 31);
    p += ribbon([[1.5, 10.45], [16, 11.2], [27, 11.5], [36, 12.1]], 0.28, SUNRAIL.yellow, 1.5, 36);
    // Under the horizon: the sun's lower half, and the green hills.
    p += between(horizon.map(([x, y]) => [x, y - 0.3]), deck, SUNRAIL.yellow, 29, 54) + ribbon(horizon, 0.75, SUNRAIL.sky);
    for (const [a, m, b] of [[16, 21, 26.5], [24, 29.5, 35], [35.5, 42, 46], [44, 48.5, 52.5], [50, 55, 61.5]]) {
      p += path(poly([[a, deck], [m, hz(m) - 0.45], [b, deck]]), SUNRAIL.green);
    }
    p += rect(0, 14.55, cabEnd + 0.1, 2, "#3b3f45");
  } else p += rect(0, 0, L, 17, c.color || "#1f5fad");
  // Windshield and side windows.
  p += path(poly([[4.05, 10.65], [4.95, 12.45], [6.1, 12.45], [6.1, 10.65]]), C.glass) + path(poly([[6.3, 10.7], [6.3, 12.45], [8.5, 12.45], [8.5, 10.8]]), C.glass);
  p += pane2(8.9, 10.55, 2.9, 1.8, 0.2) + win(15.3, 10.6, 0.7, 1.7, 0.2);
  s += path(frame, C.black) + path(body, "#f4f5f2") + clipped(body, p);
  s += door(12.2, deck + 0.15, 2.1, 12.85 - deck - 0.15, { glassY: 0.62, glassH: 0.22 });
  // Grilles: under the cab window, the tall box behind the cab, the dynamic
  // brake, the radiator intakes (a grid of square openings).
  const grille = (x, y, w, h, gap) => rect(x, y, w, h, "rgba(20,22,25,0.55)", 0.4) + slats(x, y, w, h, gap, "rgba(255,255,255,0.22)");
  s += grille(8.7, 5.15, 3.2, 1.35, 0.25) + grille(18.9, 10.3, 5.3, 3.65, 0.3) + grille(31.4, 12.6, 6.0, 1.0, 0.35);
  for (const [x, w] of [[41.6, 5.5], [47.4, 5.7], [55.2, 4.5]]) {
    s += grille(x, 12.1, w, 1.5, 0.5) + lines([[x, 12.6, x + w, 12.6], [x, 13.1, x + w, 13.1]], "rgba(255,255,255,0.22)", 0.4);
  }
  // Hood door seams; roof fans; horn.
  s += lines([20, 24.5, 29.4, 33.8, 38.2, 42.6, 47.0, 51.4, 55.8, 60.2].map((x) => [x, deck + 0.3, x, hood - 2.3]), "rgba(0,0,0,0.2)", 0.5);
  for (const x of [34.9, 43.45, 47.75, 51.8, 57.4]) s += rect(x - 1.75, hood - 0.05, 3.5, 0.55, "#2a2d31", 0.4, 'rx="0.15"');
  s += rect(10.6, cabRoof - 0.05, 1.1, 0.35, "currentColor") + rect(10.7, cabRoof + 0.3, 0.25, 0.35, "currentColor") + rect(11.2, cabRoof + 0.3, 0.25, 0.45, "currentColor");
  s += outlineOf(body) + outlineOf(frame);
  // Handrails along the walkway, rising to the cab.
  const posts = [];
  for (let x = 19.6; x < L - 1.5; x += 4.2) posts.push([x, deck, x, deck + 3.1]);
  posts.push([19.6, deck + 3.1, L - 1.6, deck + 3.1], [L - 1.6, deck, L - 1.6, deck + 3.1], [19.6, deck + 3.1, cabEnd + 0.15, deck + 4.3]);
  s += lines(posts, "#eef0f2", 0.7);
  return s;
}

// ===================== Electric locomotives =====================

// --- Bombardier ALP-46/46A (NJ Transit 4600-4664): 64 ft over couplers,
// 9 ft 8 in wide, 44 in wheels on 8 ft 10 in wheelbase trucks. Two cabs with
// raked windshields over upright noses; boxy body; two pantographs.
// NJ Transit: silver, black cab masks wrapping onto the sides, the blue-to-
// magenta-to-orange "disco" band along the lower body, orange sill line.
// --- Progress Rail SD70MACH (Metra 500-525, rebuilt from SD70MACs): a
// freight hood unit, about 74 ft, on two three-axle trucks; a wide safety-nose
// cab, a long hood with flared radiators over the rear fans, a walkway with
// handrails. Metra's bright blue with the cab top, a tall box behind the cab
// and the radiators in black; an orange stripe split by a red pinstripe from
// the nose back along the hood, rising over the radiators; navy dashes
// thickening toward the rear and a big tone-on-tone Metra logo on the hood;
// a small logo under the cab window; red and white chevrons on the nose
// front; a white line along the deck edge.
export function sd70mach(c) {
  const { L } = c, deck = 5.2, cabRoof = 15.6, hood = 14.9;
  const blue = "#2b86dc", navy = "#164f9c", K = C.black;
  let s = "";
  s += pilot(1.0, 4.0) + pilot(1.0, 4.0, L);
  // Fuel tank between the trucks.
  s += path(poly([[22, 3.9], [L - 22, 3.9], [L - 22, 2.2], ["q", L - 22, 1.3, L - 22.9, 1.3], [22.9, 1.3], ["q", 22, 1.3, 22, 2.2]]), "currentColor", 0, 'opacity="0.82"');
  for (const k of [-1, 1]) s += truck(L / 2 + k * 22, { wb: 13.6, d: 42, kind: "loco", top: 4.0, axles: 3 });
  const frame = poly([[1.0, 4.0], [L - 1.0, 4.0], [L - 1.0, deck], [1.0, deck]]);
  const nose = poly([[1.6, deck], [1.6, 9.6], ["q", 1.7, 10.4, 2.6, 10.4], [6.6, 10.4], [7.2, 11.0], [7.4, 15.0], ["q", 7.5, cabRoof, 8.4, cabRoof],
    [15.0, cabRoof], ["q", 15.8, cabRoof, 15.8, 14.8], [15.8, deck]]);
  const hoodD = poly([[15.8, deck], [15.8, hood - 0.5], ["q", 15.8, hood, 16.3, hood], [L - 19, hood], [L - 18.4, hood + 0.6], [L - 3.4, hood + 0.6],
    ["q", L - 2.8, hood + 0.6, L - 2.8, hood], [L - 2.8, deck]]);
  const dashes = () => {
    // Navy dashes, longer and closer together toward the rear.
    const segs = [];
    for (let x = 17.0, i = 0; x < L - 21; x += 0.95, i++) {
      const k = (x - 17) / (L - 38);
      for (let j = 0; j < 4; j++) {
        if ((i * 7 + j * 3) % 5 > 1 + k * 3) continue;
        const y = hood - 0.6 - ((i * 1.7 + j * 2.3) % 6.2);
        if (y > 7.9 || y < 7.0) segs.push([x, y, x, y - 0.3 - 0.9 * k]);
      }
    }
    return lines(segs, navy, 1.0);
  };
  const stripe = path(`M5.0 7.0L${L - 17.5} 7.0L${L - 13.2} 11.4L${L - 12.2} 11.4L${L - 16.6} 7.8L5.6 7.8Z`, "#f26b21") +
    path(`M5.3 7.4L${L - 17.0} 7.4L${L - 12.7} 11.4`, "none", 0, 'stroke="#c8102e" stroke-width="0.16"');
  const paint = (extra = "") => rect(0, 0, L, 17, blue) + extra + stripe + rect(0, deck, L, 0.3, "#f2f3f4");
  s += path(frame, K);
  s += path(hoodD, blue) + clipped(hoodD, paint(dashes() + rect(16.0, 11.4, 7.0, 4, K) + rect(L - 21, 11.2, 21, 5, K) +
    `<g opacity="0.75">${badge(c, 31, 10.3, 2.4)}</g>`));
  for (let x = 23.6; x < L - 22; x += 4.4) s += rect(x, deck + 1.0, 3.8, 10.8 - deck, "none", 0.4, 'rx="0.1"');
  s += rect(L - 18.2, hood - 3.6, 14.6, 3.8, "rgba(0,0,0,0.3)", 0.4) + slats(L - 18.2, hood - 3.6, 14.6, 3.8, 0.36, "rgba(255,255,255,0.14)");
  s += rect(26, hood - 0.05, 9, 0.7, C.steelDark, 0.4, 'rx="0.2"');
  for (const x of [L - 15, L - 10.2, L - 5.6]) s += path(`M${x - 2.1} ${hood + 0.6}Q${x} ${hood + 1.35} ${x + 2.1} ${hood + 0.6}Z`, C.steelDark, 0.4);
  // Cab and nose: black from the window sills up; chevrons only on the front.
  let chev = "";
  for (let k = 0; k < 5; k++) chev += path(poly([[1.6, deck + 0.4 + k * 1.1], [2.3, deck + 0.75 + k * 1.1], [2.3, deck + 1.3 + k * 1.1], [1.6, deck + 0.95 + k * 1.1]]), "#c8102e");
  s += path(nose, blue) + clipped(nose, paint(rect(1.6, deck, 0.7, 5.2, "#f4f4f4") + chev + rect(7.0, 11.1, 9, 5, K) +
    path(poly([[7.5, 11.6], [7.7, 15.0], [9.6, 15.0], [9.6, 11.6]]), C.glass) + win(10.3, 12.2, 2.2, 2.4, 0.2) + win(13.0, 12.2, 2.3, 2.4, 0.2)));
  s += rect(9.0, 5.7, 3.0, 1.1, "rgba(20,22,25,0.45)", 0.4) + slats(9.0, 5.7, 3.0, 1.1, 0.3, "rgba(255,255,255,0.18)");
  s += badge(c, 11.4, 9.65, 1.15);                                                         // the small Metra logo on the cab
  s += outlineOf(hoodD) + outlineOf(nose) + outlineOf(frame);
  const posts = [];
  for (let x = 16.4; x < L - 3; x += 6.4) posts.push([x, deck, x, deck + 3.3]);
  posts.push([16.0, deck + 3.3, L - 1.8, deck + 3.3], [L - 1.8, deck, L - 1.8, deck + 3.3], [1.8, deck, 1.8, deck + 3.3]);
  s += lines(posts, "currentColor", 0.6);
  s += rect(9.5, cabRoof - 0.05, 1.2, 0.35, "currentColor");                              // horn
  return s;
}

// --- Bombardier ALP-46 (NJ Transit 4600-4664): 64 ft, a cab at each end,
// trucks 33 ft 2 in apart on 44 in wheels. Silver sides under a dark roof
// band carrying the air intakes; each cab side a black panel around the
// side window with "NJ TRANSIT" below it; behind the cab doors the blue-to-
// magenta-to-orange stripe along the bottom of the side, fading in from a
// halftone at the front; an orange line along the sill.
export function alp46(c) {
  const { L } = c, sill = 4.25, roof = 13.75;
  const X = (v, k) => (k > 0 ? L - v : v);
  const d = poly([[2.3, sill], [L - 2.3, sill], [L - 1.45, 5.1], [L - 1.4, 9.0], [L - 1.75, 9.6], [L - 3.4, 13.1], ["q", L - 3.75, roof, L - 5.0, roof],
    [5.0, roof], ["q", 3.75, roof, 3.4, 13.1], [1.75, 9.6], [1.4, 9.0], [1.45, 5.1]]);
  let s = "";
  for (const k of [-1, 1]) {
    s += pilot(1.4, sill, k > 0 ? L : null);
    s += truck(L / 2 + k * 16.6, { wb: 8.83, d: 44, kind: "loco", top: sill });
  }
  s += rect(21.5, 2.2, L - 43, sill - 2.2, "currentColor", 0, 'opacity="0.8" rx="0.2"');
  const nj = c.agency === "njt" || !c.agency;
  let liv = rect(0, 0, L, roof + 1, nj ? "#c4c8cd" : c.color) + rect(0, 12.55, L, 2, nj ? "#1f2430" : "#3b4046");
  if (nj) {
    const grad = `ts-disco-${++clipSeq}`;
    liv += `<defs><linearGradient id="${grad}" x1="0" x2="1"><stop offset="0" stop-color="#1b3f94" stop-opacity="0"/>` +
      '<stop offset="0.12" stop-color="#1b3f94"/><stop offset="0.38" stop-color="#22389a"/><stop offset="0.56" stop-color="#6a2aa0"/>' +
      '<stop offset="0.74" stop-color="#d42a84"/><stop offset="0.88" stop-color="#f2622a"/><stop offset="1" stop-color="#f26b21"/></linearGradient></defs>';
    liv += rect(10.4, 4.6, L - 20.8, 2.2, `url(#${grad})`);
    for (const k of [-1, 1]) liv += rect(Math.min(X(0, k), X(7.2, k)), 7.6, 7.2, roof, C.black);
    liv += rect(0, sill, L, 0.25, "#f26b21");
  }
  for (const k of [-1, 1]) {
    const x = (v) => X(v, k);
    liv += path(poly([[x(1.95), 9.95], [x(3.4), 12.8], [x(4.0), 12.8], [x(4.0), 9.95]]), C.glass);
    liv += win(Math.min(x(5.0), x(6.5)), 9.7, 1.5, 3.0, 0.2);
  }
  s += path(d, "#c4c8cd") + clipped(d, liv);
  for (const k of [-1, 1]) s += door(Math.min(X(7.4, k), X(9.4, k)), sill + 0.35, 2.0, 7.9, { glassY: 0.7, glassH: 0.2 });
  // Air intakes along the dark roof band.
  for (const x of [14.5, 25.0, 39.5]) s += rect(x, 12.75, 10, 0.75, "rgba(255,255,255,0.08)", 0.3) + slats(x, 12.75, 10, 0.75, 0.4, "rgba(255,255,255,0.18)");
  s += rect(27.5, roof - 0.05, 9, 0.5, C.steelDark, 0.4);
  // "NJ TRANSIT" low on each cab side, under the black panel.
  for (const x of [4.9, L - 4.9]) s += badge(c, x, 6.6, 0.75, { logo: "njt-word" });
  // Pantographs toward each end; the trailing one raised.
  s += pantograph(12.2, roof, { up: false, facing: 1 }) + pantograph(L - 12.2, roof, { up: true, facing: -1 });
  s += outlineOf(d);
  return s;
}

// --- EMD DE30AC / DM30AC (LIRR): 75 ft over couplers, 14 ft 4 in, trucks
// 46 ft 2 in apart, 9 ft 6 in wheelbase, 44 in wheels. Monocoque body with
// ribbed stainless sides and two pairs of blue stripes, high and low. A blue
// cab with the MTA logo, its roof a little lower than the body's and capped
// in yellow, yellow along the top of the nose; raked windshield over a flat
// lower nose. Behind the cab a hatch, then the DE30AC's big 2x2 intake
// grille amidships and a radiator grille low at the back; the DM30AC (with
// third-rail shoes) has a narrow louvered panel amidships and two grilles at
// mid-height at the back. An engine-room door ahead of the rear grilles.
function lirrDiesel(c, dm) {
  const L = c.L;
  // Where the stripes stop: the doors and grille panels, [x0, x1, y0, y1].
  const gaps = dm ? [[27.1, 29.7, 4.9, 12.3], [59.9, 62.2, 5.0, 12.4], [65.2, 72.0, 6.2, 9.4]]
    : [[25.3, 33.8, 4.75, 12.2], [61.5, 63.7, 5.0, 12.4], [64.4, 73.2, 4.8, 9.0]];
  const stripe = (y, from = 10.7) => {
    let s = "", x = from;
    for (const [a, b] of [...gaps.filter((g) => y < g[3] && y + 0.33 > g[2]), [L, L]]) {
      if (a > x) s += rect(x, y, a - x, 0.33, LIRR.blue);
      x = Math.max(x, b);
    }
    return s;
  };
  return cabUnit(c, {
    badge: { x: 5.6, y: 8.25, h: 1.3, logo: "mta-inverse" },          // on the blue cab side
    roof: 14.33, sill: 4.6, rearR: 1.0,
    nose: [[2.2, 4.6], [1.45, 5.0], [1.4, 7.2], [1.6, 7.5], [3.6, 9.4], [5.6, 12.4], ["q", 5.8, 13.65, 6.8, 13.65], [10.6, 13.65]],
    top: [[11.2, 14.33]],
    glass: [[[3.75, 9.55], [5.5, 12.25], [5.75, 12.25], [5.75, 9.55]]],
    sideWin: [[6.0, 9.4, 1.9, 2.4]],
    doors: [[8.2, 1.9, 5.8, 11.5], dm ? [59.9, 2.3, 5.0, 12.4] : [61.5, 2.2, 5.0, 12.4]],
    panels: [[dm ? 17.1 : 16.8, 7.6, 1.9, 2.4], dm ? [27.1, 4.9, 2.6, 7.4] : [25.3, 4.75, 8.5, 7.45]],
    tank: [20, 54, 1.4], reservoir: [36, 50],
    grilles: [[5.0, 4.9, 2.0, 1.0, 0.25], ...(dm
      ? [[27.3, 5.3, 2.2, 2.7], [27.3, 9.1, 2.2, 2.7], [65.3, 6.2, 2.4, 3.2], [68.1, 6.2, 3.8, 3.2]]
      : [[25.6, 4.95, 3.9, 3.4], [29.7, 4.95, 3.9, 3.4], [25.6, 8.55, 3.9, 3.45], [29.7, 8.55, 3.9, 3.45], [64.4, 4.8, 8.8, 4.2, 0.36]])],
    roofItems: [[46.5, 1.8, 0.7], [54, 18, 0.25]], fans: [59, 63.8, 68.6],
    trucks: { centers: 46.17, wb: 9.5, d: 44, shoe: dm }, base: C.steel,
    paint: (c, sp) => flutes(10.7, sp.L - 1, 5.0, 13.6, 0.66) +
      stripe(11.2) + stripe(10.5) + stripe(6.6) + stripe(5.95, 12.0) +
      rect(0, 0, 10.7, 12.3, LIRR.blue) + rect(0, 12.3, 10.7, 3, LIRR.yellow) +
      path(poly([[0, 6.3], [1.5, 6.9], [3.9, 9.3], [3.9, 15], [0, 15]]), LIRR.yellow) +
      path(poly([[3.55, 9.3], [5.55, 12.35], [5.9, 12.35], [5.9, 9.3]]), C.black),
    // Horns on the front of the cab roof.
    extra: () => rect(7.6, 13.6, 1.1, 0.35, "currentColor") + rect(7.7, 13.95, 0.25, 0.35, "currentColor") + rect(8.2, 13.95, 0.25, 0.45, "currentColor"),
  });
}
export const de30ac = (c) => lirrDiesel(c, false);
export const dm30ac = (c) => lirrDiesel(c, true);


// ===================== Registry =====================
// Type key -> { draw, len (ft over couplers, or a function of the railroad),
// oneEnd (single cab, mirrored when it runs at the back of a train), variant
// (what else makes two cars of the type look different, beyond their ends) }.
const M = (draw, len, oneEnd = false, variant = null) => ({ draw, len, oneEnd, variant });
export const MODELS = {
  acs64: M(acs64, 66.67),
  alp46: M(alp46, 64),
  genesis: M(genesis, 69, true),
  p40: M(genesis, 69, true),                      // CT Rail's P40DCs: the same body
  p32: M(p32, 69, true),
  alc42: M(alc42, 71.5, true),
  charger: M(charger, 71.5, true),
  de30ac: M(de30ac, 75, true),
  dm30ac: M(dm30ac, 75, true),
  hsp46: M(hsp46, 71, true),
  mp36: M(mp36, 68, true),
  mp54ac: M(mp54ac, 68, true),
  mp40: M(mp40ph, 68, true),
  f125: M(f125, 69, true),
  bl36: M(bl36, 67.3, true),
  f40: M(f40ph, 56.17, true),
  f40c: M(f40c, 64.25, true),
  f59: M(f59, 58.58, true),
  gp40: M(gp40, 64, true),
  gp40h: M(gp40, 64, true),                       // CT Rail's GP40-3Hs, drawn on the GP40MC
  mp32: M(mp32, 65, true),
  sd70mach: M(sd70mach, 74.25, true),
  amfleet: M(amfleet1, 85.33),
  amfleet2: M(amfleet2, 85.33),
  amfleetBusiness: M(amfleetBusiness, 85.33),
  amfleetCafe: M(amfleetCafe, 85.33),
  metrolinerCab: M(metrolinerCab, 85.33, true),
  superlinerCoach: M(superlinerCoach, 85),
  superlinerSleeper: M(superlinerSleeper, 85),
  superlinerDiner: M(superlinerDiner, 85),
  superlinerLounge: M(superlinerLounge, 85),
  viewlinerSleeper: M(viewlinerSleeper, 85.33),
  viewlinerDiner: M(viewlinerDiner, 85.33),
  viewlinerBaggage: M(viewlinerBaggage, 85.33),
  bilevel: M((c) => (c.agency === "mbta" ? mbtaBilevel(c) : c.agency === "marc" ? marcKawasaki(c) : bombardierBilevel(c)), (ag) => (ag === "mbta" || ag === "marc" ? 85.33 : 85)),
  bilevelCab: M((c) => (c.agency === "mbta" ? mbtaCab(c) : c.agency === "marc" ? marcKawasakiCab(c) : c.agency === "go" ? goCab(c) : ["metrolink", "trirail"].includes(c.agency) ? rotemCabCar(c)
    : c.agency === "sunrail" ? sunrailCab(c) : bombardierCab(c)),
    (ag) => (ag === "mbta" || ag === "marc" ? 85.33 : ag === "go" ? 85 + GO_CAB : 85), true),
  kawasakiCab: M((c) => (c.agency === "marc" ? marcKawasakiCab(c) : mbtaCab(c)), 85.33, true),
  rotemCab: M(mbtaCab, 85.33, true),
  multilevel: M(multilevel, 85),
  multilevelCab: M(multilevelCab, 85, true),
  gallery: M(gallery, 85),
  galleryCab: M(galleryCabCar, 85, true),
  highliner: M(highliner, 85),
  c3: M(c3, 85),
  c3Cab: M(c3Cab, 85, true),
  californiaCar: M(californiaCar, 85),
  californiaCab: M(californiaCab, 85, true),
  surfliner: M(surfliner, 85),
  surflinerCab: M(surflinerCab, 85, true),
  single: M((c) => mbtaSingle(c), 85),
  singleCab: M(mbtaSingleCab, 85, true),
  pushPullCoach: M(septaCoach, 85),
  pushPullCab: M(septaCab, 85, true),
  shoreliner: M(shoreliner, 85),
  shorelinerCab: M(shorelinerCab, 85, true),
  mafersa: M(mafersaCoach, 85.33),
  mafersaCab: M(mafersaCab, 85.33, true),
  m7: M(m7, 85),
  m7a: M(m7a, 85),
  m8: M(m8, 85),
  m9: M(m9, 85),
  m3: M(m3, 85),
  silverliner4: M(silverliner4, 85),
  nsEmu: M(nsEmu, 85),
  nsTrailer: M(nsTrailer, 85),
  silverliner5: M(silverliner5, 85.13),
  kiss: M(kiss, 83.7),
  kissCab: M(kissCab, 90.2, true),
  smartDmu: M(smartDmu, 85),
  gtwCar: M(gtwCar, 58.85, true),
  gtwPower: M(gtwPower, 16.4),
  flirtCar: M(flirtCar, 71, true),
  flirtPower: M(flirtPower, 21),
  venture: M(venture, 85, false, (c) => (c.agency === "brightline" ? brightColor(c) : "")),
  ventureCab: M(ventureCab, 85, true),
  buddCoach: M(buddCoach, 85),
  buddSleeper: M(buddSleeper, 85),
  buddDiner: M(buddDiner, 85),
  buddBaggage: M(buddBaggage, 85),
  skyline: M(skyline, 85),
  parkCar: M(parkCar, 85, true),
  rdc: M(rdc, 85),
  acelaPower: M(acelaPower, 62.7, true),
  acelaCoach: M(acelaCoach, 61.35, false, (c) => (c.index === 1 ? "a" : c.index === c.count - 2 ? "b" : "")),
  talgo: M(talgo, 43.1),
  renaissanceCoach: M(renaissanceCoach, 75.5),
  renaissanceSleeper: M(renaissanceSleeper, 75.5),
  renaissanceDiner: M(renaissanceDiner, 75.5),
  autorack: M(autorack, 89),
  coach: M((c) => (c.route === "Piedmont" ? ncdotCoach(c) : amfleet1(c)), (ag) => 85.33),
};
