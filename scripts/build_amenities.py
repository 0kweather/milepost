"""Build data/amenities.json: what's at each station, from OpenStreetMap
(through the Overpass API): ticket offices and machines, restrooms,
elevators, parking, bike parking, bike share, taxis and places to eat.

Output: {"agency:station id": {k, v, w, e, p, pr, b, s, x, f}}
  k: a ticket office            v: ticket machines (count)
  w: restrooms                  e: elevators (count)
  p: parking spaces (0: parking, count unknown)   pr: park and ride
  b: bike parking spaces (0: bike parking, count unknown)
  s: bike share                 x: a taxi stand
  f: places to eat nearby (count)
Keys are missing when OpenStreetMap shows nothing. Stations are
data/stations.json's (run scripts/build_stations.py first).

    python3 scripts/build_amenities.py
"""
import json, math, pathlib, threading, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

DATA = pathlib.Path(__file__).resolve().parent.parent / "data"
# Public Overpass servers, tried in turn when one is busy.
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter"]
BATCH = 10
# Finished batches, so a run that stops partway resumes where it was.
CACHE = pathlib.Path("/tmp/trainsheet-amenities-cache")
# What to look for, and how far from the station (meters): what's in the
# building close by, parking further out, places to eat just around it
# (downtowns have hundreds within a few blocks).
NEAR, PARK, FOOD = 160, 400, 150
QUERY_PARTS = [
    (PARK, '["amenity"~"^(parking|bicycle_parking|bicycle_rental|taxi)$"]'),
    (NEAR, '["amenity"~"^(toilets|ticket_office)$"]'),
    (NEAR, '["shop"="ticket"]'),
    (NEAR, '["vending"="public_transport_tickets"]'),
    (NEAR, '["highway"="elevator"]'),
    (FOOD, '["amenity"~"^(cafe|restaurant|fast_food)$"]'),
]


def meters(a, b):
    dlat = math.radians(b[0] - a[0]); dlon = math.radians(b[1] - a[1])
    x = math.sin(dlat / 2) ** 2 + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(x))


def overpass(points, first=0):
    """Elements near these points, from the server `first` (then the others)."""
    body = "[out:json][timeout:90];(" + "".join(
        f"nwr(around:{r},{lat},{lon}){sel};" for lat, lon in points for r, sel in QUERY_PARTS) + ");out center tags;"
    data = urllib.parse.urlencode({"data": body}).encode()
    for attempt in range(12):
        url = OVERPASS[(first + attempt) % len(OVERPASS)]
        req = urllib.request.Request(url, data=data, headers={"User-Agent": "trainsheet-build (github.com/0kweather/trainsheet)"})
        try:
            return json.loads(urllib.request.urlopen(req, timeout=150).read())["elements"]
        except Exception as err:
            print(f"  retry {attempt + 1} ({url.split('/')[2]}): {err}", flush=True)
            time.sleep(15 + 5 * attempt)
    raise RuntimeError("Overpass kept failing")


def num(v):
    try:
        return int(str(v).split(";")[0].strip())
    except (TypeError, ValueError):
        return None


stations = json.loads((DATA / "stations.json").read_text())
rows = [(f"{agency}:{r[0]}", (r[2], r[3]), max(r[7] or 0, (r[8] or 0) * 7)) for agency, rs in stations.items() for r in rs]
# One query point per place (stations shared by railroads sit together),
# busiest first so they're done (and written) soonest.
weight = {}
for _, (lat, lon), w in rows:
    k = (round(lat, 4), round(lon, 4))
    weight[k] = max(weight.get(k, 0), w)
points = sorted(weight, key=lambda k: -weight[k])
batches = [points[i:i + BATCH] for i in range(0, len(points), BATCH)]
print(f"{len(rows)} stations, {len(points)} places, {len(batches)} queries", flush=True)

found, lock, done = {}, threading.Lock(), [0]


def fetch(n):
    part = batches[n]
    cached = CACHE / f"{part[0][0]}_{part[0][1]}_{len(part)}.json"
    if cached.exists():
        els = json.loads(cached.read_text())
    else:
        els = overpass(part, first=n % len(OVERPASS))
        cached.write_text(json.dumps(els))
    with lock:
        for e in els:
            lat, lon = (e.get("lat"), e.get("lon")) if "lat" in e else (e.get("center", {}).get("lat"), e.get("center", {}).get("lon"))
            if lat is not None:
                found[e["type"] + str(e["id"])] = (lat, lon, e.get("tags", {}))
        done[0] += 1
        print(f"  {done[0]}/{len(batches)}: {len(found)} things", flush=True)
        if done[0] % 15 == 0:
            write()


def write():
    out = {}
    things = list(found.values())
    for key, pos, _ in rows:
        a = {}
        for lat, lon, tags in things:
            if abs(lat - pos[0]) > 0.005 or abs(lon - pos[1]) > 0.007:
                continue
            d = meters(pos, (lat, lon))
            am = tags.get("amenity")
            if d <= NEAR:
                if tags.get("shop") == "ticket" or am == "ticket_office":
                    a["k"] = 1
                if tags.get("vending") == "public_transport_tickets":
                    a["v"] = a.get("v", 0) + 1
                if am == "toilets" and tags.get("access") not in ("private", "no", "customers"):
                    a["w"] = 1
                if tags.get("highway") == "elevator":
                    a["e"] = a.get("e", 0) + 1
            if am == "parking" and d <= PARK and tags.get("access") not in ("private", "no") and tags.get("parking") not in ("street_side", "lane"):
                a["p"] = a.get("p", 0) + (num(tags.get("capacity")) or 0)
                if tags.get("park_ride") not in (None, "no"):
                    a["pr"] = 1
            if am == "bicycle_parking" and d <= 250:
                a["b"] = a.get("b", 0) + (num(tags.get("capacity")) or 0)
            if am == "bicycle_rental" and d <= 250:
                a["s"] = 1
            if am == "taxi" and d <= 200:
                a["x"] = 1
            if am in ("cafe", "restaurant", "fast_food") and d <= FOOD:
                a["f"] = a.get("f", 0) + 1
        if a:
            out[key] = a
    path = DATA / "amenities.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {path} ({path.stat().st_size // 1024} KB): {len(out)} of {len(rows)} stations with something", flush=True)


CACHE.mkdir(exist_ok=True)
with ThreadPoolExecutor(len(OVERPASS)) as pool:
    list(pool.map(fetch, range(len(batches))))
write()
print("finished", flush=True)
