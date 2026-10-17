"""Build data/mta.json: station + branch lookups for LIRR and Metro-North.

The MTA realtime feeds only carry numeric stop/route IDs, so the map needs
names, coordinates and colors from the static GTFS. Run occasionally:

    python3 scripts/build_static.py
"""
import json
from feeds import DATA, GTFS, get_zip, rows as csv_rows

FEEDS = {agency: GTFS[agency][0] for agency in ("lirr", "mnr")}
# Read as the feed has them, without trimming.
rows = lambda zf, name: csv_rows(zf, name, strip=False)


def build(url):
    zf = get_zip(url, timeout=60, attempts=1, page_link=False)
    stops = {
        r["stop_id"]: [r["stop_name"].strip(), round(float(r["stop_lat"]), 5), round(float(r["stop_lon"]), 5)]
        for r in rows(zf, "stops.txt")
        if r.get("stop_lat")
    }
    routes = {
        r["route_id"]: [r.get("route_long_name") or r.get("route_short_name"), "#" + (r.get("route_color") or "666666")]
        for r in rows(zf, "routes.txt")
    }
    return {"stops": stops, "routes": routes}


out = {k: build(u) for k, u in FEEDS.items()}
path = DATA / "mta.json"
path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
print(f"wrote {path} ({path.stat().st_size // 1024} KB)")
