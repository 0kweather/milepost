"""Build data/stations.json: every station the map's railroads stop at.

Output: {agency: [[id, name, lat, lon, [lines...], place], ...]}
  - Amtrak rail stations (bus-only Thruway stops removed) via USDOT NTAD,
    plus Brightline and VIA stops from Amtraker. id = station code.
  - Commuter railroads from their GTFS schedules: stations served by rail
    routes and the lines that stop there. ids match each realtime feed's stop
    ids where the feed has them (LIRR, Metro-North, MBTA).

    python3 scripts/build_stations.py
"""
import csv, io, json, pathlib, urllib.parse, urllib.request, zipfile
from collections import defaultdict

MDB = "https://files.mobilitydatabase.org/{}/latest.zip"

# agency: (GTFS url, route filter(route row) -> bool, line name(route row) -> str)
rail = lambda r: r.get("route_type") == "2"
long_name = lambda r: (r.get("route_long_name") or r.get("route_short_name") or "").strip()
GTFS = {
    "lirr": ("https://rrgtfsfeeds.s3.amazonaws.com/gtfslirr.zip", lambda r: True, long_name),
    "mnr": ("https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip", lambda r: True, long_name),
    "mbta": ("https://cdn.mbta.com/MBTA_GTFS.zip", rail, lambda r: long_name(r).replace("/", " / ")),
    "septa": (MDB.format("mdb-503"), lambda r: True,
              lambda r: long_name(r) if long_name(r).endswith("Line") else long_name(r) + " Line"),
    "njt": (MDB.format("mdb-509"), lambda r: True, long_name),
    "metra": (MDB.format("mdb-2854"), lambda r: True, long_name),
    "rtd": (MDB.format("mdb-178"),
            lambda r: r["route_id"] in ("A", "113B", "113G", "117N"),
            lambda r: (r.get("route_short_name") or r["route_id"][-1]) + " Line"),
    "frontrunner": (MDB.format("mdb-170"), rail, lambda r: "FrontRunner"),
    "capmetro": (MDB.format("mdb-150"), lambda r: r["route_id"] == "550", lambda r: "Red Line"),
    "trirail": (MDB.format("mdb-333"), lambda r: True, lambda r: "Tri-Rail"),
    "northstar": ("https://svc.metrotransit.org/mtgtfs/gtfs.zip", lambda r: r["route_id"] == "888", lambda r: "Northstar Line"),
    "caltrain": ("https://data.trilliumtransit.com/gtfs/caltrain-ca-us/caltrain-ca-us.zip", rail, lambda r: "Caltrain"),
    "smart": ("https://data.trilliumtransit.com/gtfs/smart-ca-us/smart-ca-us.zip", rail, lambda r: "SMART"),
    "metrolink": (MDB.format("mdb-96"), lambda r: True, long_name),
}


def get(url, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": "traintracker-build"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def rows(zf, name):
    with zf.open(name) as f:
        for row in csv.DictReader(io.TextIOWrapper(f, "utf-8-sig")):
            # Some feeds (Metra) pad their headers and values with spaces.
            yield {k.strip(): (v or "").strip() for k, v in row.items() if k}


def gtfs_stations(url, keep, line_name):
    zf = zipfile.ZipFile(io.BytesIO(get(url)))
    routes = {r["route_id"]: line_name(r) for r in rows(zf, "routes.txt") if keep(r)}
    trip_line = {t["trip_id"]: routes[t["route_id"]] for t in rows(zf, "trips.txt") if t["route_id"] in routes}
    stops = {s["stop_id"]: s for s in rows(zf, "stops.txt")}
    lines = defaultdict(set)
    for st in rows(zf, "stop_times.txt"):
        line = trip_line.get(st["trip_id"])
        if line:
            s = stops.get(st["stop_id"])
            if s:
                lines[s.get("parent_station") or s["stop_id"]].add(line)
    out = []
    for sid, ls in lines.items():
        s = stops.get(sid)
        if not s or not s.get("stop_lat"):
            continue
        out.append([sid, s["stop_name"].strip(), round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5),
                    sorted(l for l in ls if l), ""])
    return out


def intercity_stations():
    ntad = ("https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Amtrak_Stations/"
            "FeatureServer/0/query?" + urllib.parse.urlencode(
                {"where": "1=1", "outFields": "Code,StnType", "returnGeometry": "false", "f": "json"}))
    types = {f["attributes"]["Code"]: f["attributes"]["StnType"] for f in json.loads(get(ntad))["features"]}
    amtraker = json.loads(get("https://api-v3.amtraker.com/v3/stations"))
    out = defaultdict(list)
    for code, s in amtraker.items():
        if not s.get("lat"):
            continue
        if code in types:
            if types[code] != "TRAIN":
                continue  # Thruway bus stop
            agency = "amtrak"
        else:
            agency = "via" if len(code) == 4 else "brightline"
        place = ", ".join(x for x in (s.get("city"), s.get("state")) if x and x.strip())
        out[agency].append([code, s["name"].strip(), round(s["lat"], 5), round(s["lon"], 5), [], place])
    return out


result = dict(intercity_stations())
for agency, (url, keep, line_name) in GTFS.items():
    try:
        result[agency] = gtfs_stations(url, keep, line_name)
        print(f"{agency}: {len(result[agency])} stations")
    except Exception as err:  # keep going; one broken feed shouldn't block the rest
        print(f"{agency}: FAILED {err}")
print({k: len(v) for k, v in result.items()})

path = pathlib.Path(__file__).resolve().parent.parent / "data" / "stations.json"
path.write_text(json.dumps(result, separators=(",", ":"), ensure_ascii=False))
print(f"wrote {path} ({path.stat().st_size // 1024} KB)")
