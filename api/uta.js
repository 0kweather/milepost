// Vercel serverless function: Utah Transit's FrontRunner feed for the map.
//
// UTA's server refuses requests from Cloudflare's network, so this one feed
// can't go through the Cloudflare relay. Vercel runs elsewhere. Deploy by
// importing this repo into Vercel; the function is served at /api/uta.
// Then set window.TRAINTRACKER_FEEDS = { uta: "https://<project>.vercel.app/api/uta" }
// in config.js.

const UPSTREAM = "https://apps.rideuta.com/tms/gtfs/Vehicle";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Let Vercel's edge serve the same copy for 15 s, so heavy traffic doesn't
  // multiply requests to UTA.
  res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=15");
  try {
    const upstream = await fetch(UPSTREAM, { headers: { "User-Agent": "TrainTracker relay" } });
    if (!upstream.ok) return res.status(502).send(`Upstream HTTP ${upstream.status}`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.status(200).send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.status(502).send(`Upstream error: ${err.message}`);
  }
}
