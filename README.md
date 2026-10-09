# TrainTracker

A live map of passenger trains across the United States: Amtrak and Brightline plus the commuter railroads that publish real-time positions, all on one map.

**Live site:** https://0kweather.github.io/traintracker/

## What's on the map

| Railroad | Region | Feed | Needs |
| --- | --- | --- | --- |
| Amtrak, Brightline, VIA Rail | Nationwide | [Amtraker API](https://amtraker.com) | — |
| MBTA Commuter Rail | Boston | MBTA V3 API | — |
| Long Island Rail Road | New York | MTA GTFS-realtime | — |
| Metro-North | New York | MTA GTFS-realtime (positions estimated from predicted times) | — |
| Northstar | Minneapolis | Metro Transit NexTrip | — |
| SEPTA Regional Rail | Philadelphia | SEPTA TrainView | relay |
| RTD commuter rail (A, B, G, N) | Denver | RTD GTFS-realtime | relay |
| FrontRunner | Salt Lake City | UTA GTFS-realtime | relay |
| CapMetro Rail | Austin | CapMetro GTFS-realtime | relay |
| Tri-Rail | South Florida | Tri-Rail GTFS-realtime | relay |
| Metra | Chicago | Metra GTFS-realtime | relay + free key |
| NJ Transit Rail | New Jersey | NJT GTFS-realtime | relay + free account |
| Caltrain, SMART | Bay Area | 511 SF Bay | relay + free key |
| Metrolink | Los Angeles | Metrolink GTFS-realtime | relay + free key |

"Relay" feeds don't send the CORS headers a browser needs, and keyed feeds can't put their key in a public web page, so both go through a tiny Cloudflare Worker (below). Without it, the site still shows everything in the first five rows.

Not yet covered, because they don't publish public vehicle positions: MARC, VRE, Coaster, SunRail, South Shore Line, Rail Runner, and others. Their trains that Amtrak runs or that share Amtrak's feed (e.g., Hartford Line Amtrak trips) do show up.

## Using it

- Zoomed out, trains are plain dots so the map stays readable; names appear once you zoom in, and labels that would overlap are hidden instead of piling up.
- Search by train number, line, or city. Click a train for its status, next stop, speed and full stop list. The URL updates so you can share a specific train.
- Toggle railroads on or off, filter to intercity or commuter, and switch light/dark with the moon button.

## Running locally

It's a static site with no build step:

```bash
python3 -m http.server 8000
```

then open http://localhost:8000. To try the relay feeds locally, run `python3 scripts/dev_relay.py` and set `window.TRAINTRACKER_RELAY = "http://127.0.0.1:8787"` in `config.js`.

## Turning on the relay feeds

1. Create a free Cloudflare account and install Wrangler (`npm i -g wrangler`), or paste `relay/worker.js` into a new Worker in the Cloudflare dashboard.
2. From `relay/`, run `wrangler deploy`.
3. Optional keys (all free), set with `wrangler secret put NAME`:
   - `METRA_API_TOKEN`: https://metra.com/developers
   - `API_511_KEY`: https://511.org/open-data/token (Caltrain + SMART)
   - `METROLINK_API_KEY`: https://metrolinktrains.com/about/gtfs/
   - `NJT_USERNAME` and `NJT_PASSWORD`: https://developer.njtransit.com
4. Put the Worker's URL in `config.js` (`window.TRAINTRACKER_RELAY = "https://traintracker-relay.<you>.workers.dev"`) and push.

The relay only serves the feeds listed in `relay/worker.js` (it is not an open proxy) and caches each one for 15 seconds.

## Project layout

```
index.html, css/, js/     the site (MapLibre GL + OpenFreeMap basemap)
js/sources.js             one adapter per feed → common train objects
js/gtfsrt.js              small dependency-free GTFS-realtime decoder
data/mta.json             LIRR/Metro-North station + branch lookups
data/rail.geojson         US passenger rail lines (USDOT NTAD)
scripts/                  rebuild the data files; local dev relay
relay/                    Cloudflare Worker for CORS-less and keyed feeds
```

Refresh the static data occasionally with `python3 scripts/build_static.py` and `python3 scripts/build_rail.py`.

Map data © OpenStreetMap contributors, tiles by OpenFreeMap. Train data from the agencies listed above. Rail lines from the USDOT/BTS National Transportation Atlas Database.
