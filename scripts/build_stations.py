"""Build data/stations.json: every station the map's railroads stop at.

Output: {agency: [[id, name, lat, lon, [lines...], place, code, busy, daily, access, tz], ...]}
  code: the station's official short code where the railroad publishes one
        (Amtrak/VIA/Brightline, LIRR, NJ Transit, Metra); otherwise empty.
  busy: how busy the station is (scheduled stops per week of service, or
        tracked Amtrak trains), used to decide which labels win for space.
  daily: trains stopping on a typical weekday (the busiest weekday in the
        next three weeks of the timetable), or null.
  access: 1 step-free (wheelchair boarding), 0 not, null unknown.
  tz: the station's time zone (IANA), or null.
  - Amtrak rail stations (bus-only Thruway stops removed) via USDOT NTAD,
    plus Brightline and VIA stops from Amtraker. id = station code.
  - Commuter railroads from their GTFS schedules: stations served by rail
    routes and the lines that stop there. ids match each realtime feed's stop
    ids where the feed has them (LIRR, Metro-North, MBTA).

    python3 scripts/build_stations.py
    python3 scripts/build_stations.py vre sounder   # just these, into the existing file
"""
import datetime, io, json, pathlib, re, sys, urllib.parse, urllib.request, zipfile
from collections import defaultdict

from feeds import (AMTRAK_GTFS, VIA_GTFS, GTFS, TRIP_LINE, long_name, current_feed, get_raw, rows)


def get(url, timeout=180):
    return current_feed(get_raw(url, timeout))


def official_code(stop):
    for value in (stop.get("stop_code"), stop.get("stop_id")):
        if value and re.fullmatch(r"[A-Za-z]{2,4}", value):
            return value.upper()
    return ""


def weekday_trips(zf, trip_ids):
    """The trips running on a typical weekday: of the next three weeks'
    weekdays, the one with the most of `trip_ids` running."""
    names = set(zf.namelist())
    today = datetime.date.today()
    days = [today + datetime.timedelta(d) for d in range(21) if (today + datetime.timedelta(d)).weekday() < 5]
    active = defaultdict(set)  # date -> service ids
    if "calendar.txt" in names:
        cols = ["monday", "tuesday", "wednesday", "thursday", "friday"]
        for c in rows(zf, "calendar.txt"):
            start, end = (datetime.datetime.strptime(c[k], "%Y%m%d").date() for k in ("start_date", "end_date"))
            for d in days:
                if start <= d <= end and c.get(cols[d.weekday()]) == "1":
                    active[d].add(c["service_id"])
    if "calendar_dates.txt" in names:
        for c in rows(zf, "calendar_dates.txt"):
            d = datetime.datetime.strptime(c["date"], "%Y%m%d").date()
            if d in days:
                (active[d].add if c["exception_type"] == "1" else active[d].discard)(c["service_id"])
    service = {t["trip_id"]: t["service_id"] for t in rows(zf, "trips.txt") if t["trip_id"] in trip_ids}
    best = max(days, key=lambda d: sum(1 for sid in service.values() if sid in active[d]), default=None)
    return {t for t, sid in service.items() if best and sid in active[best]}


def access_of(stop, children):
    """1 step-free, 0 not, None unknown: the station's own wheelchair_boarding,
    else its platforms' (step-free if any platform is)."""
    flags = [stop.get("wheelchair_boarding", "")] if stop.get("wheelchair_boarding") in ("1", "2") else \
        [c.get("wheelchair_boarding", "") for c in children if c.get("wheelchair_boarding") in ("1", "2")]
    return None if not flags else 1 if "1" in flags else 0


def gtfs_stations(url, keep, line_name, group=None, trip_line=None):
    """group(stop) -> (station id, name): folds stops into stations where a
    feed has no parent stations (MARC). trip_line(trip, line): a trip's line
    where it isn't its route's."""
    zf = zipfile.ZipFile(io.BytesIO(get(url)))
    agency_tz = next((a.get("agency_timezone") for a in rows(zf, "agency.txt")), None) or None
    routes = {r["route_id"]: line_name(r) for r in rows(zf, "routes.txt") if keep(r)}
    trip_line = {t["trip_id"]: (trip_line or (lambda t, line: line))(t, routes[t["route_id"]]) for t in rows(zf, "trips.txt") if t["route_id"] in routes}
    stops = {s["stop_id"]: s for s in rows(zf, "stops.txt")}
    children = defaultdict(list)
    for st in stops.values():
        if st.get("parent_station"):
            children[st["parent_station"]].append(st)
    today = weekday_trips(zf, set(trip_line))
    lines, visits, daily = defaultdict(set), defaultdict(int), defaultdict(set)
    for st in rows(zf, "stop_times.txt"):
        line = trip_line.get(st["trip_id"])
        # Timing and crew relief points (no boarding, no alighting) aren't stations.
        if st.get("pickup_type") == "1" and st.get("drop_off_type") == "1":
            continue
        if line:
            s = stops.get(st["stop_id"])
            if s:
                key = group(s["stop_name"])[0] if group else s.get("parent_station") or s["stop_id"]
                lines[key].add(line)
                visits[key] += 1
                if st["trip_id"] in today:
                    daily[key].add(st["trip_id"])
    if group:  # each folded station takes its first stop's position and flags
        for st in list(stops.values()):
            key, name = group(st["stop_name"])
            if key not in stops:
                stops[key] = {**st, "stop_id": key, "stop_name": name}
            children[key].append(st)
    out = []
    for sid, ls in lines.items():
        s = stops.get(sid)
        if not s or not s.get("stop_lat"):
            continue
        name = s["stop_name"].strip()
        if name.isupper():  # NJ Transit publishes names in capitals
            name = name.title()
        out.append([sid, name, round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5),
                    sorted(l for l in ls if l), "", official_code(s), visits[sid],
                    len(daily[sid]) or None, access_of(s, children[sid]), s.get("stop_timezone") or agency_tz])
    return out


def intercity_timetables():
    """Per station code: trains on a typical weekday, step-free access, time
    zone and the routes that stop there (trains only: not Thruway buses, nor
    the commuter railroads Amtrak's feed also carries), from Amtrak's and
    VIA's own timetables (Amtrak's by stop id, VIA's by stop code)."""
    info = {}
    for url, code_field in ((AMTRAK_GTFS, "stop_id"), (VIA_GTFS, "stop_code")):
        try:
            zf = zipfile.ZipFile(io.BytesIO(get(url)))
            stops = {s["stop_id"]: s for s in rows(zf, "stops.txt")}
            today = weekday_trips(zf, {t["trip_id"] for t in rows(zf, "trips.txt")})
            agencies = {a.get("agency_id", ""): a.get("agency_name", "") for a in rows(zf, "agency.txt")}
            routes = {r["route_id"]: long_name(r) for r in rows(zf, "routes.txt")
                      if r.get("route_type") == "2" and re.search(r"amtrak|via", agencies.get(r.get("agency_id", ""), "amtrak"), re.I)}
            trip_route = {t["trip_id"]: routes[t["route_id"]] for t in rows(zf, "trips.txt") if t["route_id"] in routes}
            daily, lines = defaultdict(set), defaultdict(set)
            for st in rows(zf, "stop_times.txt"):
                if st["stop_id"] not in stops:
                    continue
                code = stops[st["stop_id"]][code_field]
                if st["trip_id"] in today:
                    daily[code].add(st["trip_id"])
                if st["trip_id"] in trip_route:
                    lines[code].add(trip_route[st["trip_id"]])
            for s in stops.values():
                code = s[code_field]
                if code and code not in info:
                    info[code] = (len(daily[code]) or None, access_of(s, []), s.get("stop_timezone") or None, sorted(lines[code]))
        except Exception as err:
            print(f"{url}: FAILED {err}")
    return info


# Amtraker positions known to be off, as (lat, lon): Newark Airport is placed
# about 1 km southeast of the station, which kept it from merging with NJ
# Transit's stop there.
AMTRAK_FIXES = {"EWR": (40.70441, -74.19072)}


def intercity_stations():
    ntad = ("https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Amtrak_Stations/"
            "FeatureServer/0/query?" + urllib.parse.urlencode(
                {"where": "1=1", "outFields": "Code,StnType", "returnGeometry": "false", "f": "json"}))
    types = {f["attributes"]["Code"]: f["attributes"]["StnType"] for f in json.loads(get(ntad))["features"]}
    amtraker = json.loads(get("https://api-v3.amtraker.com/v3/stations"))
    timetables = intercity_timetables()
    out = defaultdict(list)
    for code, s in amtraker.items():
        if not s.get("lat"):
            continue
        if code in types:
            if types[code] != "TRAIN":
                continue  # Thruway bus stop
            agency = "amtrak"
        elif 24 < s["lat"] < 31 and -88 < s["lon"] < -79.5:
            agency = "brightline"  # Brightline's Florida stations aren't in NTAD
        elif len(code) == 4:
            agency = "via"
        else:
            continue  # announced but unserved stops (e.g., Iowa) aren't stations yet
        place = ", ".join(x for x in (s.get("city"), s.get("state")) if x and x.strip())
        lat, lon = AMTRAK_FIXES.get(code, (s["lat"], s["lon"])) if agency == "amtrak" else (s["lat"], s["lon"])
        daily, access, tz, lines = timetables.get(code, (None, None, s.get("tz") or None, []))
        # No route in the timetable and no train there: not a stop Amtrak or
        # VIA serves (NJ Transit's and Shore Line East's stops filed as
        # Amtrak's, unbuilt or event-only stops, a yard).
        if agency in ("amtrak", "via") and not lines and not s.get("trains"):
            continue
        out[agency].append([code, s["name"].strip(), round(lat, 5), round(lon, 5), lines, place,
                            code, len(s.get("trains") or []), daily, access, tz])
    # Amtraker also gives VIA codes to a few US stations Amtrak already covers
    # (e.g., New York Penn for the Adirondack); drop those duplicates.
    near = lambda a, b: abs(a[2] - b[2]) < 0.02 and abs(a[3] - b[3]) < 0.025
    out["via"] = [v for v in out["via"] if not any(near(v, a) for a in out["amtrak"])]
    return out


def njt_departurevision():
    """NJ Transit's DepartureVision station list, by timetable stop id:
    (DepartureVision code, step-free). NJ Transit's timetable has neither."""
    req = urllib.request.Request("https://www.njtransit.com/api/graphql/graphql", method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "trainsheet-build"},
                                 data=json.dumps({"query": "{ getTrainScheduleStationsRailForDV { atisID pentaStationID accessible } }"}).encode())
    with urllib.request.urlopen(req, timeout=60) as r:
        return {s["atisID"]: (s["pentaStationID"], s["accessible"]) for s in json.load(r)["data"]["getTrainScheduleStationsRailForDV"]}


# Station names that repeat the railroad or the word "Station".
NAME_SUFFIX = {"railrunner": re.compile(r"\s+Rail Runner Station$"), "sounder": re.compile(r"(\s+Sounder)?(\s+Station)?$"),
               "ace": re.compile(r"\s+Station$"), "exo": re.compile(r"^Gare\s+"),
               "atrain": re.compile(r"\s+Station$"), "tre": re.compile(r"\s+Station$"), "silverline": re.compile(r"(\s+Silver Line)?\s+Station$"),
               "texrail": re.compile(r"^TEXRail\s+|\s+(TEXRail\s+)?Station$"), "star": re.compile(r"\s+Station$"),
               "upx": re.compile(r"^UP Express\s+|\s+GO/UP$"), "ontarionorthland": re.compile(r"\s+(Train Shelter|Station|Go Station)$")}
NAME_FIX = {"L Enfant": "L'Enfant", "San Jose Station Diridon": "San Jose Diridon", "Stockton - Robert J Cabral": "Stockton",
            # DCTA, DART and Trinity Metro, as the stations are signed.
            "Ddtc": "Downtown Denton Transit Center", "Ebj Union": "Dallas Union Station", "Medical/Market Ctr": "Medical/Market Center",
            "Dfw Terminal B": "DFW Airport Terminal B", "Dfw North": "DFW Airport North", "Ut Dallas": "UT Dallas", "12Th Street": "12th Street",
            "Downtown Carrollton Silver Line": "Downtown Carrollton", "Shiloh Rd": "Shiloh Road", "Fort Worth Central": "Fort Worth Central",
            "Fort Worth T&P": "Fort Worth T&P", "T&P": "Fort Worth T&P", "North side": "North Side", "Grapevine Main Street": "Grapevine/Main Street",
            "DFW Airport (DFW)": "DFW Airport Terminal B", "Centreport": "CentrePort/DFW Airport",
            # Ontario Northland.
            "Toronto - Union Station Train": "Toronto Union Station", "Timmins-Porcupine": "Timmins"}

# Stations a railroad's timetable places wrongly, as (lat, lon): the Alaska
# Railroad's file puts its Fairbanks depot near Seward.
POSITION_FIX = {("alaska", "FAIR"): (64.85583, -147.70892)}

# Named railroads only: rebuild just those, keeping the rest of the file.
only = sys.argv[1:]
path = pathlib.Path(__file__).resolve().parent.parent / "data" / "stations.json"
result = json.loads(path.read_text()) if only else dict(intercity_stations())
for agency, (url, keep, line_name, *group) in GTFS.items():
    if only and agency not in only:
        continue
    try:
        result[agency] = gtfs_stations(url, keep, line_name, *(group or [None]), trip_line=TRIP_LINE.get(agency))
        for row in result[agency]:  # "Belen Rail Runner Station" -> "Belen"
            row[1] = NAME_SUFFIX[agency].sub("", row[1]) if agency in NAME_SUFFIX else row[1]
            row[1] = NAME_FIX.get(row[1].strip(), row[1].strip())
            row[1] = re.sub(r"\s{2,}", " ", row[1])
            if (agency, row[0]) in POSITION_FIX:
                row[2], row[3] = POSITION_FIX[(agency, row[0])]
        print(f"{agency}: {len(result[agency])} stations")
    except Exception as err:  # keep going; one broken feed shouldn't block the rest
        print(f"{agency}: FAILED {err}")
try:
    dv = njt_departurevision() if not only or "njt" in only else {}
    for row in result.get("njt", []):
        if row[0] in dv:
            row[6] = row[6] or dv[row[0]][0]
            row[9] = 1 if dv[row[0]][1] else 0
except Exception as err:
    print(f"njt DepartureVision: FAILED {err}")
# CT Rail's stations come from its timetable build (scripts/build_ct.py).
ct = pathlib.Path(__file__).resolve().parent.parent / "data" / "ctrail.json"
if ct.exists() and not only:
    result["ctrail"] = json.loads(ct.read_text())["stations"]
print({k: len(v) for k, v in result.items()})

path.write_text(json.dumps(result, separators=(",", ":"), ensure_ascii=False))
print(f"wrote {path} ({path.stat().st_size // 1024} KB)")
