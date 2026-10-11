// What a train is made of.
//   - Live, from the car numbers a railroad reports: SEPTA lists every car in
//     the train, in order; LIRR and MBTA name one car of each train (not
//     necessarily the front one). Car numbers are matched against each
//     railroad's published fleet roster (number ranges by model); a number
//     outside every range isn't drawn.
//   - Otherwise, the equipment that typically runs on the train's route,
//     always labeled as typical. Sources: the railroads' published equipment
//     assignments as summarized on each route's Wikipedia page.
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

// name: what it's called; kind: how it's drawn. Flags: pan (pantograph),
// cab (driving cab), emu (powered car with cabs at the train's ends),
// rows2 (two rows of small windows), dome, baggage, lounge (big upper
// windows), paint (body color, for locomotives not in the railroad's color).
const TYPES = {
  // Locomotives
  acs64: { name: "ACS-64 electric locomotive", kind: "electric", pan: true },
  alp46: { name: "ALP-46 electric locomotive", kind: "electric", pan: true },
  acelaPower: { name: "Acela power car", kind: "electric", pan: true, paint: "#e6eaee" },
  genesis: { name: "P42 Genesis locomotive", kind: "diesel" },
  alc42: { name: "ALC-42 Charger locomotive", kind: "diesel" },
  charger: { name: "Siemens Charger locomotive", kind: "diesel" },
  p32: { name: "P32AC-DM dual-mode locomotive", kind: "diesel" },
  f59: { name: "F59PHI locomotive", kind: "diesel" },
  de30ac: { name: "DE30AC diesel locomotive", kind: "diesel" },
  dm30ac: { name: "DM30AC dual-mode locomotive", kind: "diesel" },
  mp36: { name: "MP36PH diesel locomotive", kind: "diesel" },
  f40: { name: "F40PH diesel locomotive", kind: "diesel" },
  gp40: { name: "GP40MC diesel locomotive", kind: "diesel" },
  hsp46: { name: "HSP46 diesel locomotive", kind: "diesel" },
  bl36: { name: "BL36PH diesel locomotive", kind: "diesel" },
  f125: { name: "F125 diesel locomotive", kind: "diesel" },
  // Electric and diesel multiple units
  silverliner4: { name: "Silverliner IV", kind: "emu", pan: true },
  silverliner5: { name: "Silverliner V", kind: "emu", pan: true },
  m7: { name: "M7", kind: "emu" },
  m7a: { name: "M7A", kind: "emu" },
  m8: { name: "M8", kind: "emu", pan: true },
  m9: { name: "M9", kind: "emu" },
  m3: { name: "M3", kind: "emu" },
  highliner: { name: "Highliner", kind: "bilevel", emu: true, pan: true },
  kiss: { name: "Stadler KISS car", kind: "bilevel", emu: true, pan: true },
  rdc: { name: "Budd Rail Diesel Car", kind: "emu" },
  smartDmu: { name: "Nippon Sharyo railcar", kind: "emu" },
  gtwCar: { name: "Stadler GTW passenger section", kind: "emu" },
  gtwPower: { name: "Stadler GTW power module", kind: "module" },
  // Single-level coaches
  pushPullCab: { name: "Bombardier cab car", kind: "coach", cab: true },
  pushPullCoach: { name: "Bombardier coach", kind: "coach" },
  singleCab: { name: "Single-level cab car", kind: "coach", cab: true },
  single: { name: "Single-level coach", kind: "coach" },
  acelaCoach: { name: "Acela coach", kind: "coach" },
  amfleet: { name: "Amfleet I coach", kind: "coach" },
  amfleet2: { name: "Amfleet II coach", kind: "coach" },
  metrolinerCab: { name: "Metroliner cab car", kind: "coach", cab: true },
  viewlinerBaggage: { name: "Viewliner baggage car", kind: "coach", baggage: true },
  viewlinerSleeper: { name: "Viewliner sleeping car", kind: "coach", rows2: true },
  viewlinerDiner: { name: "Viewliner dining car", kind: "coach" },
  venture: { name: "Venture coach", kind: "coach" },
  ventureCab: { name: "Venture cab car", kind: "coach", cab: true },
  shoreliner: { name: "Shoreliner coach", kind: "coach" },
  shorelinerCab: { name: "Shoreliner cab car", kind: "coach", cab: true },
  coach: { name: "Coach", kind: "coach" },
  buddBaggage: { name: "Baggage car", kind: "coach", baggage: true },
  buddCoach: { name: "Stainless coach", kind: "coach" },
  buddDiner: { name: "Dining car", kind: "coach" },
  buddSleeper: { name: "Sleeping car", kind: "coach", rows2: true },
  skyline: { name: "Skyline dome car", kind: "coach", dome: true },
  parkCar: { name: "Park observation car", kind: "coach", dome: true },
  talgo: { name: "Talgo car", kind: "talgo" },
  // Bi-levels
  c3Cab: { name: "C3 bi-level cab car", kind: "bilevel", cab: true },
  c3: { name: "C3 bi-level coach", kind: "bilevel" },
  kawasakiCab: { name: "Kawasaki bi-level cab car", kind: "bilevel", cab: true },
  rotemCab: { name: "Rotem bi-level cab car", kind: "bilevel", cab: true },
  bilevel: { name: "Bi-level coach", kind: "bilevel" },
  bilevelCab: { name: "Bi-level cab car", kind: "bilevel", cab: true },
  superlinerCoach: { name: "Superliner coach", kind: "bilevel" },
  superlinerSleeper: { name: "Superliner sleeping car", kind: "bilevel" },
  superlinerDiner: { name: "Superliner dining car", kind: "bilevel" },
  superlinerLounge: { name: "Superliner Sightseer Lounge", kind: "bilevel", lounge: true },
  californiaCar: { name: "California Car", kind: "bilevel" },
  californiaCab: { name: "California Car cab car", kind: "bilevel", cab: true },
  surfliner: { name: "Surfliner car", kind: "bilevel" },
  surflinerCab: { name: "Surfliner cab car", kind: "bilevel", cab: true },
  gallery: { name: "Gallery car", kind: "bilevel" },
  galleryCab: { name: "Gallery cab car", kind: "bilevel", cab: true },
  multilevel: { name: "MultiLevel coach", kind: "bilevel" },
  multilevelCab: { name: "MultiLevel cab car", kind: "bilevel", cab: true },
  // Other
  autorack: { name: "Auto carrier", kind: "autorack" },
};

const LOCOMOTIVE = new Set(["diesel", "electric"]);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function typeOf(agency, number) {
  const n = Number(number);
  if (!Number.isInteger(n)) return null;
  const hit = (FLEETS[agency] || []).find(([a, b]) => n >= a && n <= b);
  return hit ? hit[2] : null;
}

// ---------- Typical equipment by route ----------
// { label, units: [[type, count], ...] }

const set = (label, ...units) => ({ label, units });

const VIEWLINER_LD = set("Genesis or ALC-42 locomotives with Viewliner and Amfleet cars",
  ["genesis", 2], ["viewlinerBaggage", 1], ["viewlinerSleeper", 2], ["viewlinerDiner", 1], ["amfleet2", 3]);
const SUPERLINER_LD = set("Genesis or ALC-42 locomotives with Superliner cars",
  ["alc42", 2], ["viewlinerBaggage", 1], ["superlinerSleeper", 2], ["superlinerDiner", 1], ["superlinerLounge", 1], ["superlinerCoach", 2]);
const EMPIRE = set("P32AC-DM locomotive with Amfleet coaches", ["p32", 1], ["amfleet", 5]);
const DIESEL_AMFLEET = set("Genesis or ALC-42 locomotive with Amfleet coaches", ["genesis", 1], ["amfleet", 6]);
const MIDWEST = set("Charger locomotive with Venture coaches", ["charger", 1], ["venture", 4], ["ventureCab", 1]);
const SUPERLINER_SHORT = set("Locomotive with Superliner coaches", ["charger", 1], ["superlinerCoach", 3]);

const AMTRAK = {
  "Acela": set("Acela Express or Avelia Liberty trainset", ["acelaPower", 1], ["acelaCoach", 6], ["acelaPower", 1]),
  "Northeast Regional": set("ACS-64 locomotive with Amfleet coaches (diesel south of Washington)", ["acs64", 1], ["amfleet", 7]),
  "Keystone": set("ACS-64 locomotive with Amfleet coaches and a Metroliner cab car", ["acs64", 1], ["amfleet", 4], ["metrolinerCab", 1]),
  "Empire Service": EMPIRE, "Adirondack": EMPIRE, "Maple Leaf": EMPIRE, "Ethan Allen Express": EMPIRE,
  "Vermonter": DIESEL_AMFLEET, "Carolinian": DIESEL_AMFLEET, "Pennsylvanian": DIESEL_AMFLEET, "Downeaster": DIESEL_AMFLEET,
  "Palmetto": set("Genesis or ALC-42 locomotive with Amfleet coaches", ["genesis", 1], ["amfleet2", 6]),
  "Piedmont": set("F59PHI or Charger locomotive with NCDOT coaches", ["f59", 1], ["coach", 3]),
  "Crescent": VIEWLINER_LD, "Cardinal": VIEWLINER_LD, "Floridian": VIEWLINER_LD,
  "Lake Shore Limited": VIEWLINER_LD, "Silver Meteor": VIEWLINER_LD,
  "California Zephyr": SUPERLINER_LD, "Southwest Chief": SUPERLINER_LD, "Empire Builder": SUPERLINER_LD,
  "Coast Starlight": SUPERLINER_LD, "Texas Eagle": SUPERLINER_LD, "Sunset Limited": SUPERLINER_LD,
  "City of New Orleans": SUPERLINER_LD,
  "Auto Train": set("Charger locomotives with Superliner cars and auto carriers",
    ["charger", 2], ["superlinerSleeper", 2], ["superlinerDiner", 1], ["superlinerLounge", 1], ["superlinerCoach", 2], ["autorack", 3]),
  "Heartland Flyer": SUPERLINER_SHORT, "Borealis": SUPERLINER_SHORT, "Saluki": SUPERLINER_SHORT,
  "Wolverine": MIDWEST, "Blue Water": MIDWEST, "Pere Marquette": MIDWEST, "Hiawatha": MIDWEST,
  "Lincoln Service": MIDWEST, "Lincoln River Runner": MIDWEST, "Missouri River Runner": MIDWEST,
  "Carl Sandburg": MIDWEST, "Illinois Zephyr": MIDWEST, "Illini": MIDWEST,
  "Capitol Corridor": set("Charger or F59PHI locomotive with California Cars", ["charger", 1], ["californiaCar", 3], ["californiaCab", 1]),
  "San Joaquins": set("Charger locomotive with California Cars or Venture coaches", ["charger", 1], ["californiaCar", 4], ["californiaCab", 1]),
  "Pacific Surfliner": set("Charger or F59PHI locomotive with Surfliner bi-levels", ["charger", 1], ["surfliner", 5], ["surflinerCab", 1]),
  "Amtrak Cascades": set("Charger locomotive with a Talgo Series 8 trainset", ["charger", 1], ["talgo", 10]),
};

const VIA_BUDD = set("F40PH locomotive with Budd stainless cars", ["f40", 1], ["buddBaggage", 1], ["buddCoach", 1], ["skyline", 1], ["buddSleeper", 1]);
const VIA = {
  "Corridor": set("Siemens Venture trainset (some trains use LRC or HEP cars)", ["charger", 1], ["venture", 4], ["ventureCab", 1]),
  "Canadian": set("F40PH locomotives with Budd stainless cars",
    ["f40", 2], ["buddBaggage", 1], ["buddCoach", 2], ["skyline", 1], ["buddDiner", 1], ["buddSleeper", 3], ["parkCar", 1]),
  "Ocean": set("F40PH locomotive with stainless cars", ["f40", 1], ["buddBaggage", 1], ["buddCoach", 2], ["skyline", 1], ["buddSleeper", 2]),
  "Hudson Bay": VIA_BUDD, "Skeena": VIA_BUDD,
  "Abitibi": set("F40PH locomotive with Budd stainless cars", ["f40", 1], ["buddBaggage", 1], ["buddCoach", 2]),
  "Saguenay": set("F40PH locomotive with Budd stainless cars", ["f40", 1], ["buddBaggage", 1], ["buddCoach", 2]),
  "Lake Superior": set("Budd Rail Diesel Car", ["rdc", 1]),
};

// Typical equipment for a train, or null. reported: the type of a car the
// feed named, which picks between a railroad's electric and diesel fleets.
function typicalFor(t, reported) {
  const dest = t.destination || "";
  switch (t.agency) {
    case "amtrak": return AMTRAK[t.route] || set("Locomotive with coaches", ["genesis", 1], ["amfleet", 5]);
    case "via": return VIA[t.route] || VIA.Corridor;
    case "brightline": return set("Charger locomotives with Brightline coaches", ["charger", 1], ["venture", 4], ["charger", 1]);
    case "lirr": {
      const diesel = reported ? !["m7", "m9", "m3"].includes(reported)
        : /Montauk|Greenport|Oyster Bay/.test(t.route || "") || /Port Jefferson|Oyster Bay|Montauk|Greenport|Speonk/.test(dest);
      return diesel
        ? set("DE30AC or DM30AC locomotive with C3 bi-levels", ["de30ac", 1], ["c3", 4], ["c3Cab", 1])
        : set("M7 or M9 electric cars, usually 6 to 12", [reported === "m9" ? "m9" : "m7", 8]);
    }
    case "mnr":
      if (t.route === "Danbury" || t.route === "Waterbury" || /Poughkeepsie|Wassaic/.test(dest)) {
        return set("Diesel locomotive with Shoreliner coaches", ["p32", 1], ["shoreliner", 4], ["shorelinerCab", 1]);
      }
      return /New Haven|New Canaan/.test(t.route || "")
        ? set("M8 electric cars, usually 6 to 10", ["m8", 8])
        : set("M7A electric cars, usually 6 to 10", ["m7a", 8]);
    case "mbta": {
      const single = reported === "single" || reported === "singleCab";
      return single
        ? set("Diesel locomotive with single-level coaches", ["hsp46", 1], ["single", 5], ["singleCab", 1])
        : set("Diesel locomotive with bi-level coaches", ["hsp46", 1], ["bilevel", 5], [reported === "kawasakiCab" ? "kawasakiCab" : "rotemCab", 1]);
    }
    case "septa": return set("Silverliner IV or V cars, usually 2 to 6", ["silverliner4", 4]);
    case "njt": return set("Electric or dual-mode locomotive with MultiLevel coaches", ["alp46", 1], ["multilevel", 5], ["multilevelCab", 1]);
    case "metra": return t.route === "ME"
      ? set("Highliner electric cars", ["highliner", 4])
      : set("Diesel locomotive with gallery bi-levels", ["mp36", 1], ["gallery", 5], ["galleryCab", 1]);
    case "rtd": return set("Silverliner V electric cars, usually 2 to 4", ["silverliner5", 4]);
    case "frontrunner": return set("MP36PH locomotive with Bombardier bi-levels", ["mp36", 1], ["bilevel", 3], ["bilevelCab", 1]);
    case "capmetro": return set("Stadler GTW diesel railcar", ["gtwCar", 1], ["gtwPower", 1], ["gtwCar", 1]);
    case "trirail": return set("Diesel locomotive with bi-level coaches", ["bl36", 1], ["bilevel", 3], ["bilevelCab", 1]);
    case "caltrain": return set("Stadler KISS electric trainset", ["kiss", 7]);
    case "smart": return set("Nippon Sharyo diesel railcars", ["smartDmu", 2]);
    case "metrolink": return set("F125 locomotive with bi-level coaches", ["f125", 1], ["bilevel", 4], ["bilevelCab", 1]);
    default: return null;
  }
}

// { cars: [{ number, type }], complete, typical, summary, note } or null.
export function consistOf(t) {
  const reported = (t.cars?.numbers || []).map((number) => ({ number, key: typeOf(t.agency, number) }));
  const known = reported.filter((c) => c.key);
  // Every car, straight from the feed.
  if (t.cars?.complete && known.length) {
    const cars = reported.map(({ number, key }) => ({ number, type: TYPES[key] || null }));
    const models = [...new Set(known.map((c) => TYPES[c.key].name))];
    const coaches = cars.filter((c) => !LOCOMOTIVE.has(c.type?.kind)).length;
    const summary = [`${coaches} car${coaches === 1 ? "" : "s"}`, models.length <= 2 ? models.join(" + ") : null].filter(Boolean).join(" · ");
    return { cars, complete: true, typical: false, summary };
  }
  // What usually runs on this route.
  const typical = typicalFor(t, known[0]?.key);
  if (!typical) return null;
  const cars = typical.units.flatMap(([key, count]) => Array.from({ length: count }, () => ({ number: null, type: TYPES[key] })));
  const one = known[0];
  return {
    cars, complete: true, typical: true, summary: typical.label,
    reported: one ? { number: one.number, name: TYPES[one.key].name } : null,
  };
}

// ---------- Drawings ----------
// Side views, front of the train on the left. Units are px at 1x.

const H = 46;               // rails at the bottom
const HEAD = 6;             // headroom above y=0 for a bi-level's pantograph
const INK = "currentColor"; // outlines and running gear; follows the theme (--car-ink)
const STEEL = "#d7dbe0", STEEL_DARK = "#bcc2c9", GLASS = "#39414a";

const rect = (x, y, w, h, fill, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const headlight = (x) => `<circle cx="${x}" cy="34.5" r="1.6" fill="#fff6c8"/>`;

function axle(x) {
  return `<circle cx="${x}" cy="42.5" r="3" fill="${INK}"/><circle cx="${x}" cy="42.5" r="1" fill="${STEEL_DARK}"/>`;
}

function trucks(w, axles, at = [w * 0.17, w * 0.83]) {
  let s = "";
  for (const cx of at) {
    const span = axles === 3 ? 18 : 12;
    s += rect(cx - span / 2 - 3, 38.5, span + 6, 3.5, INK, 'rx="1.5"');
    for (let i = 0; i < axles; i++) s += axle(cx - span / 2 + (span / (axles - 1)) * i);
  }
  return s;
}

function pantograph(cx, top) {
  return `<g stroke="${INK}" stroke-width="1.1" fill="none" stroke-linecap="round">
    <path d="M${cx - 7} ${top} L${cx + 2} ${top - 6} L${cx - 3} ${top - 10}"/>
    <path d="M${cx - 9} ${top - 10} H${cx + 3}"/></g>`;
}

function windowRow(x, w, y, h, skip = [], pane = 7, gap = 3) {
  let s = "";
  for (let wx = x; wx + pane <= x + w; wx += pane + gap) {
    if (skip.some(([a, b]) => wx + pane > a && wx < b)) continue;
    s += rect(wx, y, pane, h, GLASS, 'rx="1.5"');
  }
  return s;
}

function door(x, y, h, wide = false) {
  const dw = wide ? 16 : 9;
  return rect(x, y, dw, h, STEEL_DARK, `stroke="${INK}" stroke-width="0.6" rx="1"`) +
    (wide ? "" : rect(x + 2.5, y + 3, 4, h * 0.38, GLASS, 'rx="1"'));
}

function locomotive(type, color, w) {
  const electric = type.kind === "electric", top = 11;
  let s = rect(1, top, w - 2, 38 - top, type.paint || color, `stroke="${INK}" stroke-width="1" rx="${electric ? 6 : 2.5}"`);
  s += rect(1.5, 30, w - 3, 2.5, type.paint ? color : "#fff", `opacity="${type.paint ? 1 : 0.85}"`);
  // Cab windshield at the front (and the back for electrics, which have two).
  s += rect(4, 15, 12, 7, GLASS, 'rx="1.5"');
  if (electric && !type.paint) s += rect(w - 16, 15, 12, 7, GLASS, 'rx="1.5"');
  if (!electric) for (let gx = 26; gx < w - 10; gx += 5) s += rect(gx, 15, 2.2, 10, "rgba(0,0,0,0.22)", 'rx="1"'); // radiator grilles
  s += headlight(4.5);
  if (type.pan) s += pantograph(w * 0.5, top);
  return s + trucks(w, electric ? 2 : 3);
}

// One car or locomotive. ends: which ends have a driving cab facing out.
function drawCar(type, color, w, { front = false, back = false, pan = false } = {}) {
  type ??= TYPES.coach;
  const kind = type.kind;
  if (LOCOMOTIVE.has(kind)) return locomotive(type, color, w);

  if (kind === "autorack") {
    let s = rect(1, 3, w - 2, 35, STEEL_DARK, `stroke="${INK}" stroke-width="1" rx="2"`);
    for (let x = 6; x < w - 4; x += 5) s += rect(x, 6, 1.4, 29, "rgba(0,0,0,0.16)");
    return s + rect(1.5, 31, w - 3, 2, color) + trucks(w, 2);
  }
  if (kind === "talgo") {
    // Short, low articulated cars sharing one axle between them.
    let s = rect(1, 17, w - 2, 21, STEEL, `stroke="${INK}" stroke-width="1" rx="3"`);
    s += windowRow(5, w - 10, 21, 6) + rect(1.5, 31, w - 3, 3, color);
    return s + rect(w - 8, 38.5, 8, 3.5, INK, 'rx="1.5"') + axle(w - 4);
  }
  if (kind === "module") {
    // A GTW's power module: a short boxy car between the passenger sections.
    let s = rect(1, 12, w - 2, 26, STEEL_DARK, `stroke="${INK}" stroke-width="1" rx="2"`);
    for (let gx = 6; gx < w - 6; gx += 4.5) s += rect(gx, 15, 2, 10, "rgba(0,0,0,0.22)", 'rx="1"');
    return s + rect(1.5, 31, w - 3, 3, color) + trucks(w, 2, [w / 2]);
  }

  const bilevel = kind === "bilevel";
  const top = bilevel ? 5 : 12;
  let s = rect(1, top, w - 2, 38 - top, STEEL, `stroke="${INK}" stroke-width="1" rx="${bilevel ? 4 : 3}"`);
  if (type.dome) {
    s += `<path d="M${w * 0.32} ${top + 1} Q${w * 0.36} ${top - 7} ${w * 0.45} ${top - 7} H${w * 0.6} Q${w * 0.67} ${top - 7} ${w * 0.7} ${top + 1} Z" fill="${GLASS}" stroke="${INK}" stroke-width="1"/>`;
  }
  // The railroad's color in a band along the side, below the windows.
  s += rect(1.5, 31, w - 3, 3, color);
  if (type.baggage) return s + door(w * 0.25 - 8, 15, 22.5, true) + door(w * 0.75 - 8, 15, 22.5, true) + trucks(w, 2);

  const doors = kind === "emu" ? [w * 0.24 - 4.5, w * 0.76 - 4.5] : bilevel ? [w * 0.3 - 4.5, w * 0.7 - 4.5] : [7, w - 16];
  const skip = doors.map((d) => [d - 1.5, d + 10.5]);
  const cabSkip = [...(front ? [[0, 14]] : []), ...(back ? [[w - 14, w]] : [])];
  if (bilevel) {
    s += type.lounge ? windowRow(5, w - 10, 8, 11, cabSkip, 14, 2) : windowRow(5, w - 10, 10, 7, cabSkip);
    s += windowRow(5, w - 10, 21, 7, [...skip, ...cabSkip]);
  } else if (type.rows2) {
    s += windowRow(5, w - 10, 15, 5, [...skip, ...cabSkip]) + windowRow(5, w - 10, 23, 5, [...skip, ...cabSkip]);
  } else {
    s += windowRow(5, w - 10, 17, 8, [...skip, ...cabSkip]);
  }
  for (const d of doors) s += door(d, bilevel ? 20 : 15, bilevel ? 17.5 : 22.5);
  const wsY = bilevel ? 10 : 16;
  if (front) s += rect(3, wsY, 9, 8, GLASS, 'rx="1.5"') + headlight(4.5);
  if (back) s += rect(w - 12, wsY, 9, 8, GLASS, 'rx="1.5"');
  if (kind === "emu") s += rect(w * 0.4, top - 2.5, w * 0.2, 2.5, STEEL_DARK, `stroke="${INK}" stroke-width="0.6" rx="1"`); // roof equipment
  if (pan) s += pantograph(w * 0.78, top);
  return s + trucks(w, 2);
}

const WIDTH = { diesel: 92, electric: 92, emu: 118, coach: 118, bilevel: 118, talgo: 56, module: 44, autorack: 118 };

// Markup for the consist strip: one drawing per car, with its number under it
// when the railroad reported one.
export function consistHtml(c, color) {
  const n = c.cars.length;
  return c.cars.map(({ number, type }, i) => {
    const kind = type?.kind || "coach";
    const w = WIDTH[kind];
    const multipleUnit = kind === "emu" || type?.emu;
    // Driving cabs face outward, at the front and back of the train.
    const ends = multipleUnit
      ? { front: i === 0, back: c.complete && i === n - 1 }
      : { front: i === 0 && type?.cab, back: c.complete && i === n - 1 && type?.cab };
    // Multiple units share a pantograph between each pair of cars.
    ends.pan = multipleUnit && type?.pan && i % 2 === 0;
    let art = drawCar(type, color, w, ends);
    // A locomotive at the back of the train faces backward.
    if (LOCOMOTIVE.has(kind) && i > 0 && i === n - 1) art = `<g transform="translate(${w} 0) scale(-1 1)">${art}</g>`;
    const label = esc([type?.name || "Car", number].filter(Boolean).join(" "));
    return `<figure class="car" title="${label}">
      <svg viewBox="0 ${-HEAD} ${w} ${H + HEAD}" width="${w}" height="${H + HEAD}" role="img" aria-label="${label}">${art}</svg>
      ${number ? `<figcaption>${esc(number)}</figcaption>` : ""}
    </figure>`;
  }).join("");
}
