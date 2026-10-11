"""Build data/west.json: stop and trip lookups for Caltrain, SMART and Metrolink.

Their realtime feeds (through the relay) carry only stop and trip IDs, so the
map needs each railroad's static GTFS to name stops, match them to the
stations on the map, and give trains a number and destination. Run
occasionally (timetables change a few times a year):

    python3 scripts/build_west.py
"""
import csv, io, json, pathlib, urllib.request, zipfile

FEEDS = {
    "caltrain": "https://data.trilliumtransit.com/gtfs/caltrain-ca-us/caltrain-ca-us.zip",
    "smart": "https://data.trilliumtransit.com/gtfs/smart-ca-us/smart-ca-us.zip",
    "metrolink": "https://files.mobilitydatabase.org/mdb-96/latest.zip",
}


def rows(zf, name):
    with zf.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"))


def build(url):
    req = urllib.request.Request(url, headers={"User-Agent": "trainsheet-build"})
    zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=60).read()))
    raw = {r["stop_id"]: r for r in rows(zf, "stops.txt") if r.get("stop_lat")}
    # Each stop (platforms included) points at its station: the parent station
    # where there is one, which is the ID the map's station list uses.
    stops = {}
    for sid, r in raw.items():
        station = r.get("parent_station") or sid
        p = raw.get(station, r)
        stops[sid] = [p["stop_name"].strip(), round(float(p["stop_lat"]), 5), round(float(p["stop_lon"]), 5), station]
        # Some realtime feeds use stop codes instead of IDs.
        if r.get("stop_code") and r["stop_code"] not in stops:
            stops[r["stop_code"]] = stops[sid]
    trips = {r["trip_id"]: [r.get("trip_short_name") or "", r.get("trip_headsign") or ""] for r in rows(zf, "trips.txt")}
    return {"stops": stops, "trips": trips}


out = {k: build(u) for k, u in FEEDS.items()}
path = pathlib.Path(__file__).resolve().parent.parent / "data" / "west.json"
path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
print(f"wrote {path} ({path.stat().st_size // 1024} KB)")
for k, v in out.items():
    print(f"  {k}: {len(v['stops'])} stops, {len(v['trips'])} trips")
