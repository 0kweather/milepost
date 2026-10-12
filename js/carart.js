// Side-view drawings of passenger rail equipment, built from each model's
// real dimensions. Trainsheet's own artwork: hand-written geometry from
// published measurements and descriptions, nothing traced or copied.
//
// Units are feet, measured from the top of the rail (y up) and from the car's
// left coupler face (x). Every drawing shares one scale, so cars and
// locomotives stand in true proportion to each other.

export const PX_PER_FT = 3;      // on-screen scale
export const HEIGHT_FT = 21;     // drawing height: tallest cars and raised pantographs

// ---------- Primitives ----------

const n = (v) => Math.round(v * 100) / 100;
const STROKE = 'vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"';
// Fills, plus an outline in the theme's ink (currentColor) when width > 0.
const attrs = (fill, stroke = 0, extra = "") =>
  `fill="${fill}"${stroke ? ` stroke="currentColor" stroke-width="${stroke}" ${STROKE}` : ""}${extra ? " " + extra : ""}`;
export const rect = (x, y, w, h, fill, stroke = 0, extra = "") =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${attrs(fill, stroke, extra)}/>`;
export const circle = (cx, cy, r, fill, stroke = 0, extra = "") =>
  `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" ${attrs(fill, stroke, extra)}/>`;
export const path = (d, fill, stroke = 0, extra = "") => `<path d="${d}" ${attrs(fill, stroke, extra)}/>`;
export const line = (x1, y1, x2, y2, color = "currentColor", px = 0.6, extra = "") =>
  `<path d="M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}" fill="none" stroke="${color}" stroke-width="${px}" ${STROKE}${extra ? " " + extra : ""}/>`;
// Many line segments as one path element: segs = [[x1, y1, x2, y2], ...].
export const lines = (segs, color = "currentColor", px = 0.5) => segs.length
  ? `<path d="${segs.map(([a, b, c2, d2]) => `M${n(a)} ${n(b)}L${n(c2)} ${n(d2)}`).join("")}" fill="none" stroke="${color}" stroke-width="${px}" ${STROKE}/>` : "";
// Vertical slats across a grille panel, as one path.
export const slats = (x, y, w, h, gap = 0.4, color = "rgba(0,0,0,0.4)") => {
  const segs = [];
  for (let k = gap * 0.75; k < w; k += gap) segs.push([x + k, y + 0.1, x + k, y + h - 0.1]);
  return lines(segs, color, 0.4);
};
// Points to a closed path; ["q", cx, cy, x, y] entries are quadratic curves.
export const poly = (pts) =>
  pts.map((p, i) => (p[0] === "q" ? `Q${n(p[1])} ${n(p[2])} ${n(p[3])} ${n(p[4])}` : `${i ? "L" : "M"}${n(p[0])} ${n(p[1])}`)).join("") + "Z";

// ---------- Colors ----------

export const C = {
  steel: "#d9dde2",        // unpainted stainless sides
  steelShade: "#c3c9d0",   // flutes, roof curve, recessed panels
  steelDark: "#a9b0b8",
  glass: "#262c33",
  glassLight: "#3b444e",   // the sky reflected in the upper part of a window
  gasket: "#111417",
  black: "#17191c",
  rubber: "#202326",
  red: "#c8102e",
};

// Window: dark glass with a lighter upper band and a black gasket.
export function win(x, y, w, h, r = 0.25) {
  return rect(x, y, w, h, C.glass, 0, `rx="${r}" stroke="${C.gasket}" stroke-width="0.6" ${STROKE}`) +
    rect(x + 0.12, y + h * 0.62, w - 0.24, h * 0.3, C.glassLight, 0, `rx="${Math.min(r, 0.15)}"`);
}

// Side door: outlined panel; double doors split down the middle; windows in
// each leaf; grab irons either side.
export function door(x, y, w, h, { leaves = 1, glass = true, glassY = 0.55, glassH = 0.3, grabs = true, fill = "rgba(0,0,0,0.06)" } = {}) {
  let s = rect(x, y, w, h, fill, 0.6);
  const lw = w / leaves;
  for (let i = 0; i < leaves; i++) {
    if (i) s += line(x + lw * i, y, x + lw * i, y + h, "currentColor", 0.5);
    if (glass) s += win(x + lw * i + lw * 0.22, y + h * glassY, lw * 0.56, h * glassH, 0.2);
  }
  if (grabs) s += line(x - 0.25, y + h * 0.25, x - 0.25, y + h * 0.75, "currentColor", 0.6) + line(x + w + 0.25, y + h * 0.25, x + w + 0.25, y + h * 0.75, "currentColor", 0.6);
  return s;
}

// A row of evenly spaced windows centered between a and b.
export function windowRow(a, b, y, w, h, pitch, { r = 0.25, skip = [] } = {}) {
  const count = Math.max(0, Math.floor((b - a - w) / pitch) + 1);
  const x0 = a + (b - a - ((count - 1) * pitch + w)) / 2;
  let s = "";
  for (let i = 0; i < count; i++) {
    const x = x0 + i * pitch;
    if (skip.some(([p, q]) => x + w > p && x < q)) continue;
    s += win(x, y, w, h, r);
  }
  return s;
}

// ---------- Running gear ----------

// A wheel seen from the side: dark disc, rim line, hub.
function wheel(cx, d) {
  const r = d / 24;
  return circle(cx, r, r, "currentColor") + circle(cx, r, r * 0.82, "none", 0, `stroke="${C.steelDark}" stroke-width="0.5" ${STROKE}`) + circle(cx, r, r * 0.26, C.steelDark);
}

// A coil spring seen from the side: stacked turns.
function coil(x, y0, y1, w) {
  const turns = Math.max(3, Math.round((y1 - y0) / 0.24)), segs = [];
  for (let k = 0; k < turns; k++) {
    const y = y0 + ((k + 0.5) * (y1 - y0)) / turns;
    segs.push([x - w / 2, y - 0.05, x + w / 2, y + 0.05]);
  }
  return rect(x - w / 2, y0, w, y1 - y0, "currentColor", 0, 'opacity="0.55"') + lines(segs, C.steelDark, 0.7);
}

// Two-axle truck, seen from the side.
//   "car": cast outboard side frame with pedestals over the journal boxes, a
//     bolster on coil springs seen through the frame's center window, damper.
//   "pioneer": Budd Pioneer III (Amfleet, Metroliner): inboard bearings, so
//     the wheels and their disc brakes are in full view under a slim frame.
//   "loco": deep frame, a coil spring nest over each journal box, flexicoil
//     secondary springs carrying the body, dampers, sand boxes.
//   shoe: third-rail shoe beams on the journal boxes.
export function truck(cx, { wb = 8.5, d = 36, kind = "car", shoe = false, top = 3.6 } = {}) {
  const r = d / 24, a = cx - wb / 2, b = cx + wb / 2;
  let s = wheel(a, d) + wheel(b, d);
  if (kind === "pioneer") {
    for (const x of [a, b]) s += circle(x, r, r * 0.55, "none", 0, `stroke="${C.steelDark}" stroke-width="0.9" ${STROKE}`); // disc brakes
    s += path(poly([[a - 0.3, r + 0.15], [b + 0.3, r + 0.15], [b + 0.3, r + 0.7], [cx + 1.6, r + 0.95], [cx - 1.6, r + 0.95], [a - 0.3, r + 0.7]]), "currentColor", 0, 'opacity="0.85"');
    s += coil(cx - 0.9, r + 0.95, top - 0.05, 0.75) + coil(cx + 0.9, r + 0.95, top - 0.05, 0.75);
    return s;
  }
  const loco = kind === "loco";
  const ft = loco ? r * 2 + 0.15 : r * 2 - 0.2;   // frame top
  const fb = loco ? r - 0.75 : r - 0.35;          // frame bottom at the pedestals
  const ext = loco ? r + 0.55 : r + 0.3;          // how far the frame runs past each axle
  // Side frame: deep at the pedestals, a window in the middle for the bolster.
  s += path(poly([[a - ext, fb + 0.35], [a - ext + 0.35, fb], [a + r * 0.75, fb], [cx - 1.7, fb + (loco ? 0.25 : -0.25)],
    [cx + 1.7, fb + (loco ? 0.25 : -0.25)], [b - r * 0.75, fb], [b + ext - 0.35, fb], [b + ext, fb + 0.35],
    [b + ext, ft - 0.4], [b + ext - 0.5, ft], [a - ext + 0.5, ft], [a - ext, ft - 0.4]]), "currentColor");
  // Journal boxes (axle ends) in the pedestals.
  for (const x of [a, b]) s += rect(x - 0.55, r - 0.45, 1.1, 0.9, C.steelDark, 0, 'rx="0.14"') + circle(x, r, 0.18, "currentColor");
  if (loco) {
    for (const x of [a, b]) s += coil(x, r + 0.5, ft - 0.1, 0.95);                     // primary spring nests
    s += coil(cx - 1.25, ft, top, 0.95) + coil(cx + 1.25, ft, top, 0.95);              // flexicoil secondaries
    s += line(cx, ft - 0.2, cx + 0.5, top - 0.1, C.steelDark, 1.2);                     // damper
    for (const x of [a - ext - 0.15, b + ext + 0.15]) s += rect(x - 0.35, ft - 0.9, 0.7, 0.8, "currentColor", 0, 'opacity="0.8"'); // sand boxes
  } else {
    // Bolster and its springs in the frame window; damper beside them.
    s += coil(cx - 0.6, fb - 0.15, ft - 0.25, 0.75) + coil(cx + 0.6, fb - 0.15, ft - 0.25, 0.75);
    s += rect(cx - 1.9, ft - 0.25, 3.8, 0.55, "currentColor") + rect(cx - 1.1, ft + 0.3, 2.2, top - ft - 0.3, "currentColor", 0, 'opacity="0.75"');
    s += line(cx + 1.45, fb + 0.15, cx + 1.45, ft - 0.3, C.steelDark, 1);
  }
  if (shoe) {
    // Third-rail shoe beam off each outer journal box, shoe just above the rail.
    for (const [x, dir] of [[a, -1], [b, 1]]) {
      const x0 = x + dir * 0.55, x1 = x + dir * 2.0;
      s += rect(Math.min(x0, x1), r - 0.25, Math.abs(x1 - x0), 0.22, "currentColor") + rect(x1 - 0.35, 0.12, 0.7, 0.28, "currentColor") + line(x1, 0.4, x1, r - 0.25, "currentColor", 1);
    }
  }
  return s;
}

// ---------- Roof equipment ----------

// Single-arm pantograph, raised to the wire (or folded flat).
export function pantograph(cx, roof, { up = true, facing = 1 } = {}) {
  let s = rect(cx - 2.6, roof, 0.35, 0.55, C.steelDark, 0.4) + rect(cx + 2.25, roof, 0.35, 0.55, C.steelDark, 0.4); // insulators
  s += rect(cx - 2.8, roof + 0.55, 5.6, 0.3, "currentColor");                                                         // base frame
  const k = facing;
  if (!up) {
    s += line(cx - 2.2 * k, roof + 0.95, cx + 2.4 * k, roof + 1.15, "currentColor", 1.1) + line(cx + 2.4 * k, roof + 1.15, cx - 1.6 * k, roof + 1.4, "currentColor", 1.1);
    return s + rect(cx - 2.4, roof + 1.35, 1.8, 0.2, "currentColor");
  }
  const knee = [cx + 2.6 * k, roof + 3.9], head = [cx - 0.8 * k, roof + 7.2];
  s += line(cx - 2.0 * k, roof + 0.9, knee[0], knee[1], "currentColor", 1.4);                 // lower arm
  s += line(cx - 1.4 * k, roof + 0.9, knee[0] - 0.3 * k, knee[1] - 0.2, "currentColor", 0.6); // push rod
  s += line(knee[0], knee[1], head[0], head[1], "currentColor", 1.1);                          // upper arm
  s += rect(head[0] - 1.6, head[1], 3.2, 0.18, "currentColor") + rect(head[0] - 1.8, head[1] + 0.18, 3.6, 0.14, C.steelDark); // collector head and strips
  return s;
}

// ---------- Car ends ----------

// Between coupled cars: the rubber bellows diaphragm around the end door
// (its pleats run vertically, seen from the side), and below it the end sill
// and coupler, one dark mass bridging the gap to the next car.
export function coupledEnd(xFace, side, { floor = 4, top = 11.5, coupler = 2.85 } = {}) {
  const w = 1.0, x = side < 0 ? xFace : xFace - w;
  let s = rect(x, floor + 0.2, w, top - floor - 0.4, C.rubber, 0, 'rx="0.2"');
  for (const k of [0.33, 0.66]) s += line(x + w * k, floor + 0.4, x + w * k, top - 0.4, "#3a3f45", 0.6);
  s += rect(x, coupler - 0.4, w, floor - coupler + 0.6, "currentColor", 0, 'opacity="0.9"');
  return s;
}

// ---------- Bodies ----------

// A car body seen from the side: straight sides from the sill to the eave, a
// curved roof above the eave (seen as a band), rounded roof corners at the
// ends. drop: { a, b, y } lowers the underside between a and b (a bi-level's
// low floor between the trucks).
export function bodyOutline(x0, x1, sill, roof, { endR = 1.0, endRL = endR, endRR = endR, drop = null } = {}) {
  const pts = [[x0, sill]];
  if (drop) pts.push([drop.a - 1.2, sill], [drop.a, drop.y], [drop.b, drop.y], [drop.b + 1.2, sill]);
  pts.push([x1, sill], [x1, roof - endRR], ["q", x1, roof, x1 - endRR, roof], [x0 + endRL, roof], ["q", x0, roof, x0, roof - endRL]);
  return poly(pts);
}

// Horizontal stripes across a body, inset from its ends. stripes: [y, h, fill].
export const stripes = (x0, x1, list, inset = 0.15) =>
  list.map(([y, h, fill, ins = inset]) => rect(x0 + ins, y, x1 - x0 - 2 * ins, h, fill)).join("");

// Corrugated stainless (Budd fluting): fine horizontal lines.
export function flutes(x0, x1, y0, y1, gap = 0.28) {
  const segs = [];
  for (let y = y0; y <= y1; y += gap) segs.push([x0, y, x1, y]);
  return lines(segs, C.steelShade, 0.5);
}

// Underframe equipment: boxes and air reservoirs hung between the trucks.
export function underframe(x0, x1, top, { depth = 1.4, boxes = 3, tanks = true } = {}) {
  let s = "";
  const span = x1 - x0, w = span / (boxes + (tanks ? 1 : 0));
  for (let i = 0; i < boxes; i++) s += rect(x0 + i * w + 0.3, top - depth, w - 0.6, depth, "currentColor", 0, 'opacity="0.78" rx="0.1"');
  if (tanks) s += rect(x0 + boxes * w + 0.3, top - 1.05, w - 0.6, 0.85, "currentColor", 0, 'opacity="0.6" rx="0.42"');
  return s;
}

