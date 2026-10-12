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
  const shade = `<linearGradient id="${id}-s" gradientUnits="userSpaceOnUse" x1="0" y1="${lo}" x2="0" y2="${hi}">` +
    '<stop offset="0" stop-color="#000" stop-opacity="0.24"/><stop offset="0.28" stop-color="#000" stop-opacity="0.06"/>' +
    '<stop offset="0.58" stop-color="#fff" stop-opacity="0.08"/><stop offset="0.8" stop-color="#fff" stop-opacity="0.24"/>' +
    '<stop offset="0.92" stop-color="#fff" stop-opacity="0.06"/><stop offset="1" stop-color="#000" stop-opacity="0.26"/></linearGradient>';
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
// Phase V: light gray, blue top with a wavy lower edge, red sill stripe.
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
  const mnr = c.agency === "mnr";
  let liv = rect(0, 0, L, roof + 1, amtrak ? AMTRAK.platinum : mnr ? "#c3c8ce" : c.color);
  if (mnr) {
    // Metro-North's P32AC-DMs: a blue cab and nose, silver hood over a blue
    // band with a red stripe along its top.
    liv += rect(0, 0, 12.6, roof + 1, "#1f4fbf") + rect(0, sill, L, 3.0, "#1f4fbf") +
      path(`M12.6 ${sill + 3.0}L${L} ${sill + 3.4}L${L} ${sill + 3.75}L12.6 ${sill + 3.35}Z`, AMTRAK.red);
  }
  if (amtrak) {
    // The blue top's lower edge waves gently from the cab to the back.
    liv += path(`M0 ${roof + 1}L0 10.1L5.8 10.1C16 10.0 22 11.0 32 10.75S48 10.1 56 10.55S66 11.2 ${L} 11.0L${L} ${roof + 1}Z`, AMTRAK.blue);
    liv += rect(0, sill + 0.25, L, 0.26, AMTRAK.red);
  }
  liv += line(7.6, 12.25, L - 1.0, 12.25, "rgba(0,0,0,0.28)", 0.6);           // crease where the sides taper in
  liv += path(poly([[4.25, 10.1], [6.45, 12.55], [7.35, 12.55], [7.35, 10.1]]), C.black);
  liv += path(poly([[4.6, 10.3], [6.4, 12.35], [7.0, 12.35], [7.0, 10.3]]), C.glass);
  liv += win(7.8, 10.4, 2.6, 1.7, 0.2) + win(10.7, 10.4, 1.6, 1.7, 0.2);       // cab side windows
  s += path(d, amtrak ? AMTRAK.platinum : c.color) + clipped(d, liv);
  s += door(12.8, sill + 0.4, 2.2, 6.8, { glassY: 0.6, glassH: 0.2 });          // crew door
  // Radiator air intakes low at the back, a smaller one forward, louvers up high.
  for (const [x, w, y, h] of [[44.5, 14, 5.3, 2.9], [27.5, 4.5, 5.3, 2.9], [47, 10, 11.0, 1.0]]) {
    s += rect(x, y, w, h, "rgba(0,0,0,0.22)", 0.4);
    s += slats(x, y, w, h);
  }
  // Roof: dynamic brake hatch, exhaust, two radiator fans at the back.
  s += rect(28, roof, 9, 0.3, C.steelDark, 0.4) + rect(41.5, roof, 1.6, 0.55, "currentColor") + rect(52, roof, 14, 0.25, C.steelDark, 0.4);
  for (const x of [55.5, 62]) s += path(`M${x - 2.4} ${roof + 0.25}Q${x} ${roof + 0.95} ${x + 2.4} ${roof + 0.25}Z`, C.steelDark, 0.4);
  s += mnr ? badge(c, 17.5, 10.2, 1.6) : badge(c, 55, 9.3, 1.6);    // MTA disc behind the cab; Amtrak toward the rear
  s += outlineOf(d);
  return s;
}
export const p32 = (c) => genesis(c, { shoe: true });

// --- Budd Amfleet: 85 ft 4 in, 12 ft 8 in tall, the tube-shaped body of the
// Metroliner with a rounded roof and corrugated lower sides; low, wide
// windows (18 in tall on the Amfleet I, 22 in on the II). The I has a
// vestibule at each end, the II at one. Phase VI: blue window band, red
// sill stripe.
// Class colors of the Phase VII wedge: green coach, light blue business; the
// cafe car has none.
const AMFLEET_CLASS = { coach: "#3fae49", business: "#5ec4ea", cafe: null };
function amfleet(c, { two = false, cab = false, cls = "coach" } = {}) {
  const { L } = c, x0 = 1.0, x1 = L - 1.0, sill = 4.05, roof = 12.67;
  const d = bodyOutline(x0, x1, sill, roof, { endR: 2.0, endRL: cab && c.cabL ? 3.2 : 2.0 });
  const winH = two ? 1.83 : 1.5, winY = two ? 7.35 : 7.55;
  let s = underframe(19, L - 19, sill, { boxes: 3 });
  s += truck(L / 2 - 29.75, { wb: 8.5, d: 36, kind: "pioneer", top: sill }) + truck(L / 2 + 29.75, { wb: 8.5, d: 36, kind: "pioneer", top: sill });
  let liv = rect(0, 0, L, roof + 1, C.steel);
  liv += rect(0, 11.05, L, 2, C.steelShade);                         // rounded roof
  liv += flutes(x0, x1, sill + 0.35, 6.75);                          // corrugated lower sides
  // Phase VII: a window band, dark blue from the A end to a white slash a
  // third of the way along, lighter blue past it, a second white slash near
  // the B end. Only the A end carries the class-color wedge, with the logo
  // just behind it. A red line low on the side.
  const b0 = winY - 0.55, b1 = winY + winH + 0.6;
  const a = two ? x0 : x0 + 4.4;                                     // past the A-end door (Amfleet I)
  const slashAt = (f) => x0 + (x1 - x0) * f;
  // lean: 1 for "/", -1 for "\" (the two slashes lean opposite ways).
  const slashPath = (x, lean) => path(poly([[x - 0.7 * lean - 0.18, b0], [x - 0.7 * lean + 0.18, b0], [x + 0.7 * lean + 0.18, b1], [x + 0.7 * lean - 0.18, b1]]), "#ffffff");
  const mid = slashAt(0.37);
  liv += rect(x0, b0, x1 - x0, b1 - b0, AMTRAK.navy) + path(poly([[mid - 0.7, b0], [x1, b0], [x1, b1], [mid + 0.7, b1]]), AMTRAK.sky);
  liv += slashPath(mid, 1) + slashPath(slashAt(0.92), -1);
  const wedge = AMFLEET_CLASS[cls];
  if (wedge && !(cab && c.cabL)) liv += path(poly([[a, b0], [a + 2.4, b0], [a + 1.2, b1], [a, b1]]), wedge);
  liv += rect(x0, sill + 0.2, x1 - x0, 0.22, AMTRAK.red);
  s += path(d, C.steel) + clipped(d, liv);
  // Doors: both ends on the Amfleet I, the B end only on the II.
  const doors = two ? [x1 - 4.4] : [x0 + 1.8, x1 - 4.4];
  for (const x of doors) {
    s += door(x, sill + 0.15, 2.6, 6.55, { glassY: 0.55, glassH: 0.32 });
  }
  const gaps = doors.map((x) => [x - 1.2, x + 3.8]);
  gaps.push([a, a + 8.2]);                                           // wedge and logo
  if (cab && c.cabL) gaps.push([x0, x0 + 6.5]);
  s += windowRow(x0 + 4.2, x1 - 4.2, winY, two ? 5.6 : 5.3, winH, two ? 6.9 : 6.5, { r: 0.55, skip: gaps });
  if (cab && c.cabL) {
    s += path(poly([[x0 + 0.35, 8.4], [x0 + 1.4, 10.6], [x0 + 3.8, 10.6], [x0 + 3.8, 8.4]]), C.black) + win(x0 + 1.5, 8.6, 2.0, 1.8, 0.3);
  }
  s += badge(c, a + 5.0, winY + winH / 2, 2.1, { dark: true, logo: "amtrak-stack" }); // white, in the band behind the wedge
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
// Brightline's SCB-40 hides its coupler behind a removable nose cone. Siemens
// gives 40.8 ft between truck centers and 44 in wheels.
// Phase VII (ALC-42): two blues split by a curved white stripe, black around
// the cab glass flanked by white and red, red and white sill stripes.
// A stripe framing a Charger's cab glass, as seen from the side: up the lower
// nose and as a cap over the cab roof (VIA yellow, Cascades tan).
const noseStripe = (color) =>
  path(poly([[1.5, 5.0], [2.15, 9.1], [2.65, 9.35], [3.5, 9.35], [2.7, 5.0]]), color) +
  path(poly([[4.95, 13.25], [5.7, 14.5], [12.0, 14.5], [12.0, 13.25]]), color);

export function charger(c, { phase7 = false } = {}) {
  const { L } = c, sill = 4.3, roof = 14.33;
  const cone = c.agency === "brightline";
  const d = poly([[2.2, sill], [L - 1.0, sill], [L - 1.0, roof - 1.0], ["q", L - 1.0, roof, L - 2.0, roof], [7.4, roof], ["q", 5.6, roof, 5.0, 13.2],
    [2.65, 9.35], [2.15, 9.1], [1.75, 6.0], [1.55, 5.0]]);
  const amtrak = c.agency === "amtrak", route = c.route || "";
  // Amtrak's state-supported routes keep their sponsors' liveries.
  const scheme = cone ? "brightline" : c.agency === "via" ? "via" : c.agency === "mnr" ? "mnr" : !amtrak ? "plain"
    : MIDWEST_ROUTES.has(route) ? "midwest" : ["Capitol Corridor", "San Joaquins"].includes(route) ? "california"
    : route === "Pacific Surfliner" ? "surfliner" : route === "Amtrak Cascades" ? "cascades" : "phase7";
  const p7 = scheme === "phase7";
  const base = { phase7: AMTRAK.sky, brightline: "#d9dde2", via: "#2c2f33", midwest: "#c3c8ce", california: "#bfc4ca", surfliner: "#c3c8ce", mnr: "#c3c8ce",
    cascades: "#1d4a45" }[scheme] || c.color;
  // Metro-North's SC-42DM also runs on third rail into Grand Central.
  const shoe = scheme === "mnr";
  let s = "";
  if (cone) {
    // Streamlined nose cone over the coupler, down to just above the rail.
    s += path(poly([[2.3, sill + 0.05], [1.55, 5.0], [1.55, 3.4], ["q", 1.55, 1.0, 2.6, 0.85], [4.8, 0.75], [4.4, sill + 0.05]]), "#f2c500", 0.6);
  } else {
    s += pilot(1.55, sill);
  }
  s += rect(L - 2.1, 2.0, 1.1, sill - 2.0, "currentColor", 0, 'opacity="0.85"');
  s += path(poly([[21, sill], [50.5, sill], [50.5, 2.3], ["q", 50.5, 1.4, 49.6, 1.4], [21.9, 1.4], ["q", 21, 1.4, 21, 2.3]]), "currentColor", 0, 'opacity="0.82"');
  s += truck(L / 2 - 20.4, { wb: 9.8, d: 44, kind: "loco", top: sill, shoe }) + truck(L / 2 + 20.4, { wb: 9.8, d: 44, kind: "loco", top: sill, shoe });
  let liv = rect(0, 0, L, roof + 1, base);
  switch (scheme) {
    case "cascades":
      // Amtrak Cascades (Airo ALC-42E): evergreen with a big cream panel
      // along the side from behind the cab to the rear; under it a green
      // strip, then white, brown and white sill stripes; tan edging the cab glass.
      liv += path(`M16.5 8.6Q16.5 6.1 19 6.1L${L} 6.1L${L} 13.3L19 13.3Q16.5 13.3 16.5 10.8Z`, "#efe9dc");
      liv += rect(0, sill, L, 0.5, "#2a2e33") + rect(0, sill + 0.5, L, 0.15, "#f4f1ea") + rect(0, sill + 0.65, L, 0.5, "#5a3a2c") + rect(0, sill + 1.15, L, 0.1, "#f4f1ea");
      liv += noseStripe("#b08a5a");
      break;
    case "mnr":
      // Metro-North: a blue cab and nose; silver behind, over a blue band edged in red.
      liv += rect(0, sill, L, 3.0, "#1f4fbf") + path(`M14 ${sill + 3.0}L${L} ${sill + 3.0}L${L} ${sill + 3.35}L22 ${sill + 3.35}Q17 ${sill + 3.5} 14 ${sill + 4.6}Z`, AMTRAK.red);
      liv += rect(0, sill, 14, roof + 1, "#1f4fbf") + rect(0, sill, L, 0.35, "#1d1f22");
      break;
    case "phase7": {
      // Two blues split by a curved white stripe, a red nose, red and white sill stripes.
      const curve = `M14 ${sill + 0.6}C26 ${sill + 0.4} 44 ${roof - 4.5} ${L} ${roof - 3.4}`;
      liv += path(`${curve}L${L} ${roof + 1}L14 ${roof + 1}Z`, AMTRAK.navy);
      liv += path(curve, "none", 0, 'stroke="#ffffff" stroke-width="0.45"');
      liv += path(`M0 ${sill}L3.2 ${sill}L3.2 9.0L0 9.0Z`, AMTRAK.red);
      liv += rect(0, sill + 0.55, L, 0.22, AMTRAK.red) + rect(0, sill + 0.25, L, 0.2, "#ffffff");
      break;
    }
    case "brightline":
      // Silver, a big yellow panel slanting across the middle with gray
      // wedges, a dark roof band; the nose black with yellow rays.
      liv += path(`M22 ${sill}L52 ${sill}L62 ${roof + 1}L32 ${roof + 1}Z`, "#ffd100") +
        path(`M29 ${sill}L33 ${sill}L43 ${roof + 1}L39 ${roof + 1}Z`, "#8a9097") + path(`M47 ${sill}L49 ${sill}L59 ${roof + 1}L57 ${roof + 1}Z`, "#8a9097");
      liv += rect(0, roof - 0.9, L, 2, "#3a3d41") + rect(0, sill, L, 0.6, "#3a3d41") + rect(0, 0, 7.6, roof + 1, "#1d1f22");
      for (let k = 0; k < 4; k++) liv += path(poly([[0, 5.6 + k * 1.1], [7.6, 8.0 + k * 0.5], [7.6, 8.35 + k * 0.5], [0, 6.1 + k * 1.1]]), "#ffd100");
      break;
    case "via":
      // VIA's SCV-42: charcoal, a light gray roof, yellow edging the cab glass.
      liv += rect(0, roof - 0.5, L, 1.5, "#8d939a") + noseStripe("#f5c400");
      break;
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
  // Cab glass in a black surround (flanked by white and red on Phase VII);
  // the state-supported liveries show the wraparound windshield only, with a
  // narrow cab side window in the body color behind it.
  const wide = !["midwest", "california", "surfliner", "cascades"].includes(scheme);
  liv += path(poly([[2.0, 9.0], [4.95, 13.25], [wide ? 10.8 : 7.3, 13.25], [wide ? 10.8 : 6.9, 9.0]]), C.black);
  if (p7) liv += rect(11.0, 8.6, 0.35, 5.2, "#ffffff") + rect(11.5, 8.6, 0.45, 5.2, AMTRAK.red);
  liv += path(poly([[2.6, 9.35], [4.85, 12.95], [5.6, 12.95], [5.6, 9.35]]), C.glass) + (wide ? win(6.3, 9.6, 3.8, 2.9, 0.25) : win(7.7, 9.5, 1.5, 2.6, 0.25));
  liv += line(7.2, 12.9, L - 1.0, 12.9, "rgba(0,0,0,0.25)", 0.6);
  s += path(d, base) + clipped(d, liv);
  if (!wide) s += rect(9.5, 10.4, 0.35, 1.7, "#b9bec4", 0.4);  // mirror
  s += door(12.3, sill + 0.5, 2.5, 7.6, { glassY: 0.6, glassH: 0.3 });
  // Side equipment, as on the SC-44: a small louvered panel high up, the tall
  // intake, a narrow grille, the see-through X-braced grille ahead of the
  // rear truck, a louvered vent and a small window.
  for (const [x, y, w, h] of [[24.6, 10.4, 2.4, 2.0], [29.0, 6.3, 4.7, 5.6], [48.2, 6.5, 2.6, 5.4], [58.8, 9.5, 3.6, 2.6]]) {
    s += rect(x, y, w, h, "rgba(20,22,25,0.45)", 0.4) + slats(x, y, w, h, 0.32);
  }
  s += rect(52.0, 5.7, 6.0, 6.6, "rgba(20,22,25,0.6)", 0.4) + lines([[52.2, 5.9, 57.8, 12.1], [52.2, 12.1, 57.8, 5.9]], "rgba(255,255,255,0.4)", 1.0);
  s += win(63.0, 9.8, 1.7, 2.1, 0.2);
  // Roof: an exhaust hatch behind the cab, the cooling section over the rear.
  s += rect(16.5, roof - 0.05, 3.0, 0.35, C.steelDark, 0.4, 'rx="0.15"') + rect(47.5, roof - 0.05, 20.5, 0.3, C.steelDark, 0.4);
  // The railroad's logo. Phase VII: name over travelmark, just behind the
  // cab. Brightline: its wordmark on the rear half. VIA: an enormous "VIA"
  // behind the cab. Metro-North: the MTA disc behind the cab door. Midwest:
  // "Amtrak Midwest" mid-side; northern California: Caltrans' mark and name;
  // Surfliner: "Pacific Surfliner" on the gray panel; Cascades: its logo on
  // the cream.
  const mark = {
    phase7: { x: 20, y: 9.2, h: 3.6, dark: true, logo: "amtrak-stack" },
    brightline: { x: 42, y: 8.8, h: 2.6 },
    via: { x: 39, y: 8.3, h: 5.0, logo: "via-mark" },
    mnr: { x: 16.5, y: 8.2, h: 1.7 },
    midwest: { x: 40.5, y: 10.2, h: 2.3, logo: "amtrak-midwest" },
    california: { x: 41, y: 9.9, h: 1.8, logo: "caltrans" },
    surfliner: { x: 42, y: 9.3, h: 1.9, logo: "surfliner" },
    cascades: { x: 33, y: 9.4, h: 3.6, logo: "cascades-dark" },
  }[scheme] || { x: 40, y: 9.0, h: 1.7 };
  s += badge(c, mark.x, mark.y, mark.h, mark);
  s += outlineOf(d);
  return s;
}
export const alc42 = (c) => charger(c, { phase7: true });

// --- Superliner (Pullman-Standard I, Bombardier II): 85 ft, 16 ft 2 in tall,
// a low floor between the trucks, one door each side in the middle of the
// lower level, big two-piece windows upstairs. Phase VI on Superliners:
// narrow red, blue, red stripes under the upper windows; red sill stripe.
const SUPER_STRIPES = [[9.15, 0.16, AMTRAK.red], [8.7, 0.38, AMTRAK.blue], [8.48, 0.16, AMTRAK.red], [4.35, 0.2, AMTRAK.red]];
const superBase = {
  roof: 16.17, sill: 4.3, endR: 1.5, eave: 15.0, drop: { a: 16.5, b: 68.5, y: 1.35 },
  // Phase VI: the travelmark alone, blue, on the lower level just past the door.
  badge: { x: 46.8, y: 5.6, h: 1.4, logo: "amtrak-mark" },
  stripes: SUPER_STRIPES, trucks: { centers: 59.5, wb: 8.5, d: 36 }, diaphragm: [8.4, 14.9],
};
const superDoor = { x: 41.0, w: 3.0, y: 1.45, h: 6.6, glassY: 0.55, glassH: 0.25 };
export const superlinerCoach = (c) => coachCar(c, { ...superBase,
  rows: [{ a: 2.6, b: 82.4, y: 10.35, w: 4.6, h: 2.85, pitch: 5.55, r: 0.45 }, { a: 49, b: 67.5, y: 4.55, w: 3.1, h: 2.0, pitch: 4.4, r: 0.35 }],
  doors: [superDoor] });
export const superlinerSleeper = (c) => coachCar(c, { ...superBase,
  rows: [{ a: 2.6, b: 82.4, y: 10.6, w: 3.0, h: 2.4, pitch: 4.2, r: 0.35 }, { a: 18, b: 39.5, y: 4.6, w: 3.0, h: 2.1, pitch: 4.2, r: 0.35 }, { a: 45.5, b: 67, y: 4.6, w: 3.0, h: 2.1, pitch: 4.2, r: 0.35 }],
  doors: [superDoor] });
export const superlinerDiner = (c) => coachCar(c, { ...superBase,
  rows: [{ a: 9, b: 76, y: 10.35, w: 4.6, h: 2.85, pitch: 5.55, r: 0.45 }, { a: 56, b: 62, y: 5.2, w: 2.2, h: 1.5, pitch: 3, r: 0.3 }] });
// Sightseer Lounge: floor-to-ceiling windows curving into the roof upstairs.
export const superlinerLounge = (c) => coachCar(c, { ...superBase,
  rows: [{ a: 18, b: 39, y: 4.8, w: 2.6, h: 1.9, pitch: 3.6, r: 0.3 }, { a: 46, b: 67, y: 4.8, w: 2.6, h: 1.9, pitch: 3.6, r: 0.3 }],
  extra: (c, { x0, x1 }) => {
    let s = "";
    const a = x0 + 4.5, b = x1 - 4.5, w = 5.0, pitch = 5.6, count = Math.floor((b - a - w) / pitch) + 1;
    const start = a + (b - a - ((count - 1) * pitch + w)) / 2;
    for (let i = 0; i < count; i++) {
      const x = start + i * pitch;
      s += path(poly([[x, 9.55], [x + w, 9.55], [x + w, 14.6], ["q", x + w, 15.55, x + w - 0.9, 15.75], [x + 0.9, 15.75], ["q", x, 15.55, x, 14.6]]), C.glass, 0, `stroke="${C.gasket}" stroke-width="0.6" vector-effect="non-scaling-stroke"`);
      s += rect(x + 0.15, 13.6, w - 0.3, 1.6, C.glassLight, 0, 'rx="0.3"');
    }
    return s;
  } });

// --- Viewliner (Budd prototypes, Morrison-Knudsen/Amerail I, CAF II): 85 ft
// 4 in, 14 ft tall, single level. Sleepers carry a second, upper row of small
// windows for the upper berths — the "view" in the name. Viewliner I in
// Phase VI (blue band); Viewliner II in the 2013 Phase III variant (red,
// white and blue stripes) with a red sill stripe.
const P3 = (y) => [[y + 0.6, 0.3, AMTRAK.red], [y + 0.3, 0.3, "#ffffff"], [y, 0.3, AMTRAK.blue]];
const viewBase = { roof: 14.0, sill: 4.1, endR: 1.2, eave: 13.0, trucks: { centers: 59.5, wb: 8.5, d: 36 } };
const viewDoor = (x) => ({ x, w: 2.7, h: 6.7, glassY: 0.6, glassH: 0.28 });
export const viewlinerSleeper = (c) => coachCar(c, { ...viewBase, badge: false,
  stripes: [[6.7, 2.8, AMTRAK.blue], [4.3, 0.2, AMTRAK.red]],
  rows: [{ a: 2.5, b: 77.5, y: 7.1, w: 3.2, h: 2.0, pitch: 4.15, r: 0.35 }, { a: 2.5, b: 77.5, y: 10.75, w: 2.0, h: 1.1, pitch: 4.15, r: 0.3 }],
  doors: [viewDoor(80.2)] });
export const viewlinerDiner = (c) => coachCar(c, { ...viewBase, badge: false,
  stripes: [...P3(6.2), [4.3, 0.2, AMTRAK.red]],
  rows: [{ a: 22, b: 82.5, y: 7.3, w: 4.6, h: 2.9, pitch: 5.3, r: 0.4 }, { a: 7, b: 17, y: 8.4, w: 2.2, h: 1.6, pitch: 4.5, r: 0.3 }],
  doors: [viewDoor(2.6)] });
// Baggage car: no windows, two wide doors each side.
export const viewlinerBaggage = (c) => coachCar(c, { ...viewBase, badge: { x: 42.7, y: 10.9, h: 1.2 },
  stripes: [...P3(8.6), [4.3, 0.2, AMTRAK.red]],
  doors: [{ x: 19.5, w: 7.5, h: 7.6, glass: false, grabs: false }, { x: 58.3, w: 7.5, h: 7.6, glass: false, grabs: false }],
  extra: () => lines([19.5, 58.3].flatMap((x) => [1, 2, 3, 4, 5, 6].map((k) => [x + 0.2, 4.25 + k * 1.08, x + 7.3, 4.25 + k * 1.08])), "rgba(0,0,0,0.18)") });

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
// dropping toward each end; trucks 64 ft apart, 8 ft 6 in wheelbase, 33 in
// wheels; lower floor 25 in above the rail. Octagonal body: bevels above the
// upper windows and below the lower ones. Two sets of bi-parting doors on the
// lower level each side (one moved toward the middle since 1992), four lower
// windows between them, nine upper windows, two at each end level.
const BOMB = {
  roof: 15.92, sill: 3.7, ends: { h: 14.6, len: 0.0, ramp: 5.0 }, cornerR: 0.9,
  drop: { a: 16.6, b: 68.4, y: 1.25 }, trucks: { centers: 64, wb: 8.5, d: 33 }, chamfer: [2.4, 14.15],
  // Metrolink: the name at upper-deck level near one end. FrontRunner: the
  // name between the decks. Tri-Rail: its logo high near one end.
  badge: (c) => ({ metrolink: { x: 7, y: 10.2, h: 1.0 }, frontrunner: { x: 24, y: 8.7, h: 0.8 }, trirail: { x: 44, y: 9.2, h: 1.7, logo: "trirail-onnavy" } })[c.agency],
  rows: [{ xs: seq(17.6, 5.5, 9), y: 11.6, w: 4.2, h: 2.2, r: 0.35 }, { xs: seq(28.2, 5.5, 4), y: 4.4, w: 4.2, h: 2.2, r: 0.35 },
    { xs: [1.9, 6.6, 69.2, 74.8], y: 7.0, w: 3.7, h: 1.9, r: 0.3 }],
  doors: [{ x: 20.0, w: 4.33, y0: 1.55, y1: 8.15, leaves: 2, glassY: 0.42, glassH: 0.42 }, { x: 56.1, w: 4.33, y0: 1.55, y1: 8.15, leaves: 2, glassY: 0.42, glassH: 0.42 }],
  roofItems: [[6.0, 6.5, 0.35, 14.75], [72.5, 6.5, 0.35, 14.75]], diaphragm: [4.25, 13.2],
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
function bombPaint(c, g) {
  if (c.agency === "trirail") return triRailPaint(c, g);
  const L = g.L;
  let s = rect(0, 0, L, 17, "#eef0f2");
  switch (c.agency) {
    case "frontrunner":
      s += path(`M0 0L12 0Q16 6 22 17L0 17Z`, "#203f8f") + path(`M${L} 0L${L - 12} 0Q${L - 16} 6 ${L - 22} 17L${L} 17Z`, "#b02b2c");
      s += path(`M13.6 0Q17.6 6 23.6 17`, "none", 0, 'stroke="#203f8f" stroke-width="1.2"') + path(`M${L - 13.6} 0Q${L - 17.6} 6 ${L - 23.6} 17`, "none", 0, 'stroke="#b02b2c" stroke-width="1.2"');
      return s;
    case "metrolink":
      s += path(`M0 9.6C20 8.4 30 10.6 45 9.6S70 8.2 ${L} 9.6L${L} 10.4C70 9.0 60 11.4 45 10.4S20 9.2 0 10.4Z`, "#00a19a");
      s += path(`M0 10.6C20 9.4 30 11.6 45 10.6S70 9.2 ${L} 10.6L${L} 11.0C70 9.6 60 12.0 45 11.0S20 9.8 0 11.0Z`, "#1d4f91");
      return s + rect(0, 0, L, 1.9, "#1d4f91");
    case "trirail":
      return s + rect(0, 9.3, L, 1.2, "#00617f") + rect(0, 9.0, L, 0.18, "#91d14f") + rect(0, 10.6, L, 0.18, "#f37014") + rect(0, 0, L, 1.9, "#00617f");
    default:
      return s + rect(0, 9.4, L, 1.1, c.color || "#1f5fad");
  }
}
export const bombardierBilevel = (c) => bilevel(c, { ...BOMB, base: "#eef0f2", paint: bombPaint });
// Cab car: the mid-1990s full-width cab in the end section, a flat end with
// two windows, the engineer's side window behind the corner.
export const bombardierCab = (c) => bilevel(c, { ...BOMB, base: "#eef0f2", paint: bombPaint, cabLen: 6,
  cab: (c, { x0 }) => {
    let s = rect(x0, 6.8, 0.45, 2.8, C.black) + win(x0 + 0.8, 6.9, 3.0, 2.3, 0.3);
    return s;
  } });

// --- Hyundai Rotem "Guardian" cab car (Metrolink 638-695, Tri-Rail 512-521):
// same 85 ft and 64 ft truck centers, but flat-topped at 15 ft 10 in with
// rounded shoulders; lower-level doors 23 ft 5 in and 26 ft 3 in from the car
// ends; nine upper windows, three lower ones and a sign board; two windows at
// each end level. The cab rides at upper-level height behind a crush zone,
// under a sloped fiberglass mask: from the roof down to 8 ft above the rail
// over 6 ft 8 in, then an upright lower face.
const ROTEM = {
  roof: 15.87, sill: 3.7, cornerR: 1.0,
  drop: { a: 16.6, b: 68.4, y: 1.25 }, trucks: { centers: 64, wb: 8.5, d: 33 },
  badge: (c) => ({ metrolink: { x: 7, y: 10.3, h: 1.0 }, trirail: { x: 44, y: 9.4, h: 1.7, logo: "trirail-onnavy" } })[c.agency],
  rows: [{ xs: seq(18.9, 5.42, 9), y: 11.4, w: 4.4, h: 2.2, r: 0.4 }, { xs: seq(28.4, 5.42, 4), y: 4.6, w: 4.4, h: 2.1, r: 0.4 },
    { xs: [1.8, 6.6, 73.5, 78.6], y: 6.9, w: 4.0, h: 2.2, r: 0.4 }],
  doors: [{ x: 21.1, w: 4.67, y0: 1.55, y1: 8.1, leaves: 2, glassY: 0.42, glassH: 0.42 }, { x: 56.4, w: 4.67, y0: 1.55, y1: 8.1, leaves: 2, glassY: 0.42, glassH: 0.42 }],
  diaphragm: [4.25, 13.6],
};
function rotemPaint(c, g) {
  if (c.agency === "trirail") return triRailPaint(c, g);
  const L = g.L;
  let s = rect(0, 0, L, 17, C.steel) + flutes(0, L, 2.0, 3.6, 0.3);
  if (c.agency === "metrolink") {
    s += path(`M0 8.2C14 6.6 26 11.0 42 9.2S70 6.0 ${L} 8.8L${L} 9.5C70 6.9 58 10.2 42 10.0S14 7.4 0 9.0Z`, "#00a19a");
    s += path(`M0 9.3C14 7.7 26 12.1 42 10.3S70 7.1 ${L} 9.9L${L} 10.25C70 7.6 58 10.9 42 10.7S14 8.2 0 9.7Z`, "#1d4f91");
  } else {
    s += rect(0, 9.3, L, 1.2, c.agency === "trirail" ? "#00617f" : c.color || "#1f5fad");
  }
  return s;
}
export const rotemCabCar = (c) => bilevel(c, { ...ROTEM, paint: rotemPaint, cabLen: 9,
  nose: [[0.9, 3.7], [0.9, 8.0], [7.6, 15.87]],
  cab: (c, { x0 }) => {
    const metrolink = c.agency === "metrolink";
    // Black mask over the slope; teal lower face (Metrolink); three-pane
    // windshield seen edge-on; trapezoid cab side window.
    let s = path(poly([[0.9, 8.0], [7.6, 15.87], [9.6, 15.87], [9.6, 11.0], [5.0, 8.0]]), "#17191c");
    s += path(poly([[0.9, 3.75], [0.9, 8.0], [5.0, 8.0], [3.6, 3.75]]), metrolink ? "#00a19a" : "#2d62b3");
    s += line(0.9, 8.0, 5.0, 8.0, "#ffffff", 1.2) + line(5.0, 8.0, 9.6, 11.0, "#ffffff", 1.0);
    s += path(poly([[3.6, 11.2], [5.75, 13.75], [6.4, 13.75], [6.4, 11.2]]), C.glass) + path(poly([[6.9, 11.3], [8.9, 11.3], [8.9, 13.6], [7.5, 13.6]]), C.glass);
    return s + outlineOf(poly([[0.9, 3.7], [0.9, 8.0], [7.6, 15.87], [9.6, 15.87]]));
  } });
export const rotemCoach = (c) => bilevel(c, { ...ROTEM, paint: rotemPaint });

// --- MBTA bi-levels (Kawasaki BTC-4 and CTC-4, 1990-2006; Hyundai Rotem
// BTC-4D and CTC-5, 2012-2024, built to the same plan): 85 ft 4 in, 15 ft
// 6 in, stainless. Doors at the extreme ends of the car, at the end-section
// level over the trucks, with trap steps for low platforms. A purple band
// between the two rows of windows, stepping up to door-window height in
// the end sections, edged in yellow.
const MBTA_BL = {
  roof: 15.5, sill: 3.7, cornerR: 0.9, ends: { h: 15.2, len: 14.6, ramp: 2.0 },
  drop: { a: 17.4, b: 67.9, y: 1.3 }, trucks: { centers: 59.5, wb: 8.5, d: 33 },
  rows: [{ xs: seq(19.2, 3.55, 14), y: 11.0, w: 2.85, h: 2.25, r: 0.35 }, { xs: seq(19.2, 3.55, 14), y: 4.1, w: 2.85, h: 2.2, r: 0.35 },
    { xs: [12.9, 69.9], y: 12.6, w: 2.4, h: 0.8, r: 0.2 }],
  doors: [{ x: 1.35, w: 2.6, y0: 4.25, y1: 11.6, glassY: 0.62, glassH: 0.3 }, { x: 81.38, w: 2.6, y0: 4.25, y1: 11.6, glassY: 0.62, glassH: 0.3 }],
  roofItems: [[3.5, 9, 0.45, 15.2], [72.8, 9, 0.45, 15.2]], diaphragm: [4.25, 13.6],
  badge: { x: 42.7, y: 8.6, h: 1.4 },                                 // in the purple band between the decks
};
function mbtaBand(c, g) {
  const L = g.L, P = MBTA.purple, Y = MBTA.yellow;
  let s = rect(0, 0, L, 17, C.steel) + line(0, 7.2, L, 7.2, "rgba(0,0,0,0.12)", 0.5);
  const band = (top, bot) => `M0 ${bot}L15.6 ${bot}L18.4 ${bot - 2.2}L${L - 18.4} ${bot - 2.2}L${L - 15.6} ${bot}L${L} ${bot}`;
  s += path(`${band(12.3, 9.35)}L${L} 12.25L${L - 15.6} 12.25L${L - 17.8} 10.25L17.8 10.25L15.6 12.25L0 12.25Z`, P);
  s += path(band(12.3, 9.35), "none", 0, `stroke="${Y}" stroke-width="1"`);
  s += path(`M0 12.3L15.6 12.3L17.8 10.3L${L - 17.8} 10.3L${L - 15.6} 12.3L${L} 12.3`, "none", 0, `stroke="${Y}" stroke-width="1"`);
  return s;
}
const mbtaCabEnd = (c, { x0 }) => {
  let s = rect(x0, 4.3, 0.4, 10.5, "rgba(0,0,0,0.25)");
  return s;
};
export const mbtaBilevel = (c) => bilevel(c, { ...MBTA_BL, paint: mbtaBand });
export const mbtaCab = (c) => bilevel(c, { ...MBTA_BL, paint: mbtaBand, cab: mbtaCabEnd });

// --- Bombardier/Alstom MultiLevel (NJ Transit 7000-7767; MultiLevel III
// 8000s): 85 ft, 14 ft 6 in so it clears the Hudson tunnels. Low end roofs
// over the trucks rise to the full height over the two decks. Four single
// doors a side, all at the end-section level: one at each end with traps, one
// over each truck for high platforms only. Long bands of narrow windows on
// both decks; NJ Transit's blue-magenta-orange stripe between them.
const ML = {
  roof: 14.5, sill: 3.7, cornerR: 0.8, ends: { h: 13.5, len: 13.8, ramp: 3.0 },
  drop: { a: 18.6, b: 66.4, y: 1.3 }, trucks: { centers: 60.5, wb: 8.5, d: 36 },
  rows: [{ xs: seq(18.7, 2.75, 18), y: 10.65, w: 2.25, h: 2.1, r: 0.25 }, { xs: seq(18.7, 2.75, 18), y: 3.3, w: 2.25, h: 2.0, r: 0.25 },
    { xs: [7.0, 75.8], y: 7.4, w: 2.2, h: 1.9, r: 0.25 }],
  doors: [{ x: 1.3, w: 2.75, y0: 4.25, y1: 10.9, glassY: 0.55, glassH: 0.32 }, { x: 11.8, w: 2.75, y0: 4.25, y1: 10.9, glassY: 0.55, glassH: 0.32 },
    { x: 70.45, w: 2.75, y0: 4.25, y1: 10.9, glassY: 0.55, glassH: 0.32 }, { x: 80.95, w: 2.75, y0: 4.25, y1: 10.9, glassY: 0.55, glassH: 0.32 }],
  roofItems: [[4.5, 5.5, 0.4, 13.5], [75, 5.5, 0.4, 13.5]], diaphragm: [4.25, 12.5],
  badge: { x: 9.0, y: 10.3, h: 0.9, logo: "njt-word" },             // on one end section
};
function njtPaint(c, g) {
  const L = g.L, id = `ts-njt-${++clipSeq}`;
  let s = rect(0, 0, L, 17, C.steel);
  s += `<defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="#1b3f94"/><stop offset="0.5" stop-color="#b5267a"/><stop offset="1" stop-color="#f26b21"/></linearGradient></defs>`;
  s += rect(18.3, 10.45, L - 36.6, 2.55, "#1d2024") + rect(18.3, 3.1, L - 36.6, 2.45, "#1d2024");
  s += rect(18.3, 8.2, 18, 0.9, `url(#${id})`) + rect(L - 36.3, 8.2, 18, 0.9, `url(#${id})`);
  return s;
}
export const multilevel = (c) => bilevel(c, { ...ML, paint: njtPaint });
export const multilevelCab = (c) => bilevel(c, { ...ML, paint: njtPaint,
  cab: (c, { x0 }) => {
    let s = rect(x0, 4.3, 0.4, 9, "rgba(0,0,0,0.25)");
    return s;
  } });

// --- Gallery cars (Metra: Nippon Sharyo 2002-05 and Amerail 1994-96 design):
// 85 ft, 15 ft 10 in, fluted stainless, the upper level a pair of balconies
// with their own row of windows over the big lower ones. Bi-parting doors in
// the middle of the car at the low level; a blue Metra panel beside them.
const GALLERY = {
  roof: 15.86, sill: 3.7, cornerR: 1.2,
  drop: { a: 15.5, b: 69.5, y: 1.35 }, trucks: { centers: 61, wb: 8.5, d: 33 },
  rows: [{ xs: seq(2.2, 6.1, 4), y: 11.0, w: 4.9, h: 2.1, r: 0.45 }, { xs: seq(46.2, 6.1, 6), y: 11.0, w: 4.9, h: 2.1, r: 0.45 },
    { xs: seq(2.2, 6.1, 6), y: 4.4, w: 4.9, h: 2.4, r: 0.45 }, { xs: seq(46.2, 6.1, 6), y: 4.4, w: 4.9, h: 2.4, r: 0.45 }],
  doors: [{ x: 40.2, w: 4.6, y0: 1.5, y1: 8.4, leaves: 2, glassY: 0.4, glassH: 0.45 }],
  diaphragm: [4.25, 14.0],
  badge: { x: 33, y: 12.0, h: 1.9, dark: true }, // on the blue Metra panel
};
function galleryPaint(c, g) {
  const L = g.L;
  let s = rect(0, 0, L, 17, C.steel) + flutes(0, L, 1.4, 4.2, 0.3) + flutes(0, L, 6.95, 10.9, 0.3) + flutes(0, L, 13.2, 14.9, 0.3);
  s += rect(0, 14.9, L, 2, C.steelShade);
  if (c.agency === "metra") s += rect(27.6, 10.8, 10.8, 2.4, "#1f4fa3");
  return s;
}
// Metra cab ends: red and white chevrons on the end panels around the door.
const galleryCab = (c, { x0 }) => {
  let s = "";
  for (let k = 0; k < 6; k++) s += rect(x0, 3.8 + k * 1.9, 0.42, 0.95, k % 2 ? "#ffffff" : "#c8102e");
  s += win(x0 + 0.8, 11.2, 2.6, 1.9, 0.3);
  return s;
};
export const gallery = (c) => bilevel(c, { ...GALLERY, paint: galleryPaint });
export const galleryCabCar = (c) => bilevel(c, { ...GALLERY, paint: galleryPaint, cab: galleryCab });
// Highliner II (Metra Electric, Nippon Sharyo 2012-16): the same gallery body
// with motors; one single-arm pantograph per car on a lowered roof section
// at the inner end, with no upper windows beneath it.
export const highliner = married((c) => bilevel(c, { ...GALLERY, paint: galleryPaint, cab: galleryCab,
  rows: [{ xs: seq(2.2, 6.1, 4), y: 11.0, w: 4.9, h: 2.1, r: 0.45 }, { xs: seq(46.2, 6.1, 4), y: 11.0, w: 4.9, h: 2.1, r: 0.45 },
    { xs: seq(2.2, 6.1, 6), y: 4.4, w: 4.9, h: 2.4, r: 0.45 }, { xs: seq(46.2, 6.1, 6), y: 4.4, w: 4.9, h: 2.4, r: 0.45 }],
  extra: (c, g) => rect(g.L - 15.5, 14.6, 14.6, 1.3, "rgba(0,0,0,0.18)") + pantograph(g.L - 8.6, 14.6, { up: true, facing: -1 }) }));

// --- LIRR C3 (Kawasaki, 1997-99): 85 ft, only 14 ft 5.6 in tall. The ends
// over the trucks have lower roofs; single-leaf sliding doors at the quarter
// points, high-platform only; a fluted skirt tapering along the lower deck;
// two light blue stripes between the decks.
const C3 = {
  roof: 14.47, sill: 3.7, cornerR: 0.7, ends: { h: 13.6, len: 16.2, ramp: 1.6 },
  drop: { a: 17.8, b: 67.2, y: 1.3 }, trucks: { centers: 60, wb: 8.5, d: 36 },
  rows: [{ xs: seq(19.6, 3.35, 14), y: 10.75, w: 2.6, h: 2.05, r: 0.3 }, { xs: seq(19.6, 3.35, 14), y: 3.75, w: 2.6, h: 2.05, r: 0.3 },
    { xs: [5.6, 77.0], y: 9.4, w: 1.4, h: 2.0, r: 0.2 }],
  doors: [{ x: 13.5, w: 3.0, y0: 4.25, y1: 11.3, glassY: 0.5, glassH: 0.36 }, { x: 68.5, w: 3.0, y0: 4.25, y1: 11.3, glassY: 0.5, glassH: 0.36 }],
  roofItems: [[2.5, 9.0, 0.5, 13.6], [73.5, 9.0, 0.5, 13.6]], diaphragm: [4.25, 12.4],
  badge: [{ x: 9.5, y: 8.0, h: 0.8 }, { x: 74.5, y: 8.0, h: 0.8 }],  // in each end vestibule, outboard of the door
};
function c3Paint(c, g) {
  const L = g.L;
  let s = rect(0, 0, L, 17, "#c7ccd2") + flutes(19, L - 19, 1.4, 3.2, 0.28);
  s += rect(0, 9.95, L, 0.38, "#3d8fe0") + rect(0, 6.4, L, 0.38, "#3d8fe0");
  s += rect(2.5, 4.6, 2.4, 1.8, "rgba(0,0,0,0.25)") + slats(2.5, 4.6, 2.4, 1.8, 0.3);
  return s;
}
export const c3 = (c) => bilevel(c, { ...C3, paint: c3Paint });
export const c3Cab = (c) => bilevel(c, { ...C3, paint: c3Paint,
  cab: (c, { x0 }) => {
    let s = rect(x0, 4.3, 0.42, 3.2, LIRR.yellow) + rect(x0, 7.5, 0.42, 1.0, "#1c3f94");
    return s;
  } });

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
const PAINT = {
  mbta: cometPaint(MBTA.purple, { stripe: [9.85, 0.16, MBTA.yellow], pin: [6.55, 0.16, MBTA.yellow] }),
  septa: cometPaint(null, { stripe: [9.9, 0.45, "#1f4fa3"], pin: [9.55, 0.3, "#e0352b"] }),
  mnr: cometPaint("#1f4fa3", { stripe: [10.0, 0.2, "#1f4fa3"] }),
  ctdot: cometPaint("#c8102e", { stripe: [10.0, 0.2, "#c8102e"] }),
};
const single = (paint, { center = false, cab = false } = {}) => (c) => {
  const rows = center ? [{ ...COMET.rows[0], xs: skipAround(COMET.rows[0].xs, 39.4, 45.6) }] : COMET.rows;
  const badge = {
    mbta: { x: 10, y: 5.0, h: 1.0 },
    mnr: [{ x: 5.15, y: 8.25, h: 1.2, logo: "mta-inverse" }, { x: 79.4, y: 8.25, h: 1.2, logo: "mta-inverse" }],
  }[c.agency] ?? null;
  return bilevel(c, { ...COMET, rows, doors: center ? [...COMET.doors, cometCenter] : COMET.doors, paint, cab: cab ? cometCab : null, cabLen: cab ? 4 : 0, badge });
};
export const mbtaSingle = single(PAINT.mbta);
export const mbtaSingleCab = single(PAINT.mbta, { cab: true });
export const septaCoach = single(PAINT.septa);
export const septaCab = single(PAINT.septa, { cab: true });
export const shoreliner = (c) => single(c.agency === "ctdot" ? PAINT.ctdot : PAINT.mnr, { center: true })(c);
export const shorelinerCab = (c) => single(c.agency === "ctdot" ? PAINT.ctdot : PAINT.mnr, { center: true, cab: true })(c);

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
// wheels. Two single-leaf sliding doors a side, the front one about 18 ft
// from the cab corner; stainless sides, doors edged in color; third-rail
// shoes (over-running on the LIRR, under-running on Metro-North).
// LIRR ends: black above a yellow band; Metro-North M7A: blue with white.
const M7 = {
  roof: 12.88, sill: 3.55, cornerR: 1.1, trucks: { centers: 59.5, wb: 8.5, d: 36, shoe: true }, end: 0.6,
  rows: [{ xs: [4.6, 9.4, 22.4, 27.7, 33.0, 38.3, 43.6, 48.9, 54.2, 59.5, 70.6, 75.6, 80.6], y: 7.05, w: 3.1, h: 2.55, r: 0.3 }],
  doors: [{ x: 16.9, w: 4.2, y0: 4.2, y1: 11.15, glassY: 0.48, glassH: 0.38 }, { x: 63.9, w: 4.2, y0: 4.2, y1: 11.15, glassY: 0.48, glassH: 0.38 }],
  roofItems: [[5.5, 10, 0.5], [69.5, 10, 0.5]], diaphragm: [4.25, 11.4], cabLen: 4,
  // The MTA disc (with the railroad's name) on the car-end side of each door.
  badge: [{ x: 14.4, y: 8.3, h: 0.8 }, { x: 68.8, y: 8.3, h: 0.8 }],
};
const m7Paint = (edge) => (c, g) => {
  const L = g.L;
  let s = rect(0, 0, L, 17, "#d0d4d9") + rect(0, 11.9, L, 2, C.steelShade) + rect(0, 0, L, 4.25, "#2a2d31");
  s += rect(0, 4.25, L, 0.25, "#9aa1a9");
  for (const x of [16.9, 63.9]) s += rect(x - 0.35, 4.2, 0.3, 7.0, edge) + rect(x + 4.25, 4.2, 0.3, 7.0, edge);
  return s;
};
export const m7 = married((c) => bilevel(c, { ...M7, paint: m7Paint("#d4a72c"),
  cab: emuEnd([[9.6, 2.8, C.black], [6.1, 1.6, LIRR.yellow], [4.3, 1.8, "#c9cdd2"]]) }));
export const m7a = married((c) => bilevel(c, { ...M7, paint: m7Paint("#1f4fa3"),
  cab: emuEnd([[6.0, 6.4, "#1f4fa3"], [7.8, 0.2, "#ffffff"], [8.4, 0.2, "#ffffff"], [4.3, 1.7, "#c9cdd2"]]) }));

// --- Kawasaki M8 (Metro-North New Haven Line, 9101-9580): 85 ft, married
// pairs with a pantograph on the even car at the inner end, 25/12.5 kV
// overhead plus third rail. Gray stainless sides with a black-to-red stripe
// low along the side; red cab ends; single-leaf doors.
export const m8 = married((c) => bilevel(c, {
  badge: { x: 15, y: 8.3, h: 1.0 },                                   // cab side of the first door
  roof: 13.0, sill: 3.55, cornerR: 1.2, trucks: { centers: 59.5, wb: 8.5, d: 36, shoe: true }, end: 0.6,
  rows: [{ xs: [4.5, 9.6, 23.7, 29.0, 34.3, 39.6, 44.9, 50.2, 55.5, 60.8, 71.0, 76.3], y: 7.15, w: 3.5, h: 2.45, r: 0.35 }],
  doors: [{ x: 16.9, w: 4.2, y0: 4.2, y1: 11.15, glassY: 0.48, glassH: 0.38 }, { x: 63.9, w: 4.2, y0: 4.2, y1: 11.15, glassY: 0.48, glassH: 0.38 }],
  roofItems: [[3.5, 9, 0.5]], diaphragm: [4.25, 11.5], cabLen: 4,
  paint: (c, g) => {
    const L = g.L;
    return rect(0, 0, L, 17, "#b4b9bf") + rect(0, 12.0, L, 2, "#9aa0a7") + rect(0, 0, L, 4.25, "#2a2d31") +
      path(`M0 5.0L${L} 5.0L${L} 5.9L0 5.9Z`, "#c8102e") + path("M0 5.0L22 5.0Q30 5.45 34 5.9L0 5.9Z", "#1d1f22");
  },
  cab: emuEnd([[4.3, 8.5, "#c8102e"], [7.0, 3.2, "#1d1f22"]]),
  extra: (c, g) => (c.mate || c.single ? pantograph(g.L - 10, 13.0, { up: true, facing: -1 }) + rect(g.L - 16, 12.95, 4, 0.5, C.steelDark, 0.4) : ""),
}));

// --- Kawasaki M9 (LIRR 9001-9202): the M7's successor, same size; two
// sliding doors a side; blue and yellow cab ends; a blue stripe under the
// windows.
export const m9 = married((c) => bilevel(c, { ...M7,
  paint: (c, g) => m7Paint("#1c3f94")(c, g) + rect(0, 6.6, g.L, 0.3, "#1c3f94"),
  cab: emuEnd([[8.6, 3.8, "#1c3f94"], [5.9, 2.5, LIRR.yellow], [4.3, 1.6, "#1c3f94"]]) }));

// --- Budd M3 (LIRR and Metro-North, 1984-86): 85 ft, fluted stainless below
// the windows, two sets of bi-parting doors at the quarter points.
export const m3 = married((c) => bilevel(c, {
  badge: [{ x: 15.5, y: 8.4, h: 1.1 }, { x: 70.2, y: 8.4, h: 1.1 }],  // beside each door
  roof: 12.6, sill: 3.55, cornerR: 1.1, trucks: { centers: 59.5, wb: 8.5, d: 36, shoe: true }, end: 0.6,
  rows: [{ xs: [5.0, 9.6, 25.6, 30.4, 35.2, 40.0, 44.8, 49.6, 54.4, 59.2, 71.6, 76.4], y: 7.2, w: 3.3, h: 2.4, r: 0.4 }],
  doors: [{ x: 18.2, w: 4.6, y0: 4.2, y1: 11.0, leaves: 2, glassY: 0.48, glassH: 0.38 }, { x: 64.2, w: 4.6, y0: 4.2, y1: 11.0, leaves: 2, glassY: 0.48, glassH: 0.38 }],
  roofItems: [[6, 12, 0.45]], diaphragm: [4.25, 11.2], cabLen: 4,
  paint: (c, g) => rect(0, 0, g.L, 17, "#d0d4d9") + flutes(0, g.L, 4.4, 6.9, 0.27) + rect(0, 11.6, g.L, 2, C.steelShade) + rect(0, 0, g.L, 4.25, "#2a2d31") + rect(0, 9.9, g.L, 0.25, c.agency === "mnr" ? "#1f4fa3" : "#3d8fe0"),
  cab: emuEnd([[4.3, 8.4, "#2a2d31"]]),
}));

// --- GE Silverliner IV (SEPTA, 1974-76): 85 ft, trucks 59 ft 6 in apart,
// fluted stainless above and below the window band. Single doors right at
// each end with trap steps; a blanked-off plug where center doors were
// planned; small windows in a blue-over-red band. A long resistor-grid
// hump on the roof; the even car of a pair carries the pantograph on a
// lowered stretch at its inner end. Flat ends with black air scoops at the
// top corners.
export const silverliner4 = married((c) => bilevel(c, {
  roof: 13.5, sill: 3.6, cornerR: 0.8, trucks: { centers: 59.5, wb: 8.5, d: 36 }, end: 0.6,
  rows: [{ xs: [6.8, 12.8, 18.8, 24.8, 30.8, 41.0, 51.2, 57.2, 63.2, 69.2, 75.2], y: 7.4, w: 3.0, h: 2.3, r: 0.3 }],
  doors: [{ x: 1.3, w: 2.6, y0: 4.0, y1: 11.1, glassY: 0.55, glassH: 0.3 }, { x: 81.1, w: 2.6, y0: 4.0, y1: 11.1, glassY: 0.55, glassH: 0.3 }],
  diaphragm: [4.25, 11.8], cabLen: 4,
  badge: [{ x: 5.4, y: 8.6, h: 1.0, dark: true }, { x: c.L - 5.4, y: 8.6, h: 1.0, dark: true }],
  paint: (c, g) => {
    const L = g.L;
    let s = rect(0, 0, L, 17, "#d0d4d9") + flutes(0, L, 4.0, 7.0, 0.27) + flutes(0, L, 10.2, 12.4, 0.27) + rect(0, 12.4, L, 2, C.steelShade);
    s += rect(4.3, 8.65, L - 8.6, 1.45, "#1f4fa3") + rect(4.3, 7.2, L - 8.6, 1.45, "#e0352b") + rect(0, 0, L, 4.0, "#2a2d31");
    s += lines([[39.6, 4.0, 39.6, 12.4], [45.4, 4.0, 45.4, 12.4]], "rgba(0,0,0,0.3)", 0.5);
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
// high-level doors, a blue band with a red-orange pinstripe under the windows.
export const silverliner5 = married((c) => {
  const rtd = c.agency === "rtd";
  const doors = rtd
    ? [{ x: 18.4, w: 4.6, y0: 4.2, y1: 11.0, leaves: 2, glassY: 0.45, glassH: 0.4 }, { x: 62.1, w: 4.6, y0: 4.2, y1: 11.0, leaves: 2, glassY: 0.45, glassH: 0.4 }]
    : [{ x: 18.4, w: 4.6, y0: 4.0, y1: 11.0, leaves: 2, glassY: 0.45, glassH: 0.4 }, { x: 63.0, w: 2.7, y0: 4.0, y1: 11.0, glassY: 0.45, glassH: 0.4 }];
  const xs = rtd ? [5.0, 10.2, 24.4, 29.7, 35.0, 40.3, 45.6, 50.9, 56.2, 68.4, 73.7, 79.0] : [4.8, 9.6, 14.0, 24.4, 29.8, 35.2, 40.6, 46.0, 51.4, 56.8, 67.4, 72.3, 77.2];
  return bilevel(c, {
    roof: 12.6, sill: 3.6, cornerR: 1.3, trucks: { centers: 59.5, wb: 8.5, d: 36 }, end: 0.6,
    rows: [{ xs, y: 7.25, w: rtd ? 4.1 : 3.6, h: 2.5, r: 0.45 }], doors, diaphragm: [4.25, 11.3], cabLen: 4,
    // SEPTA: the wordmark low on the side behind the first doors. RTD: a
    // small "RTD" in the stripe at the cab end.
    badge: rtd ? { x: 2.6, y: 6.4, h: 0.6 } : { x: 30, y: 5.0, h: 1.2, logo: "septa-word" },
    paint: (c, g) => {
      const L = g.L;
      let s = rect(0, 0, L, 17, "#d3d7dc") + rect(0, 11.7, L, 2, C.steelShade) + rect(0, 0, L, 4.0, "#2a2d31");
      if (rtd) return s + rect(0, 6.2, L, 0.85, "#1f3f8f") + rect(0, 5.95, L, 0.18, "#e8562a");
      const sweep = (x, k) => `M${x} 5.3L${x + k * 12} 5.3Q${x + k * 16.5} 5.4 ${x + k * 18} 10.0L${x + k * 18.5} 10.25L${x + k * 18.5} 10.55Q${x + k * 15.5} 7.4 ${x + k * 11} 7.1L${x} 7.1Z`;
      s += path(sweep(0, 1), "#e0352b") + path(sweep(L, -1), "#e0352b");
      s += rect(0, 9.95, L, 0.32, "#1f4fa3") + rect(0, 10.3, L, 0.22, "#e0352b");
      s += path("M0 6.3L12 6.3Q15.6 6.5 17.6 9.95L16.6 9.95Q14.6 7.0 11 7.0L0 7.0Z", "#1f4fa3") + path(`M${L} 6.3L${L - 12} 6.3Q${L - 15.6} 6.5 ${L - 17.6} 9.95L${L - 16.6} 9.95Q${L - 14.6} 7.0 ${L - 11} 7.0L${L} 7.0Z`, "#1f4fa3");
      return s;
    },
    cab: emuEnd(rtd ? [[4.2, 8.0, "#c9cdd2"]] : [[5.3, 1.8, "#e0352b"], [7.1, 1.0, "#1f4fa3"]]),
    extra: (c, g) => {
      const L = g.L;
      let s = path(`M8.5 12.55L9.8 13.5L42 13.5L42.6 12.55Z`, "#9aa1a9", 0.4) + slats(30, 12.6, 11, 0.85, 0.5, "rgba(0,0,0,0.3)");
      if (c.mate || c.single) s += pantograph(L - 9.5, 12.6, { up: true, facing: -1 });
      return s;
    },
  });
});

// --- Stadler KISS (Caltrain, 2022-24): seven-car sets, 598 ft 11 in over
// couplers, 9 ft 10 in wide, 15 ft 10.6 in tall. Each car: an upper and lower
// deck between the trucks, an intermediate level over each truck. Four
// double doors a side: low ones at each end of the double deck (in use) and
// high ones in the end sections (for future high platforms). White with a
// red band along the roof edge, a red line at lower-window sill height and a
// gray skirt; the cab cars' tall raked noses sweep red down the front.
const KISS = {
  roof: 15.88, sill: 3.7, cornerR: 0.9, ends: { h: 15.2, len: 12.6, ramp: 1.4 }, trucks: { centers: 61.6, wb: 8.2, d: 36 },
  diaphragm: [4.25, 13.8],
};
function kissPaint(c, g) {
  const L = g.L;
  return rect(0, 0, L, 17, "#f1f2f4") + rect(0, 14.15, L, 3, "#c8102e") + rect(0, 4.2, L, 0.22, "#c8102e") + rect(0, 0, L, 3.9, "#6b7178");
}
const kissRows = (a, b) => [{ xs: seq(a, 3.9, Math.floor((b - a) / 3.9)), y: 11.2, w: 3.2, h: 2.3, r: 0.4 }, { xs: seq(a, 3.9, Math.floor((b - a) / 3.9)), y: 5.0, w: 3.2, h: 2.3, r: 0.4 }];
const kissDoors = (L, x0, x1) => [
  { x: x0 + 4.4, w: 4.3, y0: 4.25, y1: 11.0, leaves: 2, glassY: 0.4, glassH: 0.45 }, { x: x0 + 9.4, w: 4.3, y0: 1.4, y1: 8.2, leaves: 2, glassY: 0.4, glassH: 0.45 },
  { x: x1 - 13.7, w: 4.3, y0: 1.4, y1: 8.2, leaves: 2, glassY: 0.4, glassH: 0.45 }, { x: x1 - 8.7, w: 4.3, y0: 4.25, y1: 11.0, leaves: 2, glassY: 0.4, glassH: 0.45 }];
export const kiss = (c) => bilevel({ ...c, cabL: false, cabR: false }, { ...KISS, paint: kissPaint, drop: { a: 13.6, b: c.L - 13.6, y: 1.3 },
  rows: kissRows(15.0, c.L - 15.0), doors: kissDoors(c.L, 0.6, c.L - 0.6), badge: { x: 17.1, y: 9.0, h: 2.3 },
  extra: (c, g) => (c.pan ? pantograph(g.L - 6.5, 15.2, { up: true, facing: -1 }) : "") });
export const kissCab = (c) => {
  const L = c.L;
  return bilevel({ ...c, cabL: true }, { ...KISS, paint: (c, g) => kissPaint(c, g) +
      path("M0 3.9L0 16L13 16L13 14.15Q9.5 8.5 3.0 6.3L3.0 3.9Z", "#c8102e"),
    drop: { a: 19.0, b: L - 13.6, y: 1.3 },
    nose: [[0.8, 3.7], [0.8, 6.0], ["q", 1.0, 7.8, 2.0, 9.6], [5.6, 15.4], ["q", 6.0, 15.88, 7.0, 15.88]],
    rows: kissRows(20.6, L - 15.0), doors: kissDoors(L, 6.0, L - 0.6), cabLen: 6, badge: { x: 28.5, y: 9.0, h: 2.3 },
    cab: (c) => {
      let s = path(poly([[2.15, 9.9], [5.3, 15.0], [6.6, 15.0], [6.6, 10.6], [3.2, 9.9]]), C.glass) + win(7.2, 11.3, 2.4, 2.1, 0.3);
      return s;
    } });
};

// --- Nippon Sharyo DMU (SMART, 101-118): 85 ft, 14 ft 7 in, 10 ft 5 in wide;
// one Cummins engine under each car. Two-car A+B sets coupled gangway to
// gangway, a raked gangwayless cab nose at each outer end. Two doors a side
// near the car ends, a long black window band between them with a thin gold
// stripe below; silver sides, a green roof wrapping over the cab.
export const smartDmu = married((c) => bilevel(c, {
  badge: false,                                                       // SMART's logo is on the fronts only
  roof: 14.58, sill: 3.9, cornerR: 1.2, trucks: { centers: 58, wb: 8.5, d: 36 }, end: 0.6,
  nose: [[1.0, 3.9], [1.0, 6.4], ["q", 1.1, 7.6, 1.8, 8.6], [4.6, 13.4], ["q", 5.3, 14.58, 6.8, 14.58]],
  rows: [{ xs: [8.2, 21.8, 26.9, 32.0, 37.1, 42.2, 47.3, 52.4, 57.5, 62.6, 67.7], y: 7.3, w: 4.2, h: 3.0, r: 0.35 }],
  doors: [{ x: 15.0, w: 4.4, y0: 4.25, y1: 11.3, leaves: 2, glassY: 0.4, glassH: 0.45 }, { x: 74.0, w: 4.4, y0: 4.25, y1: 11.3, leaves: 2, glassY: 0.4, glassH: 0.45 }],
  roofItems: [[16, 7, 0.55], [32, 7, 0.55], [50, 7, 0.55], [75, 8, 0.6]], diaphragm: [4.25, 12.4], cabLen: 7,
  paint: (c, g) => {
    const L = g.L;
    return rect(0, 0, L, 17, "#d3d7dc") + rect(0, 13.5, L, 3, "#2e6b3f") + rect(0, 12.4, L, 1.1, "#c9cdd2") +
      rect(0, 7.0, L, 3.6, "#17191c") + rect(0, 6.75, L, 0.18, "#c9a227") + rect(0, 4.4, L, 0.3, "#2e6b3f") +
      path("M0 7.0L0 16L7.5 16Q6.0 13.0 4.2 10.6L4.2 7.0Z", "#2e6b3f");
  },
  cab: (c) => {
    let s = path(poly([[1.9, 8.9], [4.4, 12.9], [5.6, 12.9], [5.6, 8.9]]), C.glass);
    return s;
  },
}));

// --- Stadler GTW 2/6 (CapMetro 101-106, 201-204): 134 ft 2 in over
// couplers: two low-floor passenger sections hung from a short power module
// in the middle that holds two Cummins engines. Each section has one truck
// at its cab end and rests on the module at the other. Fiberglass cab
// fronts; wide low-floor doors.
export const gtwCar = (c) => bilevel({ ...c, cabL: true }, {
  roof: 12.8, sill: 2.4, cornerR: 1.0, end: 0.6, noTrucks: true,
  nose: [[1.0, 2.4], [1.0, 5.6], ["q", 1.1, 6.8, 1.8, 7.8], [3.6, 11.9], ["q", 4.2, 12.8, 5.6, 12.8]],
  rows: [{ xs: [7.6, 17.8, 22.4, 27.0, 36.8, 41.4, 46.0, 50.6], y: 5.6, w: 3.8, h: 3.6, r: 0.4 }],
  doors: [{ x: 12.6, w: 4.3, y0: 2.1, y1: 9.6, leaves: 2, glassY: 0.35, glassH: 0.5 }, { x: 31.4, w: 4.3, y0: 2.1, y1: 9.6, leaves: 2, glassY: 0.35, glassH: 0.5 }],
  roofItems: [[20, 8, 0.6]], diaphragm: [2.6, 11.2], cabLen: 6, badge: { x: 9.5, y: 4.0, h: 0.9 },
  paint: (c, g) => rect(0, 0, g.L, 17, "#f1f2f4") + rect(0, 0, g.L, 2.9, "#1d3f8f") + rect(0, 2.9, g.L, 0.4, "#c8102e") + rect(0, 11.6, g.L, 2, "#1d3f8f"),
  cab: (c) => {
    let s = path(poly([[1.7, 7.9], [3.4, 11.2], [4.5, 11.2], [4.5, 7.9]]), C.glass);
    return s;
  },
  extra: () => truck(9.2, { wb: 6.9, d: 30, top: 2.4 }),
});
// --- Stadler FLIRT DMU (Metrolink's Arrow, San Bernardino-Redlands): two
// passenger sections, about 71 ft, either side of a power module, sharing its
// trucks at the inner ends. Low floor, big windows, a long sloped cab.
// Arrow: white, a blue nose and roof band, a green stripe low on the side.
const ARROW = { white: "#f4f5f6", blue: "#1f5fbf", green: "#3aa858" };
export const flirtCar = (c) => bilevel({ ...c, cabL: true }, {
  roof: 13.4, sill: 3.0, cornerR: 1.0, end: 0.6, noTrucks: true,
  nose: [[1.0, 3.0], [1.0, 5.8], ["q", 1.1, 7.0, 2.0, 8.0], [5.2, 12.4], ["q", 6.0, 13.4, 7.6, 13.4]],
  rows: [{ xs: [16.4, 21.6, 26.8, 32.0, 37.2, 53.0, 58.2, 63.4], y: 6.2, w: 4.4, h: 3.4, r: 0.45 }],
  doors: [{ x: 10.8, w: 4.4, y0: 2.8, y1: 10.2, leaves: 2, glassY: 0.4, glassH: 0.45 }, { x: 44.6, w: 4.4, y0: 2.8, y1: 10.2, leaves: 2, glassY: 0.4, glassH: 0.45 }],
  roofItems: [[20, 10, 0.5]], diaphragm: [3.2, 11.8], cabLen: 9, badge: false,
  paint: (c, g) => rect(0, 0, g.L, 17, ARROW.white) + rect(0, 3.3, g.L, 0.4, ARROW.green) + rect(0, 12.5, g.L, 3, ARROW.blue) +
    path(poly([[0, 7.0], [2.2, 7.0], [7.8, 12.5], [0, 12.5]]), ARROW.blue),
  cab: () => path(poly([[1.9, 8.1], [5.0, 12.1], [7.6, 12.1], [7.6, 8.1]]), C.glass) + win(8.2, 8.6, 1.8, 2.4, 0.25),
  extra: () => truck(9.5, { wb: 8.2, d: 33, top: 3.0 }),
});
export function flirtPower(c) {
  const { L } = c, roof = 13.4, sill = 3.4;
  const d = poly([[0.4, sill], [L - 0.4, sill], [L - 0.4, roof - 0.6], ["q", L - 0.4, roof, L - 1.0, roof], [1.0, roof], ["q", 0.4, roof, 0.4, roof - 0.6]]);
  let s = truck(L / 2, { wb: 8.2, d: 33, kind: "loco", top: sill });
  const liv = rect(0, 0, L, 15, ARROW.white) + rect(0, 3.7, L, 0.4, ARROW.green) + rect(0, 12.5, L, 3, ARROW.blue);
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
  let liv = rect(0, 0, L, 15, "#d3d7dc") + rect(0, 0, L, 4.0, "#1d3f8f") + rect(0, 4.0, L, 0.35, "#c8102e") + rect(0, 11.8, L, 2, "#1d3f8f");
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
// under raised roof covers at both ends. Cab cars carry a Charger-like nose.
// Brightline: each coach one bright color, a yellow diagonal band across it
// with white edges, dark gray through the windows. Midwest: silver, a navy
// window band at the door end breaking up into a halftone of dots, a wide red
// band low on the side. San Joaquins (Caltrans): silver, a blue window band,
// a low band of blues and purple with yellow ends, yellow doors. VIA: gray,
// black window band under a yellow one. Cascades (Airo): evergreen, mocha
// through the windows over a cream band, brown and white sill stripes.
const BRIGHT = ["#00a651", "#e31b23", "#00a3e0", "#f58220", "#ec008c"]; // green, red, blue, orange, pink
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
      // White; the coach's color in a band above the windows, a yellow slash
      // across the middle, a dark gray window band over a thin yellow line.
      const col = BRIGHT[(c.index ?? 0) % BRIGHT.length];
      s += rect(0, 0, L, 17, "#eef0f2") + rect(0, 10.4, L, 2.4, col);
      s += path(`M${L * 0.44} 10.4L${L * 0.5} 10.4L${L * 0.54} 12.8L${L * 0.48} 12.8Z`, "#ffd100");
      s += rect(0, 6.75, L, 0.2, "#ffd100");
      s += rect(0, 6.95, L, 3.45, "#3a3d41");
      return s;
    }
    case "via":
      // VIA's Venture: light gray; a thin yellow line under a charcoal window
      // band; a yellow band above it to the roof.
      return s + rect(0, 6.55, L, 0.2, "#f5c400") + rect(0, 6.8, L, 3.5, "#2b2e32") + rect(0, 10.3, L, 2.4, "#f5c400");
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
// Logos: Cascades on the cream by the door; San Joaquins: its name high in
// the middle, Caltrans' mark under the windows by a door; Midwest: "Amtrak
// Midwest" high at the far end from the door.
const ventureBadge = (c) => (c.route === "Amtrak Cascades" ? { x: c.L - 8.6, y: 6.35, h: 1.1, logo: "cascades-dark" }
  : c.route === "San Joaquins" ? [{ x: 42.5, y: 11.3, h: 1.1, logo: "san-joaquins" }, { x: 13.4, y: 6.6, h: 0.75, logo: "caltrans" }]
  : c.agency === "amtrak" ? { x: 20, y: 11.6, h: 1.25, logo: "amtrak-midwest" }
  : { via: { x: 24, y: 11.5, h: 0.75, logo: "via-rail-canada" }, brightline: { x: 6.5, y: 5.2, h: 0.8 } }[c.agency]);
export const venture = (c) => bilevel(c, { ...VENTURE, paint: venturePaint, badge: ventureBadge,
  doors: c.agency === "brightline" || c.agency === "via" || c.route === "San Joaquins" ? [ventureDoor(1.2), ventureDoor(80.9)] : [ventureDoor(80.9)] });
// The Venture cab car (VIA's corridor trains, Amtrak Cascades' Airo, Amtrak
// Midwest, San Joaquins): a Charger-like cab, an upright nose under a steeply
// raked wraparound windshield, a cab side window behind it, a long blank cab
// section over the front truck, then the door and seven windows; the coupler
// and pilot exposed. A cap in the railroad's color edges the windshield and
// runs back along the roof (VIA yellow, Cascades tan).
const VENTURE_NOSE = [[2.2, 3.9], [1.55, 4.9], [1.75, 6.0], [2.15, 9.1], [2.65, 9.35], [5.0, 13.0], ["q", 5.6, 14.0, 7.4, 14.0]];
const CAP = { via: "#f5c400", "Amtrak Cascades": "#b08a5a" };
function ventureCabPaint(c, g) {
  const L = g.L;
  let s = venturePaint(c, g);
  if (c.agency === "via") {
    // The charcoal window band dips to the sill behind the cab.
    s += path(poly([[13.0, 10.3], [L, 10.3], [L, 6.8], [30, 6.8], [25, 3.9], [18, 3.9]]), "#2b2e32");
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
export const ventureCab = (c) => bilevel({ ...c, cabL: true }, { ...VENTURE, paint: ventureCabPaint, cabLen: 0,
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
// VIA's logo goes on as a decal in the window band, past the last window.
const BUDD = { roof: 13.56, sill: 3.9, cornerR: 1.1, trucks: { centers: 59.5, wb: 8.5, d: 36 }, end: 0.6, diaphragm: [4.25, 12.3],
  badge: { x: 79.4, y: 8.5, h: 1.4 } };
function buddPaint(c, g) {
  const L = g.L;
  return rect(0, 0, L, 17, "#d5d9de") + flutes(0, L, 4.1, 6.6, 0.26) + rect(0, 11.9, L, 2, "#c3c9d0") + flutes(0, L, 12.0, 13.4, 0.3) +
    line(0, 10.55, L, 10.55, "rgba(0,0,0,0.18)", 0.5) + line(0, 6.65, L, 6.65, "rgba(0,0,0,0.18)", 0.5);
}
const buddDoor = (x) => ({ x, w: 2.6, y0: 4.0, y1: 11.0, glassY: 0.55, glassH: 0.3 });
export const buddCoach = (c) => bilevel(c, { ...BUDD, paint: buddPaint, doors: [buddDoor(1.3), buddDoor(81.1)],
  rows: [{ xs: seq(7.0, 5.12, 14), y: 7.15, w: 4.2, h: 2.75, r: 0.35 }] });
// Manor sleeper: big section windows (with small upper-berth windows above)
// at one end, bedroom windows in the middle, smaller roomette windows at the
// other end; one vestibule.
export const buddSleeper = (c) => bilevel(c, { ...BUDD, paint: buddPaint, doors: [buddDoor(1.3)],
  rows: [{ xs: [6.4, 11.2, 16.0], y: 7.15, w: 4.0, h: 2.75, r: 0.35 }, { xs: [7.4, 12.2, 17.0], y: 10.1, w: 2.0, h: 0.6, r: 0.15 },
    { xs: [22.4, 27.0, 31.6, 36.2, 40.8, 45.4], y: 7.4, w: 3.2, h: 2.4, r: 0.3 }, { xs: seq(52.4, 3.95, 8), y: 7.6, w: 2.4, h: 2.1, r: 0.3 }] });
// Dining car: a run of dining-room windows, a kitchen end with a few small ones.
export const buddDiner = (c) => bilevel(c, { ...BUDD, paint: buddPaint, doors: [buddDoor(81.1)],
  rows: [{ xs: seq(4.4, 5.0, 10), y: 7.15, w: 4.2, h: 2.75, r: 0.35 }, { xs: [57.5, 64.2, 71.0], y: 8.6, w: 1.6, h: 1.4, r: 0.2 }] });
// Baggage car: fluted the full height, two wide doors a side, no windows.
export const buddBaggage = (c) => bilevel(c, { ...BUDD,
  paint: (c, g) => rect(0, 0, g.L, 17, "#d5d9de") + flutes(0, g.L, 4.1, 11.6, 0.26) + flutes(0, g.L, 12.0, 13.4, 0.3),
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
export const skyline = (c) => bilevel(c, { ...BUDD, paint: buddPaint, doors: [buddDoor(1.3), buddDoor(81.1)],
  rows: [{ xs: [6.6, 11.6, 16.6, 22.0, 27.0, 56.8, 61.8, 66.8, 71.8, 76.4], y: 7.15, w: 4.0, h: 2.75, r: 0.35 }, { xs: [33.4, 39.4, 45.4, 51.0], y: 7.6, w: 2.4, h: 1.8, r: 0.3 }],
  extra: () => dome(30.5, 60.5, 13.56, 15.83) });
// Park car: sleeping rooms up front, a lounge under a dome, and a round
// "bullet" observation end with wraparound windows and a tail sign. Drawn
// with the round end on the left; mirrored when it runs last, as it does.
export const parkCar = (c) => {
  const L = c.L, roof = 13.56, sill = 3.9;
  return bilevel({ ...c, cabL: true }, { ...BUDD, paint: buddPaint, doors: [buddDoor(81.1)], cabLen: 0,
    nose: [[5.0, sill], ["q", 0.6, sill, 0.6, 8.6], ["q", 0.6, roof, 6.0, roof]],
    rows: [{ xs: [6.4, 10.8, 15.2], y: 7.15, w: 3.8, h: 2.75, r: 0.35 }, { xs: [21.0, 25.4], y: 7.15, w: 3.6, h: 2.75, r: 0.35 }, { xs: seq(52.0, 5.0, 5), y: 7.4, w: 3.2, h: 2.4, r: 0.3 }],
    cab: () => path("M1.2 7.1Q1.2 6.95 1.6 6.95L5.6 6.95L5.6 10.0L1.6 10.0Q1.2 10.0 1.2 9.8Z", C.glass) + rect(1.0, 10.6, 1.0, 1.0, "#c8102e", 0, 'rx="0.2"'),
    extra: () => dome(26.0, 50.0, roof, 15.83) });
};
// Budd RDC (VIA's Sudbury-White River cars): 85 ft, 14 ft 7 in over the roof
// equipment, fluted stainless, a diesel engine under each end driving the
// inner axle of its truck; roof radiators and exhausts. VIA removed one cab
// from each car (the end is plated over) and added a yellow sill stripe.
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
// plug doors at each end. VIA (the Ocean): navy, a teal window band over a
// thin yellow line.
const REN = { navy: "#1e3466", teal: "#3fa9b5", yellow: "#f5c400" };
function renaissance(c, { rows }) {
  return coachCar(c, {
    roof: 12.6, sill: 3.8, endR: 1.4, eave: 11.7, end: 0.5,
    base: REN.navy, roofBand: "#2c3f6e",
    stripes: [[6.6, 3.1, REN.teal], [6.3, 0.25, REN.yellow]],
    rows, doors: [{ x: 1.1, w: 2.3, h: 7.0 }, { x: c.L - 3.4, w: 2.3, h: 7.0 }],
    trucks: { centers: 52, wb: 8.4, d: 33 }, diaphragm: [4.25, 11.2],
    badge: { x: 7.6, y: 10.8, h: 1.0, dark: true },
  });
}
export const renaissanceCoach = (c) => renaissance(c, { rows: [{ a: 5, b: c.L - 5, y: 7.0, w: 3.0, h: 2.4, pitch: 3.7, r: 0.35 }] });
export const renaissanceSleeper = (c) => renaissance(c, { rows: [{ a: 5, b: c.L - 5, y: 7.4, w: 1.8, h: 1.8, pitch: 3.2, r: 0.3 }] });
export const renaissanceDiner = (c) => renaissance(c, { rows: [{ a: 5, b: c.L - 5, y: 6.9, w: 4.4, h: 2.6, pitch: 5.4, r: 0.4 }] });

// ===================== Acela =====================
// Alstom Avelia Liberty (Amtrak 2100-2155 power cars): a power car at each
// end of nine articulated coaches, 698 ft in all. The power car: a short
// rounded nose under a raked windshield, white with a blue roof that fades in
// a halftone toward the coaches, red on the sill and the pantograph.
// Coaches: blue above and below a white window band, sharing a truck at each
// joint (Jakobs articulation): each coach draws half of the shared truck at
// either end and its neighbor draws the other half.
export function acelaPower(c) {
  const { L } = c, sill = 4.4, roof = 14.17;
  const d = poly([[3.6, sill], [L - 0.6, sill], [L - 0.6, roof - 0.6], ["q", L - 0.6, roof, L - 1.2, roof], [11.5, roof],
    ["q", 8.6, roof, 6.6, 12.4], [3.4, 9.6], ["q", 1.2, 8.0, 0.9, 6.3], ["q", 0.9, 4.5, 3.6, sill]]);
  // The nose's white skirt sweeps down over the coupler almost to the rail.
  let s = path(poly([[3.6, sill + 0.1], ["q", 1.3, 4.1, 1.2, 2.2], ["q", 1.2, 1.0, 2.4, 1.0], [7.0, 1.0], [7.0, sill + 0.1]]), "#e9ecef", 0.6);
  for (const x of [L / 2 - 17.6 + 6, L / 2 + 17.6 - 6]) s += truck(x, { wb: 9.33, d: 40, kind: "loco", top: sill });
  // The halftone: rows of dots growing toward the rear until they merge into solid blue.
  let liv = rect(0, 0, L, 16, "#f1f2f4") + rect(0, 12.3, L, 4, "#2f5fa6") + path(`M0 16L0 12.3L6.6 12.3L11.5 16Z`, "#2f5fa6");
  let dots = "";
  for (let x = L - 24; x < L - 8; x += 0.9) for (let y = 5.4; y < 12.3; y += 0.9) {
    const r = Math.min(0.5, 0.06 + ((x - (L - 24)) / 16) * 0.46);
    dots += `M${(x - r).toFixed(2)} ${y.toFixed(2)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0`;
  }
  liv += path(dots, "#2f5fa6") + rect(L - 8.3, 5.0, 8.3, 7.3, "#2f5fa6") + rect(0, 4.4, L, 0.6, "#c8102e");
  liv += path(poly([[3.1, 9.3], [6.4, 12.2], [8.9, 12.2], [8.9, 10.2], [5.0, 9.0]]), "#17191c");
  s += path(d, "#f1f2f4") + clipped(d, liv);
  s += door(10.6, sill + 0.3, 2.1, 7.3, { glassY: 0.62, glassH: 0.25 }) + win(13.8, 9.6, 1.4, 1.8, 0.3);
  s += rect(20, roof - 0.05, 22, 0.55, "#9aa1a9", 0.4) + slats(20, roof - 0.05, 22, 0.55, 0.45, "rgba(0,0,0,0.3)");
  s += pantograph(L - 15, roof + 0.4, { up: true, facing: -1 }).replace(/currentColor/g, "#c8102e");
  s += outlineOf(d) + carEnds(c, { floor: sill, top: 12.8 });
  s += badge(c, 22, 8.8, 3.8, { logo: "acela" });                    // the Acela logo, behind the cab door
  return s;
}
export function acelaCoach(c) {
  const { L } = c, sill = 4.0, roof = 14.0, x0 = 0.3, x1 = L - 0.3;
  const d = bodyOutline(x0, x1, sill, roof, { endR: 1.2 });
  let s = "";
  // Shared trucks at the joints; the coaches next to the power cars have their own truck at that end.
  const first = c.index === 1, last = c.count != null && c.index === c.count - 2;
  s += first ? truck(6.0, { wb: 9.0, d: 36, kind: "car", top: sill }) : truck(0, { wb: 9.0, d: 36, kind: "car", top: sill });
  s += last ? truck(L - 6.0, { wb: 9.0, d: 36, kind: "car", top: sill }) : truck(L, { wb: 9.0, d: 36, kind: "car", top: sill });
  let liv = rect(0, 0, L, 16, "#2f5fa6") + rect(0, 6.8, L, 3.3, "#f4f5f7") + rect(0, 4.0, L, 0.45, "#c8102e");
  s += path(d, "#2f5fa6") + clipped(d, liv);
  for (let x = 6.2; x < L - 8; x += 3.6) s += win(x, 7.15, 2.9, 2.6, 0.3);
  s += door(1.4, 4.2, 2.7, 7.0, { glassY: 0.55, glassH: 0.3, grabs: false });
  s += badge(c, 5.2, 12.4, 0.8, { logo: "amtrak-mark", dark: true });  // small travelmark high at the end
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
// tall, solid aluminum sides on a bi-level rack, end doors; Phase V gray
// with a red stripe.
export function autorack(c) {
  const { L } = c, sill = 3.6, roof = 19.9, x0 = 0.6, x1 = L - 0.6;
  const d = poly([[x0, sill], [x1, sill], [x1, roof - 0.5], ["q", x1, roof, x1 - 0.6, roof], [x0 + 0.6, roof], ["q", x0, roof, x0, roof - 0.5]]);
  let s = truck(L / 2 - 32.5, { wb: 5.8, d: 36, kind: "car", top: sill }) + truck(L / 2 + 32.5, { wb: 5.8, d: 36, kind: "car", top: sill });
  let liv = rect(0, 0, L, 21, "#c3c8ce") + rect(0, 5.0, L, 0.45, AMTRAK.red);
  const segs = [];
  for (let x = 3.2; x < L - 2; x += 2.6) segs.push([x, sill + 0.3, x, roof - 0.4]);
  liv += lines(segs, "rgba(0,0,0,0.12)", 0.5) + line(0, 11.6, L, 11.6, "rgba(0,0,0,0.25)", 0.8);
  s += path(d, "#c3c8ce") + clipped(d, liv) + outlineOf(d);
  s += badge(c, L / 2, 15.0, 2.6);                                   // high on the side
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

// --- MBTA: purple, black, silver and yellow. The cab is purple above a
// yellow line, black below. Behind it a yellow-edged diagonal opens onto
// silver with a purple band along the bottom, a white "T" disc, and a
// gray roof. sweep: [x at the roof, x at the band]; cabEnd: where the black
// under the cab ends; tail: x where the band steps up at the rear.
function mbtaPaint(c, { L, roof, cabEnd, sweep, band = 7.5, sill = 5.55, tail = null, tailY = 10.6, T = null }) {
  const { purple, yellow, black } = MBTA;
  let s = rect(0, 0, L, roof + 1, MBTA.silver) + rect(0, roof - 0.55, L, 1, MBTA.roof);
  s += rect(0, 0, L, sill, black) + tape(0, L, sill - 0.55);
  s += rect(cabEnd, sill, L - cabEnd, 0.14, yellow) + rect(cabEnd, sill + 0.14, L - cabEnd, band - sill - 0.14, purple);
  s += rect(0, 0, cabEnd, band, black);
  s += path(poly([[0, band], [sweep[1], band], [sweep[0], roof - 0.55], [0, roof - 0.55]]), purple);
  s += line(sweep[1], band + 0.05, sweep[0], roof - 0.6, yellow, 1.1);
  if (tail != null) {
    s += path(poly([[tail, band], [tail + 1.0, tailY], [L, tailY], [L, band]]), purple);
    s += lines([[tail, band + 0.05, tail + 1.0, tailY], [tail + 1.0, tailY, L, tailY]], yellow, 1.1);
  }
  s += rect(0, band, L, 0.15, yellow);
  if (T != null) s += tDisc(T, (band + roof) / 2 - 0.2, Math.min(2.5, (roof - band) / 2 - 0.9));
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
  sideWin: [[4.6, 10.7, 2.3, 2.5], [7.0, 10.7, 1.5, 2.5]],
  doors: [[9.6, 2.0, 5.0, 13.4]],
  grilles: [[4.9, 5.0, 3.4, 2.1, 0.3], [15.0, 13.55, 3.6, 1.05, 0.35], [57.5, 8.2, 1.15, 4.6, 0.25], [59.3, 8.2, 1.15, 4.6, 0.25], [64.4, 8.2, 1.15, 4.6, 0.25]],
  panels: [[19.0, 8.0, 3.2, 5.0]],
  tank: [23, 48, 1.5], reservoir: [33.5, 46],
  trucks: { centers: 45, wb: 9.33, d: 40 },
  roofItems: [[46, 1.6, 0.45], [53, 15, 0.3]], fans: [56, 61, 66], horn: 4.2,
  paint: (c, sp) => c.agency === "mbta" || !c.agency
    ? mbtaPaint(c, { L: sp.L, roof: sp.roof, cabEnd: 12.0, sweep: [15.2, 23.6], tail: sp.L - 8.4, T: 28.5 })
      + vee(sp.L - 10.7, 8.2, 1.9, 4.6)
    : genericPaint(c, sp),
});
// The HSP46's V-shaped intake between its upright rear intakes.
const vee = (x, y, w, h) => path(poly([[x - w / 2, y + h], [x - w / 2 + 0.55, y + h], [x, y + 0.9], [x + w / 2 - 0.55, y + h], [x + w / 2, y + h], [x + 0.3, y], [x - 0.3, y]]), "#2a2d31");

// Plain agency paint for a diesel without a researched livery.
const genericPaint = (c, sp) => rect(0, 0, sp.L, sp.sill + 1.0, "#2a2d31") + rect(0, sp.sill + 1.0, sp.L, 0.45, c.color || "#1f5fad");

// --- MotivePower MP36PH-3C (Metra 401-427, Caltrain 923-928, UTA FrontRunner
// 1-21, MBTA 010-011): 68 ft, 15 ft 6 in, Blomberg trucks 42 ft 10 in apart,
// 9 ft 4 in wheelbase, 40 in wheels. A rounded, bulbous nose under a four-pane
// windshield (two front panes, two corner panes); cab door, then an
// engine-room door; a fifth roof fan at the very rear cools the HEP genset.
export const mp36 = (c) => cabUnit(c, {
  // Metra: a big white logo on the blue toward the rear. FrontRunner: the
  // name mid-body. MBTA units carry the T disc in their paint.
  badge: (c) => ({ metra: { x: 46.5, y: 6.8, h: 3.4, dark: true }, frontrunner: { x: 36, y: 9.0, h: 1.1 } })[c.agency],
  roof: 15.5, sill: 4.55, rearR: 1.1,
  nose: [[2.25, 4.55], ["q", 1.2, 5.0, 1.2, 7.2], [1.3, 9.6], ["q", 1.45, 10.35, 2.05, 10.55], [3.85, 13.95], ["q", 4.1, 15.5, 5.8, 15.5]],
  glass: [[[2.25, 10.8], [3.75, 13.65], [4.35, 13.65], [4.35, 10.8]], [[4.55, 10.8], [4.55, 13.65], [5.4, 13.65], [5.4, 10.8]]],
  sideWin: [[6.1, 11.0, 2.6, 2.3]],
  doors: [[9.6, 2.0, 5.1, 13.6], [15.6, 2.0, 5.1, 12.4]],
  grilles: [[5.8, 5.3, 2.6, 1.9, 0.3], [44.5, 11.3, 20.5, 2.6, 0.38], [24.5, 5.5, 3.6, 1.6, 0.3]],
  panels: [[19.5, 5.4, 3.0, 6.3], [36.0, 5.4, 3.0, 6.3]],
  tank: [20.5, 46.5, 1.5], reservoir: [32, 45],
  trucks: { centers: 42.83, wb: 9.33, d: 40 },
  roofItems: [[33, 1.6, 0.6], [45, 21, 0.3]], fans: [46.7, 51.1, 55.5, 59.9, 64.1], horn: 5.6,
  paint: (c, sp) => {
    const L = sp.L;
    switch (c.agency) {
      case "metra": {
        // Silver roof, black band through the windows, orange over a red pinstripe,
        // silver cab sides, blue along the body, red and white chevrons on the nose.
        let s = rect(0, 0, L, sp.roof + 1, "#c3c7cc") + rect(0, 11.0, L, 3.6, "#1d1f22");
        s += rect(0, 10.45, L, 0.48, "#f26b21") + rect(0, 10.12, L, 0.2, "#c8102e");
        s += path(poly([[14.2, 5.6], [14.2, 9.4], ["q", 14.4, 10.12, 15.2, 10.12], [L, 10.12], [L, 5.6]]), "#2153a3");
        s += rect(0, 0, L, 5.6, "#1d1f22") + rect(0, 5.6, L, 0.12, "#ffffff");
        for (let k = 0; k < 3; k++) s += path(poly([[0, 6.2 + k * 1.15], [0.6, 6.2 + k * 1.15], [3.2, 7.0 + k * 1.15], [3.2, 7.45 + k * 1.15], [0, 6.65 + k * 1.15]]), "#c8102e");
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
        // White with a blue lower body, red and navy stripes, gray roof.
        let s = rect(0, 0, L, sp.roof + 1, "#eceef1") + rect(0, 14.4, L, 2, "#8a9098");
        s += rect(0, 0, L, 5.4, "#1d1f22") + rect(0, 5.4, L, 3.4, "#205da9") + rect(0, 8.95, L, 0.4, "#ee3338") + rect(0, 9.5, L, 0.18, "#151b91");
        return s;
      }
      case "mbta": return mbtaPaint(c, { L, roof: sp.roof, cabEnd: 12.0, sweep: [15.5, 23.5], tail: L - 8, T: 28.5 });
      default: return genericPaint(c, sp);
    }
  },
});

// --- EMD F125 "Spirit" (Metrolink 903-942): 69 ft, 14 ft 6.5 in, trucks
// 42 ft 4 in apart, 9 ft 7 in wheelbase, 40 in wheels. Vossloh body: a near-
// upright face, big rounded cab roof, two large windshield panes in a black
// mask that wraps back over the cab side window; headlight cluster centered
// under the glass; radiator intakes high on the rear quarter.
export const f125 = (c) => cabUnit(c, {
  badge: { x: 56, y: 9.3, h: 1.0 },                                  // the name near the rear
  roof: 14.54, sill: 4.5, rearR: 1.2,
  nose: [[2.45, 4.5], [1.5, 5.3], [1.35, 8.7], [1.6, 9.65], [2.6, 12.45], ["q", 3.1, 14.54, 6.6, 14.54]],
  glass: [[[1.95, 9.95], [2.65, 12.15], [3.4, 12.15], [3.4, 9.95]]],
  sideWin: [[4.9, 10.0, 3.2, 2.2]],
  doors: [[9.2, 2.1, 5.0, 12.8]],
  grilles: [[50.5, 10.0, 15.5, 3.0, 0.36], [5.3, 5.6, 2.6, 1.3, 0.3], [30, 11.5, 6, 1.6, 0.36]],
  panels: [[16.5, 6.0, 3.0, 5.6], [40.5, 6.0, 3.0, 5.6]],
  tank: [21, 48, 1.5], reservoir: [34, 47],
  trucks: { centers: 42.33, wb: 9.58, d: 40 },
  roofItems: [[48.5, 19, 0.3], [24, 1.6, 0.5]], fans: [52, 57, 62], horn: 6.0,
  paint: (c, sp) => {
    const L = sp.L;
    if (c.agency !== "metrolink") return genericPaint(c, sp);
    // Silver; black cab mask; teal band with a blue line under it and white
    // above; an orange chevron on the nose; dark roof.
    let s = rect(0, 0, L, sp.roof + 1, "#c7cbd0") + rect(0, 13.7, L, 2, "#2c3035");
    s += path(poly([[0, 8.6], [8.9, 8.6], [8.4, 13.7], [0, 13.7]]), "#17191c");
    s += rect(0, 0, L, 5.0, "#1d1f22") + rect(0, 5.0, L, 0.22, "#1d4f91") + rect(0, 5.22, L, 1.25, "#00a19a") + rect(0, 6.47, L, 0.12, "#ffffff");
    s += path(poly([[0, 6.75], [2.6, 7.25], [0, 7.75]]), "#f26b21");
    return s;
  },
});

// --- Brookville BL36PH (Tri-Rail 818-829): 67 ft 3.5 in, 14 ft 8 in, 40 in
// wheels. A faceted nose: upright lower face, three flat windshield panes
// raked back under a chamfered brow; long louver band along the top of the
// side; Tri-Rail's blue wrap with a green, orange and blue band behind the cab.
export const bl36 = (c) => cabUnit(c, {
  badge: { x: 47, y: 9.5, h: 1.6, logo: "trirail-onnavy" },         // mid-hood, white lettering on the navy
  roof: 14.67, sill: 4.55, rearR: 0.9,
  nose: [[2.2, 4.55], [1.45, 5.3], [1.55, 9.7], [1.85, 10.15], [3.45, 13.35], [4.4, 14.25], [5.6, 14.67]],
  glass: [[[2.15, 10.45], [3.4, 13.0], [4.0, 13.0], [4.0, 10.45]]],
  sideWin: [[4.9, 10.6, 3.0, 2.2]],
  doors: [[9.1, 2.0, 5.0, 13.4]],
  grilles: [[14.5, 12.4, 45, 1.5, 0.32], [5.2, 5.5, 2.6, 1.6, 0.3], [52, 5.6, 4, 4.6, 0.3], [57, 5.6, 4, 4.6, 0.3]],
  panels: [[20, 5.6, 3.0, 6.0], [38, 5.6, 3.0, 6.0]],
  tank: [21, 46, 1.5], reservoir: [32, 45],
  trucks: { centers: 41.5, wb: 9.0, d: 40 },
  roofItems: [[40, 1.4, 0.6], [48, 16, 0.3]], fans: [52, 57, 62], horn: 5.4,
  paint: (c, sp) => {
    const L = sp.L;
    if (c.agency !== "trirail") return genericPaint(c, sp);
    let s = rect(0, 0, L, sp.roof + 1, "#1d3f7a") + rect(0, 0, 12.5, sp.roof + 1, "#2d62b3");
    s += rect(12.5, 4.0, 0.7, 11, "#91d14f") + rect(13.2, 4.0, 0.5, 11, "#f37014") + rect(13.7, 4.0, 0.5, 11, "#0299d9");
    for (const [x, col] of [[L - 18, "#f37014"], [L - 16.4, "#91d14f"], [L - 14.8, "#0299d9"]]) s += path(poly([[x, 5.6], [x + 1.1, 5.6], [x + 2.3, 9.2], [x + 1.1, 12.8], [x, 12.8], [x + 1.2, 9.2]]), col);
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
    badge: { x: 48, y: 8.75, h: 2.0, skip: ["mbta"] },                // VIA: toward the rear
    roof: hood, sill, rearR: 0.9,
    nose: [[2.45, sill], [2.45, 8.3], ["q", 2.5, 8.85, 3.1, 8.95], [6.0, 9.45], [6.3, 9.75], [7.55, 14.75], ["q", 7.75, roof, 8.7, roof], [13.6, roof], [13.75, hood]],
    glass: [[[6.55, 10.35], [7.45, 14.2], [8.0, 14.2], [8.0, 10.35]]],
    sideWin: [[8.4, 11.4, 1.15, 2.6], [9.65, 11.4, 1.35, 2.6]],
    doors: [[11.15, 2.1, sill + 0.2, 14.4]],
    grilles: [[14.3, 12.6, 8.5, 2.0, 0.32], [c.L - 16.5, 10.6, 13.5, 3.6, 0.36]],
    panels: [[23.5, 5.2, 3.0, 7.0], [27.0, 5.2, 3.0, 7.0], [31.0, 5.2, 3.0, 7.0]],
    tank: [17.5, c.L - 17.5, 1.5], reservoir: [c.L / 2 - 4, c.L / 2 + 6],
    trucks: { centers: c.L - 23.2, wb: 9.0, d: 40 },
    roofItems: [[c.L - 26, 1.6, 0.45]], fans: [c.L - 13.5, c.L - 8.3, c.L - 3.6], horn: 9.6,
    paint: (c, sp) => {
      const L = sp.L;
      if (mbta || c.agency === "mbta") return mbtaPaint(c, { L, roof: sp.roof, cabEnd: 13.6, sweep: [16.5, 24.5], tail: null, T: 32 });
      if (c.agency === "via") {
        // VIA (current scheme): a blue-teal cab, light gray hood over a blue
        // lower body, yellow and orange swooshes sweeping up the hood.
        let v = rect(0, 0, L, sp.roof + 1, "#b9bec4") + rect(0, 0, L, 8.2, "#24497a") + rect(0, 0, 13.9, sp.roof + 1, "#2b7f8f");
        for (let k = 0; k < 5; k++) {
          const x = 24 + k * 1.1;
          v += path(poly([[x, 8.2], [x + 0.55, 8.2], [x + 9.5, 13.0], [x + 8.95, 13.0]]), k % 2 ? "#f08a1c" : "#f5c400");
        }
        return v + rect(0, 4.65, L, 0.3, "#f5c400");
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
export const f59 = (c) => cabUnit(c, {
  // Piedmont's carry "North Carolina" in a big upright serif mid-side.
  badge: (c) => (c.route === "Piedmont" ? { x: 37.0, y: 8.7, h: 1.6, logo: "north-carolina" } : { x: 38.5, y: 9.6, h: 1.3 }),
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
  paint: (c, sp) => {
    const L = sp.L;
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
  const mbta = c.agency === "mbta";
  const paint = mbta ? (w) => {
    let p = rect(0, 0, L, 17, MBTA.silver) + rect(0, hood - 0.7, L, 2, MBTA.black) + rect(0, cabRoof - 0.4, 15, 1, MBTA.roof);
    p += rect(0, deck, L, 1.45, MBTA.purple) + rect(0, deck + 1.45, L, 0.14, MBTA.yellow);
    p += path(poly([[0, deck], [17.5, deck], [22, hood - 0.7], [0, hood - 0.7]]), MBTA.purple) + line(17.5, deck + 1.6, 21.7, hood - 0.75, MBTA.yellow, 1.1);
    p += path(poly([[L - 3, deck], [L - 9.5, deck], [L - 12, hood - 0.7], [L - 3, hood - 0.7]]), MBTA.purple);
    return p + w;
  } : (w) => rect(0, 0, L, 17, c.color || "#1f5fad") + w;
  s += path(frame, C.black) + rect(1.2, 3.75, L - 2.4, 0.4, MBTA.yellow, 0, 'opacity="0.9"');
  s += path(hoodD, MBTA.silver) + clipped(hoodD, paint(tDisc(30, (deck + hood) / 2, 1.9)));
  // Hood doors, radiator grilles, dynamic brake, fans.
  for (let x = 16; x < L - 22; x += 4.2) s += rect(x, deck + 0.6, 3.6, hood - deck - 1.6, "none", 0.4, 'rx="0.1"');
  s += rect(L - 15.8, hood - 3.4, 12.2, 3.6, "rgba(0,0,0,0.3)", 0.4) + slats(L - 15.8, hood - 3.4, 12.2, 3.6, 0.36);
  s += rect(24, hood - 0.05, 6, 0.6, C.steelDark, 0.4);
  for (const x of [L - 13.5, L - 9.2, L - 5.2]) s += path(`M${x - 1.9} ${hood + 0.55}Q${x} ${hood + 1.25} ${x + 1.9} ${hood + 0.55}Z`, C.steelDark, 0.4);
  s += path(cab, MBTA.silver) + clipped(cab, paint("") + path(poly([[6.7, 10.6], [7.2, 14.4], [7.9, 14.4], [7.9, 10.6]]), C.glass) + win(8.6, 11.3, 2.0, 2.4, 0.2) + win(11.0, 11.3, 2.4, 2.4, 0.2));
  s += outlineOf(hoodD) + outlineOf(cab) + outlineOf(frame);
  // Handrails along the walkway.
  const posts = [];
  for (let x = 15; x < L - 3; x += 6.2) posts.push([x, deck, x, deck + 3.1]);
  posts.push([14.4, deck + 3.1, L - 2.0, deck + 3.1], [L - 2.0, deck, L - 2.0, deck + 3.1], [2.0, deck, 2.0, deck + 3.1], [2.0, deck + 3.1, 2.6, deck + 3.1]);
  s += lines(posts, "currentColor", 0.6);
  s += rect(8.5, cabRoof - 0.05, 1.1, 0.35, "currentColor");
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
// cab, a long hood with a dynamic brake blister and flared radiators over the
// rear fans, a walkway with handrails. Metra blue with a halftone fading
// toward the rear, red and white chevrons on the nose, white Metra logo on the
// hood.
export function sd70mach(c) {
  const { L } = c, deck = 5.2, cabRoof = 15.6, hood = 14.9;
  const blue = "#1f4fa3";
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
  const dots = () => {
    // Halftone: dots shrinking toward the front of the hood.
    let p = "";
    for (let x = L - 26; x < L - 3; x += 0.9) for (let y = deck + 0.6; y < hood; y += 0.9) {
      const k = (x - (L - 26)) / 23;
      p += circle(x, y, 0.08 + 0.3 * k, "#6f9be0");
    }
    return p;
  };
  const paint = (extra = "") => rect(0, 0, L, 17, blue) + rect(0, deck, L, 0.3, "#ffffff") + rect(0, deck + 0.3, L, 0.3, "#c8102e") + extra;
  s += path(frame, C.black);
  s += path(hoodD, blue) + clipped(hoodD, paint(dots()));
  for (let x = 17.5; x < L - 26; x += 4.4) s += rect(x, deck + 1.0, 3.8, hood - deck - 2.2, "none", 0.4, 'rx="0.1"');
  s += rect(L - 18.2, hood - 3.8, 14.6, 4.0, "rgba(0,0,0,0.3)", 0.4) + slats(L - 18.2, hood - 3.8, 14.6, 4.0, 0.36);
  s += rect(26, hood - 0.05, 9, 0.7, C.steelDark, 0.4, 'rx="0.2"');                     // dynamic brake blister
  for (const x of [L - 15, L - 10.2, L - 5.6]) s += path(`M${x - 2.1} ${hood + 0.6}Q${x} ${hood + 1.35} ${x + 2.1} ${hood + 0.6}Z`, C.steelDark, 0.4);
  // Cab and nose: red and white chevrons on the nose, black around the windows.
  const chevrons = () => {
    let p = rect(0, 0, 8, 17, "#ffffff");
    for (let k = 0; k < 7; k++) p += path(poly([[0, deck + k * 1.6], [7.2, deck + k * 1.6 + 2.2], [7.2, deck + k * 1.6 + 3.0], [0, deck + k * 1.6 + 0.8]]), "#c8102e");
    return p;
  };
  s += path(nose, blue) + clipped(nose, paint(chevrons() + rect(7.2, 12.4, 9, 4, C.black) +
    path(poly([[7.5, 12.7], [7.7, 15.1], [9.6, 15.1], [9.6, 12.7]]), C.glass) + win(10.3, 12.8, 2.2, 2.2, 0.2) + win(13.0, 12.8, 2.3, 2.2, 0.2)));
  s += door(12.2, deck + 0.3, 2.1, 6.4, { glassY: 0.68, glassH: 0.2, grabs: false });
  s += badge(c, 38, (deck + hood) / 2 + 0.3, 2.4, { dark: true });                        // the Metra logo on the hood
  s += outlineOf(hoodD) + outlineOf(nose) + outlineOf(frame);
  const posts = [];
  for (let x = 16.4; x < L - 3; x += 6.4) posts.push([x, deck, x, deck + 3.3]);
  posts.push([16.0, deck + 3.3, L - 1.8, deck + 3.3], [L - 1.8, deck, L - 1.8, deck + 3.3], [1.8, deck, 1.8, deck + 3.3]);
  s += lines(posts, "currentColor", 0.6);
  s += rect(9.5, cabRoof - 0.05, 1.2, 0.35, "currentColor");                              // horn
  return s;
}

export function alp46(c) {
  const { L } = c, sill = 4.25, roof = 13.75;
  const X = (v, k) => (k > 0 ? L - v : v);
  const d = poly([[2.3, sill], [L - 2.3, sill], [L - 1.45, 5.1], [L - 1.4, 9.0], [L - 1.75, 9.6], [L - 3.4, 13.1], ["q", L - 3.75, roof, L - 5.0, roof],
    [5.0, roof], ["q", 3.75, roof, 3.4, 13.1], [1.75, 9.6], [1.4, 9.0], [1.45, 5.1]]);
  let s = "";
  for (const k of [-1, 1]) {
    const x = (v) => X(v, k);
    s += pilot(1.4, sill, k > 0 ? L : null);
    s += truck(L / 2 + k * 16.6, { wb: 8.83, d: 44, kind: "loco", top: sill });
  }
  s += rect(21.5, 2.2, L - 43, sill - 2.2, "currentColor", 0, 'opacity="0.8" rx="0.2"');
  const nj = c.agency === "njt" || !c.agency;
  let liv = rect(0, 0, L, roof + 1, nj ? "#bcc1c7" : c.color) + rect(0, roof - 0.6, L, 1, "#3b4046");
  if (nj) {
    const grad = `ts-disco-${++clipSeq}`;
    liv += `<defs><linearGradient id="${grad}" x1="0" x2="1"><stop offset="0" stop-color="#1b3f94"/><stop offset="0.45" stop-color="#b5267a"/><stop offset="1" stop-color="#f26b21"/></linearGradient></defs>`;
    liv += rect(13, 5.2, 24, 1.0, `url(#${grad})`);
    for (const k of [-1, 1]) {
      const x = (v) => X(v, k);
      liv += path(poly([[x(0), 9.0], [x(4.6), 9.0], [x(4.6), 6.8], [x(7.0), 6.8], [x(7.0), roof], [x(0), roof]]), "#1d1f22");
    }
    liv += rect(0, 4.85, L, 0.22, "#f26b21") + rect(0, 0, L, 4.85, "#3b4046");
  }
  for (const k of [-1, 1]) {
    const x = (v) => X(v, k);
    liv += path(poly([[x(1.95), 9.95], [x(3.4), 12.8], [x(4.0), 12.8], [x(4.0), 9.95]]), C.glass);
    liv += win(Math.min(x(5.0), x(6.5)), 9.7, 1.5, 3.0, 0.2);
  }
  s += path(d, "#bcc1c7") + clipped(d, liv);
  for (const k of [-1, 1]) s += door(Math.min(X(7.4, k), X(9.4, k)), sill + 0.35, 2.0, 7.9, { glassY: 0.7, glassH: 0.2 });
  for (const x of [16, 22, 36, 42]) s += rect(x, 9.2, 5, 3.0, "rgba(0,0,0,0.25)", 0.4) + slats(x, 9.2, 5, 3.0, 0.32);
  s += rect(27.5, roof - 0.05, 9, 0.5, C.steelDark, 0.4);
  // "NJ TRANSIT" low on each cab side.
  for (const x of [11.5, L - 11.5]) s += badge(c, x, 7.0, 1.0, { logo: "njt-word" });
  // Pantographs toward each end; the trailing one raised.
  s += pantograph(12.2, roof, { up: false, facing: 1 }) + pantograph(L - 12.2, roof, { up: true, facing: -1 });
  s += outlineOf(d);
  return s;
}

// --- EMD DE30AC / DM30AC (LIRR): 75 ft over couplers, 14 ft 4 in, trucks
// 46 ft 2 in apart, 9 ft 6 in wheelbase, 44 in wheels. Monocoque body with
// fluted stainless sides and blue stripes; blue and yellow cab with a raised
// rounded yellow roof cap; two-pane raked windshield over a flat lower nose;
// a 2x2 intake grille mid-body. The DM30AC adds third-rail shoes.
function lirrDiesel(c, shoe) {
  return cabUnit(c, {
    badge: { x: 8.0, y: 8.6, h: 1.0, logo: "mta-inverse" },          // on the blue cab panel
    roof: 14.33, sill: 4.6, rearR: 1.0,
    nose: [[2.2, 4.6], [1.45, 5.4], [1.4, 7.7], [2.9, 10.0], [4.9, 12.75], ["q", 4.9, 14.33, 7.1, 14.33]],
    glass: [[[3.1, 10.15], [4.7, 12.4], [5.4, 12.4], [5.4, 10.15]]],
    sideWin: [[6.0, 10.3, 3.4, 2.0]],
    doors: [[10.6, 2.2, 5.0, 12.6]],
    tank: [20, 54, 1.4], reservoir: [36, 50],
    grilles: [[6.2, 6.3, 3.0, 0.9], [33.5, 7.2, 2.6, 2.4], [36.4, 7.2, 2.6, 2.4], [33.5, 9.9, 2.6, 2.4], [36.4, 9.9, 2.6, 2.4], [56, 6.0, 15.5, 6.4, 0.36]],
    roofItems: [[46.5, 1.8, 0.7], [54, 18, 0.25]], fans: [59, 63.8, 68.6], horn: 8.2,
    trucks: { centers: 46.17, wb: 9.5, d: 44, shoe }, base: C.steel,
    paint: (c, sp) => flutes(11, sp.L - 1, 5.0, 12.6, 0.32) +
      rect(0, 4.6, sp.L, 0.9, LIRR.blue) + rect(0, 5.75, sp.L, 0.28, LIRR.blue) +
      path(poly([[0, 4.6], [10.4, 4.6], [10.4, 10.0], [0, 10.0]]), LIRR.blue) +
      path(poly([[0, 10.0], [10.4, 10.0], [10.4, 15], [0, 15]]), LIRR.yellow) +
      path(poly([[2.75, 10.0], [4.75, 12.6], [9.8, 12.6], [9.8, 10.0]]), C.black),
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
  p32: M(p32, 69, true),
  alc42: M(alc42, 71.5, true),
  charger: M(charger, 71.5, true),
  de30ac: M(de30ac, 75, true),
  dm30ac: M(dm30ac, 75, true),
  hsp46: M(hsp46, 71, true),
  mp36: M(mp36, 68, true),
  f125: M(f125, 69, true),
  bl36: M(bl36, 67.3, true),
  f40: M(f40ph, 56.17, true),
  f40c: M(f40c, 64.25, true),
  f59: M(f59, 58.58, true),
  gp40: M(gp40, 64, true),
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
  bilevel: M((c) => (c.agency === "mbta" ? mbtaBilevel(c) : bombardierBilevel(c)), (ag) => (ag === "mbta" ? 85.33 : 85)),
  bilevelCab: M((c) => (c.agency === "mbta" ? mbtaCab(c) : ["metrolink", "trirail"].includes(c.agency) ? rotemCabCar(c) : bombardierCab(c)), (ag) => (ag === "mbta" ? 85.33 : 85), true),
  kawasakiCab: M(mbtaCab, 85.33, true),
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
  m7: M(m7, 85),
  m7a: M(m7a, 85),
  m8: M(m8, 85),
  m9: M(m9, 85),
  m3: M(m3, 85),
  silverliner4: M(silverliner4, 85),
  silverliner5: M(silverliner5, 85.13),
  kiss: M(kiss, 83.7),
  kissCab: M(kissCab, 90.2, true),
  smartDmu: M(smartDmu, 85),
  gtwCar: M(gtwCar, 58.85, true),
  gtwPower: M(gtwPower, 16.4),
  flirtCar: M(flirtCar, 71, true),
  flirtPower: M(flirtPower, 21),
  venture: M(venture, 85, false, (c) => (c.agency === "brightline" ? c.index % 5 : "")),
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
