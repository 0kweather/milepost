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
  njt: [4.44, true], "njt-word": [4.98, true], septa: [1, true], "septa-word": [3.98, false], "septa-mark-white": [1.384, false],
  "mta-inverse": [0.91, false], metra: [3.68, true], caltrain: [1.77, false],
  metrolink: [7.75, true], "metrolink-teal": [7.75, false], rtd: [2.2, true], capmetro: [4.14, true], trirail: [4.4, false], "trirail-onnavy": [4.4, false],
  smart: [3.31, false], frontrunner: [12.85, true], marc: [3.85, true],
  // GO Transit's "GO"; in the older locomotive scheme's green.
  go: [2.09, true], "go-teal": [2.09, false],
  // CT Rail: the mark (its lens stays red on the white version, as painted)
  // and "CT rail".
  ctrail: [4.91, true],
  // South Shore Line: its maroon sign-shaped emblem lettered in orange.
  // SunRail: the round emblem, a train under palms and the sun over the
  // name on a black banner.
  southshore: [3.651, false], sunrail: [1.155, false],
  // Sounder (Sound Transit): the "ST SoundTransit" mark, white on the blue.
  // Sound Transit logo, Wikimedia Commons (public domain).
  sounder: [6.58, true],
  // ACE (Altamont Corridor Express): "ACE" and its two arrows over
  // ALTAMONT CORRIDOR EXPRESS, as on the Chargers; "ace-mark" without the
  // name, as on the BiLevels. Recolored as painted: dark letters, magenta
  // arrows. Wikimedia Commons, "Altamont Corridor Express logo.svg" (public
  // domain).
  ace: [3.911, false], "ace-mark": [5.09, false],
  // exo: its wordmark, in the near-black navy it is painted in. Wikimedia
  // Commons, "Exo.svg" (public domain).
  exo: [3.027, false],
  // Amtrak's state-supported services.
  surfliner: [6.0, true], "amtrak-california": [1.41, true], cascades: [3.53, true], "cascades-dark": [3.53, false],
  // Caltrans' mark and name (Charger and Venture sides); the San Joaquins
  // wordmark; "SURFLINER" spaced out in white along the Surfliner cars.
  caltrans: [5.3, false], "san-joaquins": [10, false], "surfliner-word": [22, false],
  "via-leaf": [0.84, false],
  // VIA's yellow letters alone, as on the side of the SCV-42 and the Venture cab car.
  "via-word": [2.7, false],
  // Texas: "TRINITY METRO TEXRail" as on the FLIRTs' cabs; the Trinity
  // Railway Express star; DART's mark and the SILVERLINE wordmark; DCTA's
  // A-train mark. Wikimedia Commons (public domain).
  "tm-texrail": [3.133, false], "tre-nolabel": [1.68, true], dart: [0.952, true], silverline: [3.382, false], atrain: [3.077, false],
  // North County Transit District (San Diego): the COASTER and SPRINTER
  // wordmarks. Wikimedia Commons (public domain).
  coaster: [8.942, true], sprinter: [9.157, true],
  // The Alaska Railroad's emblem (the round ARR herald). Wikimedia Commons
  // (public domain).
  alaska: [1.0, false],
  // UP Express's wordmark (2024), in the olive of its cars' lettering;
  // Ontario Northland's logo and the Polar Bear Express emblem. Wikimedia
  // Commons (public domain).
  upx: [3.198, false], ontarionorthland: [10.818, true], polarbear: [1.0, false],
};
// Lettering with no logo file: Piedmont's locomotives and coaches carry
// "North Carolina" in an upright serif on the side.
const LETTERING = {
  "north-carolina": { text: "North Carolina", aspect: 5.6, color: "#3a3f4a",
    font: 'font-family="Palatino, Georgia, Times New Roman, serif"' },
  // VIA's Venture coaches: the name widely spaced out in white along the
  // middle of the yellow band.
  "via-rail-canada": { text: "VIA RAIL CANADA", aspect: 34, color: "#33373c",
    font: 'font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="500" letter-spacing="1.6em"' },
  // The Government of Canada wordmark on VIA's stainless cars: white serif
  // letters outlined in dark gray (the flag over the last "a" left out).
  canada: { text: "Canada", aspect: 3.0, color: "#ffffff",
    font: 'font-family="Times New Roman, Times, serif" stroke="#2b3036" stroke-width="0.22" paint-order="stroke"' },
  // NICTD's squared initials: maroon on the South Shore's bi-levels, orange
  // in the band along its single-level cars.
  nictd: { text: "NICTD", aspect: 3.5, color: "#7a1f2b",
    font: 'font-family="Eurostile, Microgramma, Bank Gothic, Arial Black, Helvetica Neue, sans-serif" font-weight="800" letter-spacing="0.04em"' },
  "nictd-orange": { text: "NICTD", aspect: 3.5, color: "#e8661f",
    font: 'font-family="Eurostile, Microgramma, Bank Gothic, Arial Black, Helvetica Neue, sans-serif" font-weight="800" letter-spacing="0.04em"' },
  // Sounder: "SOUNDER" big in tall, condensed cream capitals edged in dark
  // blue, low on the side. fit: set exactly aspect x h wide, by stretching
  // the letters ("spacingAndGlyphs") or only the gaps between them ("spacing").
  "sounder-word": { text: "SOUNDER", aspect: 3.6, color: "#f3f0e4", fit: "spacingAndGlyphs",
    font: 'font-family="Arial Narrow, Helvetica Neue, Arial, sans-serif" font-weight="700" stroke="#1d2f5e" stroke-width="0.12" paint-order="stroke"' },
  // New Mexico Rail Runner Express has no logo file on Commons: its name in
  // widely spaced serif capitals, as lettered on the cars, with "NEW MEXICO"
  // small above and "EXPRESS" small below.
  "rail-runner": { text: "RAIL RUNNER", aspect: 19, color: "#5e3237", fit: "spacing",
    font: 'font-family="Trajan Pro, Palatino, Georgia, Times New Roman, serif"' },
  "new-mexico": { text: "NEW MEXICO", aspect: 13, color: "#5e3237", fit: "spacing",
    font: 'font-family="Trajan Pro, Palatino, Georgia, Times New Roman, serif"' },
  "rr-express": { text: "EXPRESS", aspect: 9, color: "#5e3237", fit: "spacing",
    font: 'font-family="Trajan Pro, Palatino, Georgia, Times New Roman, serif"' },
  // exo's customer-service name, "allo" set over the exo wordmark ("allo
  // exo"): black on the Chargers, red on the coaches' white panels. Set
  // as wide as the wordmark under it.
  allo: { text: "allo", aspect: 2.32, color: "#1b1e2e", fit: "spacingAndGlyphs",
    font: 'font-family="Avenir Next, Futura, Century Gothic, Helvetica Neue, Arial, sans-serif" font-weight="700"' },
  "allo-red": { text: "allo", aspect: 2.32, color: "#b3124e", fit: "spacingAndGlyphs",
    font: 'font-family="Avenir Next, Futura, Century Gothic, Helvetica Neue, Arial, sans-serif" font-weight="600"' },
  // The wordmark's letters set as type, for the small "allo exo" panels on
  // the coaches (too small for the logo file to draw cleanly).
  "exo-word": { text: "exo", aspect: 2.32, color: "#1b1e2e", fit: "spacingAndGlyphs",
    font: 'font-family="Avenir Next, Futura, Century Gothic, Helvetica Neue, Arial, sans-serif" font-weight="700"' },
  // The Alaska Railroad's name in tall navy serif capitals along the yellow
  // band of its cars and locomotives.
  "alaska-word": { text: "ALASKA", aspect: 4.6, color: "#16295a", fit: "spacing",
    font: 'font-family="Clarendon, Rockwell, Georgia, Times New Roman, serif" font-weight="700"' },
  // WeGo Star: "Star" big in white on the gray lower hood of its F40s,
  // edged in purple.
  "star-word": { text: "Star", aspect: 1.9, color: "#ffffff",
    font: 'font-family="Avenir Next, Futura, Helvetica Neue, Arial, sans-serif" font-weight="700" font-style="italic" stroke="#5a3fb4" stroke-width="0.08" paint-order="stroke"' },
  // Trinity Railway Express: its name in navy italic capitals along the
  // upper level of the BiLevels.
  "tre-word": { text: "TRINITY RAILWAY EXPRESS", aspect: 15, color: "#002269", fit: "spacingAndGlyphs",
    font: 'font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="700" font-style="italic"' },
};
const BY_AGENCY = { lirr: "mta", mnr: "mta" };

const n = (v) => Math.round(v * 1000) / 1000;
function image(key, x, y, h, dark) {
  if (LETTERING[key]) {
    const l = LETTERING[key];
    const fit = l.fit ? ` textLength="${n(l.aspect * h)}" lengthAdjust="${l.fit}"` : "";
    return `<text x="${n(x)}" y="${n(y + h * 0.32)}" font-size="${n(h)}" fill="${dark ? "#ffffff" : l.color}" text-anchor="middle"${fit} ${l.font}>${l.text}</text>`;
  }
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
const COMPOSITE = { "amtrak-stack": 1.65, "amtrak-midwest": 4.2 };
export const logoWidth = (c, h, key = logoOf(c)) =>
  COMPOSITE[key] ? COMPOSITE[key] * h : LETTERING[key] ? LETTERING[key].aspect * h : key ? LOGOS[key][0] * h : 0;

// The railroad's logo centered at (x, y), h feet tall.
//   dark: it sits on dark paint (white version where there is one);
//   logo: a particular logo instead of the railroad's usual one, or
//     "amtrak-stack" for the wordmark over the travelmark (Phase VII
//     locomotives), or "amtrak-midwest": the Amtrak logo with "MIDWEST"
//     spaced out under its name, as on the Midwest Chargers;
//   skip: agencies to leave out.
export function badge(c, x, y, h, { dark = false, logo = null, skip = [] } = {}) {
  const key = logo || logoOf(c);
  if (!key || skip.includes(c.agency) || !(LOGOS[key] || LETTERING[key] || COMPOSITE[key])) return "";
  const body = key === "amtrak-stack"
    ? image("amtrak-word", 0, -h * 0.38, h * 0.13, dark) + image("amtrak-mark", 0, h * 0.12, h * 0.7, dark)
    : key === "amtrak-midwest"
      ? image("amtrak", 0, -h * 0.2, h * 0.45, dark) +
        `<text x="${n(h * 2.02)}" y="${n(h * 0.42)}" font-size="${n(h * 0.3)}" fill="${dark ? "#ffffff" : "#004d6e"}" text-anchor="end" letter-spacing="${n(h * 0.12)}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="600">MIDWEST</text>`
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
