// Trainsheet relay — a Cloudflare Worker that fetches the train feeds a
// browser can't read directly (no CORS headers, or an API key is required)
// and passes them through with CORS enabled.
//
// It is NOT an open proxy: only the feeds listed below can be requested, API
// keys stay in Worker secrets, and every response is cached at the edge for a
// few seconds so heavy traffic doesn't multiply upstream requests.
//
//   GET /status      -> { feeds: { septa: true, metra: false, ... } }
//   GET /njt-board/:code -> one NJ Transit station's DepartureVision board
//                       (tracks and statuses), as JSON.
//   GET /tracks/:railroad/:stop -> the tracks each train has left a big
//                       terminal from on recent days (see Usual tracks).
//   GET /septa-elevators -> SEPTA's elevator outages, as JSON.
//   GET /history/:railroad/:number -> how late an Amtrak, VIA or Brightline
//                       train number reached its last stop, day by day (the
//                       last 30 trips recorded; see "Track record" below).
//   GET /feed/:id    -> the upstream feed, byte for byte. For railroads that
//                       publish positions and predicted stop times as two
//                       GTFS-realtime feeds, both, back to back: concatenated
//                       protobuf messages read as one feed with every entity.

const CACHE_SECONDS = 15;
const feedMem = new Map(); // feed -> { at, bytes, type }: its last good copy
const STALE_MS = 5 * 60 * 1000; // how old a copy may be served when the railroad refuses
const RELAY_VERSION = "2026-10-15 (usual tracks, track record, septa elevators)";

const FEEDS = {
  septa: () => ({ url: "https://www3.septa.org/api/TrainView/index.php" }),
  // RTD and CapMetro feeds cover every bus too; only the rail lines are kept.
  rtd: () => ({
    url: "https://open-data.rtd-denver.com/files/gtfs-rt/rtd/VehiclePosition.pb",
    also: ["https://open-data.rtd-denver.com/files/gtfs-rt/rtd/TripUpdate.pb"],
    routes: ["A", "113B", "113G", "117N"],
  }),
  // UTA refuses requests from Cloudflare's servers, so with a Transitland
  // API key the relay reads Transitland's copies of UTA's feeds (below).
  uta: (env) => (env.TRANSITLAND_API_KEY ? { transitland: "f-9x0-uta~rt" } : { url: "https://apps.rideuta.com/tms/gtfs/Vehicle" }),
  capmetro: () => ({
    url: "https://data.texas.gov/download/eiei-9rpf/application%2Foctet-stream",
    also: ["https://data.texas.gov/download/rmk2-acnw/application%2Foctet-stream"],
    routes: ["550"],
  }),
  trirail: () => ({ url: "https://gtfsr.tri-rail.com/download.aspx?file=position_updates.pb" }),
  marc: () => ({
    url: "https://mdotmta-gtfs-rt.s3.amazonaws.com/MARC+RT/marc-vp.pb",
    also: ["https://mdotmta-gtfs-rt.s3.amazonaws.com/MARC+RT/marc-tu.pb"],
  }),
  // VRE's official GTFS-realtime (no CORS headers); it asks for no more than one fetch a minute.
  vre: () => ({ url: "https://gtfs.vre.org/containercdngtfsupload/VehiclePositionFeed", also: ["https://gtfs.vre.org/containercdngtfsupload/TripUpdateFeed"], ttl: 60 }),
  // NJ Transit: scraped from DepartureVision (below); no key needed.
  njt: () => ({ njtDv: true }),
  // GO Transit: scraped from GO Tracker (below); no key needed.
  go: () => ({ goTracker: true }),
  // exo (Montréal): read from the live map on exo.quebec (below); no key needed.
  exo: () => ({ exoHub: true, ttl: 20 }),

  // Keyed feeds: set the secrets with `npx wrangler secret put NAME`.
  metra: (env) =>
    env.METRA_API_TOKEN && {
      url: `https://gtfspublic.metrarr.com/gtfs/public/positions?api_token=${encodeURIComponent(env.METRA_API_TOKEN)}`,
      // Predicted stop times, for each train's upcoming stops.
      also: [`https://gtfspublic.metrarr.com/gtfs/public/tripupdates?api_token=${encodeURIComponent(env.METRA_API_TOKEN)}`],
      ttl: 30, // Metra refuses requests that come too often
    },
  // Sound Transit (OneBusAway): the whole agency's feeds, cut to Sounder's
  // routes. Fetched from here it answers without a key (it refused browsers
  // on trainsheet.com); with SOUND_TRANSIT_KEY set (free by email,
  // oba_api_key@soundtransit.org, as its terms ask) the key is sent too.
  sounder: (env) => {
    const q = env.SOUND_TRANSIT_KEY ? `40.pb?key=${encodeURIComponent(env.SOUND_TRANSIT_KEY)}` : "40.pb";
    return {
      url: `https://api.pugetsound.onebusaway.org/api/gtfs_realtime/vehicle-positions-for-agency/${q}`,
      also: [`https://api.pugetsound.onebusaway.org/api/gtfs_realtime/trip-updates-for-agency/${q}`],
      routes: ["SNDR_EV", "SNDR_TL"],
    };
  },
  caltrain: (env) => env.API_511_KEY && feed511("CT", env),
  smart: (env) => env.API_511_KEY && feed511("SA", env),
  // ACE (Altamont Corridor Express) through 511, once a minute: 511 limits
  // requests per key per hour, shared with Caltrain and SMART.
  ace: (env) => env.API_511_KEY && { ...feed511("CE", env), ttl: 60 },
  metrolink: (env) =>
    env.METROLINK_API_KEY && {
      url: "https://metrolink-gtfsrt.gbsdigital.us/feed/gtfsrt-vehicles",
      // Predicted stop times; the first of these paths that answers is used.
      also: ["gtfsrt-trips", "gtfsrt-tripupdates", "gtfsrt-trip-updates"].map((p) => `https://metrolink-gtfsrt.gbsdigital.us/feed/${p}`),
      headers: { "X-Api-Key": env.METROLINK_API_KEY },
    },
};

// 511 SF Bay: positions plus predicted stop times for one operator.
function feed511(agency, env) {
  const q = `agency=${agency}&api_key=${encodeURIComponent(env.API_511_KEY)}`;
  return { url: `https://api.511.org/transit/vehiclepositions?${q}`, also: [`https://api.511.org/transit/tripupdates?${q}`] };
}

// GTFS-realtime filtering, for feeds that cover a whole bus network: keeps the
// header and only the entities whose trip is on one of the given routes. Works
// on the raw protobuf, copying kept entities byte for byte.
function varint(b, i) {
  let v = 0, mul = 1, x;
  do { x = b[i++]; v += (x & 0x7f) * mul; mul *= 128; } while (x & 0x80);
  return [v, i];
}
function* fieldsOf(b, start = 0, end = b.length) {
  let i = start;
  while (i < end) {
    const s = i;
    let key; [key, i] = varint(b, i);
    const f = Math.floor(key / 8), w = key & 7;
    let vs = i, ve;
    if (w === 0) { [, i] = varint(b, i); ve = i; }
    else if (w === 1) { i += 8; ve = i; }
    else if (w === 5) { i += 4; ve = i; }
    else if (w === 2) { let len; [len, vs] = varint(b, i); i = ve = vs + len; }
    else return;
    yield { f, w, s, vs, ve, e: i };
  }
}
const child = (b, from, to, f) => { for (const x of fieldsOf(b, from, to)) if (x.f === f && x.w === 2) return x; return null; };
function routeOf(b, ent) {
  for (const kind of [3, 4]) { // trip_update, vehicle
    const k = child(b, ent.vs, ent.ve, kind);
    const trip = k && child(b, k.vs, k.ve, 1);
    const route = trip && child(b, trip.vs, trip.ve, 5);
    if (route) return new TextDecoder().decode(b.subarray(route.vs, route.ve));
  }
  return null;
}
function keepRoutes(b, routes) {
  const parts = [];
  for (const x of fieldsOf(b)) {
    if (x.f !== 2 || routes.includes(routeOf(b, x))) parts.push(b.subarray(x.s, x.e));
  }
  return new Blob(parts);
}

// The first of several candidate URLs that answers, as bytes (or none).
async function firstOk(urls, headers) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
    } catch {}
  }
  return null;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// ---------- NJ Transit DepartureVision ----------
// NJ Transit's DepartureVision pages read a public GraphQL API: a departure
// board per station, and each train's stop list with predicted times and the
// stops it has left. Each scrape reads a few boards to find running trains
// (two hubs and four other stations, in rotation) and refreshes the stop
// lists of the trains it knows, stalest first, so it stays well under the
// Workers subrequest limit and light on NJ Transit's site. What it has
// learned is kept in the Worker's memory between requests (and in the edge
// cache, where there is one: not on workers.dev), and requests within 15
// seconds of a scrape get its result.
const NJT_GQL = "https://www.njtransit.com/api/graphql/graphql";
const NJT_HUBS = ["NY", "NP", "HB", "SE", "ND", "TR"];
const NJT_STATIONS = ("PH AM AB AZ AH AS AN AP AO AC AV BI BH MC BS BY BV BM BN BK BB BU BW BF CB CM CY IF CN XC DL DV DO DN EO ED " +
  "EH EL EZ EN EX NA FW FH GD GW GI GL GG GK RS HQ HL HN RM HW HZ HG HI HD UF HB JA HP ON LP LI LW FA LS LB LN LY MA MZ SQ MW XU MED " +
  "MP MU MI MD MB GO MK HS UV ZM MX MR HV OL TB MS ML MT MV MH NN NT NE NH NB NV NY ND NP OR NZ OD OG OS PV PS RN PC PQ PN PE PF PL " +
  "PP PO PJ PR FZ RH RY 17 RA RB RW RG RL RF CW TS SE RT XG SM CH SO LA SV SG SF ST TE TO TR TC US UM WK WA WG WT 23 WM WF WW WH WR WB WL").split(" ");
const NJT_STOP_LISTS = 28;            // per request
const NJT_FRESH_MS = 45 * 1000;       // a stop list younger than this is skipped
const NJT_LATER_MS = 5 * 60 * 1000;   // ...or this, for a train not leaving soon
const NJT_STATE = "https://relay.trainsheet.invalid/njt-state";
const BOARD_Q = "query($s:String!){getTrainDepartureScreens(station:$s){items{trainID line lineAbbreviation background destination status}}}";
const STOPS_Q = "query($t:String!){getTrainStopList(train:$t){name time departed status}}";

async function njtGql(query, variables) {
  const res = await fetch(NJT_GQL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Trainsheet relay (https://trainsheet.com)" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`NJ Transit HTTP ${res.status}`);
  return (await res.json()).data;
}

// Minutes from now (New York time) until "5:41 PM", between -12 and +12 hours.
const nyClock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" });
function minutesUntil(text, now) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M$/i.exec(String(text || "").trim());
  if (!m) return null;
  const p = Object.fromEntries(nyClock.formatToParts(new Date(now)).map((x) => [x.type, +x.value || 0]));
  const d = (+m[1] % 12 + (/p/i.test(m[3]) ? 12 : 0)) * 60 + +m[2] - (p.hour * 60 + p.minute);
  return ((d + 720) % 1440 + 1440) % 1440 - 720;
}

let njtMem = null; // { st, at, json }

// NJ Transit's Rail Data API (with an account: NJT_USERNAME and NJT_PASSWORD,
// stored as secrets): each running train's GPS position, next stop and how
// late it is. A token lasts a day, and only 10 can be asked for a day, so
// one is kept and reused; a refused token is replaced at most every 10
// minutes. Positions are fetched at most every 20 seconds (the account
// allows 40,000 calls a day).
// An account approved for NJ Transit's test server only (it has the same
// live data) is used there until the production server takes it: the
// production server is asked again every six hours.
const NJT_SERVERS = { production: "https://raildata.njtransit.com/api/TrainData", test: "https://testraildata.njtransit.com/api/TrainData" };
let njtServer = "production";
let njtProductionRefused = 0;
let njtToken = null;       // { token, at, server }
let njtTokenTried = 0;     // when a token was last asked for
let njtVehicles = null;    // { at, list }
async function njtApi(method, form, server = njtServer) {
  const body = new FormData();
  for (const [k, v] of Object.entries(form)) body.append(k, v);
  const res = await fetch(`${NJT_SERVERS[server]}/${method}`, { method: "POST", body, headers: { accept: "application/json" } });
  // Refusals come as HTTP 500 with { errorMessage }.
  const json = await res.json().catch(() => null);
  if (!res.ok && !json?.errorMessage) throw new Error(`NJ Transit API HTTP ${res.status}`);
  return json;
}
// The token, and when to next ask for one, are kept in the Store (shared by
// every copy of the relay, and across deploys) as well as in memory.
const storeOf = (env) => env.STORE?.get(env.STORE.idFromName("njt"));
async function storeGet(env) {
  try { return await (await storeOf(env).fetch("https://store/get")).json(); } catch { return {}; }
}
async function storeSet(env, data) {
  try { await storeOf(env).fetch("https://store/set", { method: "POST", body: JSON.stringify(data) }); } catch {}
}
// The next midnight in New York, when NJ Transit's daily limits reset.
function nextNyMidnight() {
  const now = Date.now();
  const p = Object.fromEntries(nyParts.formatToParts(new Date(now)).map((x) => [x.type, +x.value]));
  return now + ((24 - (p.hour % 24)) * 60 - p.minute) * 60 * 1000 + 60 * 1000;
}
async function njtGetToken(env) {
  // Back to production when it may have taken the account since.
  if (njtServer === "test" && Date.now() - njtProductionRefused > 6 * 3600 * 1000) { njtServer = "production"; njtToken = null; }
  if (njtToken && njtToken.server === njtServer && Date.now() - njtToken.at < 23 * 3600 * 1000) return njtToken.token;
  const kept = await storeGet(env);
  if (kept.token && Date.now() - kept.at < 23 * 3600 * 1000) {
    njtToken = { token: kept.token, at: kept.at, server: kept.server };
    njtServer = kept.server;
    if (kept.server === "test") njtProductionRefused = kept.productionRefused || Date.now();
    return njtToken.token;
  }
  const wait = Math.max(njtTokenTried + 10 * 60 * 1000, kept.tried ? kept.tried + 10 * 60 * 1000 : 0, kept.blockedUntil || 0);
  if (Date.now() < wait) throw new Error("NJ Transit token: waiting before asking again");
  njtTokenTried = Date.now();
  await storeSet(env, { ...kept, tried: njtTokenTried });
  const creds = { username: env.NJT_USERNAME, password: env.NJT_PASSWORD };
  let r = await njtApi("getToken", creds);
  if (njtServer === "production" && /missing user account/i.test(r?.errorMessage || "")) {
    njtProductionRefused = Date.now();
    njtServer = "test";
    r = await njtApi("getToken", creds);
  }
  if (r?.Authenticated !== "True" || !r.UserToken) {
    // Out of tokens for today: nobody asks again until midnight.
    if (/daily usage limit/i.test(r?.errorMessage || "")) await storeSet(env, { ...kept, tried: njtTokenTried, blockedUntil: nextNyMidnight() });
    throw new Error(`NJ Transit token refused${r?.errorMessage ? `: ${r.errorMessage}` : ""}`);
  }
  njtToken = { token: r.UserToken, at: Date.now(), server: njtServer };
  await storeSet(env, { token: njtToken.token, at: njtToken.at, server: njtServer, productionRefused: njtProductionRefused, tried: njtTokenTried });
  return njtToken.token;
}
// One train's crowding (getTrainStopList's CAPACITY): how full it is, by
// section (front, middle, back) and car, with which cars have a restroom.
// Read when someone opens the train, at most every minute per train.
const njtCrowd = new Map(); // train -> { at, json }
async function fetchNjtCrowd(env, id) {
  const hit = njtCrowd.get(id);
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.json;
  let r = await njtApi("getTrainStopList", { token: await njtGetToken(env), train: id });
  if (r?.errorMessage && /token/i.test(r.errorMessage)) {
    njtToken = null;
    r = await njtApi("getTrainStopList", { token: await njtGetToken(env), train: id });
  }
  if (r?.errorMessage) throw new Error(r.errorMessage);
  const num = (v) => (v === "" || v == null || Number.isNaN(+v) ? null : +v);
  const c = (r?.CAPACITY || [])[0];
  const json = { at: Date.now(), crowd: c ? {
    pct: num(c.CUR_PERCENTAGE), color: (c.CUR_CAPACITY_COLOR || "").trim() || null, count: num(c.CUR_PASSENGER_COUNT),
    at: nyTime(c.CREATED_TIME),
    sections: (c.SECTIONS || []).map((x) => ({
      pos: x.SECTION_POSITION, pct: num(x.CUR_PERCENTAGE), color: (x.CUR_CAPACITY_COLOR || "").trim() || null, count: num(x.CUR_PASSENGER_COUNT),
      cars: (x.CARS || []).map((k) => ({ no: k.CAR_NO, position: num(k.CAR_POSITION), rest: k.CAR_REST === true || k.CAR_REST === "true",
        pct: num(k.CUR_PERCENTAGE), color: (k.CUR_CAPACITY_COLOR || "").trim() || null, count: num(k.CUR_PASSENGER_COUNT) })),
    })),
  } : null };
  njtCrowd.set(id, { at: Date.now(), json });
  return json;
}

// LIRR and Metro-North crowding, from the MTA's TrainTime app's data: each
// train's cars in order, how full each is (EMPTY, MANY_SEATS, FEW_SEATS,
// SRO, NO_DATA), riders counted, restrooms, quiet cars, bikes. One copy of
// every train is read at most every 30 seconds and shared; a request gets
// just its train's cars.
const TRAINTIME = "https://backend-unified.mylirr.org/locations?geometry=TRACK_TURF&railroad=BOTH";
let traintimeMem = null; // { at, byKey }
async function mtaCrowd(railroad, number) {
  if (!traintimeMem || Date.now() - traintimeMem.at > 30 * 1000) {
    const res = await fetch(TRAINTIME, { headers: { Accept: "application/json", "Accept-Version": "3.0", "User-Agent": "Trainsheet relay" } });
    if (!res.ok) throw new Error(`TrainTime HTTP ${res.status}`);
    const byKey = new Map();
    for (const t of await res.json()) {
      const cars = t.consist?.cars;
      if (!cars?.length) continue;
      byKey.set(`${t.railroad}:${t.train_num}`, {
        fleet: t.consist.fleet || null,
        cars: cars.map((c) => ({ no: c.number != null ? String(c.number) : null, type: c.type || null, level: c.loading || null,
          count: c.passengers ?? null, rest: Boolean(c.restroom), quiet: Boolean(c.quiet), bikes: Boolean(c.bikes), loco: Boolean(c.locomotive) })),
      });
    }
    traintimeMem = { at: Date.now(), byKey };
  }
  return { at: traintimeMem.at, crowd: traintimeMem.byKey.get(`${railroad}:${number}`) || null };
}

// "30-May-2024 02:30:44 PM" in New York, as epoch milliseconds.
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const nyParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
function nyTime(text) {
  const m = /^(\d{1,2})-(\w{3})-(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ([AP])M$/i.exec(String(text || "").trim());
  if (!m || MONTHS[m[2]] == null) return null;
  const local = Date.UTC(+m[3], MONTHS[m[2]], +m[1], (+m[4] % 12) + (/p/i.test(m[7]) ? 12 : 0), +m[5], +m[6]);
  const p = Object.fromEntries(nyParts.formatToParts(new Date(local)).map((x) => [x.type, +x.value]));
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - Math.floor(local / 60000) * 60000;
  return local - offset;
}
async function fetchNjtVehicles(env) {
  if (!env.NJT_USERNAME || !env.NJT_PASSWORD) return null;
  if (njtVehicles && Date.now() - njtVehicles.at < 20 * 1000) return njtVehicles.list;
  let r = await njtApi("getVehicleData", { token: await njtGetToken(env) });
  if (!Array.isArray(r) && /token/i.test(r?.errorMessage || "")) {
    njtToken = null;
    r = await njtApi("getVehicleData", { token: await njtGetToken(env) });
  }
  if (!Array.isArray(r)) throw new Error(`NJ Transit vehicles: ${r?.errorMessage || "no data"}`);
  const list = r.map((v) => ({
    id: String(v.ID), line: v.TRAIN_LINE, dir: v.DIRECTION, next: v.NEXT_STOP,
    lat: +v.LATITUDE, lon: +v.LONGITUDE, late: v.SEC_LATE === "" ? null : +v.SEC_LATE, at: nyTime(v.LAST_MODIFIED),
  })).filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon) && v.lat && v.lon);
  njtVehicles = { at: Date.now(), list };
  return list;
}

// ---------- Transitland (UTA) ----------
// Transitland keeps copies of UTA's GTFS-realtime feeds and serves them with
// an API key. Its free tier allows 10,000 requests a month, so positions are
// refreshed at most every 5 minutes and predicted stop times every 15, only
// while FrontRunner runs (about 4 a.m. to 1 a.m. Mountain time, Monday to
// Saturday): roughly 8,000 a month. Between refreshes the last copies are
// served. (Each Worker instance keeps its own copies, so a busy day with
// several instances uses more.)
const TL_EVERY = { vehicle_positions: 5 * 60 * 1000, trip_updates: 15 * 60 * 1000 };
const tlMem = {}; // "feed/type" -> { at, bytes }
const mountain = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });
function frontRunnerRunning(now) {
  const p = Object.fromEntries(mountain.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const min = +p.hour * 60 + +p.minute;
  // Saturday service runs past midnight into Sunday's small hours.
  if (p.weekday === "Sun") return min < 90;
  return min >= 240 || (p.weekday !== "Mon" && min < 90);
}
async function fetchTransitland(feed, env) {
  const now = Date.now(), running = frontRunnerRunning(now);
  const parts = await Promise.all(Object.entries(TL_EVERY).map(async ([type, every]) => {
    const key = `${feed}/${type}`, hit = tlMem[key];
    if (hit && (now - hit.at < every || !running)) return hit.bytes;
    if (!running) return new Uint8Array(0);
    try {
      const res = await fetch(`https://transit.land/api/v2/rest/feeds/${encodeURIComponent(feed)}/download_latest_rt/${type}.pb`, {
        headers: { apikey: env.TRANSITLAND_API_KEY, "User-Agent": "Trainsheet relay (https://trainsheet.com)" },
      });
      if (!res.ok) throw new Error(`Transitland HTTP ${res.status}`);
      tlMem[key] = { at: now, bytes: new Uint8Array(await res.arrayBuffer()) };
    } catch (err) {
      if (!hit) throw err;
      hit.at = now - every + 60 * 1000; // keep the last copy; try again in a minute
    }
    return tlMem[key].bytes;
  }));
  // Positions, then predicted stop times: read as one feed.
  return new Response(new Blob(parts), { headers: { "Content-Type": "application/octet-stream" } });
}

// ---------- GO Transit (GO Tracker) ----------
// GO Tracker (gotracker.ca), GO's public live map, reads each line's trains
// from a small web service as XML: GPS position, train number, line, delay,
// first and last stations, equipment number. It answers only requests that
// come from its map page, so the relay sends that page as the referrer.
// One request per line, kept 15 seconds.
const GO_LINES = ["01", "09", "21", "31", "61", "65", "71"]; // LW, LE, Milton, Kitchener, Richmond Hill, Barrie, Stouffville
const GO_TRACKER = "https://www.gotracker.ca/GoTracker/web/GODataAPIProxy.svc/TripLocation/Service/Lang";
let goMem = null; // { at, json }
const xmlAttrs = (tag) => Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"/g)].map(([, k, v]) => [k, v
  .replace(/&#xD;&#xA;/g, " ").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")]));
// ---------- exo (its live map's SignalR hub) ----------
// exo.quebec's live map gets its trains over SignalR: after a negotiate call,
// a WebSocket joins one group per line and direction for vehicle positions
// and one for trip updates (delays by stop), and each group answers with its
// current state at once. Each scrape joins them all, keeps what arrives in a
// few seconds and hangs up: two subrequests.
// Returns { at, vehicles: [{ TripId, Route, Latitude, Longitude, Timestamp, ... }],
//           tripUpdates: [{ TripId, StopTimeUpdates: [{ StopSequence, ArrivalDelay, Stop: { Code } }] }] }.
const EXO_HUB = "https://apim-shared-prod.exo.quebec/tempsreel/routeHub";
const EXO_ROUTES = [259, 260, 262, 263, 264]; // the hub's ids for lines 11-15
const SIGNALR_END = "\x1e";

async function fetchExo() {
  const headers = { Origin: "https://exo.quebec", "User-Agent": "Trainsheet relay (https://trainsheet.com)" };
  const neg = await (await fetch(`${EXO_HUB}/negotiate?negotiateVersion=1`, { method: "POST", headers })).json();
  if (!neg.url || !neg.accessToken) throw new Error("exo negotiate failed");
  const res = await fetch(`${neg.url}&access_token=${encodeURIComponent(neg.accessToken)}`, { headers: { ...headers, Upgrade: "websocket" } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`exo hub HTTP ${res.status}`);
  ws.accept();
  const groups = EXO_ROUTES.flatMap((r) => [0, 1].flatMap((d) => [`vehicle-routeId-${r}-directionId-${d}`, `tripUpdate-routeId-${r}-directionId-${d}`]));
  const got = new Map(); // group -> its trains
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    ws.addEventListener("message", (e) => {
      for (const frame of String(e.data).split(SIGNALR_END)) {
        if (!frame) continue;
        const m = JSON.parse(frame);
        if (m.type !== 1 || m.target !== "TempsReel") continue;
        try { got.set(m.arguments[0], JSON.parse(m.arguments[1])); } catch { /* not JSON: skip */ }
        if (groups.every((g) => got.has(g))) { clearTimeout(timer); resolve(); }
      }
    });
    ws.addEventListener("close", () => { clearTimeout(timer); resolve(); });
    ws.send(JSON.stringify({ protocol: "json", version: 1 }) + SIGNALR_END);
    groups.forEach((g, i) => ws.send(JSON.stringify({ type: 1, target: "JoinGroup", arguments: [g], invocationId: String(i) }) + SIGNALR_END));
  });
  try { ws.close(); } catch { /* already closed */ }
  const of = (prefix) => [...got].filter(([g]) => g.startsWith(prefix)).flatMap(([, list]) => (Array.isArray(list) ? list : []));
  return { at: Date.now(), vehicles: of("vehicle-"), tripUpdates: of("tripUpdate-") };
}

async function fetchGoTracker() {
  const now = Date.now();
  if (goMem && now - goMem.at < 15 * 1000) return goMem.json;
  const pages = await Promise.allSettled(GO_LINES.map((line) => fetch(`${GO_TRACKER}/${line}/en`, {
    headers: { "User-Agent": "Trainsheet relay (https://trainsheet.com)", Referer: "https://www.gotracker.ca/gotracker/web/GoMap.aspx" },
  }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`GO Tracker HTTP ${r.status}`))))));
  if (pages.every((p) => p.status === "rejected")) throw pages[0].reason;
  const trains = [];
  for (const p of pages) {
    for (const [tag] of (p.value || "").matchAll(/<InServiceTripPublic\b[^>]*\/?>/g)) {
      const a = xmlAttrs(tag);
      if (a.IsEquipmentMove === "true" || !a.Latitude) continue;
      trains.push({
        trip: a.TripNumber, line: a.Corridor, lineCode: a.CorridorCode, lat: +a.Latitude, lon: +a.Longitude,
        delaySec: +a.DelaySeconds || 0, from: a.StartStation, to: a.EndStation || a.Destination,
        start: a.StartTime, end: a.EndTime, equipment: a.EquipmentCode || null,
        atStation: (a.InStation || "").trim() || null, atStationId: a.InStationId || null,
        moving: a.IsMoving === "true", express: a.Express === "true",
        updated: a.ModifiedDate || null,
      });
    }
  }
  goMem = { at: now, json: { at: now, trains } };
  return goMem.json;
}

// One station's departure board, for its tracks: a station's page asks for
// it. Kept 30 seconds per station.
const boardMem = new Map(); // code -> { at, json }
const BOARD_FULL_Q = "query($s:String!){getTrainDepartureScreens(station:$s){items{trainID line destination status track departureDate}}}";
async function njtBoard(code) {
  const hit = boardMem.get(code);
  if (hit && Date.now() - hit.at < 30 * 1000) return hit.json;
  const data = await njtGql(BOARD_FULL_Q, { s: code });
  const json = { at: Date.now(), items: (data?.getTrainDepartureScreens?.items || []).map(({ trainID, line, destination, status, track, departureDate }) =>
    ({ trainID, line, destination, status, track: track || null, departureDate })) };
  boardMem.set(code, { at: Date.now(), json });
  return json;
}

async function fetchNjtDv(ctx, env) {
  const now = Date.now();
  if (njtMem && now - njtMem.at < 15 * 1000) return Response.json(njtMem.json);
  // GPS positions from the Rail Data API, where there's an account; the
  // scraped boards below still give each train's stops.
  const vehicles = fetchNjtVehicles(env).catch((err) => (console.warn(err.message), null));
  const cache = caches.default, key = new Request(NJT_STATE);
  let st = njtMem?.st;
  if (!st) {
    const hit = await cache.match(key).catch(() => null);
    st = hit ? await hit.json() : { turn: 0, trains: {} };
  }
  const turn = st.turn++;

  const boards = [NJT_HUBS[(turn * 2) % NJT_HUBS.length], NJT_HUBS[(turn * 2 + 1) % NJT_HUBS.length],
    ...[0, 1, 2, 3].map((i) => NJT_STATIONS[(turn * 4 + i) % NJT_STATIONS.length])];
  for (const r of await Promise.allSettled(boards.map((s) => njtGql(BOARD_Q, { s })))) {
    for (const it of r.value?.getTrainDepartureScreens?.items || []) {
      if (!it.trainID) continue;
      const t = (st.trains[it.trainID] ||= { id: it.trainID });
      Object.assign(t, { line: it.line, abbr: it.lineAbbreviation, color: it.background, dest: it.destination, cancelled: it.status === "CANCELLED", seen: now });
    }
  }

  // Every train with a GPS position gets its stop list read too, though no
  // board read so far has listed it.
  const gps = await vehicles;
  for (const v of gps || []) {
    const t = (st.trains[v.id] ||= { id: v.id, line: v.line, dest: null });
    t.seen = now;
  }

  // Stop lists: trains never read first, then the stalest. A train that
  // won't leave for a while is read less often.
  const due = Object.values(st.trains).filter((t) => {
    if (t.cancelled) return false;
    const leaves = t.stops && !t.stops.some((s) => s.departed) ? minutesUntil(t.stops[0]?.time, now) : null;
    return !t.fetched || now - t.fetched > (leaves != null && leaves > 20 ? NJT_LATER_MS : NJT_FRESH_MS);
  }).sort((a, b) => (a.fetched || 0) - (b.fetched || 0)).slice(0, NJT_STOP_LISTS);
  const lists = await Promise.allSettled(due.map((t) => njtGql(STOPS_Q, { t: t.id })));
  due.forEach((t, i) => {
    const l = lists[i].value?.getTrainStopList;
    if (Array.isArray(l) && l.length) Object.assign(t, { stops: l, fetched: now });
  });

  // Forget trains that have arrived (every stop but the last left, its time
  // 20 minutes past) or that no board has listed for four hours.
  for (const [id, t] of Object.entries(st.trains)) {
    const s = t.stops || [];
    const arrived = s.length > 1 && s.slice(0, -1).every((x) => x.departed) && minutesUntil(s[s.length - 1].time, now) < -20;
    if (arrived || t.cancelled || now - t.seen > 4 * 3600 * 1000) delete st.trains[id];
  }
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(st), { headers: { "Cache-Control": "max-age=86400" } })).catch(() => {}));
  const trains = Object.values(st.trains).filter((t) => t.stops).map(({ id, line, abbr, color, dest, stops }) => ({ id, line, abbr, color, dest, stops }));
  njtMem = { st, at: now, json: { at: now, trains, vehicles: gps } };
  return Response.json(njtMem.json);
}

// ---------- Track record ----------
// Every five minutes (a Cron Trigger, wrangler.toml) the relay reads
// Amtraker's trains and keeps, for each trip that has finished, how late it
// reached its last stop: one row per train number per day, in the Store's
// SQLite (its own copy, "runs"). A trip counts from the day it left its
// first stop, in that stop's time zone.

const HISTORY_RAILROADS = { Amtrak: "amtrak", Via: "via", Brightline: "brightline" };
const runsStore = (env) => env.STORE?.get(env.STORE.idFromName("runs"));

// The finished trips in one read of Amtraker: [{ rr, num, day, origin, dest, sch, delay }].
function finishedRuns(json) {
  const out = [];
  for (const list of Object.values(json || {})) {
    for (const t of list) {
      const rr = HISTORY_RAILROADS[t.provider];
      const first = t.stations?.[0], last = t.stations?.[t.stations.length - 1];
      // Amtraker marks a train Completed once it has reached its last stop,
      // whose arr is then when it got there.
      if (!rr || !first || !last || t.trainState !== "Completed" || !last.arr || !last.schArr) continue;
      const delay = Math.round((Date.parse(last.arr) - Date.parse(last.schArr)) / 60000);
      if (!Number.isFinite(delay) || delay < -60 || delay > 48 * 60) continue;
      const left = Date.parse(first.schDep || first.schArr);
      if (!Number.isFinite(left)) continue;
      const day = new Date(left).toLocaleDateString("en-CA", { timeZone: first.tz || "America/New_York" });
      out.push({ rr, num: String(t.trainNum), day, origin: first.name, dest: last.name, sch: last.schArr, delay });
    }
  }
  return out;
}

async function recordRuns(env) {
  const store = runsStore(env);
  if (!store) return 0;
  const res = await fetch("https://api-v3.amtraker.com/v3/trains", { headers: { "User-Agent": "Trainsheet relay" } });
  if (!res.ok) throw new Error(`Amtraker HTTP ${res.status}`);
  const runs = finishedRuns(await res.json());
  if (runs.length) await store.fetch("https://store/history/record", { method: "POST", body: JSON.stringify(runs) });
  return runs.length;
}

// SEPTA's elevator outages (its API sends no CORS headers), kept two minutes.
let septaLifts = null; // { at, body }
async function fetchSeptaLifts() {
  if (septaLifts && Date.now() - septaLifts.at < 120 * 1000) return septaLifts.body;
  const res = await fetch("https://www3.septa.org/api/elevator/index.php", { headers: { "User-Agent": "Trainsheet relay" } });
  if (!res.ok) throw new Error(`SEPTA HTTP ${res.status}`);
  const body = await res.text();
  septaLifts = { at: Date.now(), body };
  return body;
}


// ---------- Usual tracks ----------
// At the big terminals a train's track goes up only minutes before it
// leaves. Every five minutes (a Cron Trigger, wrangler.toml) the relay notes
// the tracks posted for trains about to leave them, one per train per day,
// in the Store; a station's page asks which tracks each train has left from
// on its last ten recorded days, to show until the real one is posted.
// Amtrak isn't covered: Amtraker almost never has its platforms.
const TRACK_STOPS = { lirr: ["237", "349", "241", "102"], mnr: ["1"], njt: ["NY", "HB", "NP", "SE"] };
const MTA_RT = {
  lirr: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr",
  mnr: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr",
};
const TRACK_KEEP_DAYS = 21;
const TRACK_LAST_DAYS = 10;
const tracksMem = new Map(); // "railroad:stop" -> { at, json }
const tracksStore = (env) => env.STORE.get(env.STORE.idFromName("tracks"));

// The service day a departure belongs to, in New York: trains after
// midnight count with the day before.
const nyDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const serviceDay = (ms) => nyDate.format(new Date(ms - 3 * 3600 * 1000));

// Reading the GTFS-realtime protobuf with the helpers above.
const pbText = (b, x) => (x ? new TextDecoder().decode(b.subarray(x.vs, x.ve)) : "");
const intField = (b, from, to, f) => { for (const x of fieldsOf(b, from, to)) if (x.f === f && x.w === 0) return varint(b, x.vs)[0]; return 0; };
// The train number, as the site reads it (js/sources.js): from LIRR's trip
// id, or Metro-North's vehicle label.
const lirrNumber = (id) => id.match(/^[A-Z]+\d*_\d+_(\d+)/)?.[1] || id.match(/^(\d+)[A-Z]?_\d{4}-\d{2}-\d{2}$/)?.[1] || id.split("_").pop();

// Tracks posted at the watched stations for departures between 8 minutes
// ago and 20 minutes from now (the MTA's railroad extension, field 1005).
function mtaTracks(rr, b, now) {
  const stops = new Set(TRACK_STOPS[rr]), out = [];
  const entities = [...fieldsOf(b)].filter((x) => x.f === 2 && x.w === 2);
  const labels = new Map(); // trip id -> vehicle label
  for (const e of entities) {
    const v = child(b, e.vs, e.ve, 4);
    const trip = v && child(b, v.vs, v.ve, 1), veh = v && child(b, v.vs, v.ve, 8);
    const label = veh && pbText(b, child(b, veh.vs, veh.ve, 2));
    if (trip && label) labels.set(pbText(b, child(b, trip.vs, trip.ve, 1)), label);
  }
  for (const e of entities) {
    const tu = child(b, e.vs, e.ve, 3);
    if (!tu) continue;
    // The label is on the trip update, the vehicle in the same entity, or
    // a vehicle entity of its own.
    const trip = child(b, tu.vs, tu.ve, 1), own = child(b, e.vs, e.ve, 4);
    const veh = child(b, tu.vs, tu.ve, 3) || (own && child(b, own.vs, own.ve, 8));
    const tripId = trip ? pbText(b, child(b, trip.vs, trip.ve, 1)) : "";
    const label = (veh && pbText(b, child(b, veh.vs, veh.ve, 2))) || labels.get(tripId) || "";
    const train = rr === "mnr" ? label : lirrNumber(tripId);
    if (!train || /^[A-Z]+\d/.test(train)) continue; // Metro-North's buses ("EB1973")
    for (const s of fieldsOf(b, tu.vs, tu.ve)) {
      if (s.f !== 2 || s.w !== 2) continue;
      const stop = pbText(b, child(b, s.vs, s.ve, 4));
      if (!stops.has(stop)) continue;
      const ext = child(b, s.vs, s.ve, 1005);
      const track = ext ? pbText(b, child(b, ext.vs, ext.ve, 1)).trim() : "";
      const ev = child(b, s.vs, s.ve, 3) || child(b, s.vs, s.ve, 2);
      const at = ev ? intField(b, ev.vs, ev.ve, 2) * 1000 : 0;
      if (track && at > now - 8 * 60000 && at < now + 20 * 60000) out.push({ rr, stop, train, day: serviceDay(at), track });
    }
  }
  return out;
}

// NJ Transit's boards: a track shows once the train is boarding.
async function njtTracks(now) {
  const out = [];
  const boards = await Promise.allSettled(TRACK_STOPS.njt.map((s) => njtGql(BOARD_FULL_Q, { s })));
  boards.forEach((r, i) => {
    for (const it of r.value?.getTrainDepartureScreens?.items || []) {
      const mins = minutesUntil(it.departureDate, now), track = String(it.track || "").trim();
      if (!it.trainID || !track || mins == null || mins < -8 || mins > 20) continue;
      out.push({ rr: "njt", stop: TRACK_STOPS.njt[i], train: String(it.trainID), day: serviceDay(now + mins * 60000), track });
    }
  });
  return out;
}

async function recordTracks(env) {
  if (!env.STORE) return;
  const now = Date.now();
  const found = await Promise.allSettled([
    ...Object.entries(MTA_RT).map(async ([rr, url]) => {
      const res = await fetch(url, { headers: { "User-Agent": "Trainsheet relay" } });
      if (!res.ok) throw new Error(`${rr} HTTP ${res.status}`);
      return mtaTracks(rr, new Uint8Array(await res.arrayBuffer()), now);
    }),
    njtTracks(now),
  ]);
  for (const r of found) if (r.status === "rejected") console.warn("tracks", r.reason?.message);
  const rows = found.flatMap((r) => r.value || []);
  if (rows.length) await tracksStore(env).fetch("https://store/tracks/record", { method: "POST", body: JSON.stringify(rows) });
}

// Shared storage for every copy of the relay: a small JSON record (NJ
// Transit's token), and in their own copies a table of the usual tracks and
// one of finished trips.
export class Store {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    const { pathname, searchParams } = new URL(request.url);
    if (pathname === "/tracks/record") return this.recordTracks(await request.json());
    if (pathname === "/tracks/query") return Response.json(this.queryTracks(searchParams.get("rr"), searchParams.get("stop")));
    if (pathname === "/history/record") return this.recordRuns(await request.json());
    if (pathname === "/history/query") return Response.json(this.queryRuns(searchParams.get("rr"), searchParams.get("num")));
    if (request.method === "POST") {
      await this.ctx.storage.put("data", await request.json());
      return new Response("ok");
    }
    return Response.json((await this.ctx.storage.get("data")) || {});
  }
  tracks() {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS tracks (rr TEXT, stop TEXT, train TEXT, day TEXT, track TEXT, PRIMARY KEY (rr, stop, train, day))");
    sql.exec("CREATE INDEX IF NOT EXISTS tracks_day ON tracks (day)");
    return sql;
  }
  // The latest track seen for each train's departure that day; a row is only
  // written when it's new or the track changed.
  recordTracks(rows) {
    const sql = this.tracks();
    for (const r of rows) {
      sql.exec("INSERT INTO tracks VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET track = excluded.track WHERE track <> excluded.track",
        r.rr, r.stop, r.train, r.day, r.track);
    }
    sql.exec("DELETE FROM tracks WHERE day < ?", serviceDay(Date.now() - TRACK_KEEP_DAYS * 86400000));
    return new Response("ok");
  }
  // Each train's tracks on its last ten recorded days, most used first:
  // { "1514": [["3", 8], ["5", 2]] }.
  queryTracks(rr, stop) {
    const rows = this.tracks().exec(`SELECT train, track, COUNT(*) AS n FROM (
        SELECT train, track, ROW_NUMBER() OVER (PARTITION BY train ORDER BY day DESC) AS k FROM tracks WHERE rr = ? AND stop = ?
      ) WHERE k <= ? GROUP BY train, track ORDER BY train, n DESC`, rr, stop, TRACK_LAST_DAYS).toArray();
    const trains = {};
    for (const r of rows) (trains[r.train] ||= []).push([r.track, r.n]);
    return { trains };
  }
  // Finished trips (Track record), kept four months. The first report of a
  // trip stands; later reads of the same finished train only repeat it.
  runs() {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS runs (rr TEXT, num TEXT, day TEXT, origin TEXT, dest TEXT, sch TEXT, delay INTEGER, at INTEGER, PRIMARY KEY (rr, num, day))");
    return sql;
  }
  recordRuns(rows) {
    const sql = this.runs(), now = Date.now();
    for (const r of rows) sql.exec("INSERT OR IGNORE INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)", r.rr, r.num, r.day, r.origin, r.dest, r.sch, r.delay, now);
    if (Math.random() < 0.02) sql.exec("DELETE FROM runs WHERE at < ?", now - 120 * 86400 * 1000);
    return new Response("ok");
  }
  queryRuns(rr, num) {
    return { runs: this.runs().exec("SELECT day, origin, dest, delay FROM runs WHERE rr = ? AND num = ? ORDER BY day DESC LIMIT 30", rr, num).toArray() };
  }
}

export default {
  // The Cron Trigger, every five minutes: the tracks posted at the big
  // terminals (Usual tracks) and the trips that have finished (Track record).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(recordTracks(env).catch((err) => console.warn("tracks", err.message)));
    ctx.waitUntil(recordRuns(env).catch((err) => console.warn("history", err.message)));
  },

  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const { pathname } = new URL(request.url);

    if (pathname === "/status") {
      const feeds = Object.fromEntries(Object.entries(FEEDS).map(([id, f]) => [id, Boolean(f(env))]));
      // Which code is deployed, and whether optional keys are visible to it
      // (true/false only), for checking a deploy.
      const check = { version: RELAY_VERSION, transitland: Boolean(env.TRANSITLAND_API_KEY), njt: Boolean(env.NJT_USERNAME && env.NJT_PASSWORD), tracks: Boolean(env.STORE), history: Boolean(env.STORE) };
      return Response.json({ feeds, check }, { headers: { ...CORS, "Cache-Control": "max-age=300" } });
    }

    // Every LIRR and Metro-North train's cars, in order: [number, model,
    // locomotive?], for drawing the real trains.
    if (pathname === "/mta-consists") {
      try {
        await mtaCrowd("LIRR", "");
        const trains = {};
        for (const [k, c] of traintimeMem.byKey) trains[k] = c.cars.map((x) => [x.no, x.type, x.loco ? 1 : 0]);
        return Response.json({ at: traintimeMem.at, trains }, { headers: { ...CORS, "Cache-Control": "public, max-age=30" } });
      } catch (err) {
        return new Response(`Upstream error: ${err.message}`, { status: 502, headers: CORS });
      }
    }

    const mta = pathname.match(/^\/mta-crowd\/(lirr|mnr)\/(\w{1,8})$/);
    if (mta) {
      try {
        return Response.json(await mtaCrowd(mta[1] === "lirr" ? "LIRR" : "MNR", mta[2]), { headers: { ...CORS, "Cache-Control": "public, max-age=30" } });
      } catch (err) {
        return new Response(`Upstream error: ${err.message}`, { status: 502, headers: CORS });
      }
    }

    const crowd = pathname.match(/^\/njt-crowd\/(\w{1,6})$/);
    if (crowd) {
      if (!env.NJT_USERNAME) return new Response("Not configured", { status: 404, headers: CORS });
      try {
        return Response.json(await fetchNjtCrowd(env, crowd[1]), { headers: { ...CORS, "Cache-Control": "public, max-age=60" } });
      } catch (err) {
        return new Response(`Upstream error: ${err.message}`, { status: 502, headers: CORS });
      }
    }

    // Whether the NJ Transit account works: a count, never the token.
    if (pathname === "/njt-check") {
      // ?server=test: whether the same account logs in to the test server
      // (yes or no only; that token is thrown away).
      if (new URL(request.url).searchParams.get("server") === "test") {
        const body = new FormData();
        body.append("username", env.NJT_USERNAME || "");
        body.append("password", env.NJT_PASSWORD || "");
        const r = await fetch("https://testraildata.njtransit.com/api/TrainData/getToken", { method: "POST", body }).then((x) => x.json()).catch((e) => ({ errorMessage: e.message }));
        let vehicles = null;
        if (r?.UserToken) {
          const vb = new FormData();
          vb.append("token", r.UserToken);
          const v = await fetch("https://testraildata.njtransit.com/api/TrainData/getVehicleData", { method: "POST", body: vb }).then((x) => x.json()).catch(() => null);
          if (Array.isArray(v)) vehicles = { count: v.length, newest: v.map((x) => x.LAST_MODIFIED).sort((a, b) => (nyTime(b) || 0) - (nyTime(a) || 0))[0] || null, sample: v[0] ? { id: v[0].ID, line: v[0].TRAIN_LINE, next: v[0].NEXT_STOP } : null };
        }
        return Response.json({ server: "test", authenticated: r?.Authenticated === "True", error: r?.errorMessage || null, vehicles }, { headers: CORS });
      }
      try {
        const list = await fetchNjtVehicles(env);
        return Response.json({ configured: list != null, server: njtServer, vehicles: list?.length ?? 0, sample: list?.[0] ? { id: list[0].id, line: list[0].line, next: list[0].next } : null }, { headers: CORS });
      } catch (err) {
        return Response.json({ configured: true, error: err.message }, { status: 502, headers: CORS });
      }
    }

    const usual = pathname.match(/^\/tracks\/(lirr|mnr|njt)\/([A-Z0-9]{1,4})$/);
    if (usual) {
      const [, rr, stop] = usual, key = `${rr}:${stop}`;
      if (!env.STORE || !TRACK_STOPS[rr].includes(stop)) return new Response("Not recorded", { status: 404, headers: CORS });
      const headers = { ...CORS, "Cache-Control": "public, max-age=600" };
      const hit = tracksMem.get(key);
      if (hit && Date.now() - hit.at < 10 * 60 * 1000) return Response.json(hit.json, { headers });
      try {
        const q = new URLSearchParams({ rr, stop });
        const json = { at: Date.now(), ...(await (await tracksStore(env).fetch(`https://store/tracks/query?${q}`)).json()) };
        tracksMem.set(key, { at: json.at, json });
        return Response.json(json, { headers });
      } catch (err) {
        return new Response(`Store error: ${err.message}`, { status: 502, headers: CORS });
      }
    }

    if (pathname === "/septa-elevators") {
      try {
        return new Response(await fetchSeptaLifts(), { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=120" } });
      } catch (err) {
        return new Response(`Upstream error: ${err.message}`, { status: 502, headers: CORS });
      }
    }

    const hist = pathname.match(/^\/history\/(amtrak|via|brightline)\/(\w{1,6})$/);
    if (hist) {
      const store = runsStore(env);
      if (!store) return new Response("Not configured", { status: 404, headers: CORS });
      try {
        const r = await store.fetch(`https://store/history/query?rr=${hist[1]}&num=${encodeURIComponent(hist[2])}`);
        return new Response(r.body, { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=600" } });
      } catch (err) {
        return new Response(`Storage error: ${err.message}`, { status: 502, headers: CORS });
      }
    }

    const board = pathname.match(/^\/njt-board\/([A-Z0-9]{2,3})$/);
    if (board) {
      if (!NJT_STATIONS.includes(board[1])) return new Response("Unknown station", { status: 404, headers: CORS });
      try {
        return Response.json(await njtBoard(board[1]), { headers: { ...CORS, "Cache-Control": "public, max-age=30" } });
      } catch (err) {
        return new Response(`Upstream error: ${err.message}`, { status: 502, headers: CORS });
      }
    }

    const match = pathname.match(/^\/feed\/([a-z0-9-]+)$/);
    const spec = match && FEEDS[match[1]]?.(env);
    if (!spec) return new Response("Unknown or unconfigured feed", { status: 404, headers: CORS });

    const cache = caches.default;
    const cacheKey = new Request(new URL(`/feed/${match[1]}`, request.url).toString());
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    // Each feed is fetched from its railroad at most every `ttl` seconds (15
    // unless it asks for longer), and every visitor shares that copy: the
    // edge cache does nothing on workers.dev, and railroads refuse requests
    // that come too often. The scraped feeds keep their own.
    const ttl = spec.ttl ?? CACHE_SECONDS;
    const kept = feedMem.get(match[1]);
    const keptResponse = () => new Response(kept.bytes, { headers: { ...CORS, "Content-Type": kept.type, "Cache-Control": `public, max-age=${CACHE_SECONDS}` } });
    if (kept && Date.now() - kept.at < ttl * 1000) return keptResponse();

    const headers = { "User-Agent": "Trainsheet relay", ...spec.headers };
    let upstream;
    try {
      upstream = spec.njtDv ? await fetchNjtDv(ctx, env)
        : spec.goTracker ? Response.json(await fetchGoTracker())
        : spec.exoHub ? Response.json(await fetchExo())
        : spec.transitland ? await fetchTransitland(spec.transitland, env)
        : await fetch(spec.url, { headers });
    } catch (err) {
      if (kept && Date.now() - kept.at < STALE_MS) return keptResponse();
      return new Response(`Upstream error: ${err.message}`, { status: 502, headers: CORS });
    }
    // Refused or failing: the last good copy, if it's recent, rather than an error.
    if (!upstream.ok && kept && Date.now() - kept.at < STALE_MS) return keptResponse();
    if (!upstream.ok) return new Response(`Upstream HTTP ${upstream.status}`, { status: 502, headers: CORS });

    // Positions, then the predicted stop times if they're available.
    let body = upstream.body;
    if (spec.also) {
      const first = new Uint8Array(await upstream.arrayBuffer());
      const extra = await firstOk(spec.also, headers);
      body = extra ? new Blob([first, extra]) : first;
      if (spec.routes) body = keepRoutes(new Uint8Array(await new Response(body).arrayBuffer()), spec.routes);
    }

    const type = upstream.headers.get("Content-Type") || "application/octet-stream";
    body = new Uint8Array(await new Response(body).arrayBuffer());
    feedMem.set(match[1], { at: Date.now(), bytes: body, type });
    const response = new Response(body, {
      headers: {
        ...CORS,
        "Content-Type": type,
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      },
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
