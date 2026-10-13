"""Build data/schedules/<railroad>.json: two weeks of timetable for railroads
whose live data gives a train's number but not its stops (South Shore Line,
SunRail), or no live data at all (Rail Runner, placed from the timetable).

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
import csv, datetime, io, json, pathlib, re, sys, time, urllib.request, zipfile
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
}
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def get(url, attempts=4):
    req = urllib.request.Request(url, headers={"User-Agent": "trainsheet-build"})
    for attempt in range(attempts):
        try:
            return zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=180).read()))
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


def build(agency, url, keep, line_name, number_of, stations):
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
    lines = {r["route_id"]: line_name(r) for r in rows(zf, "routes.txt") if keep(r)}
    trips = {t["trip_id"]: t for t in rows(zf, "trips.txt") if t["route_id"] in lines and days.get(t["service_id"])}
    # Each stop as its station (the parent station where there is one).
    station_of = {s["stop_id"]: s.get("parent_station") or s["stop_id"] for s in rows(zf, "stops.txt")}
    times = defaultdict(list)
    for st in rows(zf, "stop_times.txt"):
        if st["trip_id"] in trips:
            sid = station_of.get(st["stop_id"], st["stop_id"])
            if sid in stations:
                times[st["trip_id"]].append((int(st["stop_sequence"]), sid, minutes(st["arrival_time"] or st["departure_time"]),
                                             minutes(st["departure_time"] or st["arrival_time"])))
    patterns = defaultdict(dict)  # number -> {(line, stops): mask}
    for trip_id, seq in times.items():
        t = trips[trip_id]
        n = number_of(t)
        if not n or len(seq) < 2:
            continue
        seq.sort()
        mask = 0
        for d in days[t["service_id"]]:
            mask |= 1 << (d - today).days
        key = (lines[t["route_id"]], tuple((sid, arr, dep) for _, sid, arr, dep in seq))
        patterns[n][key] = patterns[n].get(key, 0) | mask
    used = {sid for p in patterns.values() for (_, pat) in p for sid, *_ in pat}
    tz = next((s[10] for s in stations.values() if s[10]), None)
    return {"start": today.isoformat(), "tz": tz,
            "stops": {sid: stations[sid][1:4] for sid in sorted(used)},
            "trips": {n: [[mask, line, [list(x) for x in pat]] for (line, pat), mask in p.items()] for n, p in sorted(patterns.items())}}


all_stations = json.loads((DATA / "stations.json").read_text())
(DATA / "schedules").mkdir(exist_ok=True)
for agency, (url, keep, line_name, number_of) in FEEDS.items():
    if sys.argv[1:] and agency not in sys.argv[1:]:
        continue
    out = build(agency, url, keep, line_name, number_of, {r[0]: r for r in all_stations[agency]})
    path = DATA / "schedules" / f"{agency}.json"
    path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    print(f"{agency}: {len(out['stops'])} stops, {len(out['trips'])} train numbers ({path.stat().st_size // 1024} KB)")
