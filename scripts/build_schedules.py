"""Build data/schedules/<railroad>.json: two weeks of timetable for railroads
whose live data gives a train's number but not its stops (South Shore Line,
SunRail, SEPTA, exo), or no live data the site can use (Rail Runner, Coaster,
Sprinter, A-train, TRE, DART's Silver Line, TEXRail, WeGo Star, UP Express,
the Polar Bear Express, the Alaska Railroad: placed from the timetable).
Railroads with no public train numbers name each run by its direction (or
route) and first departure ("0-0605") and say "unnumbered": true.

Output: {"start": "YYYY-MM-DD", "tz": IANA zone, "stops": {stop id: [name, lat, lon]},
         "trips": {train number: [[days, line, [[stop id, arr, dep], ...]], ...]}}
  days:     a bitmask of the dates the pattern runs: bit i is `start` + i
            days, over two weeks.
  arr, dep: minutes after midnight of the service day; past 1440 for trains
            running after midnight.
Stop ids and names are the stations' in data/stations.json (run
scripts/build_stations.py first).

    python3 scripts/build_schedules.py [railroad ...]
"""
import csv, datetime, io, json, pathlib, re, sys, time, unicodedata, urllib.parse, urllib.request, zipfile
from collections import defaultdict

DATA = pathlib.Path(__file__).resolve().parent.parent / "data"
# railroad: (GTFS url, keep route(row), line name(route row), train number(trip row))
FEEDS = {
    # Trip ids are train numbers ("22", "1001").
    "southshore": ("https://www.mysouthshoreline.com/google/google_transit.zip", lambda r: r["route_type"] == "2",
                   lambda r: r["route_long_name"], lambda t: t["trip_id"]),
    "sunrail": ("https://corporate.sunrail.com/gtfs/google_transit.zip", lambda r: r["route_type"] == "2",
                lambda r: "SunRail", lambda t: t["trip_short_name"]),
    # "102 Express" -> "102"
    "railrunner": ("https://mjcaction.com/MJC_GTFS_Public/nmrailrunner_google_transit.zip", lambda r: r["route_id"] == "rr",
                   lambda r: "Rail Runner", lambda t: t["trip_short_name"].split()[0] if t["trip_short_name"] else None),
    # SEPTA Regional Rail: its live feed names each train's next stop only.
    "septa": ("https://files.mobilitydatabase.org/mdb-503/latest.zip", lambda r: True,
              lambda r: (lambda n: n if n.endswith("Line") else n + " Line")(r["route_long_name"].strip()),
              lambda t: re.sub(r"^[A-Z]+", "", t["trip_short_name"]) or None),
    # exo: platforms fold into stations by name (as in build_stations.py).
    "exo": ("https://exo.quebec/uploads/ressources-telechargeables/a-propos/donnees-ouvertes/trains/google_transit.zip",
            lambda r: r["route_type"] == "2", lambda r: re.sub(r"^\d+\s*-\s*", "", r["route_long_name"]).replace("/", "-"),
            lambda t: t["trip_short_name"] or None, lambda s: re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", s["stop_name"].lower()).encode("ascii", "ignore").decode()).strip("-")),
    # NCTD: COASTER (commuter rail, two route ids) and SPRINTER (diesel railcars, filed as light rail).
    "coaster": ("https://lfportal.nctd.org/staticGTFS/google_transit.zip", lambda r: r["route_long_name"] == "COASTER", lambda r: "Coaster", lambda t: t["trip_short_name"] or None,
                lambda s: nctd_station(s)),
    # Railroads that don't number their trains publicly (train number None):
    # each run is keyed by its direction and first departure, and shown
    # without a number. Sprinter's trip_short_name is its destination.
    "sprinter": ("https://lfportal.nctd.org/staticGTFS/google_transit.zip", lambda r: r["route_long_name"] == "SPRINTER", lambda r: "Sprinter", None,
                 lambda s: nctd_station(s)),
    "atrain": ("https://gtfs.remix.com/dcta_denton_tx_us.zip", lambda r: r["route_long_name"] == "A-train", lambda r: "A-train", None),
    # DART's feed has the Trinity Railway Express (run with Trinity Metro) and the Silver Line.
    "tre": ("https://www.dart.org/transitdata/latest/google_transit.zip", lambda r: r["route_short_name"] == "TRE", lambda r: "Trinity Railway Express", None),
    "silverline": ("https://www.dart.org/transitdata/latest/google_transit.zip", lambda r: r["route_short_name"] == "SILVER", lambda r: "Silver Line", None),
    "texrail": ("https://gtfsdata.ridetm.org/gtfs/fwtatransitdata.zip", lambda r: r["route_short_name"] == "TEXRail", lambda r: "TEXRail", None),
    "star": ("https://www.wegotransit.com/googleexport/google_transit.zip", lambda r: r["route_id"] == "90", lambda r: "WeGo Star", None),
    "upx": ("https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/UP-GTFS.zip", lambda r: True, lambda r: "UP Express", None),
    # Ontario Northland files every route as a bus; its train is the Polar Bear Express (Cochrane-Moosonee).
    # The feed already has the Northlander's proposed trips, but it is not carrying passengers yet
    # (October 2026): add r["route_long_name"].startswith("Northlander") back when it is.
    "ontarionorthland": ("https://ontarionorthland.tmix.se/gtfs/gtfs.zip", lambda r: "Moosonee" in r["route_long_name"],
                         lambda r: "Polar Bear Express", None),
    # The Alaska Railroad's page links its current timetable file (named by date).
    "alaska": ("https://www.alaskarailroad.com/gtfs", lambda r: True, lambda r: ALASKA_LINES.get(r["route_id"], r.get("route_long_name", "")), None),
}
# Every other railroad on the map, for search's trains later today: the feed,
# routes, line names and station folds build_stations.py uses (so stops are
# the map's stations), each train numbered as its live feed numbers it (None:
# no public numbers, as the live feed shows none).
_stations_src = (pathlib.Path(__file__).resolve().parent / "build_stations.py").read_text()
_stations = {}
exec(_stations_src[:_stations_src.index("\ndef get(")], _stations)
short = lambda t: t.get("trip_short_name") or None
NUMBERS = {
    "lirr": short, "mnr": short, "mbta": short, "caltrain": short, "metrolink": short, "vre": short, "sounder": short,
    "njt": lambda t: (t.get("block_id") or "").lstrip("0") or None,                        # its blocks, unpadded ("0067": train 67)
    "metra": lambda t: re.sub(r"^\D+", "", t["trip_id"].split("_")[1]) if "_" in t["trip_id"] else None,  # "UP-N_UN303_V3_A": 303
    "marc": lambda t: re.sub(r"^Train\s*", "", t.get("trip_short_name") or "", flags=re.I) or None,  # "Train 446"
    "go": lambda t: t["trip_id"].rsplit("-", 1)[-1],                                        # "20261028-ST-7420": 7420
    "ace": lambda t: (re.match(r"ACE0*(\d+)", t["trip_id"]) or [None, None])[1],             # "ACE03H": 3
    # (Tri-Rail's published timetable ran out in August 2025: left out until there's a current one.)
    "rtd": None, "frontrunner": None, "capmetro": None, "smart": None,
}
for _agency, _number_of in NUMBERS.items():
    _url, _keep, _line_name, *_group = _stations["GTFS"][_agency]
    FEEDS[_agency] = (_url, _keep, _line_name, _number_of, *([lambda s, g=_group[0]: g(s["stop_name"])[0]] if _group and _group[0] else []))
# Amtrak's and VIA's own timetables (Amtrak's stops by id, VIA's by code, as
# the map's stations are). Amtraker shows VIA's numbers without its "v".
# Amtrak's own trains (agency 51) and the Maple Leaf (filed under VIA, 157);
# not the commuter trains its file also carries (Shore Line East, MARC).
FEEDS["amtrak"] = ("https://content.amtrak.com/content/gtfs/GTFS.zip", lambda r: r.get("route_type") == "2" and r.get("agency_id") in ("51", "157"),
                   _stations["long_name"], short)
FEEDS["via"] = ("https://www.viarail.ca/sites/all/files/gtfs/viarail.zip", lambda r: True, _stations["long_name"], short,
                lambda s: s.get("stop_code") or s["stop_id"])
# Trains filed under another line (Metrolink's Arrow under the San Bernardino Line).
TRIP_LINE = _stations.get("TRIP_LINE", {})
# Live feeds that name a train only by its trip id, or stops only by code, get
# lookups for them: "ids" {trip id: number}, "codes" {stop code: station id}.
LOOKUPS = {"exo"}
# Railroads whose trains through the city are split into a trip per line.
JOIN = {"septa"}
# Railroads whose new season's trips come without stop times.
BORROW = {"alaska"}
# NCTD lists each station once per direction: folded by name, as in build_stations.py.
NCTD_WORDS = {"Rd": "Road", "Dr": "Drive", "Blvd": "Boulevard", "St": "Street", "Hwy": "Highway"}
nctd_station = lambda s: re.sub(r"[^a-z0-9]+", "-", re.sub(r"\b(Rd|Dr|Blvd|St|Hwy)$", lambda m: NCTD_WORDS[m.group(1)],
    re.sub(r"\s+(Platform\s+\d+|Station)$", "", s["stop_name"].strip()).replace("San Diego - ", "San Diego ").replace("Civic Center - Vista", "Vista Civic Center")).lower()).strip("-")
# The Alaska Railroad's trains by route: one line for both directions.
ALASKA_LINES = {"DenaliNB": "Denali Star", "DenaliSB": "Denali Star", "AuroraNB": "Aurora Winter Train", "AuroraSB": "Aurora Winter Train",
                "CoastalNB": "Coastal Classic", "CoastalSB": "Coastal Classic", "Glacier": "Glacier Discovery", "Hurricane": "Hurricane Turn"}
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def get(url, attempts=4):
    req = urllib.request.Request(url, headers={"User-Agent": "trainsheet-build"})
    for attempt in range(attempts):
        try:
            data = urllib.request.urlopen(req, timeout=180).read()
            # A page that links the current file (the Alaska Railroad's, named by date).
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


def build(agency, url, keep, line_name, number_of, stations, station_by=None):
    zf = get(url)
    today = datetime.date.today()
    window = [today + datetime.timedelta(d) for d in range(14)]
    days = defaultdict(set)  # service id -> dates in the window
    for c in rows(zf, "calendar.txt"):
        start, end = (datetime.datetime.strptime(c[k], "%Y%m%d").date() for k in ("start_date", "end_date"))
        for d in window:
            if start <= d <= end and c[DAYS[d.weekday()]] == "1":
                days[c["service_id"]].add(d)
    for c in rows(zf, "calendar_dates.txt"):
        d = datetime.datetime.strptime(c["date"], "%Y%m%d").date()
        if d in window:
            (days[c["service_id"]].add if c["exception_type"] == "1" else days[c["service_id"]].discard)(d)
    # A railroad that publishes only its next timetable (DART, a few days
    # before it takes effect) leaves the days until then empty: they run as
    # the same weekday does in the new one's first week.
    starts = [datetime.datetime.strptime(c["start_date"], "%Y%m%d").date() for c in rows(zf, "calendar.txt")]
    starts += [datetime.datetime.strptime(c["date"], "%Y%m%d").date() for c in rows(zf, "calendar_dates.txt") if c["exception_type"] == "1"]
    begins = min(starts, default=today)
    if begins > today:
        for dates in days.values():
            for d in window:
                if d < begins and next((d + datetime.timedelta(7 * k) for k in range(1, 3) if d + datetime.timedelta(7 * k) >= begins), None) in dates:
                    dates.add(d)
    routes = [r for r in rows(zf, "routes.txt") if keep(r)]
    lines = {r["route_id"]: line_name(r) for r in routes}
    colors = {line_name(r): f"#{r['route_color']}" for r in routes if r.get("route_color")}
    route_trips = {t["trip_id"]: t for t in rows(zf, "trips.txt") if t["route_id"] in lines}
    trips = {k: t for k, t in route_trips.items() if days.get(t["service_id"])}
    # Each stop as its station (the parent station where there is one).
    all_stops = list(rows(zf, "stops.txt"))
    station_of = {s["stop_id"]: station_by(s) if station_by else s.get("parent_station") or s["stop_id"] for s in all_stops}
    times = defaultdict(list)
    for st in rows(zf, "stop_times.txt"):
        if st["trip_id"] in (route_trips if agency in BORROW else trips):
            sid = station_of.get(st["stop_id"], st["stop_id"])
            # Stops with no time of their own (VIA's flag stops) are left out.
            if sid in stations and (st["arrival_time"] or st["departure_time"]):
                times[st["trip_id"]].append((int(st["stop_sequence"]), sid, minutes(st["arrival_time"] or st["departure_time"]),
                                             minutes(st["departure_time"] or st["arrival_time"])))
    # The Alaska Railroad's file lists each new season's trips (this winter's
    # Aurora and Hurricane Turn) without stop times, which only last season's
    # trips have: a trip with none takes those of its route's other trips.
    if agency in BORROW:
        by_route = defaultdict(list)
        for trip_id, seq in times.items():
            by_route[route_trips[trip_id]["route_id"]].append(seq)
        times = {trip_id: times.get(trip_id) or list(by_route[t["route_id"]][-1])
                 for trip_id, t in trips.items() if times.get(trip_id) or by_route.get(t["route_id"])}
    # A train through the city is two trips (one per line) with one number
    # (SEPTA's PAO3549 then WTR3549): joined into one run, in time order.
    if agency in JOIN:
        joined = {}
        for trip_id, seq in times.items():
            t = trips[trip_id]
            k = (number_of(t), t["service_id"])
            joined.setdefault(k, (trip_id, []))[1].extend(seq)
        times = {}
        for trip_id, seq in joined.values():
            seq.sort(key=lambda x: (x[2], x[3]))
            out_seq = []
            for i, (seq_no, sid, arr, dep) in enumerate(seq):
                if out_seq and out_seq[-1][1] == sid:
                    out_seq[-1] = (out_seq[-1][0], sid, out_seq[-1][2], max(dep, out_seq[-1][3]))
                else:
                    out_seq.append((i, sid, arr, dep))
            times[trip_id] = out_seq
    patterns = defaultdict(dict)  # number -> {(line, stops): mask}
    for trip_id, seq in times.items():
        t = trips[trip_id]
        seq.sort()
        # A stop listed twice in a row (the Alaska Railroad's file lists every
        # stop twice) is one stop: its first arrival, its last departure.
        merged = []
        for x in seq:
            if merged and merged[-1][1] == x[1]:
                merged[-1] = (merged[-1][0], x[1], merged[-1][2], max(x[3], merged[-1][3]))
            else:
                merged.append(x)
        seq = merged
        # No public train numbers: a run is its direction (or route) and first departure ("0-0605").
        n = number_of(t) if number_of else f"{t.get('direction_id') or t['route_id']}-{seq[0][3] // 60:02d}{seq[0][3] % 60:02d}"
        if not n or len(seq) < 2:
            continue
        mask = 0
        for d in days[t["service_id"]]:
            mask |= 1 << (d - today).days
        line = TRIP_LINE[agency](t, lines[t["route_id"]]) if agency in TRIP_LINE else lines[t["route_id"]]
        key = (line, tuple((sid, arr, dep) for _, sid, arr, dep in seq))
        patterns[n][key] = patterns[n].get(key, 0) | mask
    used = {sid for p in patterns.values() for (_, pat) in p for sid, *_ in pat}
    # Times are in the feed's own zone (Amtrak's are all Eastern, whatever the station's).
    tz = next((a.get("agency_timezone") for a in rows(zf, "agency.txt") if a.get("agency_timezone")), None) \
        or next((s[10] for s in stations.values() if s[10]), None)
    out = {"start": today.isoformat(), "tz": tz,
           "stops": {sid: stations[sid][1:4] for sid in sorted(used)},
           "trips": {n: [[mask, line, [list(x) for x in pat]] for (line, pat), mask in p.items()] for n, p in sorted(patterns.items())}}
    if colors:
        out["colors"] = colors
    if not number_of:
        out["unnumbered"] = True
    if agency in LOOKUPS:
        out["ids"] = {tid: number_of(t) for tid, t in trips.items() if number_of(t)}
        out["codes"] = {s["stop_code"]: station_of[s["stop_id"]] for s in all_stops if s.get("stop_code") and station_of[s["stop_id"]] in used}
    return out


def departures_index():
    """data/departures.json, for search's "Later today": every railroad's runs
    without their stops (its first and last stop, departure and days), from
    all the files in data/schedules/."""
    out = {}
    for path in [*sorted((DATA / "schedules").glob("*.json")), DATA / "ctrail.json"]:
        if not path.exists():
            continue
        tt = json.loads(path.read_text())
        tt.setdefault("tz", "America/New_York")  # CT Rail's file doesn't say
        runs, ends = [], set()
        for n, pats in tt["trips"].items():
            for days, line, stops in pats:
                runs.append([n, line, stops[0][0], stops[-1][0], stops[0][2] if stops[0][2] is not None else stops[0][1], days])
                ends |= {stops[0][0], stops[-1][0]}
        runs.sort(key=lambda r: r[4])
        out[path.stem] = {"start": tt["start"], "tz": tt["tz"], **({"unnumbered": True} if tt.get("unnumbered") else {}),
                          **({"file": "ctrail.json"} if path.stem == "ctrail" else {}),
                          "stops": {sid: tt["stops"][sid][0] for sid in sorted(ends)}, "runs": runs}
    path = DATA / "departures.json"
    path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    print(f"departures: {sum(len(v['runs']) for v in out.values())} runs ({path.stat().st_size // 1024} KB)")


all_stations = json.loads((DATA / "stations.json").read_text())
(DATA / "schedules").mkdir(exist_ok=True)
for agency, (url, keep, line_name, number_of, *station_by) in FEEDS.items():
    if sys.argv[1:] and agency not in sys.argv[1:]:
        continue
    out = build(agency, url, keep, line_name, number_of, {r[0]: r for r in all_stations[agency]}, *station_by)
    path = DATA / "schedules" / f"{agency}.json"
    path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    print(f"{agency}: {len(out['stops'])} stops, {len(out['trips'])} train numbers ({path.stat().st_size // 1024} KB)")

departures_index()
