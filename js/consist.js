import { MODELS } from "./carmodels.js?v=dev";
import { PX_PER_FT, HEIGHT_FT, locoCoupler } from "./carart.js?v=dev";

// What a train is made of.
//   - Live, from the car numbers a railroad reports: SEPTA lists every car in
//     the train, in order; LIRR and MBTA name one car of each train (not
//     necessarily the front one). Car numbers are matched against each
//     railroad's published fleet roster (number ranges by model); a number
//     outside every range isn't drawn.
//   - Otherwise, the equipment that typically runs on the train's route,
//     always labeled as typical. Sources: the railroads' published equipment
//     assignments as summarized on each route's Wikipedia page.
// The drawings (carmodels.js) are Trainsheet's own side views, built from each
// model's published dimensions.

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
    [10, 11, "mp36"], [1025, 1036, "f40c"], [1050, 1075, "f40c"],
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
  acelaPower: { name: "Avelia Liberty power car", kind: "electric", pan: true, paint: "#e6eaee" },
  genesis: { name: "P42 Genesis locomotive", kind: "diesel" },
  alc42: { name: "ALC-42 Charger locomotive", kind: "diesel" },
  charger: { name: "Siemens Charger locomotive", kind: "diesel" },
  p32: { name: "P32AC-DM dual-mode locomotive", kind: "diesel" },
  f59: { name: "F59PHI locomotive", kind: "diesel" },
  de30ac: { name: "DE30AC diesel locomotive", kind: "diesel" },
  dm30ac: { name: "DM30AC dual-mode locomotive", kind: "diesel" },
  mp36: { name: "MP36PH diesel locomotive", kind: "diesel" },
  f40: { name: "F40PH diesel locomotive", kind: "diesel" },
  f40c: { name: "F40PH-3C diesel locomotive", kind: "diesel" },
  gp40: { name: "GP40MC diesel locomotive", kind: "diesel" },
  hsp46: { name: "HSP46 diesel locomotive", kind: "diesel" },
  bl36: { name: "BL36PH diesel locomotive", kind: "diesel" },
  f125: { name: "F125 diesel locomotive", kind: "diesel" },
  sd70mach: { name: "SD70MACH diesel locomotive", kind: "diesel" },
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
  kissCab: { name: "Stadler KISS cab car", kind: "bilevel", emu: true },
  rdc: { name: "Budd Rail Diesel Car", kind: "emu" },
  smartDmu: { name: "Nippon Sharyo railcar", kind: "emu" },
  gtwCar: { name: "Stadler GTW passenger section", kind: "emu" },
  gtwPower: { name: "Stadler GTW power module", kind: "module" },
  flirtCar: { name: "Stadler FLIRT passenger section", kind: "emu" },
  flirtPower: { name: "Stadler FLIRT power module", kind: "module" },
  // Single-level coaches
  pushPullCab: { name: "Bombardier cab car", kind: "coach", cab: true },
  pushPullCoach: { name: "Bombardier coach", kind: "coach" },
  singleCab: { name: "Single-level cab car", kind: "coach", cab: true },
  single: { name: "Single-level coach", kind: "coach" },
  acelaCoach: { name: "Avelia Liberty coach", kind: "coach" },
  amfleet: { name: "Amfleet I coach", kind: "coach" },
  amfleet2: { name: "Amfleet II coach", kind: "coach" },
  amfleetBusiness: { name: "Amfleet I business class car", kind: "coach" },
  amfleetCafe: { name: "Amfleet I cafe car", kind: "coach" },
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
  renaissanceCoach: { name: "Renaissance coach", kind: "coach" },
  renaissanceSleeper: { name: "Renaissance sleeping car", kind: "coach", rows2: true },
  renaissanceDiner: { name: "Renaissance service car", kind: "coach" },
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

// Two locomotives rarely match: a new ALC-42 Charger usually leads an older
// P42 Genesis.
const LD_PAIR = [["alc42", 1], ["genesis", 1]];
const VIEWLINER_LD = set("ALC-42 and Genesis locomotives with Viewliner and Amfleet cars",
  ...LD_PAIR, ["viewlinerBaggage", 1], ["viewlinerSleeper", 2], ["viewlinerDiner", 1], ["amfleet2", 3]);
const SUPERLINER_LD = set("ALC-42 and Genesis locomotives with Superliner cars",
  ...LD_PAIR, ["viewlinerBaggage", 1], ["superlinerSleeper", 2], ["superlinerDiner", 1], ["superlinerLounge", 1], ["superlinerCoach", 2]);
const EMPIRE = set("P32AC-DM locomotive with Amfleet coaches", ["p32", 1], ["amfleet", 5]);
const DIESEL_AMFLEET = set("Genesis or ALC-42 locomotive with Amfleet coaches", ["genesis", 1], ["amfleet", 6]);
// Midwest Venture sets run with a Charger at each end; only the Hiawatha's
// have cab cars.
const MIDWEST = set("Charger locomotives with Venture coaches", ["charger", 1], ["venture", 5], ["charger", 1]);
const HIAWATHA = set("Charger locomotive with Venture coaches and a cab car", ["charger", 1], ["venture", 5], ["ventureCab", 1]);
const SUPERLINER_SHORT = set("Charger locomotive with Superliner coaches", ["charger", 1], ["superlinerCoach", 3]);

const AMTRAK = {
  "Acela": set("Avelia Liberty trainset (some trips still use the original Acela Express)", ["acelaPower", 1], ["acelaCoach", 9], ["acelaPower", 1]),
  "Northeast Regional": set("ACS-64 locomotive with an Amfleet business class car, cafe and coaches (diesel south of Washington)", ["acs64", 1], ["amfleetBusiness", 1], ["amfleetCafe", 1], ["amfleet", 6]),
  "Keystone": set("ACS-64 locomotive with Amfleet coaches and a Metroliner cab car", ["acs64", 1], ["amfleet", 4], ["metrolinerCab", 1]),
  "Empire Service": EMPIRE, "Adirondack": EMPIRE, "Maple Leaf": EMPIRE, "Ethan Allen Express": EMPIRE,
  "Vermonter": DIESEL_AMFLEET, "Carolinian": DIESEL_AMFLEET, "Pennsylvanian": DIESEL_AMFLEET, "Downeaster": DIESEL_AMFLEET,
  "Palmetto": set("ALC-42 locomotive with Amfleet coaches", ["alc42", 1], ["amfleet2", 6]),
  "Piedmont": set("F59PHI or Charger locomotive with NCDOT coaches", ["f59", 1], ["coach", 3]),
  "Crescent": VIEWLINER_LD, "Cardinal": VIEWLINER_LD, "Floridian": VIEWLINER_LD,
  "Lake Shore Limited": VIEWLINER_LD, "Silver Meteor": VIEWLINER_LD,
  "California Zephyr": SUPERLINER_LD, "Southwest Chief": SUPERLINER_LD, "Empire Builder": SUPERLINER_LD,
  "Coast Starlight": SUPERLINER_LD, "Texas Eagle": SUPERLINER_LD, "Sunset Limited": SUPERLINER_LD,
  "City of New Orleans": SUPERLINER_LD,
  "Auto Train": set("ALC-42 and Genesis locomotives with Superliner cars and auto carriers",
    ...LD_PAIR, ["superlinerSleeper", 2], ["superlinerDiner", 1], ["superlinerLounge", 1], ["superlinerCoach", 2], ["autorack", 3]),
  "Heartland Flyer": set("Genesis locomotive with Superliner coaches", ["genesis", 1], ["superlinerCoach", 3]),
  "Borealis": SUPERLINER_SHORT,
  // CN keeps the Venture cars off its line south of Chicago.
  "Saluki": set("Charger locomotive with Superliner coaches", ["charger", 1], ["superlinerCoach", 5]),
  "Illini": set("Charger locomotive with Superliner coaches", ["charger", 1], ["superlinerCoach", 5]),
  "Wolverine": MIDWEST, "Blue Water": MIDWEST, "Pere Marquette": MIDWEST, "Hiawatha": HIAWATHA,
  "Lincoln Service": MIDWEST, "Lincoln River Runner": MIDWEST, "Missouri River Runner": MIDWEST,
  "Carl Sandburg": MIDWEST, "Illinois Zephyr": MIDWEST,
  "Capitol Corridor": set("Charger or F59PHI locomotive with California Cars", ["charger", 1], ["californiaCar", 3], ["californiaCab", 1]),
  "San Joaquins": set("Charger locomotive with a Caltrans Venture trainset (some trains still use California Cars)", ["charger", 1], ["venture", 5], ["ventureCab", 1]),
  "Pacific Surfliner": set("Charger or F59PHI locomotive with Surfliner bi-levels", ["charger", 1], ["surfliner", 5], ["surflinerCab", 1]),
  "Amtrak Cascades": set("ALC-42E locomotive with an Airo trainset", ["alc42", 1], ["venture", 6], ["ventureCab", 1]),
};

const VIA_BUDD = set("F40PH locomotive with Budd stainless cars", ["f40", 1], ["buddBaggage", 1], ["buddCoach", 1], ["skyline", 1], ["buddSleeper", 1]);
const VIA = {
  "Corridor": set("Siemens Venture trainset (some trains use LRC or HEP cars)", ["charger", 1], ["venture", 4], ["ventureCab", 1]),
  "Canadian": set("F40PH locomotives with Budd stainless cars",
    ["f40", 2], ["buddBaggage", 1], ["buddCoach", 2], ["skyline", 1], ["buddDiner", 1], ["buddSleeper", 3], ["parkCar", 1]),
  "Ocean": set("F40PH locomotive with Renaissance cars", ["f40", 1], ["renaissanceCoach", 2], ["renaissanceDiner", 1], ["renaissanceSleeper", 3]),
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
    // A Charger at each end of four coaches (green, red, purple, and blue Premium).
    // Seven coaches since the 2024–25 expansion (five Smart, two Premium).
    case "brightline": return set("Charger locomotives with 7 Brightline coaches", ["charger", 1], ["venture", 7], ["charger", 1]);
    case "lirr": {
      const diesel = reported ? !["m7", "m9", "m3"].includes(reported)
        : /Montauk|Greenport|Oyster Bay/.test(t.route || "") || /Port Jefferson|Oyster Bay|Montauk|Greenport|Speonk/.test(dest);
      return diesel
        ? set("DE30AC or DM30AC locomotive with C3 bi-levels", ["de30ac", 1], ["c3", 4], ["c3Cab", 1])
        : set("M7 or M9 electric cars, usually 6 to 12", [reported === "m9" ? "m9" : "m7", 8]);
    }
    case "mnr":
      // The new SC-42DM Chargers run the Hudson Line to Poughkeepsie; the
      // Danbury and upper Harlem trains still have P32AC-DMs.
      if (/Poughkeepsie/.test(dest) && !/Danbury|Waterbury|Harlem/.test(t.route || "")) {
        return set("SC-42DM Charger locomotive with Shoreliner coaches", ["charger", 1], ["shoreliner", 4], ["shorelinerCab", 1]);
      }
      if (t.route === "Danbury" || t.route === "Waterbury" || /Wassaic/.test(dest)) {
        return set("P32AC-DM locomotive with Shoreliner coaches", ["p32", 1], ["shoreliner", 4], ["shorelinerCab", 1]);
      }
      return /New Haven|New Canaan/.test(t.route || "")
        ? set("M8 electric cars, usually 6 to 10", ["m8", 8])
        : set("M7A electric cars, usually 6 to 10", ["m7a", 8]);
    case "mbta": {
      const single = reported === "single" || reported === "singleCab";
      // The locomotive the feed named, when it named one.
      const loco = ["hsp46", "f40c", "gp40", "mp36"].includes(reported) ? reported : "hsp46";
      return single
        ? set("Diesel locomotive with single-level coaches", [loco, 1], ["single", 5], ["singleCab", 1])
        : set("Diesel locomotive with bi-level coaches", [loco, 1], ["bilevel", 5], [reported === "kawasakiCab" ? "kawasakiCab" : "rotemCab", 1]);
    }
    case "septa": return set("Silverliner IV or V cars, usually 2 to 6", ["silverliner4", 4]);
    case "njt": return set("Electric or dual-mode locomotive with MultiLevel coaches", ["alp46", 1], ["multilevel", 5], ["multilevelCab", 1]);
    case "metra": return t.route === "ME"
      ? set("Highliner electric cars", ["highliner", 4])
      : ["MD-N", "MD-W"].includes(t.route)
        ? set("SD70MACH locomotive with gallery bi-levels", ["sd70mach", 1], ["gallery", 5], ["galleryCab", 1])
        : set("Diesel locomotive with gallery bi-levels", ["mp36", 1], ["gallery", 5], ["galleryCab", 1]);
    case "rtd": return set("Silverliner V electric cars, usually 2 to 4", ["silverliner5", 4]);
    case "frontrunner": return set("MP36PH locomotive with Bombardier bi-levels", ["mp36", 1], ["bilevel", 3], ["bilevelCab", 1]);
    case "capmetro": return set("Stadler GTW diesel railcar", ["gtwCar", 1], ["gtwPower", 1], ["gtwCar", 1]);
    case "trirail": return set("Diesel locomotive with bi-level coaches", ["bl36", 1], ["bilevel", 3], ["bilevelCab", 1]);
    case "caltrain": return set("Stadler KISS electric trainset", ["kissCab", 1], ["kiss", 5], ["kissCab", 1]);
    case "smart": return set("Nippon Sharyo diesel railcars", ["smartDmu", 2]);
    // Arrow (San Bernardino–Redlands, trains 38xx): Stadler FLIRT railcars.
    case "metrolink": return /^38\d\d$/.test(t.number || "") || /Redlands/.test(dest)
      ? set("Stadler FLIRT railcar", ["flirtCar", 1], ["flirtPower", 1], ["flirtCar", 1])
      : set("F125 locomotive with bi-level coaches", ["f125", 1], ["bilevel", 4], ["bilevelCab", 1]);
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
    return { cars, complete: true, typical: false, summary, agency: t.agency, route: t.route };
  }
  // What usually runs on this route.
  const typical = typicalFor(t, known[0]?.key);
  if (!typical) return null;
  const cars = typical.units.flatMap(([key, count]) => Array.from({ length: count }, () => ({ number: null, type: TYPES[key] })));
  const one = known[0];
  return {
    cars, complete: true, typical: true, summary: typical.label, agency: t.agency, route: t.route,
    reported: one ? { number: one.number, name: TYPES[one.key].name } : null,
  };
}

// ---------- Drawings ----------
// Each type is drawn by its model in carmodels.js, from real dimensions at a
// shared scale (carart.js). Lengths are over the couplers, in feet.

const art = (key) => MODELS[key] || MODELS.coach;

// Markup for the consist strip: one drawing per car, with its number under it
// when the railroad reported one.
let renderSeq = 0;
export function consistHtml(c, color) {
  const n = c.cars.length;
  // Identical cars (same model, same ends) are drawn once and reused.
  const drawn = new Map(), uid = `tsc${++renderSeq}`;
  // Married pairs: a car whose neighbor carries the next or previous number is
  // half of a pair (0: the front half, 1: its mate, drawn facing backward); a
  // numbered car with no mate beside it is a single, with a cab at each end.
  // Without numbers, cars pair up in order.
  const nums = c.cars.map((x) => Number(x.number));
  const mate = (i, j) => j >= 0 && j < n && Number.isInteger(nums[i]) && Math.abs(nums[i] - nums[j]) === 1 && c.cars[j].type?.key === c.cars[i].type?.key;
  const pairOf = (i) => (!Number.isInteger(nums[i]) || !c.cars[i].number ? i % 2 : mate(i, i + 1) && !(mate(i, i - 1) && pairOf(i - 1) === 0) ? 0 : mate(i, i - 1) ? 1 : 2);
  return c.cars.map(({ number, type }, i) => {
    const t = type || TYPES.coach;
    const model = art(t.key);
    const L = typeof model.len === "function" ? model.len(c.agency) : model.len;
    const multipleUnit = t.kind === "emu" || t.emu;
    const lead = i === 0, last = i === n - 1 && c.complete;
    // Driving cabs face outward, at the front and back of the train.
    const cabL = (multipleUnit || t.cab) && lead;
    const cabR = (multipleUnit || t.cab) && last && (multipleUnit || !lead);
    // Single-cab equipment at the back faces backward: drawn facing forward,
    // then mirrored.
    const flip = model.oneEnd && i > 0 && i === n - 1;
    const ctx = {
      L, color, agency: c.agency, lead, cabL: flip ? false : cabL, cabR: flip ? false : cabR, mirrored: flip,
      // Multiple units share a pantograph between each pair of cars.
      pan: multipleUnit && t.pan && i % 2 === 0,
      pair: pairOf(i), index: i, count: n, route: c.route,
      coupledL: flip ? i < n - 1 : i > 0,
      coupledR: flip ? i > 0 : i < n - 1,
    };
    if (flip) ctx.cabL = true;
    const sig = [t.key, flip, ctx.lead, ctx.cabL, ctx.cabR, ctx.pan, ctx.pair, ctx.coupledL, ctx.coupledR, model.variant ? model.variant(ctx) : ""].join();
    let drawing;
    if (drawn.has(sig)) {
      drawing = `<use href="#${drawn.get(sig)}"/>`;
    } else {
      const id = `${uid}-${drawn.size}`;
      drawn.set(sig, id);
      drawing = model.draw(ctx);
      // Locomotives draw no gangway: where one is coupled to the next unit,
      // draw its coupler out to the face so the two visibly connect.
      if (LOCOMOTIVE.has(t.kind)) {
        if (ctx.coupledL) drawing += locoCoupler(0, -1);
        if (ctx.coupledR) drawing += locoCoupler(L, 1);
      }
      if (flip) drawing = `<g transform="matrix(-1 0 0 1 ${L} 0)">${drawing}</g>`;
      drawing = `<g id="${id}">${drawing}</g>`;
    }
    const label = esc([t.name, number].filter(Boolean).join(" "));
    return `<figure class="car" title="${label}">
      <svg viewBox="0 0 ${L} ${HEIGHT_FT}" width="${Math.round(L * PX_PER_FT)}" height="${HEIGHT_FT * PX_PER_FT}" role="img" aria-label="${label}"><g transform="matrix(1 0 0 -1 0 ${HEIGHT_FT})">${drawing}</g></svg>
      ${number ? `<figcaption>${esc(number)}</figcaption>` : ""}
    </figure>`;
  }).join("");
}
