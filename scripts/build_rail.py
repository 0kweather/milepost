"""Build data/rail.geojson: US passenger rail lines, tagged by the networks
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
import json, math, pathlib, urllib.parse, urllib.request
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
    "MNRX": "northstar", "DRTD": "rtd", "RTDC": "rtd", "CMRX": "capmetro", "TRE": "tre", "DART": "tre",
    "NMRX": "railrunner", "WES": "wes", "TEXR": "texrail",
}
ORDER = ["amtrak", "brightline"]  # intercity first, then commuter networks alphabetically
COMMUTER_STATIONS = {"mbta", "lirr", "mnr", "njt", "septa", "metra", "northstar", "rtd", "frontrunner",
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
    nets = {CODES[c] for c in (props.get(f) for f in CODE_FIELDS) if c in CODES}
    commuter = {n for n in nets if n != "amtrak"} if p in ("B", "C") else set()
    if p in ("B", "C") and not commuter:
        commuter = {nearest_commuter(pt) or "commuter"}
    out = (["amtrak"] if p in ("A", "B") else []) + sorted(commuter)
    return tuple(sorted(out, key=lambda n: (ORDER.index(n) if n in ORDER else len(ORDER), n)))[:3]


print("passenger lines")
segments = []
for f in query("PASSNGR IN ('A','B','C') AND COUNTRY = 'US'", ["PASSNGR"] + CODE_FIELDS):
    for line in parts(f["geometry"]):
        if len(line) >= 2:
            segments.append((networks(f["properties"], line[len(line) // 2]), line))

print("Brightline (Florida East Coast main line, Miami to Cocoa)")
for f in query("RROWNER1 = 'FEC' AND (YARDNAME IS NULL OR YARDNAME = '')", ["RROWNER1"]):
    for line in parts(f["geometry"]):
        if len(line) >= 2 and line[0][1] < 28.45:
            segments.append((("brightline",), line))


# Chain segments that meet end to end (at nodes where exactly two segments
# with the same networks meet) into long lines, so the map's simplification
# at low zoom doesn't break the network into dashes.
def key(pt):
    return (round(pt[0], 4), round(pt[1], 4))


def merge(lines):
    ends = defaultdict(list)
    for i, p in enumerate(lines):
        ends[key(p[0])].append(i)
        ends[key(p[-1])].append(i)
    used = [False] * len(lines)

    def extend(chain):
        while True:
            tail = key(chain[-1])
            nxt = [j for j in ends[tail] if not used[j]]
            if len(ends[tail]) != 2 or not nxt:
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
for nets, line in segments:
    by_nets[nets].append(line)

features = []
for nets, lines in by_nets.items():
    for chain in merge(lines):
        props = {"n": len(nets)}
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
