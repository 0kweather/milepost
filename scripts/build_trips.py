"""Build data/trips.json: stop and trip lookups for railroads whose realtime
feeds (through the relay) carry only IDs: Caltrain, SMART, Metrolink, RTD,
CapMetro and Metra.

Their realtime feeds (through the relay) carry only stop and trip IDs, so the
map needs each railroad's static GTFS to name stops, match them to the
stations on the map, and give trains a number and destination. Run
occasionally (timetables change a few times a year):

    python3 scripts/build_trips.py
"""
import csv, io, json, pathlib, re, urllib.request, zipfile

DATA = pathlib.Path(__file__).resolve().parent.parent / "data"
# The station IDs the map uses (data/stations.json), per railroad: some use
# parent stations, others platforms.
STATIONS = {a: {r[0] for r in rows} for a, rows in json.loads((DATA / "stations.json").read_text()).items()}

MDB = "https://files.mobilitydatabase.org/{}/latest.zip"
# URL, and the routes to keep for agencies whose feed also covers buses.
FEEDS = {
    "caltrain": ("https://data.trilliumtransit.com/gtfs/caltrain-ca-us/caltrain-ca-us.zip", None),
    "smart": ("https://data.trilliumtransit.com/gtfs/smart-ca-us/smart-ca-us.zip", None),
    "metrolink": (MDB.format("mdb-96"), None),
    "rtd": (MDB.format("mdb-178"), {"A", "113B", "113G", "117N"}),
    "capmetro": (MDB.format("mdb-150"), {"550"}),
    "metra": ("https://schedules.metrarail.com/gtfs/schedule.zip", None),
}


def rows(zf, name):
    # Some feeds (Metra) put a space after every comma.
    with zf.open(name) as f:
        for r in csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"), skipinitialspace=True):
            yield {k.strip(): (v or "").strip() for k, v in r.items() if k}


def headsign(h):
    # "550 Downtown Station SB" -> "Downtown Station"
    return re.sub(r"\s+(NB|SB|EB|WB)$", "", re.sub(r"^\d+\s+", "", h.strip()))


def build(agency, url, routes):
    req = urllib.request.Request(url, headers={"User-Agent": "trainsheet-build"})
    zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=120).read()))
    trips = {r["trip_id"]: [r.get("trip_short_name") or "", headsign(r.get("trip_headsign") or "")]
             for r in rows(zf, "trips.txt") if routes is None or r["route_id"] in routes}
    # Only the stops those trips use (a whole bus network's stops would be huge).
    used = None
    if routes is not None:
        used = {r["stop_id"] for r in rows(zf, "stop_times.txt") if r["trip_id"] in trips}
    raw = {r["stop_id"]: r for r in rows(zf, "stops.txt") if r.get("stop_lat")}
    # Each stop (platforms included) points at its station: the parent station
    # where there is one, which is the ID the map's station list uses.
    stops = {}
    for sid, r in raw.items():
        if used is not None and sid not in used:
            continue
        parent = r.get("parent_station") or sid
        known = STATIONS.get(agency, set())
        station = parent if parent in known or sid not in known else sid
        p = raw.get(parent, r)
        stops[sid] = [p["stop_name"].strip(), round(float(p["stop_lat"]), 5), round(float(p["stop_lon"]), 5), station]
        # Some realtime feeds use stop codes instead of IDs.
        if r.get("stop_code") and r["stop_code"] not in stops:
            stops[r["stop_code"]] = stops[sid]
    return {"stops": stops, "trips": trips}


out = {k: build(k, u, routes) for k, (u, routes) in FEEDS.items()}
path = DATA / "trips.json"
path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
print(f"wrote {path} ({path.stat().st_size // 1024} KB)")
for k, v in out.items():
    print(f"  {k}: {len(v['stops'])} stops, {len(v['trips'])} trips")
