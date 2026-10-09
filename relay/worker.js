// TrainTracker relay — a Cloudflare Worker that fetches the train feeds a
// browser can't read directly (no CORS headers, or an API key is required)
// and passes them through with CORS enabled.
//
// It is NOT an open proxy: only the feeds listed below can be requested, API
// keys stay in Worker secrets, and every response is cached at the edge for a
// few seconds so heavy traffic doesn't multiply upstream requests.
//
//   GET /status      -> { feeds: { septa: true, metra: false, ... } }
//   GET /feed/:id    -> the upstream feed, byte for byte

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
  caltrain: (env) =>
    env.API_511_KEY && {
      url: `https://api.511.org/transit/vehiclepositions?agency=CT&api_key=${encodeURIComponent(env.API_511_KEY)}`,
    },
  smart: (env) =>
    env.API_511_KEY && {
      url: `https://api.511.org/transit/vehiclepositions?agency=SA&api_key=${encodeURIComponent(env.API_511_KEY)}`,
    },
  metrolink: (env) =>
    env.METROLINK_API_KEY && {
      url: "https://metrolink-gtfsrt.gbsdigital.us/feed/gtfsrt-vehicles",
      headers: { "X-Api-Key": env.METROLINK_API_KEY },
    },
  njt: (env) => env.NJT_USERNAME && env.NJT_PASSWORD && { njt: true },
};

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

    let upstream;
    try {
      upstream = spec.njt
        ? await fetchNjt(env)
        : await fetch(spec.url, { headers: { "User-Agent": "TrainTracker relay", ...spec.headers } });
    } catch (err) {
      return new Response(`Upstream error: ${err.message}`, { status: 502, headers: CORS });
    }
    if (!upstream.ok) return new Response(`Upstream HTTP ${upstream.status}`, { status: 502, headers: CORS });

    const response = new Response(upstream.body, {
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
