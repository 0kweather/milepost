// What a train is made of, drawn from the car numbers its railroad reports.
//   - SEPTA lists every car in the train, in order.
//   - LIRR and MBTA name one car of each train (not necessarily the front one).
// Car numbers are matched against each railroad's published fleet roster
// (number ranges by model); a number outside every range isn't drawn.
// The drawings are Milepost's own simplified side views.

// [first, last, type]
const FLEETS = {
  septa: [
    [101, 188, "silverliner4"], [276, 460, "silverliner4"],
    [701, 738, "silverliner5"], [801, 882, "silverliner5"],
    [901, 915, "acs64"],
    [2401, 2410, "pushPullCab"], [2501, 2525, "pushPullCoach"], [2550, 2559, "pushPullCoach"],
  ],
  lirr: [
    [7001, 7836, "m7"], [9001, 9202, "m9"], [9771, 9946, "m3"],
    [5001, 5023, "c3Cab"], [4001, 4134, "c3"],
    [400, 423, "de30ac"], [500, 522, "dm30ac"],
  ],
  mbta: [
    [10, 11, "mp36"], [1001, 1011, "f40"], [1025, 1036, "f40"], [1050, 1075, "f40"],
    [1115, 1139, "gp40"], [1776, 1776, "gp40"], [2000, 2039, "hsp46"],
    [1700, 1724, "kawasakiCab"], [1800, 1870, "rotemCab"],
    [700, 781, "bilevel"], [800, 886, "bilevel"], [900, 932, "bilevel"],
    [1500, 1533, "singleCab"], [1600, 1652, "single"],
    [200, 258, "single"], [350, 389, "single"], [500, 542, "single"], [600, 653, "single"],
  ],
};

// name: what riders call it; kind: how it's drawn.
const TYPES = {
  silverliner4: { name: "Silverliner IV", kind: "emu", pan: true },
  silverliner5: { name: "Silverliner V", kind: "emu", pan: true },
  acs64: { name: "ACS-64 electric locomotive", kind: "electric", pan: true },
  pushPullCab: { name: "Bombardier cab car", kind: "coach", cab: true },
  pushPullCoach: { name: "Bombardier coach", kind: "coach" },
  m7: { name: "M7", kind: "emu" },
  m9: { name: "M9", kind: "emu" },
  m3: { name: "M3", kind: "emu" },
  c3Cab: { name: "C3 bi-level cab car", kind: "bilevel", cab: true },
  c3: { name: "C3 bi-level coach", kind: "bilevel" },
  de30ac: { name: "DE30AC diesel locomotive", kind: "diesel" },
  dm30ac: { name: "DM30AC dual-mode locomotive", kind: "diesel" },
  mp36: { name: "MP36PH diesel locomotive", kind: "diesel" },
  f40: { name: "F40PH diesel locomotive", kind: "diesel" },
  gp40: { name: "GP40MC diesel locomotive", kind: "diesel" },
  hsp46: { name: "HSP46 diesel locomotive", kind: "diesel" },
  kawasakiCab: { name: "Kawasaki bi-level cab car", kind: "bilevel", cab: true },
  rotemCab: { name: "Rotem bi-level cab car", kind: "bilevel", cab: true },
  bilevel: { name: "Bi-level coach", kind: "bilevel" },
  singleCab: { name: "Single-level cab car", kind: "coach", cab: true },
  single: { name: "Single-level coach", kind: "coach" },
};

const LOCOMOTIVE = new Set(["diesel", "electric"]);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function typeOf(agency, number) {
  const n = Number(number);
  if (!Number.isInteger(n)) return null;
  const hit = (FLEETS[agency] || []).find(([a, b]) => n >= a && n <= b);
  return hit ? TYPES[hit[2]] : null;
}

// { cars: [{ number, type }], complete, summary } or null when nothing's known.
export function consistOf(t) {
  const list = t.cars?.numbers || [];
  const cars = list.map((number) => ({ number, type: typeOf(t.agency, number) }));
  if (!cars.some((c) => c.type)) return null;
  const complete = Boolean(t.cars.complete);
  // "4 cars · Silverliner V". When the feed names just one car, it isn't
  // necessarily the one in front, so only its model is given.
  const models = [...new Set(cars.map((c) => c.type?.name).filter(Boolean))];
  const coaches = cars.filter((c) => !LOCOMOTIVE.has(c.type?.kind)).length;
  const summary = complete
    ? [`${coaches} car${coaches === 1 ? "" : "s"}`, models.length <= 2 ? models.join(" + ") : null].filter(Boolean).join(" · ")
    : models.join(", ");
  return { cars, complete, summary };
}

// ---------- Drawings ----------
// Side views, front of the train on the left. Units are px at 1x.

const H = 46;               // drawing height; rails at the bottom
const INK = "currentColor"; // outlines and running gear; follows the theme (--car-ink)
const STEEL = "#d7dbe0", STEEL_DARK = "#bcc2c9", GLASS = "#39414a";

const rect = (x, y, w, h, fill, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;

function wheels(x, w, axles) {
  let s = "";
  for (const cx of [x + w * 0.17, x + w * 0.83]) {
    const span = axles === 3 ? 18 : 12;
    s += rect(cx - span / 2 - 3, 38.5, span + 6, 3.5, INK, 'rx="1.5"');
    for (let i = 0; i < axles; i++) {
      const wx = cx - span / 2 + (span / (axles - 1)) * i;
      s += `<circle cx="${wx}" cy="42.5" r="3" fill="${INK}"/><circle cx="${wx}" cy="42.5" r="1" fill="${STEEL_DARK}"/>`;
    }
  }
  return s;
}

function pantograph(cx, top) {
  return `<g stroke="${INK}" stroke-width="1.1" fill="none" stroke-linecap="round">
    <path d="M${cx - 7} ${top} L${cx + 2} ${top - 6} L${cx - 3} ${top - 10}"/>
    <path d="M${cx - 9} ${top - 10} H${cx + 3}"/></g>`;
}

function windowRow(x, w, y, h, skip = []) {
  let s = "";
  const pane = 7, gap = 3;
  for (let wx = x; wx + pane <= x + w; wx += pane + gap) {
    if (skip.some(([a, b]) => wx + pane > a && wx < b)) continue;
    s += rect(wx, y, pane, h, GLASS, 'rx="1.5"');
  }
  return s;
}

function door(x, y, h) {
  return rect(x, y, 9, h, STEEL_DARK, `stroke="${INK}" stroke-width="0.6" rx="1"`) + rect(x + 2.5, y + 3, 4, h * 0.38, GLASS, 'rx="1"');
}

// One car or locomotive. ends: which ends have a driving cab ("front"/"back").
function drawCar(type, color, w, { front = false, back = false } = {}) {
  const kind = type?.kind || "coach";
  let s = "";
  if (kind === "diesel" || kind === "electric") {
    // Painted in the railroad's color, with a light stripe along the side.
    const top = 11;
    s += rect(1, top, w - 2, 38 - top, color, `stroke="${INK}" stroke-width="1" rx="${kind === "electric" ? 6 : 2.5}"`);
    s += rect(1.5, 30, w - 3, 2.5, "#fff", 'opacity="0.85"');
    // Cab windshield at the front (and the back for electrics, which have two).
    s += rect(4, 15, 12, 7, GLASS, 'rx="1.5"');
    if (kind === "electric") s += rect(w - 16, 15, 12, 7, GLASS, 'rx="1.5"');
    else for (let gx = 26; gx < w - 10; gx += 5) s += rect(gx, 15, 2.2, 10, "rgba(0,0,0,0.22)", 'rx="1"'); // radiator grilles
    s += `<circle cx="4.5" cy="34.5" r="1.6" fill="#fff6c8"/>`;
    if (type?.pan) s += pantograph(w * 0.5, top);
    s += wheels(0, w, kind === "diesel" ? 3 : 2);
    return s;
  }
  const bilevel = kind === "bilevel";
  const top = bilevel ? 5 : 12;
  s += rect(1, top, w - 2, 38 - top, STEEL, `stroke="${INK}" stroke-width="1" rx="${bilevel ? 4 : 3}"`);
  // The railroad's color in a band along the side, below the windows.
  s += rect(1.5, 31, w - 3, 3, color);
  const doors = kind === "emu" ? [w * 0.24 - 4.5, w * 0.76 - 4.5] : bilevel ? [w * 0.3 - 4.5, w * 0.7 - 4.5] : [7, w - 16];
  const skip = doors.map((d) => [d - 1.5, d + 10.5]);
  const cabSkip = [...(front ? [[0, 14]] : []), ...(back ? [[w - 14, w]] : [])];
  if (bilevel) {
    s += windowRow(5, w - 10, 10, 7, cabSkip);
    s += windowRow(5, w - 10, 21, 7, [...skip, ...cabSkip]);
  } else {
    s += windowRow(5, w - 10, 17, 8, [...skip, ...cabSkip]);
  }
  for (const d of doors) s += door(d, bilevel ? 20 : 15, bilevel ? 17.5 : 22.5);
  const wsY = bilevel ? 10 : 16;
  if (front) s += rect(3, wsY, 9, 8, GLASS, 'rx="1.5"') + `<circle cx="4.5" cy="34.5" r="1.6" fill="#fff6c8"/>`;
  if (back) s += rect(w - 12, wsY, 9, 8, GLASS, 'rx="1.5"');
  if (kind === "emu") {
    s += rect(w * 0.4, top - 2.5, w * 0.2, 2.5, STEEL_DARK, `stroke="${INK}" stroke-width="0.6" rx="1"`); // roof equipment
    if (type?.pan) s += pantograph(w * 0.78, top);
  }
  s += wheels(0, w, 2);
  return s;
}

const WIDTH = { diesel: 92, electric: 92, emu: 118, coach: 118, bilevel: 118 };

// Markup for the consist strip: one drawing per car with its number under it.
export function consistHtml(c, color) {
  const n = c.cars.length;
  return c.cars.map(({ number, type }, i) => {
    const w = WIDTH[type?.kind || "coach"];
    const kind = type?.kind;
    // Driving cabs face outward: on the lead car, and on the last car when the
    // whole train is known.
    const ends = kind === "emu"
      ? { front: i === 0, back: c.complete && i === n - 1 }
      : { front: i === 0 && type?.cab, back: c.complete && i === n - 1 && type?.cab };
    let art = drawCar(type, color, w, ends);
    // A locomotive at the back of a push-pull train faces backward.
    if (LOCOMOTIVE.has(kind) && i > 0 && i === n - 1) {
      art = `<g transform="translate(${w} 0) scale(-1 1)">${art}</g>`;
    }
    const label = esc(type ? `${type.name} ${number}` : `Car ${number}`);
    return `<figure class="car" title="${label}">
      <svg viewBox="0 0 ${w} ${H}" width="${w}" height="${H}" role="img" aria-label="${label}">${art}</svg>
      <figcaption>${esc(number)}</figcaption>
    </figure>`;
  }).join("");
}
