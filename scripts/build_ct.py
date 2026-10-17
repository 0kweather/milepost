"""Build data/ctrail.json: CT Rail's timetable (CTrail Hartford Line and Shore
Line East). CTDOT publishes no live train positions, so the app places these
trains from their timetable, shifted by the delay MTA TrainTime's New Haven
board shows. Also writes CT Rail's stations into data/stations.json
(scripts/build_stations.py keeps them).

Output: {"start": "YYYY-MM-DD", "stops": {code: [name, lat, lon]},
         "trips": {train number: [[days, line, [[code, arr, dep], ...]], ...]},
         "stations": [stations.json rows]}
  days:     a bitmask of the dates the pattern runs: bit i is `start` + i
            days, over two weeks.
  line:     "Hartford Line" or "Shore Line East".
  arr, dep: minutes after midnight of the service day; past 1440 for trains
            running after midnight.
Stop codes are Amtrak's station codes.

    python3 scripts/build_ct.py
"""
import datetime, json
from collections import defaultdict
from feeds import AMTRAK_GTFS, DATA, get_zip, minutes, rows as csv_rows

HL_URL = "https://ctrides.com/hlgtfs.zip"  # CTrail's own Hartford Line trains only
AMTRAK_URL = AMTRAK_GTFS  # carries Shore Line East
SLE_ROUTE = "42948"

# Hartford Line stop ids -> Amtrak codes; Shore Line East already uses them.
HL_CODES = {"1": "NHV", "2": "STS", "3": "WFD", "4": "MDN", "5": "BER", "6": "HFD", "7": "WND", "8": "WNL", "9": "SPG"}
NAMES = {"NHV": "New Haven Union Station", "STS": "State Street", "WFD": "Wallingford", "MDN": "Meriden",
         "BER": "Berlin", "HFD": "Hartford", "WND": "Windsor", "WNL": "Windsor Locks", "SPG": "Springfield",
         "OSB": "Old Saybrook", "WSB": "Westbrook", "CLN": "Clinton", "MDS": "Madison", "GUI": "Guilford",
         "BNF": "Branford", "BRP": "Bridgeport", "STM": "Stamford", "NLC": "New London"}


get = lambda url: get_zip(url, page_link=False)
rows = lambda zf, name: csv_rows(zf, name, optional=True)


today = datetime.date.today()
window = [today + datetime.timedelta(d) for d in range(14)]
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def service_days(zf):
    """service id -> set of dates in the window it runs."""
    days = defaultdict(set)
    for c in rows(zf, "calendar.txt"):
        start, end = (datetime.datetime.strptime(c[k], "%Y%m%d").date() for k in ("start_date", "end_date"))
        for d in window:
            if start <= d <= end and c[DAYS[d.weekday()]] == "1":
                days[c["service_id"]].add(d)
    for c in rows(zf, "calendar_dates.txt"):
        d = datetime.datetime.strptime(c["date"], "%Y%m%d").date()
        if d in window:
            (days[c["service_id"]].add if c["exception_type"] == "1" else days[c["service_id"]].discard)(d)
    return days


stops, trips = {}, defaultdict(dict)  # number -> {(line, stops): mask}
access = {}                           # code -> 1 step-free, 0 not (where a timetable says)
weekday = defaultdict(set)            # code -> trips on the busiest weekday
visits = defaultdict(int)             # code -> stops in the two weeks
lines_at = defaultdict(set)


def add(zf, line, keep, number, code_of):
    days = service_days(zf)
    picked = {t["trip_id"]: t for t in rows(zf, "trips.txt") if keep(t) and days.get(t["service_id"])}
    times = defaultdict(list)
    for st in rows(zf, "stop_times.txt"):
        if st["trip_id"] in picked:
            times[st["trip_id"]].append((int(st["stop_sequence"]), code_of(st["stop_id"]),
                                         minutes(st["arrival_time"] or st["departure_time"]),
                                         minutes(st["departure_time"] or st["arrival_time"])))
    for s in rows(zf, "stops.txt"):
        code = code_of(s["stop_id"])
        if code in NAMES and code not in stops:
            stops[code] = [NAMES[code], round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5)]
        if code in NAMES and s.get("wheelchair_boarding") in ("1", "2"):
            access.setdefault(code, 1 if s["wheelchair_boarding"] == "1" else 0)
    for trip_id, seq in times.items():
        t = picked[trip_id]
        n = number(t)
        if not n:
            continue
        seq.sort()
        pattern = tuple((code, arr, dep) for _, code, arr, dep in seq if code in NAMES)
        dates = days[t["service_id"]]
        mask = 0
        for d in dates:
            mask |= 1 << (d - today).days
        key = (line, pattern)
        trips[n][key] = trips[n].get(key, 0) | mask
        for code, *_ in pattern:
            lines_at[code].add(line)
            visits[code] += len(dates)
            if any(d.weekday() < 5 for d in dates):
                weekday[code].add(n)


# Hartford Line: CTrail trips only ("CTrail 4404"); "4400B" legs are buses.
hl = get(HL_URL)
add(hl, "Hartford Line", lambda t: True,
    lambda t: (lambda n: None if n.endswith("B") else n)(t["trip_short_name"].replace("CTrail", "").strip()),
    lambda sid: HL_CODES.get(sid, sid))
# Shore Line East, from Amtrak's timetable (it's Amtrak-run).
add(get(AMTRAK_URL), "Shore Line East", lambda t: t["route_id"] == SLE_ROUTE,
    lambda t: t["trip_short_name"] or None, lambda sid: sid)

stations = [[code, name, lat, lon, sorted(lines_at[code]), "", code, visits[code],
             len(weekday[code]) or None, access.get(code), "America/New_York"]
            for code, (name, lat, lon) in stops.items() if code in lines_at]
out = {"start": today.isoformat(), "stops": {c: s for c, s in stops.items() if c in lines_at},
       "trips": {n: [[mask, line, [list(x) for x in pat]] for (line, pat), mask in p.items()] for n, p in sorted(trips.items())},
       "stations": stations}
path = DATA / "ctrail.json"
path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
print(f"wrote {path} ({path.stat().st_size // 1024} KB): {len(out['stops'])} stops, {len(out['trips'])} train numbers")

st_path = DATA / "stations.json"
all_st = json.loads(st_path.read_text())
all_st["ctrail"] = stations
st_path.write_text(json.dumps(all_st, separators=(",", ":"), ensure_ascii=False))
print(f"updated {st_path}: {len(stations)} CT Rail stations")
