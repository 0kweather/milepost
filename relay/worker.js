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
  rtd: () => ({ url: "https://open-data.rtd-denver.com/files/gtfs-rt/rtd/VehiclePosition.pb" }),
  uta: () => ({ url: "https://apps.rideuta.com/tms/gtfs/Vehicle" }),
  capmetro: () => ({ url: "https://data.texas.gov/download/eiei-9rpf/application%2Foctet-stream" }),
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
