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
import datetime, json, re, sys
from collections import defaultdict
from feeds import DATA, GTFS, get_zip, long_name, minutes, rows as csv_rows

# railroad: (GTFS url, keep route(route row), line name(route row)): every
# commuter railroad in build_stations.py's table; not the Alaska Railroad.
FEEDS = {agency: GTFS[agency][:3] for agency in GTFS if agency != "alaska"}
# MBTA's lines as its timetable names them ("Fall River/New Bedford Line";
# the station list spaces the slash).
FEEDS["mbta"] = (GTFS["mbta"][0], GTFS["mbta"][1], long_name)
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
SPAN = 14


get = lambda url: get_zip(url, timeout=240)
rows = lambda zf, name: csv_rows(zf, name, optional=True, spaces=True)


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
