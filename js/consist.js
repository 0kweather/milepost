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
  // MARC's single-level MARC II cars, GP39s and HHP-8s have no drawing yet.
  marc: [
    [10, 35, "mp36"], [80, 87, "charger"],
    [7800, 7834, "bilevel"], [7845, 7858, "bilevelCab"], [7870, 7876, "bilevel"], [7890, 7896, "bilevel"],
    [8000, 8034, "multilevel"], [8045, 8059, "multilevelCab"], [8090, 8094, "multilevel"],
  ],
  // GO Transit (Wikipedia, "GO Transit rolling stock"): MP40PH-3C 600-666
  // except 647, rebuilt as the prototype MP54AC; new MP54ACs 667-682.
  // BiLevel coaches 2000-2857 and 4000-4225, 4500-4533 (Series IX); the new
  // CEM cab cars 300-380. The older cab cars (200-214, 242-257) have no
  // drawing yet.
  go: [
    [600, 646, "mp40"], [647, 647, "mp54ac"], [648, 666, "mp40"], [667, 682, "mp54ac"],
    [300, 380, "bilevelCab"], [2000, 2857, "bilevel"], [4000, 4225, "bilevel"], [4500, 4533, "bilevel"],
  ],
  // CT Rail (Wikipedia, "Hartford Line" and "Shore Line East"): P40DC
  // 6700-6711, GP40-3H 6694-6699; Mafersa cab cars 1701-1719 (odd) and
  // coaches 1730-1774 (even). The M8s Shore Line East ran in 2022-26 came
  // from the shared Metro-North pool.
  ctrail: [
    [6700, 6711, "p40"], [6694, 6699, "gp40h"],
    [1701, 1719, "mafersaCab"], [1730, 1774, "mafersa"],
    [9101, 9580, "m8"],
  ],
  // South Shore Line (Wikipedia, "South Shore Line"): Nippon Sharyo
  // single-level cars 1-48 and 101-110, trailers 201-210; Highliner II
  // bi-levels 301-314 and 1201-1226 (from Metra). The feed names one car.
  southshore: [
    [1, 48, "nsEmu"], [101, 110, "nsEmu"], [201, 210, "nsTrailer"],
    [301, 314, "highliner"], [1201, 1226, "highliner"],
  ],
  // SunRail (Wikipedia, "SunRail", and photos of the cars' numbers): MP32PH-Q
  // 100-110; BiLevel cab cars 2000-2012, coaches 3000-3009. The feed names
  // the locomotive and the cab car.
  sunrail: [
    [100, 110, "mp32"], [2000, 2012, "bilevelCab"], [3000, 3009, "bilevel"],
  ],
  // VRE (Wikipedia, "Virginia Railway Express"): MP36PH-3C V50-V69; Gallery
  // IV cab cars 710-730 and coaches 800-879 (the cars carry a "V" before the
  // number).
  vre: [
    [50, 69, "mp36"], [710, 730, "galleryCab"], [800, 879, "gallery"],
  ],
  // Sounder: F59PHI 901-911, MP40PH-3C 921-923. Its BiLevel coaches and cab
  // cars are numbered in several series that aren't matched here.
  sounder: [
    [901, 911, "f59"], [921, 923, "mp40"],
  ],
  // New Mexico Rail Runner Express: MP36PH-3C 101-109; BiLevel coaches
  // 1001-1013 and cab cars 1101-1109.
  railrunner: [
    [101, 109, "mp36"], [1001, 1013, "bilevel"], [1101, 1109, "bilevelCab"],
  ],
  // ACE (Wikipedia, "Altamont Corridor Express"): F40PH-3C 3101-3106 (3101
  // and 3106 stored), SC-44 Chargers 3110-3115; BiLevel VI coaches
  // 3201-3222 and cab cars 3301-3308, BiLevel IX coaches from 3223 and cab
  // cars 3310-3314. The feed reports the locomotive's number.
  ace: [
    [3101, 3106, "f40c"], [3110, 3115, "charger"],
    [3201, 3234, "bilevel"], [3301, 3308, "bilevelCab"], [3310, 3314, "bilevelCab"],
  ],
  // exo (Wikipedia, "Exo commuter rail"): F59PHI 1320-1330, F59PH
  // 1341-1345, ALP-45DP 1350-1369, Siemens Chargers ("EC-42") 1400-1409;
  // BiLevel cab cars 2000-2003 and coaches 2020-2037; CRRC bi-level cab cars
  // 2050-2057 and coaches 2100-2135; MultiLevel cab cars 3000-3025 and
  // coaches 3026-3159 (160 cars in the 3000s, 26 of them cab cars).
  exo: [
    [1320, 1330, "f59"], [1341, 1345, "f59ph"], [1350, 1369, "alp45"], [1400, 1409, "charger"],
    [2000, 2003, "bilevelCab"], [2020, 2037, "bilevel"], [2050, 2057, "crrcBilevelCab"], [2100, 2135, "crrcBilevel"],
    [3000, 3025, "multilevelCab"], [3026, 3159, "multilevel"],
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
  p40: { name: "P40DC Genesis locomotive", kind: "diesel" },
  alc42: { name: "ALC-42 Charger locomotive", kind: "diesel" },
  charger: { name: "Siemens Charger locomotive", kind: "diesel" },
  p32: { name: "P32AC-DM dual-mode locomotive", kind: "diesel" },
  f59: { name: "F59PHI locomotive", kind: "diesel" },
  de30ac: { name: "DE30AC diesel locomotive", kind: "diesel" },
  dm30ac: { name: "DM30AC dual-mode locomotive", kind: "diesel" },
  mp36: { name: "MP36PH diesel locomotive", kind: "diesel" },
  mp40: { name: "MP40PH-3C diesel locomotive", kind: "diesel" },
  mp54ac: { name: "MP54AC diesel locomotive", kind: "diesel" },
  f40: { name: "F40PH diesel locomotive", kind: "diesel" },
  f40c: { name: "F40PH-3C diesel locomotive", kind: "diesel" },
  gp40: { name: "GP40MC diesel locomotive", kind: "diesel" },
  gp40h: { name: "GP40-3H diesel locomotive", kind: "diesel" },
  mp32: { name: "MP32PH-Q diesel locomotive", kind: "diesel" },
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
  nsEmu: { name: "Nippon Sharyo electric car", kind: "emu", pan: true },
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
  mafersa: { name: "Mafersa coach", kind: "coach" },
  mafersaCab: { name: "Mafersa cab car", kind: "coach", cab: true },
  nsTrailer: { name: "Nippon Sharyo trailer car", kind: "coach" },
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

// Light, nearly colorless paint (stainless, silver, white) dims in dark mode
// by --car-neutral-dim, as it would under softer light; every livery color
// is left exactly as painted.
function themable(svg) {
  return svg.replace(/(fill|stroke)="#([0-9a-f]{3}|[0-9a-f]{6})"/gi, (m, prop, hex) => {
    const h = hex.length === 3 ? [...hex].map((x) => x + x).join("") : hex;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    if (max < 0.55 || max - Math.min(r, g, b) > 0.12) return m;
    return `${m} style="${prop}:color-mix(in srgb, #${h}, #000 var(--car-neutral-dim, 0%))"`;
  });
}
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function typeOf(agency, number) {
  const n = Number(number);
  if (!Number.isInteger(n)) return null;
  const hit = (FLEETS[agency] || []).find(([a, b]) => n >= a && n <= b);
  // A type with no drawing yet (TYPES lacks it) isn't matched.
  return hit && TYPES[hit[2]] ? hit[2] : null;
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

// A type if it has a drawing, else a stand-in that does.
const drawable = (key, instead) => (TYPES[key] && MODELS[key] ? key : instead);

// Typical equipment for a train, or null. reported: the type of a car the
// feed named, which picks between a railroad's electric and diesel fleets.
function typicalFor(t, reported) {
  const dest = t.destination || "";
  switch (t.agency) {
    case "amtrak": return AMTRAK[t.route] || set("Locomotive with coaches", ["genesis", 1], ["amfleet", 5]);
    case "via": return VIA[t.route] || VIA.Corridor;
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
    case "marc": {
      // Penn Line: mostly SC-44 Chargers (some HHP-8 electrics), its rush-hour
      // trains mostly Kawasaki bi-levels, MultiLevels at other times. Camden
      // and Brunswick: MP36s (Chargers too on the Brunswick) with MultiLevels.
      const route = t.route || "";
      const loco = ["mp36", "charger"].includes(reported) ? reported : /Penn/i.test(route) ? "charger" : "mp36";
      const kawasaki = ["bilevel", "bilevelCab"].includes(reported) || (/Penn/i.test(route) && !["multilevel", "multilevelCab"].includes(reported));
      const name = loco === "charger" ? "SC-44 Charger" : "MP36PH";
      if (kawasaki) return set(`${name} locomotive with Kawasaki bi-levels (MultiLevels on some trains)`, [loco, 1], ["bilevel", 5], ["bilevelCab", 1]);
      return /Camden/i.test(route)
        ? set(`${name} locomotive with MultiLevel coaches (or Kawasaki bi-levels)`, [loco, 1], ["multilevel", 3], ["multilevelCab", 1])
        : set(`${name} locomotive with MultiLevel coaches`, [loco, 1], ["multilevel", 4], ["multilevelCab", 1]);
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
    // Most GO trains run 12 cars (11 coaches and a cab car) behind an
    // MP40PH-3C or MP54AC; the reported locomotive picks which.
    case "go": return set("MP54AC or MP40PH-3C locomotive with BiLevel coaches and a cab car, usually 12 cars",
      [reported === "mp40" ? "mp40" : "mp54ac", 1], ["bilevel", 11], ["bilevelCab", 1]);
    // CT Rail: both lines run push-pull sets, a P40DC (some trains a
    // GP40-3H) with Mafersa coaches and a cab car; Shore Line East went back
    // to them in 2026 after four years of M8 electric cars.
    case "ctrail": {
      if (reported === "m8") return set("M8 electric cars, usually 4", ["m8", 4]);
      const gp = reported === "gp40h";
      return set(`${gp ? "GP40-3H" : "P40DC"} locomotive with Mafersa coaches and a cab car`,
        [gp ? "gp40h" : "p40", 1], ["mafersa", 3], ["mafersaCab", 1]);
    }
    // South Shore Line: mostly Nippon Sharyo single-level cars, two to eight;
    // some Lakeshore Corridor trains are Highliner bi-levels. The Monon
    // Corridor's Hammond–Dyer shuttles are pairs of single-level cars.
    case "southshore": {
      if (reported === "highliner") return set("Highliner II bi-level electric cars, usually 2 to 8", ["highliner", 4]);
      if (/Monon/i.test(t.route || "")) return set("Nippon Sharyo single-level electric cars, usually 2", ["nsEmu", 2]);
      return reported === "nsTrailer"
        ? set("Nippon Sharyo single-level electric cars and a trailer, usually 2 to 8", ["nsEmu", 2], ["nsTrailer", 1], ["nsEmu", 3])
        : set("Nippon Sharyo single-level electric cars, usually 2 to 8", ["nsEmu", 6]);
    }
    // SunRail: an MP32PH-Q with a BiLevel coach and a cab car (the fleet has
    // ten coaches and thirteen cab cars for its eleven locomotives).
    case "sunrail": return set("MP32PH-Q locomotive with a BiLevel coach and a cab car (some trains two coaches)", ["mp32", 1], ["bilevel", 1], ["bilevelCab", 1]);
    // VRE: an MP36PH-3C with Gallery IV coaches and a cab car at the
    // Washington end, usually 6 to 8 cars on both lines.
    case "vre": return set("MP36PH-3C locomotive with gallery bi-levels and a cab car, usually 6 to 8 cars",
      ["mp36", 1], ["gallery", 6], ["galleryCab", 1]);
    // Sounder: an F59PHI or MP40PH-3C (the reported locomotive picks which)
    // with BiLevel coaches and a cab car: usually 7 cars on the S Line, 2 or
    // 3 on the N Line.
    case "sounder": {
      const loco = reported === "mp40" ? "mp40" : "f59", name = loco === "mp40" ? "MP40PH-3C" : "F59PHI";
      return /^N/.test(t.route || "")
        ? set(`${name} locomotive with BiLevel coaches and a cab car, usually 2 or 3 cars`, [loco, 1], ["bilevel", 1], ["bilevelCab", 1])
        : set(`${name} locomotive with BiLevel coaches and a cab car, usually 7 cars`, [loco, 1], ["bilevel", 6], ["bilevelCab", 1]);
    }
    // Rail Runner: an MP36PH-3C with BiLevel coaches and a cab car, usually
    // 4 cars.
    case "railrunner": return set("MP36PH-3C locomotive with BiLevel coaches and a cab car, usually 4 cars",
      ["mp36", 1], ["bilevel", 3], ["bilevelCab", 1]);
    // ACE: an SC-44 Charger (or an F40PH-3C, when the feed names one) with
    // BiLevel coaches and a cab car, usually 4 to 8 cars.
    case "ace": {
      const f40 = reported === "f40c";
      return set(`${f40 ? "F40PH-3C" : "SC-44 Charger"} locomotive with BiLevel coaches and a cab car, usually 4 to 8 cars`,
        [f40 ? "f40c" : "charger", 1], ["bilevel", 5], ["bilevelCab", 1]);
    }
    // exo: push-pull trains, the locomotive at the outbound end. The
    // ALP-45DPs run on diesel on the Vaudreuil-Hudson, Saint-Jérôme and
    // Mont-Saint-Hilaire lines (with F59PHIs and, since late 2025, Chargers);
    // F59PHIs on Candiac, F59PHs on Mascouche. Saint-Jérôme has the BiLevels
    // (and CRRC bi-levels), the others MultiLevels. The reported locomotive
    // or car picks.
    case "exo": {
      const route = t.route || "";
      const locos = { alp45: "ALP-45DP", f59: "F59PHI", f59ph: "F59PH", charger: "Charger" };
      const usual = /Mascouche/.test(route) ? "f59ph" : /Candiac/.test(route) ? "f59" : "alp45";
      const loco = drawable(locos[reported] ? reported : usual, /Mascouche/.test(route) ? "f59" : "charger");
      const name = locos[loco];
      if (reported === "crrcBilevel" || reported === "crrcBilevelCab") {
        return set(`${name} locomotive with CRRC bi-level coaches and a cab car`, [loco, 1], ["crrcBilevel", 5], [drawable("crrcBilevelCab", "bilevelCab"), 1]);
      }
      const bl = reported === "bilevel" || reported === "bilevelCab" || (/J[ée]r[ôo]me/.test(route) && !["multilevel", "multilevelCab"].includes(reported));
      if (bl) return set(`${name} locomotive with BiLevel coaches and a cab car (some trains CRRC bi-levels)`, [loco, 1], ["bilevel", 5], ["bilevelCab", 1]);
      const n = /Vaudreuil|Hilaire/.test(route) ? 6 : 4;
      return set(`${name} locomotive with MultiLevel coaches and a cab car`, [loco, 1], ["multilevel", n], ["multilevelCab", 1]);
    }
    default: return null;
  }
}

// { cars: [{ number, type }], complete, typical, summary, note } or null.
// A number from each of a railroad's fleet ranges, one per car type: for
// showing every type it runs, not only its lines' typical trains.
export function fleetSamples(agency) {
  const out = new Map();
  for (const [first, , key] of FLEETS[agency] || []) if (!out.has(key)) out.set(key, String(first));
  return [...out].map(([key, number]) => ({ key, number }));
}

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
// How each car of a consist is drawn: its type and model, its length, and
// the drawing context (which way it faces, its cabs, its neighbors).
function carsOf(c, color) {
  const n = c.cars.length;
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
    return { t, model, L, ctx, flip, number };
  });
}

// One car's drawing (without its id or reuse), as SVG content in feet.
function drawCar({ t, model, L, ctx, flip }, { couplers = true } = {}) {
  let drawing = themable(model.draw(ctx));
  // Locomotives draw no gangway: where one is coupled to the next unit,
  // draw its coupler out to the face so the two visibly connect.
  if (couplers && LOCOMOTIVE.has(t.kind)) {
    if (ctx.coupledL) drawing += locoCoupler(0, -1);
    if (ctx.coupledR) drawing += locoCoupler(L, 1);
  }
  return flip ? `<g transform="matrix(-1 0 0 1 ${L} 0)">${drawing}</g>` : drawing;
}

export function consistHtml(c, color) {
  // Identical cars (same model, same ends) are drawn once and reused.
  const drawn = new Map(), uid = `tsc${++renderSeq}`;
  return carsOf(c, color).map((car, i) => {
    const { t, model, L, ctx, flip, number } = car;
    const sig = [t.key, flip, ctx.lead, ctx.cabL, ctx.cabR, ctx.pan, ctx.pair, ctx.coupledL, ctx.coupledR, model.variant ? model.variant(ctx) : ""].join();
    let drawing;
    if (drawn.has(sig)) {
      drawing = `<use href="#${drawn.get(sig)}"/>`;
    } else {
      const id = `${uid}-${drawn.size}`;
      drawn.set(sig, id);
      drawing = `<g id="${id}">${drawCar(car)}</g>`;
    }
    const label = esc([t.name, number].filter(Boolean).join(" "));
    // Tapping a car shows what it is (app.js).
    return `<figure class="car" data-car="${i}" role="button" tabindex="0" title="${label}">
      <svg viewBox="0 0 ${L} ${HEIGHT_FT}" width="${Math.round(L * PX_PER_FT)}" height="${HEIGHT_FT * PX_PER_FT}" role="img" aria-label="${label}"><g transform="matrix(1 0 0 -1 0 ${HEIGHT_FT})">${drawing}</g></svg>
      ${number ? `<figcaption>${esc(number)}</figcaption>` : ""}
    </figure>`;
  }).join("");
}

// A single car of a consist, drawn on its own (no couplers to its
// neighbors), `width` px wide.
export function carSvg(c, i, color, width) {
  const car = carsOf(c, color)[i];
  if (!car) return "";
  const { L, t } = car;
  return `<svg class="car-portrait" viewBox="0 0 ${L} ${HEIGHT_FT}" width="${width}" height="${Math.round((width * HEIGHT_FT) / L)}" role="img" aria-label="${esc(t.name)}"><g transform="matrix(1 0 0 -1 0 ${HEIGHT_FT})">${drawCar(car, { couplers: false })}</g></svg>`;
}

// Where to look up car i's fact sheet (data/models.json), most specific
// first: model@railroad/route, model@railroad, model. The generic "coach"
// is an Amfleet I except on the Piedmont.
export function modelIds(c, i) {
  const key = c.cars[i]?.type?.key || "coach";
  const k = key === "coach" && !(c.agency === "amtrak" && c.route === "Piedmont") ? "amfleet" : key;
  return [`${k}@${c.agency}/${c.route || ""}`, `${k}@${c.agency}`, k];
}
