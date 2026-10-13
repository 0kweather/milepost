"""Build data/go.json: GO Transit's train timetable, for the live trains GO
Tracker reports (through the relay), which carry only a train number, their
first and last stations, a position and a delay.

Output: {"start": "YYYY-MM-DD", "stops": {stop_id: [name, lat, lon]},
         "trips": {train number: [[days, [[stop_id, minutes], ...]], ...]}}
  days:    a bitmask of the dates the pattern runs: bit i is `start` + i
           days, over two weeks.
  minutes: departure (arrival at the last stop) after midnight of the
           service day; past 1440 for trains running after midnight.
A train number keeps the same stops nearly every day it runs; where it
doesn't (weekends, holidays), each pattern is listed with its dates. The app
picks a live train's pattern by its first and last times, then by date.

    python3 scripts/build_go.py
"""
import csv, datetime, io, json, pathlib, urllib.request, zipfile
from collections import defaultdict

URL = "https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/GO-GTFS.zip"
DATA = pathlib.Path(__file__).resolve().parent.parent / "data"


def rows(zf, name):
    with zf.open(name) as f:
        for r in csv.DictReader(io.TextIOWrapper(f, "utf-8-sig")):
            yield {k.strip(): (v or "").strip() for k, v in r.items() if k}


def minutes(hms):
    h, m, *_ = (int(x) for x in hms.split(":"))
    return h * 60 + m


req = urllib.request.Request(URL, headers={"User-Agent": "trainsheet-build"})
zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=180).read()))

rail = {r["route_id"] for r in rows(zf, "routes.txt") if r["route_type"] == "2"}
today = datetime.date.today()
window = {today + datetime.timedelta(d) for d in range(14)}
days = defaultdict(set)  # service id -> dates it runs in the window
for c in rows(zf, "calendar_dates.txt"):
    d = datetime.datetime.strptime(c["date"], "%Y%m%d").date()
    if d in window and c["exception_type"] == "1":
        days[c["service_id"]].add(d)

# Trip ids end in the train number ("20261127-LW-1619").
trips = {}
for t in rows(zf, "trips.txt"):
    if t["route_id"] in rail and days.get(t["service_id"]):
        trips[t["trip_id"]] = (t["trip_id"].rsplit("-", 1)[-1], days[t["service_id"]])

times = defaultdict(list)
for st in rows(zf, "stop_times.txt"):
    if st["trip_id"] in trips:
        times[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"], st["departure_time"] or st["arrival_time"],
                                     st["arrival_time"] or st["departure_time"]))

patterns = defaultdict(dict)  # number -> {stops tuple: date mask}
for trip_id, seq in times.items():
    number, dates = trips[trip_id]
    seq.sort()
    stops = tuple((sid, minutes(arr if i == len(seq) - 1 else dep)) for i, (_, sid, dep, arr) in enumerate(seq))
    mask = 0
    for d in dates:
        mask |= 1 << (d - today).days
    patterns[number][stops] = patterns[number].get(stops, 0) | mask

used = {sid for p in patterns.values() for stops in p for sid, _ in stops}
stops = {s["stop_id"]: [s["stop_name"], round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5)]
         for s in rows(zf, "stops.txt") if s["stop_id"] in used}
out = {"start": today.isoformat(), "stops": stops,
       "trips": {n: [[mask, [list(x) for x in stops]] for stops, mask in p.items()] for n, p in sorted(patterns.items())}}
path = DATA / "go.json"
path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
print(f"wrote {path} ({path.stat().st_size // 1024} KB): {len(stops)} stops, {len(out['trips'])} train numbers")
