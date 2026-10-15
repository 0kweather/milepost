"""Build data/linecolors.json: the color each railroad gives its lines in its
timetable (GTFS route_color), under the line names the map uses, for the
small line marks beside line names.

Output: {railroad: {line name: "#rrggbb"}}. Lines whose railroad gives them
no color of their own (none, or the same one for every line) are left out.

    python3 scripts/build_linecolors.py
"""
import collections, csv, io, json, pathlib, re, sys, time, urllib.parse, urllib.request, zipfile

ROOT = pathlib.Path(__file__).resolve().parent
# The feed table and line names, exactly as scripts/build_stations.py has them
# (the top of that file, up to where its work starts).
source = (ROOT / "build_stations.py").read_text()
exec(source[:source.index("\ndef get(")])


def get(url, attempts=4):
    req = urllib.request.Request(url, headers={"User-Agent": "trainsheet-build"})
    for attempt in range(attempts):
        try:
            data = urllib.request.urlopen(req, timeout=240).read()
            # A page linking the current file (the Alaska Railroad's): follow it.
            m = None if data[:2] == b"PK" else re.search(rb'href="([^"]+\.zip)"', data, re.I)
            if m:
                return get(urllib.parse.urljoin(url, m.group(1).decode()), attempts)
            return zipfile.ZipFile(io.BytesIO(data))
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


out = {}
for agency, (url, keep, line_name, *_) in GTFS.items():
    if sys.argv[1:] and agency not in sys.argv[1:]:
        continue
    try:
        zf = get(url)
    except Exception as err:
        print(f"{agency}: FAILED ({err})")
        continue
    colors = collections.defaultdict(collections.Counter)
    for r in rows(zf, "routes.txt"):
        if not keep(r):
            continue
        c = (r.get("route_color") or "").strip().lstrip("#").lower()
        name = line_name(r)
        if name and len(c) == 6 and c not in ("ffffff", "000000"):
            colors[name][c] += 1
    lines = {name: f"#{cs.most_common(1)[0][0]}" for name, cs in colors.items()}
    # One color for every line is the railroad's own, not the lines'.
    if len(lines) > 1 and len(set(lines.values())) == 1:
        lines = {}
    # Lines split from their routes by trip (build_stations.py's TRIP_LINE):
    # Metrolink's Arrow in its blue.
    if agency == "metrolink":
        lines["Metrolink Arrow"] = "#2a62d4"
    if lines:
        out[agency] = lines
    print(f"{agency}: {len(lines)} lines with colors")

path = ROOT.parent / "data" / "linecolors.json"
old = json.loads(path.read_text()) if path.exists() and sys.argv[1:] else {}
old.update(out)
path.write_text(json.dumps(old, separators=(",", ":"), ensure_ascii=False, sort_keys=True))
print(f"wrote {path}")
