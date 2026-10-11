// What a train is made of.
//   - Live, from the car numbers a railroad reports: SEPTA lists every car in
//     the train, in order; LIRR and MBTA name one car of each train (not
//     necessarily the front one). Car numbers are matched against each
//     railroad's published fleet roster (number ranges by model); a number
//     outside every range isn't drawn.
//   - Otherwise, the equipment that typically runs on the train's route,
//     always labeled as typical. Sources: the railroads' published equipment
//     assignments as summarized on each route's Wikipedia page.
// The drawings are Milepost's own side views, drawn from each model's real
// proportions and features (see Drawings below).

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

for (const [key, type] of Object.entries(TYPES)) type.key = key;

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
    return { cars, complete: true, typical: false, summary, agency: t.agency };
  }
  // What usually runs on this route.
  const typical = typicalFor(t, known[0]?.key);
  if (!typical) return null;
  const cars = typical.units.flatMap(([key, count]) => Array.from({ length: count }, () => ({ number: null, type: TYPES[key] })));
  const one = known[0];
  return {
    cars, complete: true, typical: true, summary: typical.label, agency: t.agency,
    reported: one ? { number: one.number, name: TYPES[one.key].name } : null,
  };
}

// ---------- Drawings ----------
// Side views, front of the train on the left, drawn from each model's real
// proportions: 118 px per 85 ft car along the train, and heights stretched
// about 1.6x so windows and doors still read at 1x in a narrow panel.
// Outlines and running gear use currentColor (--car-ink), so they follow the
// theme; everything else is flat color in the railroad's livery.

const FT_Y = 2.2;                  // px per foot of height
const RAIL = 46;                   // top of the rail
const HEAD = 6;                    // room above y=0 for pantographs and tall cars
const SILL = 39.4;                 // underside of a car body, about 3 ft up
const LOCO_SILL = 37.8;            // locomotives: frame line, with tanks below
const yAt = (ft) => RAIL - ft * FT_Y;

const INK = "currentColor";
const STEEL = "#d8dce1", STEEL_DARK = "#b2b8c0", GLASS = "#2e353d", CAB_BLACK = "#16191d", LAMP = "#ffe39a";
// Amtrak: Phase VI cars (mid-tone blue window band, red sill stripe), Phase V
// locomotives (light gray, blue top, red sill), Phase VII Chargers.
const AMTRAK_LIVERY = { blue: "#23589f", red: "#c8102e", gray: "#d5d9de", navy: "#17325c", sky: "#2f6ab3" };
const SEPTA = { red: "#cf2030", blue: "#1f4a98" };
const CASCADES = { cream: "#ede4cd", brown: "#6c4a35", green: "#2e5c3c" };

const r1 = (v) => Math.round(v * 10) / 10;
// Template tag that rounds every number in a path to 0.1 px.
const pd = (s, ...v) => s.reduce((o, str, i) => o + str + (i < v.length ? r1(v[i]) : ""), "");
const rect = (x, y, w, h, fill, more = "") =>
  `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="${fill}"${more ? " " + more : ""}/>`;
const path = (d, fill, more = "") => `<path d="${d}" fill="${fill}"${more ? " " + more : ""}/>`;
const outline = (d, w = 0.9) => path(d, "none", `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round"`);
const lamp = (x, y, r = 0.9) => `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="${LAMP}"/>`;
const poly = (pts) => "M" + pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join("L") + "Z";

// A car body: straight sides, rounded roof edges, and an optional drop
// center (a bi-level's low floor between the trucks): [from, to, bottom].
function bodyPath(x0, x1, T, B, { rt = 3, rb = 1.2, rtL = rt, rtR = rt, drop = null } = {}) {
  let d = pd`M${x0} ${T + rtL}Q${x0} ${T} ${x0 + rtL} ${T}H${x1 - rtR}Q${x1} ${T} ${x1} ${T + rtR}V${B - rb}Q${x1} ${B} ${x1 - rb} ${B}`;
  if (drop) d += pd`H${drop[1] + 2}L${drop[1]} ${drop[2]}H${drop[0]}L${drop[0] - 2} ${B}`;
  return d + pd`H${x0 + rb}Q${x0} ${B} ${x0} ${B - rb}Z`;
}

// Windows evenly spaced and centered in each clear stretch between a and b.
function windows(a, b, y, h, w, pitch, { gaps = [], r = 1.1, split = false } = {}) {
  const runs = [];
  let start = a;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g0 > start) runs.push([start, Math.min(g0, b)]);
    start = Math.max(start, g1);
  }
  if (start < b) runs.push([start, b]);
  let s = "";
  for (const [p, q] of runs) {
    if (q - p < w) continue;
    const n = Math.floor((q - p - w) / pitch) + 1;
    const x = p + (q - p - ((n - 1) * pitch + w)) / 2;
    for (let i = 0; i < n; i++) {
      const wx = x + i * pitch;
      s += split
        ? rect(wx, y, w / 2 - 0.35, h, GLASS, `rx="${r}"`) + rect(wx + w / 2 + 0.35, y, w / 2 - 0.35, h, GLASS, `rx="${r}"`)
        : rect(wx, y, w, h, GLASS, `rx="${r}"`);
    }
  }
  return s;
}

// A side door: outlined panel with its window; double doors split down the middle.
function door(x, y0, y1, w, { dbl = false, glass = true } = {}) {
  let s = rect(x, y0, w, y1 - y0, "rgba(0,0,0,0.08)", `stroke="${INK}" stroke-width="0.55" rx="0.4"`);
  if (dbl) s += path(pd`M${x + w / 2} ${y0}V${y1}`, "none", `stroke="${INK}" stroke-width="0.45"`);
  if (glass) {
    const gh = Math.min(4.6, (y1 - y0) * 0.32);
    s += dbl
      ? rect(x + 0.9, y0 + 2, w / 2 - 1.6, gh, GLASS, 'rx="0.4"') + rect(x + w / 2 + 0.7, y0 + 2, w / 2 - 1.6, gh, GLASS, 'rx="0.4"')
      : rect(x + w * 0.25, y0 + 2, w * 0.5, gh, GLASS, 'rx="0.4"');
  }
  return s;
}

// Doors are placed from an end ("l"/"r" plus an inset), centered ("c"), or
// at a fraction of the car's length.
function doorX(c, d) {
  if (d.at === "l") return c.x0 + (d.inset || 0);
  if (d.at === "r") return c.x1 - (d.inset || 0) - d.w;
  if (d.at === "c") return c.L / 2 - d.w / 2;
  return c.L * d.at - d.w / 2;
}

// A two-axle truck: wheels behind the side frame, journal boxes, and the
// bolster springs up to the body. Third-rail cars carry contact shoes.
function truck(cx, wb = 11.8, { shoe = false, top = SILL } = {}) {
  const a = cx - wb / 2, b = cx + wb / 2;
  let s = `<circle cx="${r1(a)}" cy="43.4" r="2.6" fill="${INK}"/><circle cx="${r1(b)}" cy="43.4" r="2.6" fill="${INK}"/>`;
  s += rect(cx - 2, top, 4, 41.4 - top, INK, 'opacity="0.55"');
  s += rect(a - 3, 41.3, wb + 6, 2.3, INK, 'rx="1.1"');
  s += rect(a - 0.8, 41.8, 1.6, 1.3, STEEL_DARK) + rect(b - 0.8, 41.8, 1.6, 1.3, STEEL_DARK);
  if (shoe) s += rect(a - 5.6, 44.1, 3, 0.9, INK) + rect(b + 2.6, 44.1, 3, 0.9, INK);
  return s;
}

// A single-arm pantograph, raised (or folded down on the roof).
function pantograph(cx, roof, up = true) {
  const g = `fill="none" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round"`;
  let s = rect(cx - 5, roof - 1, 1.8, 1, INK) + rect(cx + 3.2, roof - 1, 1.8, 1, INK);
  if (!up) return s + path(pd`M${cx - 5} ${roof - 1.5}L${cx + 4.5} ${roof - 2.3}L${cx - 2.5} ${roof - 2.9}`, "none", `${g} stroke-width="0.8"`);
  return s + path(pd`M${cx - 4.2} ${roof - 1.2}L${cx + 2.6} ${roof - 6.6}L${cx - 2} ${roof - 12}`, "none", `${g} stroke-width="0.9"`) +
    path(pd`M${cx - 5.8} ${roof - 12}H${cx + 1.8}`, "none", `${g} stroke-width="1.3"`);
}

const roofBox = (x, T, w, h = 1.8, fill = STEEL_DARK) => rect(x, T - h + 0.3, w, h, fill, `stroke="${INK}" stroke-width="0.5" rx="0.6"`);

// A louvered grille: a dark panel with vertical slats.
function louvers(x, y, w, h, fill = "rgba(0,0,0,0.18)") {
  let s = rect(x, y, w, h, fill, 'rx="0.4"');
  for (let lx = x + 1.1; lx < x + w - 0.8; lx += 1.7) s += rect(lx, y + 0.7, 0.7, h - 1.4, "rgba(0,0,0,0.32)");
  return s;
}

// Car ends: the rubber diaphragm between coupled cars (the strip has no gap,
// so neighbors' diaphragms meet) and the coupler.
function ends(c, a, b, diaphragm = true) {
  let s = "";
  if (c.coupledL && diaphragm) s += rect(0, a, 2, b - a, INK, 'opacity="0.55" rx="0.5"');
  if (c.coupledR && diaphragm) s += rect(c.L - 2, a, 2, b - a, INK, 'opacity="0.55" rx="0.5"');
  return s + rect(0, 39.5, 2.8, 1.4, INK) + rect(c.L - 2.8, 39.5, 2.8, 1.4, INK);
}

// x for a point measured from one end of the car, so cab details can be
// drawn at either end.
const fromEnd = (c, side) => (dx, w = 0) => (side === "l" ? c.x0 + dx : c.x1 - dx - w);

// ----- Liveries -----

function singleStripes(c, s, T, win) {
  const amtrak = c.agency === "amtrak";
  const below = win ? win.y + win.h : T + 10;
  if (amtrak && s.livery === "phase6") return [[win.y - 1.7, win.h + 3.4, AMTRAK_LIVERY.blue], [SILL - 2.3, 1.1, AMTRAK_LIVERY.red, 3.2]];
  if (amtrak && s.livery === "phase3") {
    const y = win ? below + 1.5 : T + 10.4;
    return [[y, 1.4, AMTRAK_LIVERY.red], [y + 1.4, 1.4, "#ffffff"], [y + 2.8, 1.4, AMTRAK_LIVERY.blue], [SILL - 2.3, 1.1, AMTRAK_LIVERY.red, 3.2]];
  }
  if (amtrak && s.livery === "acela") return [[below + 1, SILL - below - 1.4, "#c3c9d0", 1.4], [SILL - 2.4, 1.2, AMTRAK_LIVERY.red, 3]];
  return [[below + 1.8, 1.9, c.color], [below + 4.4, 0.7, c.color]];
}

function emuStripes(c, s, win) {
  const below = win.y + win.h;
  if (c.agency === "septa") return [[below + 1.6, 1.3, SEPTA.red], [below + 3.1, 1.3, SEPTA.blue]];
  return [[below + 1.6, 1.9, c.color], [below + 4.2, 0.7, c.color]];
}

function bilevelStripes(c, s, T, upBottom) {
  if (c.agency === "amtrak" && s.livery === "superliner") {
    // Phase VI on Superliners: narrow red, blue, red stripes under the upper windows.
    const y = upBottom + 1.4;
    return [[y, 0.8, AMTRAK_LIVERY.red], [y + 1.3, 1.8, AMTRAK_LIVERY.blue], [y + 3.6, 0.8, AMTRAK_LIVERY.red], [SILL - 2.4, 1.1, AMTRAK_LIVERY.red, 2.4]];
  }
  return [[upBottom + 1.8, 1.8, c.color], [SILL - 2.6, 1.4, c.color, 2.4]];
}

// ----- Single-level cars -----

function singleLevel(c, s) {
  const { x0, x1, L } = c, T = yAt(s.ft), B = SILL;
  const rt = s.rt ?? 3, rc = Math.max(rt, s.cabRound ?? rt);
  const d = bodyPath(x0, x1, T, B, { rt, rb: s.rb ?? 1.2, rtL: c.cabL ? rc : rt, rtR: s.obs ? 9 : c.cabR ? rc : rt });
  let o = path(d, s.body || STEEL);
  if (s.dome) o += dome(c, T, s.dome);
  const doors = (s.doors || []).map((dd) => ({ ...dd, x: doorX(c, dd) }));
  const gaps = doors.map((dd) => [dd.x - 1.3, dd.x + dd.w + 1.3]);
  if (c.cabL) gaps.push([x0, x0 + 8.6]);
  if (c.cabR) gaps.push([x1 - 8.6, x1]);
  if (s.obs) gaps.push([x1 - 9, x1]);
  const rows = s.rows || [];
  const main = rows[0] ? { y: T + rows[0].dy, h: rows[0].h } : null;
  for (const [y, h, fill, inset = 0.7] of singleStripes(c, s, T, main)) o += rect(x0 + inset, y, x1 - x0 - 2 * inset, h, fill);
  for (const dy of s.flutes || []) o += rect(x0 + 2.2, T + dy, x1 - x0 - 4.4, 0.55, STEEL_DARK);
  for (const r of rows) o += windows(x0 + (r.padL ?? 4), x1 - (r.padR ?? 4), T + r.dy, r.h, r.w, r.pitch, { gaps, r: r.r ?? 1.1 });
  for (const dd of doors) o += door(dd.x, T + (s.doorTop ?? 2.4), B - 0.5, dd.w, dd);
  if (s.obs) o += rect(x1 - 7, T + 3.4, 5.2, 5.6, GLASS, 'rx="1.6"'); // observation end windows
  for (const side of ["l", "r"]) if (side === "l" ? c.cabL : c.cabR) o += coachCab(c, side, T, B, s);
  o += truck(17.9) + truck(L - 17.9);
  o += outline(d);
  return o + ends(c, T + 3, B - 1);
}

function dome(c, T, [a, b]) {
  const x = c.L * a, w = c.L * (b - a), h = 6.2;
  const d = pd`M${x} ${T + 0.6}C${x + 1.4} ${T - h} ${x + 4} ${T - h} ${x + 7} ${T - h}H${x + w - 7}C${x + w - 4} ${T - h} ${x + w - 1.4} ${T - h} ${x + w} ${T + 0.6}Z`;
  let s = path(d, GLASS);
  for (let mx = x + 5; mx < x + w - 3; mx += 4.6) s += rect(mx, T - h + 0.6, 0.6, h, STEEL_DARK);
  return s + outline(d, 0.8);
}

// A coach's driving cab: windshield seen edge-on, the cab side window,
// headlight and ditch light on the lead car, anticlimber below.
function coachCab(c, side, T, B, s) {
  const X = fromEnd(c, side);
  let o = "";
  if (s.cabStyle === "charger") {
    // Venture cab cars share the Charger's raked cab.
    o += path(poly([[X(0.9), T + 8.6], [X(5.4), T + 1.4], [X(11), T + 1.4], [X(11), T + 8.6]]), CAB_BLACK);
  } else {
    o += rect(X(0.5, 2.6), T + 2.6, 2.6, 5.4, GLASS, 'rx="0.6"');
    o += rect(X(3.9, 3.6), T + 3, 3.6, 4.6, GLASS, 'rx="0.6"');
  }
  if (c.lead && side === "l") o += lamp(X(1.6), T + 1.8) + lamp(X(1.5), B - 2.6, 0.8);
  return o + rect(X(0.3, 3.4), B - 0.4, 3.4, 1.6, INK, 'opacity="0.7"');
}

// ----- Multiple units -----

function emuCar(c, s) {
  const { x0, x1, L } = c, T = yAt(s.ft), B = SILL;
  const rt = s.rt ?? 2.8, rc = s.rtCab ?? rt;
  const d = bodyPath(x0, x1, T, B, { rt, rb: 1, rtL: c.cabL ? rc : rt, rtR: c.cabR ? rc : rt });
  let o = path(d, STEEL);
  let roof = T;
  if (s.hump) {
    // Silverliner IV: the raised roof section over the dynamic-brake grids.
    const [a, b] = s.hump.map((f) => L * f);
    const hp = pd`M${a} ${T + 0.4}L${a + 2.2} ${T - 2.4}H${b - 2.2}L${b} ${T + 0.4}Z`;
    o += path(hp, STEEL);
    for (let gx = a + 5; gx < b - 4; gx += 6) o += rect(gx, T - 1.7, 2.6, 1, "rgba(0,0,0,0.3)");
    o += outline(hp, 0.7);
  }
  if (s.hvac) o += roofBox(x0 + 6.5, T, 15) + roofBox(x1 - 21.5, T, 15);
  if (s.roofPod) o += roofBox(L * 0.4, T, L * 0.2, 1.7);
  if (s.stacks) o += roofBox(L * 0.3, T, 2, 2.6) + roofBox(L * 0.68, T, 2, 2.6);
  const win = { y: T + s.win.dy, h: s.win.h };
  for (const [y, h, fill] of emuStripes(c, s, win)) o += rect(x0 + 0.7, y, x1 - x0 - 1.4, h, fill);
  for (const dy of s.flutes || []) o += rect(x0 + 2.2, T + dy, x1 - x0 - 4.4, 0.55, STEEL_DARK);
  const doors = (s.doorsBy?.[c.agency] || s.doors).map((dd) => ({ ...dd, x: doorX(c, dd) }));
  const gaps = doors.map((dd) => [dd.x - 1.3, dd.x + dd.w + 1.3]);
  gaps.push(c.cabL ? [x0, x0 + 9.4] : [x0, x0 + 2.5], c.cabR ? [x1 - 9.4, x1] : [x1 - 2.5, x1]);
  if (s.plug) gaps.push([L / 2 - 4, L / 2 + 4]);
  o += windows(x0 + 2, x1 - 2, win.y, s.win.h, s.win.w, s.win.pitch, { gaps, r: s.win.r ?? 0.9 });
  for (const dd of doors) o += door(dd.x, T + 2.6, B - 0.5, dd.w, dd);
  // Silverliner IV: a windowed panel where center doors were provided for but never fitted.
  if (s.plug) o += rect(L / 2 - 2.6, T + 2.8, 5.2, B - T - 3.4, "none", `stroke="${INK}" stroke-width="0.5" rx="0.4"`) + rect(L / 2 - 1.4, T + 4.6, 2.8, 4.4, GLASS, 'rx="0.4"');
  for (const side of ["l", "r"]) if (side === "l" ? c.cabL : c.cabR) o += emuCab(c, side, T, B, s);
  if (c.pan) o += pantograph(L * (s.panAt ?? 0.72), roof);
  o += truck(17.9, 11.8, { shoe: s.shoe }) + truck(L - 17.9, 11.8, { shoe: s.shoe });
  o += outline(d);
  return o + ends(c, T + 3, B - 1);
}

// An EMU's cab end: the front's color wrapping onto the side (black with a
// yellow stripe on the M7, blue with white stripes on the M7A), the cab side
// window, and lights on the lead car.
function emuCab(c, side, T, B, s) {
  const X = fromEnd(c, side);
  let o = "";
  if (s.cap) {
    o += rect(X(0.5, 3.2), T + 0.7, 3.2, B - T - 1.4, s.cap.fill, 'rx="0.8"');
    for (const [dy, h, fill] of s.cap.lines) o += rect(X(0.5, 3.2), T + dy, 3.2, h, fill === "rail" ? c.color : fill);
  } else {
    o += rect(X(0.5, 2.4), T + 2.8, 2.4, 5.2, GLASS, 'rx="0.6"');
  }
  o += rect(X(4.3, 3.6), T + 3.2, 3.6, 4.8, GLASS, 'rx="0.6"');
  if (c.lead && side === "l") o += lamp(X(2), T + 2.4) + lamp(X(1.9), B - 2.4, 0.8);
  return o;
}

// ----- Bi-levels -----

function bilevelCar(c, s) {
  const { x0, x1, L } = c, T = yAt(s.ft), B = SILL;
  const drop = [29, L - 29, s.dropY ?? 42.4];
  const rt = s.rt ?? 3.4, rc = s.rtCab ?? 6;
  const d = bodyPath(x0, x1, T, B, { rt, rb: 1.2, rtL: c.cabL ? rc : rt, rtR: c.cabR ? rc : rt, drop });
  let o = path(d, STEEL);
  const up = s.upper, lo = s.lower;
  const upY = T + up.dy, loY = T + lo.dy;
  for (const [y, h, fill, inset = 0.7] of bilevelStripes(c, s, T, upY + up.h)) o += rect(x0 + inset, y, x1 - x0 - 2 * inset, h, fill);
  const doors = (s.doors || []).map((dd) => ({ ...dd, x: doorX(c, dd) }));
  const gaps = doors.map((dd) => [dd.x - 1.3, dd.x + dd.w + 1.3]);
  const cabGaps = [];
  if (c.cabL) cabGaps.push([x0, x0 + 9]);
  if (c.cabR) cabGaps.push([x1 - 9, x1]);
  o += windows(x0 + (up.pad ?? 4), x1 - (up.pad ?? 4), upY, up.h, up.w, up.pitch, { gaps: cabGaps, split: up.split, r: up.r ?? 1 });
  for (const [a, b] of lo.segments || [[drop[0] + 2, drop[1] - 2]]) {
    o += windows(a, b, loY, lo.h, lo.w, lo.pitch, { gaps: [...gaps, ...cabGaps], r: lo.r ?? 1 });
  }
  for (const dd of doors) o += door(dd.x, T + (s.doorTop ?? 14.6), (dd.x > drop[0] && dd.x < drop[1] ? drop[2] : B) - 0.5, dd.w, dd);
  for (const side of ["l", "r"]) {
    if (!(side === "l" ? c.cabL : c.cabR)) continue;
    // The cab sits at the upper end: windshield and side window in a black surround.
    const X = fromEnd(c, side);
    o += rect(X(0.5, 9.4), T + 4.4, 9.4, 6.4, CAB_BLACK, 'rx="1"') + rect(X(5, 3.8), T + 5.4, 3.8, 4.2, "#4c5661", 'rx="0.5"');
    if (c.lead && side === "l") o += lamp(X(1.8), T + 2.6) + lamp(X(1.6), B - 2.6, 0.8);
  }
  if (c.pan) o += pantograph(L * 0.7, T);
  o += truck(17.9) + truck(L - 17.9);
  o += outline(d);
  return o + ends(c, T + 6, B - 1);
}

// ----- Locomotives -----

// Genesis (P42DC, P32AC-DM): a nose sloped all the way from the windshield
// to the pilot, a crease along the upper sides where they taper in, radiator
// fans at the back of the roof. Phase V: light gray, blue along the top with
// a wavy lower edge, red sill stripe.
function genesis(c, s) {
  const { x0, x1, L } = c, T = yAt(14.33), B = LOCO_SILL;
  const d = pd`M${x0 + 9.6} ${T}H${x1 - 1.6}Q${x1} ${T} ${x1} ${T + 1.6}V${B}H${x0 + 1.2}V${B - 4}L${x0 + 5.2} ${T + 8}L${x0 + 8.3} ${T + 1.3}Q${x0 + 8.7} ${T} ${x0 + 9.6} ${T}Z`;
  const amtrak = c.agency === "amtrak";
  let o = path(d, amtrak ? AMTRAK_LIVERY.gray : c.color);
  if (amtrak) {
    o += path(pd`M${x0 + 8.6} ${T + 0.5}H${x1 - 0.5}V${T + 6.2}C${x1 - 13} ${T + 8.4} ${x1 - 25} ${T + 3.8} ${x1 - 39} ${T + 5.8}S${x0 + 28} ${T + 8.2} ${x0 + 15} ${T + 6.6}H${x0 + 6.6}Z`, AMTRAK_LIVERY.blue);
    o += rect(x0 + 1.6, B - 1.7, x1 - x0 - 2.2, 1, AMTRAK_LIVERY.red);
  } else {
    o += rect(x0 + 2, B - 6, x1 - x0 - 2.6, 1.4, "#fff", 'opacity="0.85"');
  }
  o += rect(x0 + 9.4, T + 4.1, x1 - x0 - 10.2, 0.6, "rgba(0,0,0,0.2)");
  o += path(poly([[x0 + 5.6, T + 7.6], [x0 + 8.4, T + 1.8], [x0 + 10.6, T + 1.8], [x0 + 8.3, T + 7.6]]), GLASS);
  o += rect(x0 + 11.6, T + 1.9, 4.4, 4.2, GLASS, 'rx="0.6"');
  o += louvers(x1 - 23, T + 8.4, 13, 4.8) + louvers(x0 + 36, T + 8.8, 6, 4);
  o += roofBox(x1 - 25, T, 20, 1.5) + roofBox(L * 0.5, T, 2.2, 1.8);
  o += rect(34, B, 28, 2.6, INK, 'opacity="0.45" rx="1"');
  o += truck(22.5, 12.4, { shoe: s.shoe, top: B }) + truck(L - 22.5, 12.4, { shoe: s.shoe, top: B });
  if (c.lead) o += `<ellipse cx="${r1(x0 + 3.5)}" cy="${r1(T + 13)}" rx="0.9" ry="0.6" fill="${LAMP}"/>` + lamp(x0 + 1.9, B - 1.6, 0.8);
  o += outline(d);
  return o + ends(c, T + 4, B - 1);
}

// Siemens Charger (SC-44, ALC-42): a steeply raked windshield over an
// upright nose, big radiator louvers high on the rear sides.
function charger(c, s) {
  const { x0, x1, L } = c, T = yAt(14.1), B = LOCO_SILL;
  const d = pd`M${x0 + 11.8} ${T}H${x1 - 1.6}Q${x1} ${T} ${x1} ${T + 1.6}V${B}H${x0 + 0.8}V${B - 3}L${x0 + 2.4} ${B - 6}L${x0 + 2.6} ${T + 10}L${x0 + 4.2} ${T + 8.6}L${x0 + 10.4} ${T + 1}Q${x0 + 10.9} ${T} ${x0 + 11.8} ${T}Z`;
  const phase7 = c.agency === "amtrak" && s.phase7;
  let o = path(d, phase7 ? AMTRAK_LIVERY.sky : c.color);
  if (phase7) {
    // Phase VII: two blues divided by a curved white stripe; red and white sill stripes.
    const curve = pd`M${x0 + 19} ${B - 3.2}C${x0 + 42} ${B - 4} ${x1 - 34} ${T + 5.4} ${x1 - 0.5} ${T + 4.6}`;
    o += path(curve + pd`V${T + 0.5}H${x0 + 19}Z`, AMTRAK_LIVERY.navy);
    o += path(curve, "none", 'stroke="#fff" stroke-width="1.1"');
    o += rect(x0 + 2, B - 2.3, x1 - x0 - 2.6, 0.9, AMTRAK_LIVERY.red) + rect(x0 + 1.4, B - 1.3, x1 - x0 - 2, 0.6, "#fff");
  } else {
    o += rect(x0 + 2.6, B - 6, x1 - x0 - 3.2, 1.4, "#fff", 'opacity="0.85"');
  }
  // Black around the cab glass (flanked by white and red on Phase VII).
  o += path(poly([[x0 + 3.7, T + 9.6], [x0 + 10.1, T + 0.8], [x0 + 19, T + 0.8], [x0 + 19, T + 9.6]]), CAB_BLACK);
  if (phase7) o += rect(x0 + 19.4, T + 0.8, 1, 8.8, "#fff") + rect(x0 + 20.8, T + 0.8, 1.2, 8.8, AMTRAK_LIVERY.red);
  o += rect(x0 + 12.4, T + 2.2, 5.2, 4.8, "#4c5661", 'rx="0.6"');
  o += louvers(x1 - 27, T + 1.8, 20, 7);
  o += roofBox(x1 - 28, T, 22, 1.4);
  o += rect(36, B, 28, 2.6, INK, 'opacity="0.45" rx="1"');
  o += truck(23, 12.4, { top: B }) + truck(L - 23, 12.4, { top: B });
  if (c.lead) o += lamp(x0 + 2.2, B - 7.4) + lamp(x0 + 1.6, B - 1.8, 0.8);
  o += outline(d);
  return o + ends(c, T + 4, B - 1);
}

// Twin-cab electrics (ACS-64, ALP-46): a raked cab at each end, pantographs
// on the roof, equipment boxes slung between the trucks.
function twinElectric(c, s) {
  const { x0, x1, L } = c, T = yAt(s.ft ?? 14.1), B = LOCO_SILL;
  const k = s.boxy ? 0.55 : 1; // how far the windshields rake back
  const d = pd`M${x0 + 4 + 5.6 * k} ${T}H${x1 - 4 - 5.6 * k}Q${x1 - 3.2 - 5.2 * k} ${T} ${x1 - 3 - 4.9 * k} ${T + 1}L${x1 - 3.4} ${T + 9}L${x1 - 1.4} ${B - 5.5}V${B}H${x0 + 1.4}V${B - 5.5}L${x0 + 3.4} ${T + 9}L${x0 + 3 + 4.9 * k} ${T + 1}Q${x0 + 3.2 + 5.2 * k} ${T} ${x0 + 4 + 5.6 * k} ${T}Z`;
  const amtrak = c.agency === "amtrak";
  let o = path(d, amtrak ? AMTRAK_LIVERY.gray : c.color);
  if (amtrak) o += rect(x0 + 13, T + 0.5, x1 - x0 - 26, 4.2, AMTRAK_LIVERY.blue) + rect(x0 + 2.2, B - 1.7, x1 - x0 - 4.4, 1, AMTRAK_LIVERY.red);
  else o += rect(x0 + 2.4, B - 6, x1 - x0 - 4.8, 1.4, "#fff", 'opacity="0.85"');
  for (const side of ["l", "r"]) {
    const X = fromEnd(c, side);
    // Cab glass in a black surround: raked windshield and cab side window.
    o += path(poly([[X(3.7), T + 8.6], [X(3 + 4.9 * k), T + 1.4], [X(14.4), T + 1.4], [X(14.4), T + 8.6]]), CAB_BLACK);
    o += rect(X(9.6, 4), T + 2.4, 4, 4.4, "#4c5661", 'rx="0.5"');
    o += path(poly([[X(1.4), B], [X(6), B], [X(5), B + 2.6], [X(2.4), B + 2.6]]), INK, 'opacity="0.8"'); // pilot
  }
  o += louvers(L * 0.36, T + 5.6, 8, 6) + louvers(L * 0.54, T + 5.6, 8, 6);
  o += roofBox(L * 0.44, T, L * 0.12, 1.6);
  o += pantograph(L * 0.68, T) + pantograph(L * 0.3, T, false);
  o += rect(33, B, L - 66, 2.4, INK, 'opacity="0.4" rx="1"');
  o += truck(22.5, 12.6, { top: B }) + truck(L - 22.5, 12.6, { top: B });
  if (c.lead) o += lamp(x0 + 2.3, B - 4.4) + lamp(x0 + 2, B - 1.6, 0.8);
  o += outline(d);
  return o + ends(c, T + 4, B - 1);
}

// Acela Express power car: one long, low-sloped nose; gray body with a blue
// roof and a red sill stripe; pantograph toward the back.
function acelaPower(c) {
  const { x0, x1, L } = c, T = yAt(14), B = LOCO_SILL;
  const d = pd`M${x0 + 21} ${T}H${x1 - 1.6}Q${x1} ${T} ${x1} ${T + 1.6}V${B}H${x0 + 1.4}V${B - 3.4}Q${x0 + 1.4} ${T + 15.6} ${x0 + 4.6} ${T + 12.6}L${x0 + 16.2} ${T + 2}Q${x0 + 18.2} ${T} ${x0 + 21} ${T}Z`;
  let o = path(d, AMTRAK_LIVERY.gray);
  o += path(pd`M${x0 + 14.4} ${T + 3.8}L${x0 + 16.4} ${T + 1.8}Q${x0 + 18.2} ${T + 0.5} ${x0 + 21} ${T + 0.5}H${x1 - 0.5}V${T + 3.8}Z`, AMTRAK_LIVERY.blue);
  o += path(poly([[x0 + 6.4, T + 10.8], [x0 + 15.7, T + 2.6], [x0 + 18.4, T + 2.6], [x0 + 18.4, T + 5.6], [x0 + 10.2, T + 10.8]]), GLASS);
  o += rect(x0 + 3, B - 1.7, x1 - x0 - 3.6, 1, AMTRAK_LIVERY.red);
  o += louvers(x0 + 36, T + 6.4, 10, 5.4) + louvers(x0 + 50, T + 6.4, 10, 5.4) + louvers(x0 + 64, T + 6.4, 10, 5.4);
  o += roofBox(L * 0.42, T, 12, 1.6) + pantograph(L * 0.72, T);
  o += rect(34, B, 28, 2.4, INK, 'opacity="0.4" rx="1"');
  o += truck(23, 12.4, { top: B }) + truck(L - 23, 12.4, { top: B });
  if (c.lead) o += lamp(x0 + 3.2, T + 15.6) + lamp(x0 + 2, B - 1.6, 0.8);
  o += outline(d);
  return o + ends(c, T + 4, B - 1);
}

// Other cab-unit diesels, painted in the railroad's color: a flat, rounded
// (F59PHI) or angled (F125, BL36PH) cab, radiator louvers and fans at the
// back, fuel tank between two-axle trucks.
function cabUnit(c, s) {
  const { x0, x1, L } = c, T = yAt(s.ft), B = LOCO_SILL;
  const tail = pd`H${x1 - 1.6}Q${x1} ${T} ${x1} ${T + 1.6}V${B}H${x0 + 1.4}`;
  let d;
  if (s.nose === "round") d = pd`M${x0 + 12} ${T}` + tail + pd`V${B - 5}Q${x0 + 1.4} ${T + 6} ${x0 + 12} ${T}Z`;
  else if (s.nose === "angled") d = pd`M${x0 + 10} ${T}` + tail + pd`V${B - 6}L${x0 + 2.4} ${T + 9.6}L${x0 + 8.6} ${T + 0.9}Q${x0 + 9.1} ${T} ${x0 + 10} ${T}Z`;
  else d = pd`M${x0 + 6} ${T}` + tail + pd`V${T + 9}L${x0 + 3.6} ${T + 1.2}Q${x0 + 4.2} ${T} ${x0 + 6} ${T}Z`;
  let o = path(d, c.color);
  o += rect(x0 + 2.4, B - 6, x1 - x0 - 3, 1.4, "#fff", 'opacity="0.85"');
  // Cab glass: windshield and side window, dark against the paint.
  const g = s.nose === "flat" ? 3.4 : 6.6;
  o += path(poly([[x0 + g - 1.6, T + 8.2], [x0 + g + 1.2, T + 1.4], [x0 + g + 9.6, T + 1.4], [x0 + g + 9.6, T + 8.2]]), CAB_BLACK);
  o += rect(x0 + g + 4.6, T + 2.4, 4, 4.4, "#4c5661", 'rx="0.5"');
  o += louvers(x1 - 24, T + 2.4, 18, 5.4) + roofBox(x1 - 24, T, 18, 1.5) + roofBox(L * 0.5, T, 2.2, 1.8);
  o += rect(32, B, L - 64, 2.6, INK, 'opacity="0.45" rx="1"');
  o += truck(21, 12, { shoe: s.shoe, top: B }) + truck(L - 21, 12, { shoe: s.shoe, top: B });
  if (c.lead) o += lamp(x0 + 2.2, T + 11.6) + lamp(x0 + 1.9, B - 1.6, 0.8);
  o += outline(d);
  return o + ends(c, T + 4, B - 1);
}

// ----- Others -----

// Talgo (Amtrak Cascades): short, low cars sharing one axle at each joint,
// wheels mostly hidden behind skirts.
function talgoCar(c) {
  const { x0, x1, L } = c, T = yAt(11.2), B = 42.2;
  const d = bodyPath(x0, x1, T, B, { rt: 5.2, rb: 1.4 });
  const cascades = c.agency === "amtrak";
  let o = path(d, cascades ? CASCADES.cream : STEEL);
  if (cascades) o += rect(x0 + 0.7, 35.4, x1 - x0 - 1.4, B - 36, CASCADES.brown) + rect(x0 + 0.7, 33.8, x1 - x0 - 1.4, 1.2, CASCADES.green);
  else o += rect(x0 + 0.7, 33.8, x1 - x0 - 1.4, 1.6, c.color);
  o += windows(x0 + 6.4, x1 - 3, T + 4.4, 4.6, 6.2, 7.9);
  o += door(x0 + 1.6, T + 3, B - 0.5, 3.6);
  o += `<circle cx="${r1(L - 3)}" cy="43.4" r="2.6" fill="${INK}"/>` + rect(L - 6, 42.6, 6, 1.4, INK);
  o += outline(d);
  return o + ends(c, T + 3, B - 1);
}

// Auto Train's auto carriers: tall enclosed bi-level racks, all gray with a
// red stripe, ribbed sides.
function autorack(c) {
  const { x0, x1, L } = c, T = yAt(19), B = SILL;
  const d = bodyPath(x0, x1, T, B, { rt: 1.4, rb: 1 });
  let o = path(d, "#b9bec4");
  for (let x = x0 + 5; x < x1 - 3; x += 6.6) o += rect(x, T + 1.4, 0.8, B - T - 3, "rgba(0,0,0,0.16)");
  o += rect(x0 + 1, T + (B - T) * 0.48, x1 - x0 - 2, 0.7, "rgba(0,0,0,0.25)");
  o += rect(x0 + 1.2, B - 2.3, x1 - x0 - 2.4, 1.1, c.agency === "amtrak" ? AMTRAK_LIVERY.red : c.color);
  o += truck(19) + truck(L - 19);
  o += outline(d, 0.8);
  return o + ends(c, 0, 0, false);
}

// Stadler GTW passenger section: low floor, one truck at its outer end (the
// inner end rests on the power module), cab at the outer end. Drawn with the
// outer end on the left and mirrored when it's the back section.
function gtwCar(c) {
  const { x0, x1, L } = c, T = yAt(12.6), hi = SILL, lo = 41.6;
  const cab = c.cabL || c.cabR;
  const rl = cab ? 5.6 : 2.4;
  const d = pd`M${x0} ${T + rl}Q${x0} ${T} ${x0 + rl} ${T}H${x1 - 1}Q${x1} ${T} ${x1} ${T + 1}V${lo}H${x0 + 28}L${x0 + 26} ${hi}H${x0 + 1}Q${x0} ${hi} ${x0} ${hi - 1}Z`;
  let o = path(d, STEEL);
  o += rect(x0 + 0.7, T + 11.6, x1 - x0 - 1.4, 1.9, c.color);
  const dx = L * 0.62 - 3;
  o += windows(x0 + (cab ? 9.6 : 3), x1 - 2.5, T + 3.6, 6.2, 8, 9.6, { gaps: [[dx - 1.3, dx + 7.3]] });
  o += door(dx, T + 2.6, lo - 0.5, 6, { dbl: true });
  if (cab) {
    o += path(poly([[x0 + 0.9, T + 8.4], [x0 + 4.4, T + 1.4], [x0 + 8.6, T + 1.4], [x0 + 8.6, T + 8.4]]), GLASS);
    if (c.lead) o += lamp(x0 + 1.6, T + 12.4) + lamp(x0 + 1.4, hi - 2.4, 0.8);
  }
  o += roofBox(x0 + 30, T, 18, 1.4);
  o += truck(14);
  o += outline(d);
  return o + ends({ ...c, coupledL: c.coupledL && !cab }, T + 3, hi - 1);
}

// The GTW's power module: a short box between the passenger sections with a
// walkway window, engine louvers on both sides of it, and its own truck.
function gtwPower(c) {
  const { x0, x1, L } = c, T = yAt(13.6), B = SILL;
  const d = bodyPath(x0, x1, T, B, { rt: 1.4, rb: 1 });
  let o = path(d, "#c5cad0");
  o += louvers(x0 + 1.8, T + 2.6, 8.6, 9) + louvers(x1 - 10.4, T + 2.6, 8.6, 9);
  o += rect(L / 2 - 2.2, T + 3.2, 4.4, 6.2, GLASS, 'rx="0.6"');
  o += rect(x0 + 0.7, T + 13, x1 - x0 - 1.4, 1.9, c.color);
  o += roofBox(x0 + 3, T, x1 - x0 - 6, 2.2);
  o += truck(L / 2, 10.4);
  o += outline(d, 0.8);
  return o + ends(c, T + 3, B - 1);
}

// ----- What each type looks like -----
// Heights in feet; lengths in px (118 for an 85 ft car). Window rows are
// offsets from the roof line.

const AMFLEET = { draw: singleLevel, ft: 12.67, rt: 5.6, rb: 3, livery: "phase6", flutes: [13.2, 15, 16.8] };
const COMET = { draw: singleLevel, ft: 13.3, rows: [{ dy: 4.4, h: 5, w: 6, pitch: 7.6, padL: 8, padR: 8 }],
  doors: [{ at: "l", inset: 2.4, w: 4 }, { at: "r", inset: 2.4, w: 4 }] };
const BUDD = { draw: singleLevel, ft: 13.6, rt: 3.6, flutes: [2, 3.3, 15.2, 16.6, 18] };
const VENTURE = { draw: singleLevel, ft: 12.9, rt: 4.6, cabRound: 7, cabStyle: "charger",
  rows: [{ dy: 4, h: 5.6, w: 9.6, pitch: 11.2, padL: 8, padR: 8 }],
  doors: [{ at: "l", inset: 2.6, w: 4.4 }, { at: "r", inset: 2.6, w: 4.4 }] };
const SUPER = { draw: bilevelCar, ft: 16.17, rt: 4, livery: "superliner", doorTop: 16.4 };
const KAWASAKI = { draw: bilevelCar, ft: 15.5, upper: { dy: 3.4, h: 5, w: 7.2, pitch: 8.6 }, lower: { dy: 16.8, h: 4.6, w: 7.2, pitch: 8.6 },
  doors: [{ at: "l", inset: 27.6, w: 5 }, { at: "r", inset: 27.6, w: 5 }] };
const CALIFORNIA = { ...KAWASAKI, ft: 16 };
const GALLERY = { draw: bilevelCar, ft: 15.7, upper: { dy: 4, h: 4, w: 5.6, pitch: 7.6 }, lower: { dy: 16.4, h: 5.6, w: 7.6, pitch: 8.8 },
  doors: [{ at: "c", w: 6.4, dbl: true }] };
const MULTILEVEL = { draw: bilevelCar, ft: 15.9, upper: { dy: 3.6, h: 5, w: 7, pitch: 8.6 }, lower: { dy: 17, h: 4.6, w: 7, pitch: 8.6 },
  doors: [{ at: "l", inset: 2.6, w: 4.6 }, { at: "r", inset: 2.6, w: 4.6 }], doorTop: 11.6 };
const M7 = { draw: emuCar, ft: 12.92, rt: 2.8, rtCab: 3.6, hvac: true, shoe: true,
  win: { dy: 4.6, h: 6, w: 6.6, pitch: 8.2 }, doors: [{ at: 0.25, w: 5.8, dbl: true }, { at: 0.75, w: 5.8, dbl: true }] };
const SILVERLINER = { draw: emuCar, ft: 12.75 };

const DRAW = {
  // Locomotives
  acs64: { draw: twinElectric, len: 92 },
  alp46: { draw: twinElectric, len: 88, ft: 14.6, boxy: true },
  acelaPower: { draw: acelaPower, len: 96, oneEnd: true },
  genesis: { draw: genesis, len: 96, oneEnd: true },
  p32: { draw: genesis, len: 96, oneEnd: true, shoe: true },
  alc42: { draw: charger, len: 100, oneEnd: true, phase7: true },
  charger: { draw: charger, len: 99, oneEnd: true },
  f40: { draw: cabUnit, len: 78, ft: 15.5, nose: "flat", oneEnd: true },
  mp36: { draw: cabUnit, len: 94, ft: 15.4, nose: "flat", oneEnd: true },
  hsp46: { draw: cabUnit, len: 96, ft: 15.4, nose: "flat", oneEnd: true },
  gp40: { draw: cabUnit, len: 82, ft: 15.4, nose: "flat", oneEnd: true },
  de30ac: { draw: cabUnit, len: 96, ft: 14.6, nose: "flat", oneEnd: true },
  dm30ac: { draw: cabUnit, len: 96, ft: 14.6, nose: "flat", oneEnd: true, shoe: true },
  bl36: { draw: cabUnit, len: 94, ft: 15, nose: "angled", oneEnd: true },
  f59: { draw: cabUnit, len: 80, ft: 15.4, nose: "round", oneEnd: true },
  f125: { draw: cabUnit, len: 94, ft: 15, nose: "angled", oneEnd: true },
  // Multiple units
  m7: { ...M7, cap: { fill: "#16181b", lines: [[13.2, 1.2, "#f2c12e"]] } },
  m7a: { ...M7, cap: { fill: "#1d4e9a", lines: [[11.4, 0.6, "#fff"], [12.8, 0.6, "#fff"], [14.2, 0.6, "#fff"]] } },
  m9: { ...M7, win: { dy: 4.2, h: 6.4, w: 7.4, pitch: 9 }, cap: { fill: "#1f2328", lines: [[13, 1.2, "rail"]] } },
  m3: { ...M7, hvac: false, roofPod: true },
  m8: { ...M7, win: { dy: 4.2, h: 6.4, w: 7.4, pitch: 9 }, doors: [{ at: 0.25, w: 4.8 }, { at: 0.75, w: 4.8 }], panAt: 0.7,
    cap: { fill: "#1b1d20", lines: [[13, 1.2, "rail"]] } },
  silverliner4: { ...SILVERLINER, rt: 1.6, rtCab: 2.2, hump: [0.28, 0.72], plug: true, panAt: 0.86,
    win: { dy: 4.4, h: 4.8, w: 5.4, pitch: 7.4 }, doors: [{ at: "l", inset: 2.4, w: 4 }, { at: "r", inset: 2.4, w: 4 }] },
  silverliner5: { ...SILVERLINER, rt: 3.2, rtCab: 5.4, roofPod: true, panAt: 0.62,
    win: { dy: 3.8, h: 6, w: 8, pitch: 9.6 },
    doors: [{ at: "l", inset: 2.4, w: 4 }, { at: "r", inset: 2.4, w: 4 }, { at: "c", w: 6, dbl: true }],
    doorsBy: { rtd: [{ at: 0.27, w: 6, dbl: true }, { at: 0.73, w: 6, dbl: true }] } },
  rdc: { draw: emuCar, ft: 14.6, rt: 3.6, stacks: true, roofPod: true, flutes: [2, 3.3, 16.4, 17.8, 19.2, 20.6],
    win: { dy: 5.2, h: 5.6, w: 8.4, pitch: 9.8 }, doors: [{ at: "l", inset: 2.4, w: 4 }, { at: "r", inset: 2.4, w: 4 }] },
  smartDmu: { draw: emuCar, ft: 13.4, rt: 3.4, rtCab: 6, roofPod: true,
    win: { dy: 4, h: 6, w: 8.4, pitch: 10 }, doors: [{ at: 0.27, w: 6, dbl: true }, { at: 0.73, w: 6, dbl: true }] },
  highliner: { ...GALLERY },
  kiss: { ...KAWASAKI, ft: 15.1 },
  gtwCar: { draw: gtwCar, len: 77, oneEnd: true },
  gtwPower: { draw: gtwPower, len: 30 },
  // Single-level cars
  amfleet: { ...AMFLEET, rows: [{ dy: 6.1, h: 3.4, w: 7.4, pitch: 8.8, padL: 9, padR: 9 }],
    doors: [{ at: "l", inset: 2.4, w: 4 }, { at: "r", inset: 2.4, w: 4 }] },
  amfleet2: { ...AMFLEET, rows: [{ dy: 5.7, h: 4.2, w: 7.4, pitch: 8.8, padL: 4.5, padR: 9 }], doors: [{ at: "r", inset: 2.4, w: 4 }] },
  metrolinerCab: { ...AMFLEET, cabRound: 6.4, rows: [{ dy: 6.1, h: 3.4, w: 7.4, pitch: 8.8, padL: 9, padR: 9 }], doors: [{ at: "r", inset: 2.4, w: 4 }] },
  viewlinerSleeper: { draw: singleLevel, ft: 14, rt: 3.4, livery: "phase6",
    rows: [{ dy: 9.6, h: 5, w: 6.4, pitch: 8.4, padL: 4.5, padR: 9 }, { dy: 2.8, h: 3, w: 4.4, pitch: 8.4, padL: 4.5, padR: 9 }],
    doors: [{ at: "r", inset: 2.4, w: 4 }] },
  viewlinerDiner: { draw: singleLevel, ft: 14, rt: 3.4, livery: "phase3",
    rows: [{ dy: 3.6, h: 6.4, w: 9, pitch: 10.6, padL: 22, padR: 7 }], doors: [{ at: "l", inset: 2.4, w: 4 }] },
  viewlinerBaggage: { draw: singleLevel, ft: 14, rt: 3.4, livery: "phase3",
    doors: [{ at: 0.3, w: 10.4, glass: false }, { at: 0.7, w: 10.4, glass: false }] },
  acelaCoach: { draw: singleLevel, ft: 13.2, rt: 4.4, livery: "acela",
    rows: [{ dy: 4.2, h: 5.4, w: 7.8, pitch: 9.4, padL: 9, padR: 4 }], doors: [{ at: "l", inset: 2.4, w: 4 }] },
  venture: VENTURE,
  ventureCab: VENTURE,
  shoreliner: COMET, shorelinerCab: COMET, pushPullCab: COMET, pushPullCoach: COMET,
  singleCab: COMET, single: COMET, coach: COMET,
  buddCoach: { ...BUDD, rows: [{ dy: 5, h: 5.4, w: 8.6, pitch: 10.2, padL: 9, padR: 4 }], doors: [{ at: "l", inset: 2.4, w: 4 }] },
  buddDiner: { ...BUDD, rows: [{ dy: 5, h: 5.4, w: 9.4, pitch: 11, padL: 22, padR: 4 }], doors: [{ at: "r", inset: 2.4, w: 4 }] },
  buddSleeper: { ...BUDD, rows: [{ dy: 9, h: 4, w: 5.2, pitch: 7.2, padL: 4, padR: 9 }, { dy: 3.8, h: 3, w: 5.2, pitch: 7.2, padL: 4, padR: 9 }],
    flutes: [2, 15.2, 16.6, 18], doors: [{ at: "r", inset: 2.4, w: 4 }] },
  buddBaggage: { ...BUDD, flutes: [2, 3.3, 4.6, 15.2, 16.6, 18], doors: [{ at: 0.3, w: 10.4, glass: false }, { at: 0.7, w: 10.4, glass: false }] },
  skyline: { ...BUDD, dome: [0.38, 0.62], rows: [{ dy: 5, h: 5.4, w: 8.6, pitch: 10.2, padL: 9, padR: 4 }], doors: [{ at: "l", inset: 2.4, w: 4 }] },
  parkCar: { ...BUDD, dome: [0.5, 0.74], obs: true, rows: [{ dy: 5, h: 5.4, w: 8.6, pitch: 10.2, padL: 9, padR: 4 }], doors: [{ at: "l", inset: 2.4, w: 4 }] },
  talgo: { draw: talgoCar, len: 60 },
  // Bi-levels
  superlinerCoach: { ...SUPER, upper: { dy: 3.4, h: 5.4, w: 8.2, pitch: 10.2 }, lower: { dy: 17.8, h: 4.2, w: 6, pitch: 8, segments: [[64, 88]] },
    doors: [{ at: "c", w: 4.2 }] },
  superlinerSleeper: { ...SUPER, upper: { dy: 3.4, h: 5, w: 5.6, pitch: 7.2 }, lower: { dy: 17.8, h: 4.2, w: 5.6, pitch: 7.2, segments: [[31, 55], [63, 87]] },
    doors: [{ at: "c", w: 4.2 }] },
  superlinerDiner: { ...SUPER, upper: { dy: 3.4, h: 5.4, w: 8.2, pitch: 10.2, pad: 8 }, lower: { dy: 18, h: 3.6, w: 5, pitch: 7, segments: [[72, 82]] } },
  superlinerLounge: { ...SUPER, upper: { dy: 1.4, h: 10.6, w: 8.4, pitch: 9.6, r: 2.6, pad: 6 }, lower: { dy: 18.2, h: 3.6, w: 4.8, pitch: 7, segments: [[33, 53], [65, 85]] } },
  bilevel: KAWASAKI, bilevelCab: KAWASAKI, kawasakiCab: KAWASAKI, rotemCab: KAWASAKI, c3: KAWASAKI, c3Cab: KAWASAKI,
  californiaCar: CALIFORNIA, californiaCab: CALIFORNIA, surfliner: CALIFORNIA, surflinerCab: CALIFORNIA,
  gallery: GALLERY, galleryCab: GALLERY, multilevel: MULTILEVEL, multilevelCab: MULTILEVEL,
  // Other
  autorack: { draw: autorack, len: 122 },
};

// Markup for the consist strip: one drawing per car, with its number under it
// when the railroad reported one.
export function consistHtml(c, color) {
  const n = c.cars.length;
  return c.cars.map(({ number, type }, i) => {
    const t = type || TYPES.coach;
    const spec = DRAW[t.key] || DRAW.coach;
    const L = spec.len || 118;
    const multipleUnit = t.kind === "emu" || t.emu;
    const lead = i === 0, last = i === n - 1 && c.complete;
    // Driving cabs face outward, at the front and back of the train.
    const cabL = (multipleUnit || t.cab) && lead;
    const cabR = (multipleUnit || t.cab) && last && (multipleUnit || !lead);
    // A locomotive (or GTW section) at the back faces backward: drawn
    // facing forward, then mirrored.
    const flip = spec.oneEnd && i > 0 && i === n - 1;
    const ctx = {
      L, x0: 2, x1: L - 2, color, agency: c.agency, lead, cabL, cabR,
      // Multiple units share a pantograph between each pair of cars.
      pan: multipleUnit && t.pan && i % 2 === 0,
      coupledL: flip ? i < n - 1 : i > 0,
      coupledR: flip ? i > 0 : i < n - 1,
    };
    let art = spec.draw(ctx, spec);
    if (flip) art = `<g transform="matrix(-1 0 0 1 ${L} 0)">${art}</g>`;
    const label = esc([t.name, number].filter(Boolean).join(" "));
    return `<figure class="car" title="${label}">
      <svg viewBox="0 ${-HEAD} ${L} ${RAIL + HEAD}" width="${L}" height="${RAIL + HEAD}" role="img" aria-label="${label}">${art}</svg>
      ${number ? `<figcaption>${esc(number)}</figcaption>` : ""}
    </figure>`;
  }).join("");
}
