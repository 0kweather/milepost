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
//   GET /feed/:id    -> the upstream feed, byte for byte. For railroads that
//                       publish positions and predicted stop times as two
//                       GTFS-realtime feeds, both, back to back: concatenated
//                       protobuf messages read as one feed with every entity.

const CACHE_SECONDS = 15;
const RELAY_VERSION = "2026-10-13 (FrontRunner via Transitland)";

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
  // NJ Transit: scraped from DepartureVision (below); no key needed.
  njt: () => ({ njtDv: true }),
  // GO Transit: scraped from GO Tracker (below); no key needed.
  go: () => ({ goTracker: true }),

  // Keyed feeds: set the secrets with `npx wrangler secret put NAME`.
  metra: (env) =>
    env.METRA_API_TOKEN && {
      url: `https://gtfspublic.metrarr.com/gtfs/public/positions?api_token=${encodeURIComponent(env.METRA_API_TOKEN)}`,
      // Predicted stop times, for each train's upcoming stops.
      also: [`https://gtfspublic.metrarr.com/gtfs/public/tripupdates?api_token=${encodeURIComponent(env.METRA_API_TOKEN)}`],
    },
  caltrain: (env) => env.API_511_KEY && feed511("CT", env),
  smart: (env) => env.API_511_KEY && feed511("SA", env),
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

async function fetchNjtDv(ctx) {
  const now = Date.now();
  if (njtMem && now - njtMem.at < 15 * 1000) return Response.json(njtMem.json);
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
  njtMem = { st, at: now, json: { at: now, trains } };
  return Response.json(njtMem.json);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const { pathname } = new URL(request.url);

    if (pathname === "/status") {
      const feeds = Object.fromEntries(Object.entries(FEEDS).map(([id, f]) => [id, Boolean(f(env))]));
      // Which code is deployed, and whether optional keys are visible to it
      // (true/false only), for checking a deploy.
      const check = { version: RELAY_VERSION, transitland: Boolean(env.TRANSITLAND_API_KEY) };
      return Response.json({ feeds, check }, { headers: { ...CORS, "Cache-Control": "max-age=300" } });
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

    const headers = { "User-Agent": "Trainsheet relay", ...spec.headers };
    let upstream;
    try {
      upstream = spec.njtDv ? await fetchNjtDv(ctx)
        : spec.goTracker ? Response.json(await fetchGoTracker())
        : spec.transitland ? await fetchTransitland(spec.transitland, env)
        : await fetch(spec.url, { headers });
    } catch (err) {
      return new Response(`Upstream error: ${err.message}`, { status: 502, headers: CORS });
    }
    if (!upstream.ok) return new Response(`Upstream HTTP ${upstream.status}`, { status: 502, headers: CORS });

    // Positions, then the predicted stop times if they're available.
    let body = upstream.body;
    if (spec.also) {
      const first = new Uint8Array(await upstream.arrayBuffer());
      const extra = await firstOk(spec.also, headers);
      body = extra ? new Blob([first, extra]) : first;
      if (spec.routes) body = keepRoutes(new Uint8Array(await new Response(body).arrayBuffer()), spec.routes);
    }

    const response = new Response(body, {
      headers: {
        ...CORS,
        "Content-Type": upstream.headers.get("Content-Type") || "application/octet-stream",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      },
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
