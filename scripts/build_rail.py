"""Build data/rail.geojson: every US rail line with Amtrak or commuter service.

Source: USDOT/BTS National Transportation Atlas Database, North American Rail
Network Lines (PASSNGR = A Amtrak, C commuter, B both). Geometry is simplified
and rounded so the whole network loads quickly at any zoom. Run occasionally:

    python3 scripts/build_rail.py
"""
import json, pathlib, urllib.parse, urllib.request
from collections import defaultdict

URL = ("https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/"
       "NTAD_North_American_Rail_Network_Lines/FeatureServer/0/query")
PAGE = 2000


def fetch(offset):
    params = {
        "where": "PASSNGR IN ('A','B','C') AND COUNTRY = 'US'",
        "outFields": "PASSNGR",
        "maxAllowableOffset": "0.0003",
        "geometryPrecision": "4",
        "resultOffset": offset,
        "resultRecordCount": PAGE,
        "orderByFields": "OBJECTID",
        "f": "geojson",
    }
    with urllib.request.urlopen(f"{URL}?{urllib.parse.urlencode(params)}", timeout=120) as r:
        return json.load(r)["features"]


features, offset = [], 0
while True:
    page = fetch(offset)
    for f in page:
        if not f.get("geometry"):
            continue
        p = f["properties"]["PASSNGR"]
        features.append({
            "type": "Feature",
            # a = carries Amtrak (intercity), c = commuter only
            "properties": {"k": "c" if p == "C" else "a"},
            "geometry": f["geometry"],
        })
    offset += len(page)
    print(f"{offset} segments")
    if len(page) < PAGE:
        break

# The network arrives as ~16k short segments. Drawn as-is, short pieces vanish
# when the map simplifies geometry at low zoom, leaving gaps. Chain segments
# that meet end to end (at nodes where exactly two segments of the same kind
# meet) into long lines.
def key(pt):
    return (round(pt[0], 4), round(pt[1], 4))


def merge(features):
    segs = []
    for f in features:
        g = f["geometry"]
        parts = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        segs += [(f["properties"]["k"], p) for p in parts if len(p) >= 2]
    out = []
    for kind in ("a", "c"):
        lines = [p for k, p in segs if k == kind]
        ends = defaultdict(list)  # node -> [(line index, at start?)]
        for i, p in enumerate(lines):
            ends[key(p[0])].append(i)
            ends[key(p[-1])].append(i)
        used = [False] * len(lines)

        def extend(chain):
            # Grow the chain from its tail while the tail node joins exactly one other line.
            while True:
                tail = key(chain[-1])
                nxt = [j for j in ends[tail] if not used[j]]
                if len(ends[tail]) != 2 or not nxt:
                    return chain
                j = nxt[0]
                used[j] = True
                p = lines[j]
                chain += (p if key(p[0]) == tail else p[::-1])[1:]

        for i, p in enumerate(lines):
            if used[i]:
                continue
            used[i] = True
            chain = extend(list(p))
            chain = extend(chain[::-1])
            out.append({"type": "Feature", "properties": {"k": kind},
                        "geometry": {"type": "LineString", "coordinates": chain}})
    return out


before = len(features)
features = merge(features)
print(f"merged {before} segments into {len(features)} lines")

path = pathlib.Path(__file__).resolve().parent.parent / "data" / "rail.geojson"
path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
print(f"wrote {path} ({path.stat().st_size // 1024} KB, {len(features)} features)")
