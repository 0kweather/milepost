"""Build data/trips.json: stop and trip lookups for railroads whose realtime
feeds (through the relay) carry only IDs: Caltrain, SMART, Metrolink, RTD,
CapMetro and Metra.

Trips are [number, headsign] (plus {stop_sequence: stop_id} where the realtime
feed gives only sequences). Their realtime feeds (through the relay) carry only stop and trip IDs, so the
map needs each railroad's static GTFS to name stops, match them to the
stations on the map, and give trains a number and destination. Run
occasionally (timetables change a few times a year):

    python3 scripts/build_trips.py
    python3 scripts/build_trips.py vre sounder   # just these, into the existing file
"""
import csv, io, json, pathlib, re, sys, urllib.request, zipfile

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
    "marc": ("https://feeds.mta.maryland.gov/gtfs/marc", None),
    "frontrunner": (MDB.format("mdb-170"), {"41065"}),  # UTA's feed also covers TRAX and buses
    "vre": ("https://gtfs.vre.org/containercdngtfsupload/google_transit.zip", None),
    "sounder": ("https://www.soundtransit.org/GTFS-rail/40_gtfs.zip", {"SNDR_EV", "SNDR_TL"}),  # not Link
}


def rows(zf, name):
    # Some feeds (Metra) put a space after every comma.
    with zf.open(name) as f:
        for r in csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"), skipinitialspace=True):
            yield {k.strip(): (v or "").strip() for k, v in r.items() if k}


# MARC lists each station once per direction ("NEW CARROLLTON MARC nb" and
# "... sb"), with no parent station. Both fold into one station, named in
# plain words, whose id is that name as a slug ("new-carrollton").
MARC_NAMES = {"Penn Station": "Baltimore Penn Station", "Union Station": "Washington Union Station",
              "Camden Station": "Baltimore Camden Station", "Bwi Rail Station": "BWI Airport", "St Denis": "St. Denis",
              "Brunswick Md": "Brunswick", "Harpers Ferry W Va": "Harpers Ferry", "Duffields W Va": "Duffields",
              "Martinsburg W Va": "Martinsburg", "Point Of Rocks": "Point of Rocks"}


def marc_station(name):
    """(station id, name) for one of MARC's per-direction stops."""
    base = re.sub(r"\s+MARC(\s+(nb|sb|eb|wb|Washington))?$", "", name.strip(), flags=re.I).title()
    base = MARC_NAMES.get(base, base)
    return re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-"), base


def headsign(h):
    # "550 Downtown Station SB" -> "Downtown Station"
    return re.sub(r"\s+(NB|SB|EB|WB)$", "", re.sub(r"^\d+\s+", "", h.strip()))


def build(agency, url, routes):
    req = urllib.request.Request(url, headers={"User-Agent": "trainsheet-build"})
    zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=120).read()))
    # MARC's headsigns are bare city names in capitals ("BALTIMORE"),
    # FrontRunner's read "To Ogden"; their trains' last stops name their
    # destinations better.
    trips = {r["trip_id"]: [r.get("trip_short_name") or "", "" if agency in ("marc", "frontrunner") else headsign(r.get("trip_headsign") or "")]
             for r in rows(zf, "trips.txt") if routes is None or r["route_id"] in routes}
    # Only the stops those trips use (a whole bus network's stops would be huge).
    used = None
    if routes is not None:
        used = set()
        for r in rows(zf, "stop_times.txt"):
            if r["trip_id"] in trips:
                used.add(r["stop_id"])
                # UTA's trip updates name stops only by their place in the trip,
                # so FrontRunner trips carry their stops by sequence.
                if agency in SEQUENCED:
                    if len(trips[r["trip_id"]]) < 3:
                        trips[r["trip_id"]].append({})
                    trips[r["trip_id"]][2][r["stop_sequence"]] = r["stop_id"]
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
        # FrontRunner's timetable includes crew relief points; only stations count.
        if agency in SEQUENCED and station not in known:
            continue
        p = raw.get(parent, r)
        name = p["stop_name"].strip()
        if agency == "marc":  # per-direction stops fold into one station
            station, name = marc_station(name)
        if agency == "sounder":  # "Kent Sounder Station" -> "Kent"
            name = re.sub(r"(\s+Sounder)?(\s+Station)?$", "", name)
        stops[sid] = [name, round(float(p["stop_lat"]), 5), round(float(p["stop_lon"]), 5), station]
        # Some realtime feeds use stop codes instead of IDs.
        if r.get("stop_code") and r["stop_code"] not in stops:
            stops[r["stop_code"]] = stops[sid]
    return {"stops": stops, "trips": trips}


SEQUENCED = {"frontrunner"}
only = sys.argv[1:]
path = DATA / "trips.json"
out = json.loads(path.read_text()) if only else {}
out.update({k: build(k, u, routes) for k, (u, routes) in FEEDS.items() if not only or k in only})
path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
print(f"wrote {path} ({path.stat().st_size // 1024} KB)")
for k, v in out.items():
    print(f"  {k}: {len(v['stops'])} stops, {len(v['trips'])} trips")
