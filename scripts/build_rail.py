"""Build data/rail.geojson: US and Canadian passenger rail lines, tagged by the networks
(railroads) that run passenger trains on them.

Source: USDOT/BTS National Transportation Atlas Database, North American Rail
Network Lines. Each segment lists its owners and trackage-rights holders as
railroad codes (AMTK, MNCW, NJT, ...) and a passenger-service flag
(PASSNGR = A Amtrak, C commuter, B both). Commuter trains often run on
freight-owned track (Metra on Union Pacific lines, say) where the commuter
railroad isn't listed; those take the railroad of the nearest commuter
station. Brightline's Florida East Coast track isn't flagged as passenger in
NTAD, so it's added separately.

Output features: properties { n: number of networks, a, b, c: network ids }.
Run after scripts/build_stations.py (it uses data/stations.json):

    python3 scripts/build_rail.py
"""
import json, math, pathlib, time, urllib.parse, urllib.request
from collections import defaultdict

URL = ("https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/"
       "NTAD_North_American_Rail_Network_Lines/FeatureServer/0/query")
ROOT = pathlib.Path(__file__).resolve().parent.parent
CODE_FIELDS = ["RROWNER1", "RROWNER2", "RROWNER3"] + [f"TRKRGHTS{i}" for i in range(1, 10)]

# Railroad code -> network id (ids match js/networks.js).
CODES = {
    "AMTK": "amtrak", "NJT": "njt", "MBTA": "mbta", "SCAX": "metrolink", "MNCW": "mnr", "LI": "lirr",
    "UTF": "frontrunner", "SEPA": "septa", "MARC": "marc", "NIRC": "metra", "VREX": "vre",
    "SLE": "shoreline", "NICD": "southshore", "JPBX": "caltrain", "SDRX": "sounder", "ACEX": "ace",
    "SFRC": "trirail", "TRCX": "trirail", "CFCR": "sunrail", "NCTD": "coaster", "SMRT": "smart",
    "DRTD": "rtd", "RTDC": "rtd", "CMRX": "capmetro", "TRE": "tre", "DART": "tre",
    "NMRX": "railrunner", "WES": "wes", "TEXR": "texrail",
    # Canada
    "GO": "go", "AMT": "exo", "EXO": "exo", "WCE": "wce", "WCXR": "wce",
}
ORDER = ["amtrak", "via", "brightline"]  # intercity first, then commuter networks alphabetically
COMMUTER_STATIONS = {"mbta", "lirr", "mnr", "njt", "septa", "metra", "rtd", "frontrunner",
                     "capmetro", "trirail", "caltrain", "smart", "metrolink"}
NEAREST_KM = 4


def query(where, fields):
    out, offset = [], 0
    while True:
        params = {"where": where, "outFields": ",".join(fields), "maxAllowableOffset": "0.0003",
                  "geometryPrecision": "4", "resultOffset": offset, "resultRecordCount": 2000,
                  "orderByFields": "OBJECTID", "f": "geojson"}
        with urllib.request.urlopen(f"{URL}?{urllib.parse.urlencode(params)}", timeout=180) as r:
            page = json.load(r)["features"]
        out += [f for f in page if f.get("geometry")]
        offset += len(page)
        print(f"  {offset} segments")
        if len(page) < 2000:
            return out


def parts(geom):
    return [geom["coordinates"]] if geom["type"] == "LineString" else geom["coordinates"]


# Commuter stations, bucketed on a ~0.1° grid for the nearest-station fallback.
stations = json.loads((ROOT / "data" / "stations.json").read_text())
grid = defaultdict(list)
for agency, rows in stations.items():
    if agency in COMMUTER_STATIONS:
        for _id, _name, lat, lon, *_ in rows:
            grid[(int(lat * 10), int(lon * 10))].append((lat, lon, agency))


def nearest_commuter(pt):
    lon, lat = pt
    best, best_km = None, NEAREST_KM
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for slat, slon, agency in grid.get((int(lat * 10) + dx, int(lon * 10) + dy), []):
                km = math.hypot((slat - lat) * 111, (slon - lon) * 111 * math.cos(math.radians(lat)))
                if km < best_km:
                    best, best_km = agency, km
    return best


def networks(props, pt):
    p = props.get("PASSNGR")
    if p == "V":  # VIA Rail Canada
        return ("via",)
    if p == "D":  # Alaska Railroad
        return ("alaska",)
    nets = {CODES[c] for c in (props.get(f) for f in CODE_FIELDS) if c in CODES}
    commuter = {n for n in nets if n != "amtrak"} if p in ("B", "C") else set()
    if p in ("B", "C") and not commuter:
        commuter = {nearest_commuter(pt) or "commuter"}
    out = (["amtrak"] if p in ("A", "B") else []) + sorted(commuter)
    return tuple(sorted(out, key=lambda n: (ORDER.index(n) if n in ORDER else len(ORDER), n)))[:3]


print("passenger lines (US and Canada)")
segments = []
# Main line only (NET = 'M'): yard tracks, sidings and industrial leads are
# what make big terminals look like a tangle. PASSNGR: A Amtrak, B Amtrak and
# commuter, C commuter, D Alaska Railroad, V VIA Rail (Canada).
for f in query("NET = 'M' AND COUNTRY IN ('US', 'CA') AND PASSNGR IN ('A','B','C','D','V')", ["PASSNGR"] + CODE_FIELDS):
    for line in parts(f["geometry"]):
        if len(line) >= 2:
            segments.append((networks(f["properties"], line[len(line) // 2]), line))

print("Brightline (Florida East Coast main line, Miami to Cocoa)")
for f in query("RROWNER1 = 'FEC' AND NET = 'M'", ["RROWNER1"]):
    for line in parts(f["geometry"]):
        if len(line) >= 2 and line[0][1] < 28.45:
            segments.append((("brightline",), line))


# ---------- Gap filling from OpenStreetMap ----------
# NTAD lags new construction (Brightline to Orlando, LIRR into Grand Central
# Madison, Tri-Rail to Miami Central, Metrolink's Arrow, SMART to Windsor...)
# and has holes (Metro-North's Waterbury Branch). For each railroad, fetch its
# OpenStreetMap train routes and add any stretch the network doesn't already
# cover, joined to the existing track so trains can be routed across it.

OSM_OPERATORS = {
    "brightline": "Brightline", "lirr": "Long Island Rail Road|LIRR", "mnr": "Metro-North",
    "mbta": "MBTA|Massachusetts Bay|CapeFLYER|Keolis", "njt": "NJ Transit|New Jersey Transit",
    "septa": "SEPTA", "metra": "Metra", "metrolink": "Metrolink|Southern California Regional|SBCTA|Arrow",
    "rtd": "Regional Transportation District|RTD|Denver Transit", "frontrunner": "Utah Transit|UTA",
    "capmetro": "Capital Metro|CapMetro", "trirail": "Tri-Rail|South Florida Regional",
    "caltrain": "Caltrain", "smart": "SMART|Sonoma.Marin", "via": "VIA Rail|Via Rail",
    "go": "GO Transit|Metrolinx", "exo": "^exo$|Réseau de transport métropolitain",
}
# (name, network to tag, Overpass relation filter, bbox south,west,north,east)
TARGETED_FILLS = [
    # Amtrak's approach into New Orleans Union Passenger Terminal.
    ("new-orleans", "amtrak", '["operator"="Amtrak"]', "29.88,-90.2,30.03,-89.95"),
    # The CapeFLYER (run by the Cape Cod Regional Transit Authority) to Hyannis.
    ("capeflyer", "mbta", '["ref"~"CapeFlyer",i]', "41.6,-71.0,41.95,-70.2"),
]
COVERED_M = 50      # OSM track within this distance of existing track is already drawn
MIN_RUN_M = 400     # ignore shorter uncovered bits (station tracks, crossovers)
STEP_M = 100        # densify OSM ways so gaps between far-apart nodes are noticed


OSM_CACHE = ROOT / "scripts" / ".osm-cache"
MIRRORS = ("https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
           "https://maps.mail.ru/osm/tools/overpass/api/interpreter")


def overpass(query, name):
    """Run an Overpass query, caching the answer so reruns don't hammer the
    (often busy) public servers. Delete scripts/.osm-cache to refresh."""
    cached = OSM_CACHE / f"{name}.json"
    if cached.exists():
        return json.loads(cached.read_text())
    for attempt in range(9):
        url = MIRRORS[attempt % len(MIRRORS)]
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": query}).encode(),
                                         headers={"User-Agent": "milepost-build"})
            with urllib.request.urlopen(req, timeout=300) as r:
                elements = json.load(r)["elements"]
            OSM_CACHE.mkdir(exist_ok=True)
            cached.write_text(json.dumps(elements))
            return elements
        except Exception as err:
            print(f"  overpass retry {attempt + 1} ({err})")
            time.sleep(min(90, 15 * (attempt + 1)))
    return None


def meters(a, b):
    return math.hypot((b[0] - a[0]) * 111320 * math.cos(math.radians(a[1])), (b[1] - a[1]) * 110540)


class Coverage:
    """Grid index over segment pieces: nearest point on existing track."""
    CELL = 0.01

    def __init__(self, segs):
        self.segs = segs
        self.grid = {}
        for k in range(len(segs)):
            self.add(k)

    def add(self, k):
        c = self.segs[k][1]
        for i in range(len(c) - 1):
            a, b = c[i], c[i + 1]
            for gx in range(int(min(a[0], b[0]) // self.CELL), int(max(a[0], b[0]) // self.CELL) + 1):
                for gy in range(int(min(a[1], b[1]) // self.CELL), int(max(a[1], b[1]) // self.CELL) + 1):
                    self.grid.setdefault((gx, gy), []).append((k, i))

    def nearest(self, p, max_m, exclude=None):
        best = None
        gx, gy = int(p[0] // self.CELL), int(p[1] // self.CELL)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for k, i in self.grid.get((gx + dx, gy + dy), ()):
                    if k == exclude:
                        continue
                    c = self.segs[k][1]
                    a, b = c[i], c[i + 1]
                    kx = math.cos(math.radians(p[1]))
                    ax, ay = (b[0] - a[0]) * kx, b[1] - a[1]
                    px, py = (p[0] - a[0]) * kx, p[1] - a[1]
                    L = ax * ax + ay * ay
                    t = max(0.0, min(1.0, (px * ax + py * ay) / L)) if L else 0.0
                    q = (round(a[0] + (b[0] - a[0]) * t, 5), round(a[1] + (b[1] - a[1]) * t, 5))
                    d = meters(p, q)
                    if d <= max_m and (best is None or d < best[0]):
                        best = (d, k, i, t, q)
        return best


def densify(pts, step=STEP_M):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = int(meters(a, b) // step)
        out += [(a[0] + (b[0] - a[0]) * j / (n + 1), a[1] + (b[1] - a[1]) * j / (n + 1)) for j in range(1, n + 1)]
        out.append(b)
    return out


def split_segments(segs, cuts):
    """Insert nodes into existing segments where new track joins them."""
    by_seg = defaultdict(list)
    for k, i, t, q in cuts:
        by_seg[k].append((i, t, q))
    for k, cs in by_seg.items():
        nets, c = segs[k]
        pieces, cur, last_i = [], [c[0]], 0
        cs.sort()
        for i, t, q in cs:
            cur += c[last_i + 1:i + 1]
            last_i = i
            if tuple(cur[-1]) == q:
                continue
            cur.append(list(q))
            pieces.append(cur)
            cur = [list(q)]
        cur += c[last_i + 1:]
        pieces.append(cur)
        segs[k] = (nets, pieces[0])
        segs.extend((nets, p) for p in pieces[1:] if len(p) >= 2)


def add_uncovered(segs, net, elements):
    """Add the stretches of these OSM ways that existing track doesn't cover."""
    cov = Coverage(segs)
    cuts, added_m = [], 0
    for way in elements:
        line = densify([(round(g["lon"], 5), round(g["lat"], 5)) for g in way.get("geometry", [])])
        if len(line) < 2:
            continue
        near = [cov.nearest(p, COVERED_M) for p in line]
        i = 0
        while i < len(line):
            if near[i]:
                i += 1
                continue
            j = i
            while j < len(line) and not near[j]:
                j += 1
            run = line[max(0, i - 1):min(len(line), j + 1)]
            length = sum(meters(a, b) for a, b in zip(run, run[1:]))
            if length >= MIN_RUN_M:
                run = [list(p) for p in run]
                # Join each end to the track it touches.
                for end, idx in ((0, i - 1), (-1, j)):
                    hit = near[idx] if 0 <= idx < len(line) else None
                    if hit:
                        _d, k, si, t, q = hit
                        run[end] = list(q)
                        cuts.append((k, si, t, q))
                segs.append(((net,), run))
                cov.add(len(segs) - 1)  # so parallel tracks aren't added twice
                added_m += length
                # Later ways may now be covered by this run.
                near = [n or cov.nearest(p, COVERED_M) for n, p in zip(near, line)]
            i = j
    split_segments(segs, cuts)
    return added_m


def fill_gaps(segs):
    for net, operators in OSM_OPERATORS.items():
        pts = [(lon, lat) for _id, _n, lat, lon, *_ in stations.get(net, [])]
        if net in ("go", "exo"):
            pts = [(-79.4, 43.65), (-73.57, 45.5)]  # no stations of ours; search around Toronto/Montreal
        if not pts:
            continue
        lons, lats = [p[0] for p in pts], [p[1] for p in pts]
        bbox = f"{min(lats) - 0.5},{min(lons) - 0.5},{max(lats) + 0.5},{max(lons) + 0.5}"
        elements = overpass(f"""[out:json][timeout:240];
(relation["route"="train"]["operator"~"{operators}",i]({bbox});
 relation["route"="train"]["network"~"{operators}",i]({bbox}););
way(r)["railway"="rail"];
out geom;""", f"routes-{net}")
        if elements is None:
            print(f"  {net}: skipped, OpenStreetMap unavailable (rerun later to fill its gaps)")
            continue
        print(f"  {net}: +{add_uncovered(segs, net, elements) / 1000:.1f} km from OpenStreetMap")
        time.sleep(2)

    # Targeted fills: specific places the broad search misses, limited to track
    # inside the area (the routes themselves run much farther).
    for name, net, routes, bbox in TARGETED_FILLS:
        elements = overpass(f"""[out:json][timeout:240];
relation["route"="train"]{routes}({bbox});
way(r)["railway"="rail"]({bbox});
out geom;""", f"targeted-{name}")
        if elements is None:
            print(f"  {name}: skipped, OpenStreetMap unavailable")
            continue
        print(f"  {name}: +{add_uncovered(segs, net, elements) / 1000:.1f} km from OpenStreetMap")
        time.sleep(2)


print("filling gaps from OpenStreetMap")
fill_gaps(segments)


# ---------- Heal near-miss dead ends ----------
# Track pieces whose end stops a few meters short of another line (common
# where OSM station tracks meet NTAD, and in places within NTAD) would leave
# the routing graph disconnected. Join each dead end to the nearest other
# line within HEAL_M.
HEAL_M = 60
HEAL_SAME_M = 150  # when the nearby line is the same railroad


def heal_dead_ends(segs):
    key = lambda pt: (round(pt[0], 4), round(pt[1], 4))  # same node rounding as the merge step
    degree = defaultdict(int)
    for _n, c in segs:
        degree[key(c[0])] += 1
        degree[key(c[-1])] += 1
    cov = Coverage(segs)
    cuts, healed = [], 0
    for k in range(len(segs)):
        nets, c = segs[k]
        for end in (0, -1):
            if degree[key(c[end])] != 1:
                continue
            hit = cov.nearest(tuple(c[end]), HEAL_M, exclude=k)
            if not hit:
                # A bit farther is fine when it's the same railroad's track.
                far = cov.nearest(tuple(c[end]), HEAL_SAME_M, exclude=k)
                if far and set(segs[far[1]][0]) & set(nets):
                    hit = far
            if hit and hit[0] > 0.5:
                _d, k2, i, t, q = hit
                c[end] = list(q)
                degree[key(q)] += 2
                cuts.append((k2, i, t, q))
                healed += 1
    split_segments(segs, cuts)
    print(f"joined {healed} dead ends to nearby track")


heal_dead_ends(segments)


# ---------- Bridge small breaks ----------
# Pieces of one line can still stop short of each other by a few hundred
# meters (OSM ways that don't quite meet along a new corridor). Join two dead
# ends of the same railroad up to BRIDGE_M apart when they face each other:
# each points toward the other along its own line, so unrelated stubs that
# merely sit near each other are left alone.
BRIDGE_M = 1000
FACING_DEG = 35


def bridge_breaks(segs):
    key = lambda pt: (round(pt[0], 4), round(pt[1], 4))
    degree = defaultdict(int)
    for _n, c in segs:
        degree[key(c[0])] += 1
        degree[key(c[-1])] += 1

    def heading(a, b):
        return math.degrees(math.atan2((b[1] - a[1]) * 110540, (b[0] - a[0]) * 111320 * math.cos(math.radians(a[1]))))

    def turn(a, b):
        return abs((a - b + 180) % 360 - 180)

    ends = []  # (point, outward heading, nets)
    for nets, c in segs:
        if len(c) < 2:
            continue
        for tip, back in ((c[0], c[1]), (c[-1], c[-2])):
            if degree[key(tip)] == 1:
                ends.append((tuple(tip), heading(back, tip), set(nets)))
    grid = defaultdict(list)
    for i, (p, _h, _n) in enumerate(ends):
        grid[(int(p[0] * 50), int(p[1] * 50))].append(i)
    used, bridges = set(), []
    for i, (p, h, nets) in enumerate(ends):
        if i in used:
            continue
        best = None
        gx, gy = int(p[0] * 50), int(p[1] * 50)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((gx + dx, gy + dy), ()):
                    q, hq, nq = ends[j]
                    if j == i or j in used or not (nets & nq):
                        continue
                    d = meters(p, q)
                    if not 0 < d <= BRIDGE_M:
                        continue
                    toward = heading(p, q)
                    if turn(toward, h) <= FACING_DEG and turn(toward + 180, hq) <= FACING_DEG and (best is None or d < best[0]):
                        best = (d, j)
        if best:
            j = best[1]
            used.update((i, j))
            bridges.append(((tuple(sorted(nets & ends[j][2])),), [list(p), list(ends[j][0])]))
    for (nets,), line in bridges:
        segs.append((order(nets), line))
    print(f"bridged {len(bridges)} small breaks")


def order(nets):
    return tuple(sorted(set(nets), key=lambda n: (ORDER.index(n) if n in ORDER else len(ORDER), n)))[:3]


bridge_breaks(segments)


# ---------- Collapse parallel tracks ----------
# NTAD (and OSM) sometimes map a corridor's two main tracks as separate lines a
# few dozen meters apart (Providence, many stations), which draws the route
# twice. Walking from the longest track down, any stretch that runs mostly
# alongside track already drawn is marked hidden: it isn't drawn and trains
# don't snap to it, but it stays in the data so the routing graph keeps every
# connection. Its railroads are folded into the drawn line's colors.
PARALLEL_M = 120
MIN_PARALLEL_LEN_M = 150


def collapse_parallel(segs):
    """Returns the set of segment indexes to hide; folds their networks into
    the drawn segments they run alongside."""
    lengths = [sum(meters(a, b) for a, b in zip(c, c[1:])) for _n, c in segs]
    drawn = []          # (nets, line) of drawn segments, in Coverage order
    drawn_idx = []      # their indexes in segs
    cum_cache = {}
    cov = Coverage(drawn)
    hidden = set()

    def along(k, i, t):
        if k not in cum_cache:
            c = drawn[k][1]
            cum = [0.0]
            for p, q in zip(c, c[1:]):
                cum.append(cum[-1] + meters(p, q))
            cum_cache[k] = cum
        cum = cum_cache[k]
        return cum[i] + (cum[i + 1] - cum[i]) * t

    for idx in sorted(range(len(segs)), key=lambda i: -lengths[i]):
        nets, line = segs[idx]
        if lengths[idx] >= MIN_PARALLEL_LEN_M:
            pts = densify([tuple(p) for p in line], step=25)
            hits = [cov.nearest(p, PARALLEL_M) for p in pts]
            if all(hits):
                # A true duplicate runs alongside one drawn line for (nearly)
                # its whole length. A link between the ends of two different
                # lines is also "near" track everywhere, but hiding it would
                # leave a hole.
                owners = defaultdict(list)
                for h in hits:
                    owners[h[1]].append(along(h[1], h[2], h[3]))
                k, spots = max(owners.items(), key=lambda kv: len(kv[1]))
                if len(spots) >= 0.95 * len(hits) and max(spots) - min(spots) >= 0.7 * lengths[idx]:
                    drawn[k] = (order(drawn[k][0] + tuple(nets)), drawn[k][1])
                    segs[drawn_idx[k]] = drawn[k]
                    hidden.add(idx)
                    continue
        drawn.append((nets, line))
        drawn_idx.append(idx)
        cov.add(len(drawn) - 1)
    print(f"hid {len(hidden)} parallel stretches")
    return hidden


hidden = collapse_parallel(segments)


# Chain segments that meet end to end (at nodes where exactly two segments
# with the same networks meet) into long lines, so the map's simplification
# at low zoom doesn't break the network into dashes.
def key(pt):
    return (round(pt[0], 4), round(pt[1], 4))


def merge(lines, degree):
    # Only chain through a node where exactly two pieces of track meet across
    # the whole network; anywhere more meet is a junction (say, where a
    # Metro-North-only branch leaves the shared main line), and the line must
    # break there so the routing graph connects the two.
    ends = defaultdict(list)
    for i, p in enumerate(lines):
        ends[key(p[0])].append(i)
        ends[key(p[-1])].append(i)
    used = [False] * len(lines)

    def extend(chain):
        while True:
            tail = key(chain[-1])
            nxt = [j for j in ends[tail] if not used[j]]
            if degree[tail] != 2 or len(ends[tail]) != 2 or not nxt:
                return chain
            j = nxt[0]
            used[j] = True
            p = lines[j]
            chain += (p if key(p[0]) == tail else p[::-1])[1:]

    out = []
    for i, p in enumerate(lines):
        if not used[i]:
            used[i] = True
            out.append(extend(extend(list(p))[::-1]))
    return out


def oriented(chain):
    # Draw every line west->east (or south->north if it runs mostly north-south)
    # so side-by-side colors keep the same order where chains meet.
    dx, dy = chain[-1][0] - chain[0][0], chain[-1][1] - chain[0][1]
    flip = dx < 0 if abs(dx) >= abs(dy) * 0.75 else dy < 0
    return chain[::-1] if flip else chain


by_nets = defaultdict(list)
for i, (nets, line) in enumerate(segments):
    by_nets[(nets, i in hidden)].append(line)

degree = defaultdict(int)
for _nets, line in segments:
    degree[key(line[0])] += 1
    degree[key(line[-1])] += 1

features = []
for (nets, is_hidden), lines in by_nets.items():
    for chain in merge(lines, degree):
        props = {"n": len(nets)}
        if is_hidden:
            props["h"] = 1  # routing only, not drawn
        props.update({k: v for k, v in zip("abc", nets)})
        features.append({"type": "Feature", "properties": props,
                         "geometry": {"type": "LineString", "coordinates": oriented(chain)}})

counts = defaultdict(int)
for nets, _ in segments:
    for n in nets:
        counts[n] += 1
print("segments per network:", dict(sorted(counts.items(), key=lambda x: -x[1])))
path = ROOT / "data" / "rail.geojson"
path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
print(f"wrote {path} ({path.stat().st_size // 1024} KB, {len(features)} lines from {len(segments)} segments)")
