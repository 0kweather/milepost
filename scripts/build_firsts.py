"""Build data/firsts.json: when each commuter railroad's trains start running
again overnight, for the "asleep" card a railroad's page shows when nothing
is running.

Output: {"start": "YYYY-MM-DD",
         railroad: {"tz": IANA zone, "days": [[[dep, number, line, origin], ...], ...]}}
  days: one list per day from `start`: the service day's first few trains
        from 2:30 AM, and its first few after midnight (dep past 1440).
  dep:  minutes after midnight of the service day.
  origin: the station's name as on the map (data/stations.json).

    python3 scripts/build_firsts.py [railroad ...]
"""
import csv, datetime, io, json, pathlib, re, sys, time, urllib.parse, urllib.request, zipfile
from collections import defaultdict

DATA = pathlib.Path(__file__).resolve().parent.parent / "data"
MDB = "https://files.mobilitydatabase.org/{}/latest.zip"
rail = lambda r: r.get("route_type") == "2"
anything = lambda r: True
long_name = lambda r: (r.get("route_long_name") or r.get("route_short_name") or "").strip()
# railroad: (GTFS url, keep route(route row), line name(route row)), as in build_stations.py
FEEDS = {
    "lirr": ("https://rrgtfsfeeds.s3.amazonaws.com/gtfslirr.zip", anything, long_name),
    "mnr": ("https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip", anything, long_name),
    "mbta": ("https://cdn.mbta.com/MBTA_GTFS.zip", rail, long_name),
    "septa": (MDB.format("mdb-503"), anything, lambda r: long_name(r) if long_name(r).endswith("Line") else long_name(r) + " Line"),
    "njt": (MDB.format("mdb-509"), rail, long_name),
    "metra": (MDB.format("mdb-2854"), anything, long_name),
    "rtd": (MDB.format("mdb-178"), lambda r: r["route_id"] in ("A", "113B", "113G", "117N"),
            lambda r: (r.get("route_short_name") or r["route_id"][-1]) + " Line"),
    "frontrunner": (MDB.format("mdb-170"), rail, lambda r: "FrontRunner"),
    "capmetro": (MDB.format("mdb-150"), lambda r: r["route_id"] == "550", lambda r: "Red Line"),
    "trirail": (MDB.format("mdb-333"), rail, lambda r: "Tri-Rail"),
    "caltrain": ("https://data.trilliumtransit.com/gtfs/caltrain-ca-us/caltrain-ca-us.zip", rail, lambda r: "Caltrain"),
    "smart": ("https://data.trilliumtransit.com/gtfs/smart-ca-us/smart-ca-us.zip", rail, lambda r: "SMART"),
    "metrolink": (MDB.format("mdb-96"), anything, long_name),
    "go": ("https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/GO-GTFS.zip", rail,
           lambda r: long_name(r) + " line"),
    "marc": ("https://feeds.mta.maryland.gov/gtfs/marc", rail, lambda r: long_name(r).split(" - ")[0].title() + " Line"),
    "vre": ("https://gtfs.vre.org/containercdngtfsupload/google_transit.zip", rail, long_name),
    "sounder": ("https://www.soundtransit.org/GTFS-rail/40_gtfs.zip", lambda r: r["route_id"].startswith("SNDR_"),
                lambda r: r.get("route_short_name") or long_name(r)),
    "southshore": ("https://www.mysouthshoreline.com/google/google_transit.zip", rail, long_name),
    "sunrail": ("https://corporate.sunrail.com/gtfs/google_transit.zip", rail, lambda r: "SunRail"),
    "railrunner": ("https://mjcaction.com/MJC_GTFS_Public/nmrailrunner_google_transit.zip", lambda r: r["route_id"] == "rr",
                   lambda r: "Rail Runner"),
    "ace": (MDB.format("mdb-2684"), rail, lambda r: "ACE"),
    "exo": ("https://exo.quebec/uploads/ressources-telechargeables/a-propos/donnees-ouvertes/trains/google_transit.zip", rail,
            lambda r: re.sub(r"^\d+\s*-\s*", "", long_name(r)).replace("/", "-")),
    "coaster": ("https://lfportal.nctd.org/staticGTFS/google_transit.zip", lambda r: r["route_long_name"] == "COASTER", lambda r: "Coaster"),
    "sprinter": ("https://lfportal.nctd.org/staticGTFS/google_transit.zip", lambda r: r["route_long_name"] == "SPRINTER", lambda r: "Sprinter"),
    "atrain": ("https://gtfs.remix.com/dcta_denton_tx_us.zip", lambda r: r["route_long_name"] == "A-train", lambda r: "A-train"),
    "tre": ("https://www.dart.org/transitdata/latest/google_transit.zip", lambda r: r["route_short_name"] == "TRE", lambda r: "Trinity Railway Express"),
    "silverline": ("https://www.dart.org/transitdata/latest/google_transit.zip", lambda r: r["route_short_name"] == "SILVER", lambda r: "Silver Line"),
    "texrail": ("https://gtfsdata.ridetm.org/gtfs/fwtatransitdata.zip", lambda r: r["route_short_name"] == "TEXRail", lambda r: "TEXRail"),
    "star": ("https://www.wegotransit.com/googleexport/google_transit.zip", lambda r: r["route_id"] == "90", lambda r: "WeGo Star"),
    "upx": ("https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/UP-GTFS.zip", anything, lambda r: "UP Express"),
    # Ontario Northland files every route as a bus; its train is the Polar Bear Express (Cochrane-Moosonee).
    # The feed already has the Northlander's proposed trips, but it is not carrying passengers yet
    # (October 2026): add r["route_long_name"].startswith("Northlander") back when it is.
    "ontarionorthland": ("https://ontarionorthland.tmix.se/gtfs/gtfs.zip",
                         lambda r: "Moosonee" in r["route_long_name"],
                         lambda r: "Polar Bear Express"),
}
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
SPAN = 14


def get(url, attempts=4):
    req = urllib.request.Request(url, headers={"User-Agent": "trainsheet-build"})
    for attempt in range(attempts):
        try:
            data = urllib.request.urlopen(req, timeout=240).read()
            # A page that links the current file (named by date).
            if data[:2] != b"PK":
                href = re.search(rb'href="([^"]+\.zip)"', data, re.I).group(1).decode()
                return get(urllib.parse.urljoin(url, href))
            return zipfile.ZipFile(io.BytesIO(data))
        except Exception as err:
            if attempt == attempts - 1:
                raise
            print(f"  {url}: retry {attempt + 1} ({err})")
            time.sleep(10)


def rows(zf, name):
    if name not in zf.namelist():
        return
    with zf.open(name) as f:
        for r in csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"), skipinitialspace=True):
            yield {k.strip(): (v or "").strip() for k, v in r.items() if k}


def minutes(hms):
    h, m, *_ = (int(x) for x in hms.split(":"))
    return h * 60 + m


STATIONS = {a: {r[0]: r[1] for r in rs} for a, rs in json.loads((DATA / "stations.json").read_text()).items()}
# Railroads whose stations fold several stops by name (no ids in common with
# data/stations.json): any named stop counts as a station.
FOLDED = {a: (lambda s: bool(s.get("stop_name"))) for a in ("exo", "marc", "coaster", "sprinter")}
EACH = 3  # trains kept per stretch


def build(agency, url, keep, line_name, today):
    zf = get(url)
    window = [today + datetime.timedelta(d) for d in range(SPAN)]
    days = defaultdict(set)  # service id -> dates it runs in the window
    for c in rows(zf, "calendar.txt"):
        start, end = (datetime.datetime.strptime(c[k], "%Y%m%d").date() for k in ("start_date", "end_date"))
        for d in window:
            if start <= d <= end and c[DAYS[d.weekday()]] == "1":
                days[c["service_id"]].add(d)
    for c in rows(zf, "calendar_dates.txt"):
        d = datetime.datetime.strptime(c["date"], "%Y%m%d").date()
        if d in window:
            (days[c["service_id"]].add if c["exception_type"] == "1" else days[c["service_id"]].discard)(d)
    # Only the next timetable published (DART): days before it takes effect
    # run as the same weekday in its first week (as in build_schedules.py).
    starts = [datetime.datetime.strptime(c["start_date"], "%Y%m%d").date() for c in rows(zf, "calendar.txt")]
    starts += [datetime.datetime.strptime(c["date"], "%Y%m%d").date() for c in rows(zf, "calendar_dates.txt") if c["exception_type"] == "1"]
    begins = min(starts, default=today)
    if begins > today:
        for dates in days.values():
            for d in window:
                if d < begins and next((d + datetime.timedelta(7 * k) for k in range(1, 3) if d + datetime.timedelta(7 * k) >= begins), None) in dates:
                    dates.add(d)
    lines = {r["route_id"]: line_name(r) for r in rows(zf, "routes.txt") if keep(r)}
    trips = {t["trip_id"]: t for t in rows(zf, "trips.txt") if t["route_id"] in lines and days.get(t["service_id"])}
    stops = {s["stop_id"]: s for s in rows(zf, "stops.txt")}
    names = STATIONS.get(agency, {})
    def name(sid):
        s = stops.get(sid, {})
        for k in (s.get("parent_station"), sid):
            if k and k in names:
                return names[k]
        n = (stops.get(s.get("parent_station") or "") or s).get("stop_name", "")
        n = re.sub(r"\s+(Platform\s+\d+|Station|Stn)$", "", n)
        return n.title() if n.isupper() else n
    first = {}  # trip id -> (dep, first stop id)
    for st in rows(zf, "stop_times.txt"):
        tid = st["trip_id"]
        if tid not in trips:
            continue
        seq, dep = int(st["stop_sequence"]), st["departure_time"] or st["arrival_time"]
        # Yard limits and other timing points aren't stations (DART's TRE trips start at one).
        if names and not any(k in names for k in (stops.get(st["stop_id"], {}).get("parent_station"), st["stop_id"])) \
                and not (agency in FOLDED and FOLDED[agency](stops.get(st["stop_id"], {}))):
            continue
        if dep and (tid not in first or seq < first[tid][0]):
            first[tid] = (seq, minutes(dep), st["stop_id"])
    starts = [[] for _ in range(SPAN)]
    for tid, (_, dep, sid) in first.items():
        t = trips[tid]
        number = t.get("trip_short_name") or ""
        entry = [dep, number if re.fullmatch(r"[A-Za-z]?\d{1,5}[A-Za-z]?", number) else "", lines[t["route_id"]], name(sid)]
        for d in days[t["service_id"]]:
            starts[(d - today).days].append(entry)
    best = []
    for day in starts:
        day.sort(key=lambda e: e[0])
        best.append([e for e in day if 150 <= e[0] < 1440][:EACH] + [e for e in day if e[0] >= 1440][:EACH])
    tz = next((a["agency_timezone"] for a in rows(zf, "agency.txt") if a.get("agency_timezone")), None)
    return {"tz": tz, "days": best}


path = DATA / "firsts.json"
today = datetime.date.today()
out = json.loads(path.read_text()) if path.exists() and sys.argv[1:] else {}
if out.get("start") not in (None, today.isoformat()):
    sys.exit("firsts.json starts on another day: rebuild every railroad (no arguments)")
out["start"] = today.isoformat()
for agency, (url, keep, line_name) in FEEDS.items():
    if sys.argv[1:] and agency not in sys.argv[1:]:
        continue
    try:
        out[agency] = build(agency, url, keep, line_name, today)
        print(f"{agency}: {sum(1 for d in out[agency]['days'] if d)} days with trains, today {out[agency]['days'][0][:1]}")
    except Exception as err:
        print(f"{agency}: FAILED ({err})")
path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
print(f"wrote {path} ({path.stat().st_size // 1024} KB)")
