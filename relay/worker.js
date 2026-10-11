// Trainsheet relay — a Cloudflare Worker that fetches the train feeds a
// browser can't read directly (no CORS headers, or an API key is required)
// and passes them through with CORS enabled.
//
// It is NOT an open proxy: only the feeds listed below can be requested, API
// keys stay in Worker secrets, and every response is cached at the edge for a
// few seconds so heavy traffic doesn't multiply upstream requests.
//
//   GET /status      -> { feeds: { septa: true, metra: false, ... } }
//   GET /feed/:id    -> the upstream feed, byte for byte. For railroads that
//                       publish positions and predicted stop times as two
//                       GTFS-realtime feeds, both, back to back: concatenated
//                       protobuf messages read as one feed with every entity.

const CACHE_SECONDS = 15;

const FEEDS = {
  septa: () => ({ url: "https://www3.septa.org/api/TrainView/index.php" }),
  // RTD and CapMetro feeds cover every bus too; only the rail lines are kept.
  rtd: () => ({
    url: "https://open-data.rtd-denver.com/files/gtfs-rt/rtd/VehiclePosition.pb",
    also: ["https://open-data.rtd-denver.com/files/gtfs-rt/rtd/TripUpdate.pb"],
    routes: ["A", "113B", "113G", "117N"],
  }),
  uta: () => ({ url: "https://apps.rideuta.com/tms/gtfs/Vehicle" }),
  capmetro: () => ({
    url: "https://data.texas.gov/download/eiei-9rpf/application%2Foctet-stream",
    also: ["https://data.texas.gov/download/rmk2-acnw/application%2Foctet-stream"],
    routes: ["550"],
  }),
  trirail: () => ({ url: "https://gtfsr.tri-rail.com/download.aspx?file=position_updates.pb" }),

  // Keyed feeds: set the secrets with `npx wrangler secret put NAME`.
  metra: (env) =>
    env.METRA_API_TOKEN && {
      url: `https://gtfspublic.metrarr.com/gtfs/public/positions?api_token=${encodeURIComponent(env.METRA_API_TOKEN)}`,
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
  njt: (env) => env.NJT_USERNAME && env.NJT_PASSWORD && { njt: true },
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

// NJ Transit hands out a session token that is good for a day; reuse it.
let njtToken = null;
async function fetchNjt(env) {
  const base = "https://raildata.njtransit.com/api/GTFSRT";
  const post = (path, fields) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return fetch(`${base}/${path}`, { method: "POST", body: form });
  };
  if (!njtToken) {
    const auth = await (await post("getToken", { username: env.NJT_USERNAME, password: env.NJT_PASSWORD })).json();
    njtToken = auth.UserToken;
  }
  let res = await post("getVehiclePositions", { token: njtToken });
  if (res.status === 401 || res.status === 403) {
    njtToken = null;
    return fetchNjt(env);
  }
  return res;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const { pathname } = new URL(request.url);

    if (pathname === "/status") {
      const feeds = Object.fromEntries(Object.entries(FEEDS).map(([id, f]) => [id, Boolean(f(env))]));
      return Response.json({ feeds }, { headers: { ...CORS, "Cache-Control": "max-age=300" } });
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
      upstream = spec.njt ? await fetchNjt(env) : await fetch(spec.url, { headers });
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
