"""Build data/footprints.json: outlines for major stations.

A big terminal is more than a dot: Boston South Station's building sits
beyond the end of its tracks, New York Penn's platforms run for blocks. For
the major stations (hubs shared by several railroads, the busiest intercity
stations, and each commuter railroad's busiest), fetch the station building and
train platforms from OpenStreetMap and draw a rounded outline around them.

Output: {station key: [[lon, lat], ...]}  (key = "ic:BOS", "lirr:237", ...)
Run after scripts/build_stations.py:

    python3 scripts/build_footprints.py
"""
import json, math, pathlib, time, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
INTERCITY = {"amtrak", "via", "brightline"}
MIRRORS = ("https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
           "https://maps.mail.ru/osm/tools/overpass/api/interpreter")
PLATFORM_M = 450   # platforms this close belong to the station
BUILDING_M = 200   # so do station buildings
PAD_M = 14         # outline padding around platforms and building


def key(agency, sid):
    return f"{'ic' if agency in INTERCITY else agency}:{sid}"


def meters(a, b):
    return math.hypot((b[0] - a[0]) * 111320 * math.cos(math.radians(a[1])), (b[1] - a[1]) * 110540)


def overpass(query):
    for attempt in range(9):
        url = MIRRORS[attempt % len(MIRRORS)]
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": query}).encode(),
                                         headers={"User-Agent": "milepost-build"})
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)["elements"]
        except Exception as err:
            print(f"  overpass retry {attempt + 1} ({err})")
            time.sleep(min(90, 15 * (attempt + 1)))
    raise RuntimeError("Overpass unavailable")


# ---- pick the major stations ----
stations = json.loads((ROOT / "data" / "stations.json").read_text())
rows = [(ag, r) for ag, rs in stations.items() for r in rs]
candidates = {}
# Hubs: stations of two or more railroads within 450 m of each other.
by_cell = {}
for ag, r in rows:
    by_cell.setdefault((round(r[2], 2), round(r[3], 2)), []).append((ag, r))
for ag, r in rows:
    near = [a for dx in (-0.01, 0, 0.01) for dy in (-0.01, 0, 0.01)
            for a, o in by_cell.get((round(r[2] + dx, 2), round(r[3] + dy, 2)), [])
            if a != ag and meters((r[3], r[2]), (o[3], o[2])) < 450]
    if near:
        candidates[key(ag, r[0])] = r
for ag, rs in stations.items():
    ranked = sorted(rs, key=lambda r: -(r[7] or 0))
    top = [r for r in ranked if (r[7] or 0) >= 15][:40] if ag in INTERCITY else ranked[:2]
    for r in top:
        candidates[key(ag, r[0])] = r
# One outline per place: keep the first candidate within 450 m.
picked = []
for k, r in candidates.items():
    if not any(meters((r[3], r[2]), (p[1][3], p[1][2])) < 450 for p in picked):
        picked.append((k, r))
print(f"{len(picked)} major stations")

# ---- fetch platforms and buildings ----
parts = []
for _k, r in picked:
    lat, lon = r[2], r[3]
    parts.append(f'way["railway"="platform"](around:{PLATFORM_M},{lat},{lon});')
    parts.append(f'way["building"="train_station"](around:{BUILDING_M},{lat},{lon});')
elements = overpass("[out:json][timeout:600];(" + "".join(parts) + ");out tags geom;")
print(f"{len(elements)} OpenStreetMap shapes")


def is_train_platform(tags):
    # Skip subway, light rail, tram and bus platforms that share the area.
    return not any(tags.get(t) == "yes" for t in ("subway", "light_rail", "tram", "monorail")) and \
        tags.get("station") not in ("subway", "light_rail") and tags.get("bus") != "yes"


def hull(points):
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


out = {}
for k, r in picked:
    lat, lon = r[2], r[3]
    kx = 111320 * math.cos(math.radians(lat))
    local = lambda p: ((p[0] - lon) * kx, (p[1] - lat) * 110540)
    shapes, platforms = [], 0
    for e in elements:
        geom = [(g["lon"], g["lat"]) for g in e.get("geometry", [])]
        if not geom:
            continue
        tags = e.get("tags", {})
        if tags.get("railway") == "platform":
            if is_train_platform(tags) and min(meters((lon, lat), g) for g in geom) < PLATFORM_M:
                shapes += geom
                platforms += 1
        elif min(meters((lon, lat), g) for g in geom) < BUILDING_M:
            shapes += geom
    if platforms < 2:
        continue  # not enough mapped to draw something meaningful
    # Pad the hull with a ring around each corner, then hull again: a rounded outline.
    corners = hull([local(p) for p in shapes])
    ring = [(x + PAD_M * math.cos(a), y + PAD_M * math.sin(a))
            for x, y in corners for a in (i * math.pi / 6 for i in range(12))]
    outline = [[round(lon + x / kx, 6), round(lat + y / 110540, 6)] for x, y in hull(ring)]
    outline.append(outline[0])
    out[k] = outline
    print(f"  {r[1]}: {platforms} platforms")

path = ROOT / "data" / "footprints.json"
path.write_text(json.dumps(out, separators=(",", ":")))
print(f"wrote {path} ({len(out)} stations, {path.stat().st_size // 1024} KB)")
