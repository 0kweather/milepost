"""Build data/rail.geojson: every US rail line with Amtrak or commuter service.

Source: USDOT/BTS National Transportation Atlas Database, North American Rail
Network Lines (PASSNGR = A Amtrak, C commuter, B both). Geometry is simplified
and rounded so the whole network loads quickly at any zoom. Run occasionally:

    python3 scripts/build_rail.py
"""
import json, pathlib, urllib.parse, urllib.request

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

path = pathlib.Path(__file__).resolve().parent.parent / "data" / "rail.geojson"
path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
print(f"wrote {path} ({path.stat().st_size // 1024} KB, {len(features)} features)")
