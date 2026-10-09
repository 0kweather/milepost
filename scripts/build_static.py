"""Build data/mta.json: station + branch lookups for LIRR and Metro-North.

The MTA realtime feeds only carry numeric stop/route IDs, so the map needs
names, coordinates and colors from the static GTFS. Run occasionally:

    python3 scripts/build_static.py
"""
import csv, io, json, pathlib, urllib.request, zipfile

FEEDS = {
    "lirr": "https://rrgtfsfeeds.s3.amazonaws.com/gtfslirr.zip",
    "mnr": "https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip",
}


def rows(zf, name):
    with zf.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"))


def build(url):
    zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(url, timeout=60).read()))
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
path = pathlib.Path(__file__).resolve().parent.parent / "data" / "mta.json"
path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
print(f"wrote {path} ({path.stat().st_size // 1024} KB)")
