# Trainsheet

A live map of passenger trains across the United States: Amtrak and Brightline plus the commuter railroads that publish real-time positions, all on one map.

**Live site:** https://0kweather.github.io/trainsheet/

## What's on the map

| Railroad | Region | Feed | Needs |
| --- | --- | --- | --- |
| Amtrak, Brightline, VIA Rail | Nationwide | [Amtraker API](https://amtraker.com) | — |
| MBTA Commuter Rail | Boston | MBTA V3 API | — |
| Long Island Rail Road | New York | MTA GTFS-realtime | — |
| Metro-North | New York | MTA GTFS-realtime (positions estimated from predicted times) | — |
| SEPTA Regional Rail | Philadelphia | SEPTA TrainView | relay |
| RTD commuter rail (A, B, G, N) | Denver | RTD GTFS-realtime | relay |
| FrontRunner | Salt Lake City | UTA GTFS-realtime | relay |
| CapMetro Rail | Austin | CapMetro GTFS-realtime | relay |
| Tri-Rail | South Florida | Tri-Rail GTFS-realtime | relay |
| Metra | Chicago | Metra GTFS-realtime | relay + free key |
| NJ Transit Rail | New Jersey | NJ Transit DepartureVision (scraped; positions estimated from predicted times) | relay |
| GO Transit | Toronto | GO Tracker (scraped) plus GO's timetable (`scripts/build_go.py`) | relay |
| CT Rail (Hartford Line, Shore Line East) | Connecticut | CTDOT's timetable (`scripts/build_ct.py`), with delays, tracks and cancellations from MTA TrainTime's New Haven board; positions estimated | direct |
| Caltrain, SMART | Bay Area | 511 SF Bay | relay + free key |
| Metrolink | Los Angeles | Metrolink GTFS-realtime | relay + free key |
| MARC | Maryland | MARC GTFS-realtime | relay |
| Virginia Railway Express | Northern Virginia | VRE GTFS-realtime | relay |
| Sounder | Seattle | Sound Transit GTFS-realtime (OneBusAway; its terms ask for a free key, sent once set) | relay |
| South Shore Line | Chicago–South Bend | South Shore's ETA SPOT tracker, plus its timetable (`scripts/build_schedules.py`) | direct |
| SunRail | Orlando | sunrail.com's train status, plus its timetable | direct |
| Rail Runner Express | New Mexico | Timetable only (no live data published); positions estimated | direct |
| ACE (Altamont Corridor Express) | Stockton–San Jose | 511 SF Bay GTFS-realtime | relay + free key |
| exo | Montréal | exo.quebec's live map (scraped by the relay), plus exo's timetable | relay |
| Coaster, Sprinter | San Diego | NCTD's timetable; positions estimated (live data needs a Swiftly key) | direct |
| Trinity Railway Express, TEXRail, DART Silver Line, A-train | Dallas–Fort Worth | Each railroad's timetable; positions estimated (no public live data) | direct |
| WeGo Star | Nashville | WeGo's timetable; positions estimated (not in WeGo's live feed) | direct |
| UP Express | Toronto | Metrolinx's timetable; positions estimated (not in GO Tracker) | direct |
| Polar Bear Express (Ontario Northland) | Cochrane–Moosonee | Ontario Northland's timetable; positions estimated | direct |
| Alaska Railroad | Anchorage–Fairbanks | The Alaska Railroad's timetable; positions estimated | direct |

"Relay" feeds don't send the CORS headers a browser needs, and keyed feeds can't put their key in a public web page, so both go through a tiny Cloudflare Worker (below). Without it, the site still shows everything in the first four rows.

Northstar (Minneapolis) ended rail service; its route is now a bus, so it isn't shown. Ontario Northland's Northlander is in its timetable file ahead of its return but isn't carrying passengers yet, so only the Polar Bear Express is shown. Not yet covered: West Coast Express and WES (they need keys). Trains that Amtrak runs or that share Amtrak's feed (e.g., Amtrak's own Hartford Line and Valley Flyer trips) do show up.

## Using it

- **Stations:** every station on these railroads is on the map (intercity stops from regional zoom, commuter stops once you zoom into a metro area). Click one, or search for it, to see which railroads and lines serve it and the next trains due, with live predicted times and delays. Stations shared by several railroads, like New York Penn or Boston South Station, appear as one stop. MBTA stations show the MBTA's own live predictions. Arrivals say where each train is now (its next stop, or the station it's standing at).
- **Usual tracks.** At the big terminals a track goes up only minutes before a train leaves. The relay notes every track posted at New York Penn, Grand Central, Atlantic Terminal and Jamaica (LIRR), Grand Central (Metro-North), and New York Penn, Hoboken, Newark Penn and Secaucus (NJ Transit), once per train per day. Until a train's real track is posted, its row shows a dashed track: the one it has used on at least 60% of its last ten recorded days (or two tracks between them on 80%), with the count in its tooltip. Amtrak isn't covered, since Amtraker almost never has its platforms. Needs the relay.
- **Disruptions on the map.** Where a railroad says no trains are running right now (service suspended, or buses replacing trains), that stretch of track loses its colored strands for a thin broken line in the railroad's color, labeled ("Buses replace trains") once zoomed in; hover or tap it for the railroad's notice. A station the stretch leaves with no trains of that railroad says so on its page ("No Metro-North trains here right now", with the notice), and its row in Served by reads "No trains right now"; a station at the end that trains still reach from the other side (Southeast, for "between Southeast and Wassaic") doesn't. From the MTA's LIRR and Metro-North alerts and the MBTA's, refreshed every five minutes (`js/disruptions.js`). A stretch runs between the stations the notice names (or lists), trimmed to stations only the affected lines serve, so track other trains still use isn't marked.
- **Tracking.** A train's page has a **Track** button. It asks where you're getting off (the stops ahead, the last one chosen to begin with), then the train stays pinned at the top with a countdown to your stop, and you're told when it gets there. Tap "Tracking to …" to change the stop or stop tracking.
- **Status, one way everywhere.** A train under five minutes late is on time (green); five minutes or more is late (orange); red is kept for a train that isn't running. In the stop list a later time shows with the timetable's beside it, struck through.
- **The map.** Roads, buildings and land use stay in the background so the rail lines carry the color. A selected train's route lights up in its line's color: solid ahead, faded behind. Taps pick the nearest train within a finger's width.
- **Which train am I on?** Press the locate button while riding. For the next 30 seconds Trainsheet watches your location; if you're moving faster than 15 mph and a train on the map is where you are, heading your way (and about as fast, where it reports a speed), a card asks whether you're on it. "Track this ride" opens it and asks where you're getting off. Your location stays in the browser.
- **Settings** (gear button): light/dark/auto appearance, **Units** (miles or kilometers, for speeds and distances; the default follows your browser's language), **Show stations**, **Infer direction**, **Time zone** (your own by default, or each station's local time, or a chosen zone), **Catch unreported delays**, and **Colorblind-friendly** (statuses in blue and orange, with a circle for on time and a triangle for late).
- **Inferred direction.** Trains whose feed has no heading (Caltrain, some SMART and Metrolink trains, among others) are pointed along the track the way the route to their next stop leads; the heading chip on their page is underlined with dots. It can be turned off in Settings, and those trains then show as dots.
- **Consist.** A train's page draws its cars right under its status. Where the railroad reports car numbers, they're matched to its published fleet roster: every car in order for SEPTA. Numbers outside the roster aren't drawn. Everywhere else, including Amtrak, VIA and LIRR/MBTA trains where only one car is named, the page shows the equipment that typically runs on that route, marked with an eye icon whose tip says the car count and types may not be accurate. Typical sets come from each route's published equipment assignments (as summarized on Wikipedia), and the one car LIRR or MBTA names picks between electric and diesel or bi-level and single-level fleets. Married pairs face outward, with their cabs at the pair's ends; single cars get a cab at each end. The drawings are Trainsheet's own: hand-written SVG geometry built from each model's published dimensions (length, height, truck centers, wheel size, door positions) and checked against photographs, all at one scale of 3 px per foot, so a locomotive stands in true proportion to its cars. Liveries follow each railroad's current paint. No public-domain side views of these trains exist, and the ones on Wikimedia Commons are CC BY-SA, so nothing is traced or copied.
- **Unreported delays.** Railroads often keep showing a train on time well after it's fallen behind. Trainsheet checks each GPS fix against the posted times: a train still at the platform after its posted departure (and not moving), or still too far from its next stop to make the posted arrival even running at 1.5× its scheduled pace, is at least that late. Trainsheet only counts delay the GPS proves, never extrapolates past the last fix, and pushes later stops back by the timetable's running times unless the feed already shows them later. These delays are underlined with dots, and the train page says what the GPS showed. Works for Amtrak, VIA and LIRR trains reporting GPS. Brightline is skipped because its feed doesn't say when a position was taken. It's on by default and can be turned off in Settings (`js/delays.js`).
- **Rail lines are colored by network.** Each stretch of track takes the color of the railroads that run passenger trains on it, and shared track (Amtrak and Metro-North on the New Haven Line, for example) is drawn as side-by-side strands, one per railroad. Hover a line to see who runs on it. Railroads come from USDOT's track ownership and trackage-rights codes, plus the nearest commuter station for commuter trains on freight-owned track.
- **Trains sit on the track.** Reported positions are snapped to the nearest rail line within 1.5 km, preferring the train's own railroad when it's about as close. The rail lines form a graph, so trains placed from the timetable (Metro-North) and slide animations follow the track between two points (a shortest-path route) instead of cutting across curves.
- **Stations sit on the track** too: each is drawn at the nearest point on its railroad's track within 400 m. Terminals like Boston South Station, whose tracks end short of the building, sit at the end of the platforms.
- **Main line only.** Yard tracks, sidings and spurs are left out (from both the passenger network and the basemap), so big terminals don't turn into a tangle.
- Trains are arrows pointing the way they're headed. Zoomed out, they're unlabeled so the map stays readable; names appear once you zoom in, and labels that would overlap are hidden instead of piling up.
- Search by train number, line, or city. Click a train for its status, next stop, speed and full stop list. The URL updates so you can share a specific train.
- Toggle railroads on or off and filter to intercity or commuter.

## Running locally

It's a static site with no build step:

```bash
python3 -m http.server 8000
```

then open http://localhost:8000. To try the relay feeds locally, run `python3 scripts/dev_relay.py` and set `window.TRAINSHEET_RELAY = "http://127.0.0.1:8787"` in `config.js`.

## Turning on the relay feeds

1. Create a free Cloudflare account and install Wrangler (`npm i -g wrangler`), or paste `relay/worker.js` into a new Worker in the Cloudflare dashboard.
2. From `relay/`, run `wrangler deploy`.
3. Optional keys (all free), set with `wrangler secret put NAME`:
   - `METRA_API_TOKEN`: https://metra.com/developers
   - `API_511_KEY`: https://511.org/open-data/token (Caltrain + SMART)
   - `METROLINK_API_KEY`: https://metrolinktrains.com/about/gtfs/
4. Put the Worker's URL in `config.js` (`window.TRAINSHEET_RELAY = "https://trainsheet-relay.<you>.workers.dev"`) and push.

The relay only serves the feeds listed in `relay/worker.js` (it is not an open proxy) and caches each one for 15 seconds. A Cron Trigger (every five minutes, in `wrangler.toml`) records the tracks posted at the big terminals in the Worker's Durable Object, for usual tracks; it keeps three weeks.

## Project layout

```
index.html, css/, js/     the site (MapLibre GL + OpenFreeMap basemap)
js/sources.js             one adapter per feed → common train objects
js/gtfsrt.js              small dependency-free GTFS-realtime decoder
data/mta.json             LIRR/Metro-North station + branch lookups
data/rail.geojson         US and Canadian passenger main lines (USDOT NTAD) tagged by network, merged into continuous lines
data/stations.json        stations for every railroad (NTAD, Amtraker, agency GTFS)
js/stations.js            station merging and "next trains" lookups
js/delays.js              delays the GPS proves but the railroad hasn't posted
js/consist.js             fleet rosters and typical equipment for a train's cars
js/carmodels.js           side-view drawings of each locomotive and car model
js/carart.js              drawing toolkit: trucks, windows, doors, pantographs, scale
js/estimate.js            rail index: snapping to track and routing along it
js/networks.js            rail network names and colors
scripts/                  rebuild the data files; local dev relay
relay/                    Cloudflare Worker for CORS-less and keyed feeds
```

Deploys run through `.github/workflows/pages.yml`, which stamps every file reference (`?v=dev` in the source) with the commit ID so browsers never mix cached files from different versions.

Refresh the static data occasionally with `python3 scripts/build_static.py`, `python3 scripts/build_stations.py`, then `python3 scripts/build_rail.py` (it uses the stations), and `python3 scripts/build_trips.py` (stop and trip lookups for Caltrain, SMART, Metrolink, RTD and CapMetro; it uses the stations too).

Map data © OpenStreetMap contributors, tiles by OpenFreeMap. Train data from the agencies listed above. Rail lines from the USDOT/BTS National Transportation Atlas Database. Railroad logos on the train drawings (`img/logos/`) are the railroads' trademarks, from the public-domain versions on Wikimedia Commons.
