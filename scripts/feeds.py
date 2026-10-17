"""The railroads' timetable feeds, and what every build script reads them
with: the GTFS table (a railroad's feed, the routes that are its trains, the
line names the map uses, how its stops fold into stations), the download,
the CSV reader and the clock. Imported by scripts/build_*.py (which used to
carry their own copies, or read the top of build_stations.py); nothing here
runs on its own.
"""
import csv, io, pathlib, re, time, unicodedata, urllib.parse, urllib.request, zipfile

DATA = pathlib.Path(__file__).resolve().parent.parent / "data"
# Amtrak's and VIA's own timetables (Amtrak's also carries Shore Line East
# and other commuter trains).
AMTRAK_GTFS = "https://content.amtrak.com/content/gtfs/GTFS.zip"
VIA_GTFS = "https://www.viarail.ca/sites/all/files/gtfs/viarail.zip"
MDB = "https://files.mobilitydatabase.org/{}/latest.zip"

# agency: (GTFS url, route filter(route row) -> bool, line name(route row) -> str)
rail = lambda r: r.get("route_type") == "2"
long_name = lambda r: (r.get("route_long_name") or r.get("route_short_name") or "").strip()
EXO_GTFS = "https://exo.quebec/uploads/ressources-telechargeables/a-propos/donnees-ouvertes/trains/google_transit.zip"
exo_line = lambda r: re.sub(r"^\d+\s*-\s*", "", long_name(r)).replace("/", "-")
slug = lambda name: re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", name.lower()).encode("ascii", "ignore").decode()).strip("-")
# NCTD's stop names: "Oceanside Transit Center Platform 3" -> "Oceanside Transit Center".
NCTD_WORDS = {"Rd": "Road", "Dr": "Drive", "Blvd": "Boulevard", "St": "Street", "Hwy": "Highway"}
nctd_name = lambda name: re.sub(r"\b(Rd|Dr|Blvd|St|Hwy)$", lambda m: NCTD_WORDS[m.group(1)],
                               re.sub(r"\s+(Platform\s+\d+|Station)$", "", name.strip()).replace("San Diego - ", "San Diego ").replace("Civic Center - Vista", "Vista Civic Center"))
# The Alaska Railroad's trains by route: one line for both directions.
ALASKA_LINES = {"DenaliNB": "Denali Star", "DenaliSB": "Denali Star", "AuroraNB": "Aurora Winter Train", "AuroraSB": "Aurora Winter Train",
                "CoastalNB": "Coastal Classic", "CoastalSB": "Coastal Classic", "Glacier": "Glacier Discovery", "Hurricane": "Hurricane Turn"}
GTFS = {
    "lirr": ("https://rrgtfsfeeds.s3.amazonaws.com/gtfslirr.zip", lambda r: True, long_name),
    "mnr": ("https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip", lambda r: True, long_name),
    "mbta": ("https://cdn.mbta.com/MBTA_GTFS.zip", rail, lambda r: long_name(r).replace("/", " / ")),
    "septa": (MDB.format("mdb-503"), lambda r: True,
              lambda r: long_name(r) if long_name(r).endswith("Line") else long_name(r) + " Line"),
    "njt": (MDB.format("mdb-509"), rail, long_name),  # the feed also has its light rail lines
    "metra": (MDB.format("mdb-2854"), lambda r: True, long_name),
    "rtd": (MDB.format("mdb-178"),
            lambda r: r["route_id"] in ("A", "113B", "113G", "117N"),
            lambda r: (r.get("route_short_name") or r["route_id"][-1]) + " Line"),
    "frontrunner": (MDB.format("mdb-170"), rail, lambda r: "FrontRunner"),
    "capmetro": (MDB.format("mdb-150"), lambda r: r["route_id"] == "550", lambda r: "Red Line"),
    "trirail": (MDB.format("mdb-333"), rail, lambda r: "Tri-Rail"),  # not the airport shuttle stops
    "caltrain": ("https://data.trilliumtransit.com/gtfs/caltrain-ca-us/caltrain-ca-us.zip", rail, lambda r: "Caltrain"),
    "smart": ("https://data.trilliumtransit.com/gtfs/smart-ca-us/smart-ca-us.zip", rail, lambda r: "SMART"),
    "metrolink": (MDB.format("mdb-96"), lambda r: True, long_name),
    "go": ("https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/GO-GTFS.zip", rail,
           lambda r: long_name(r) + " line"),
    # "PENN - WASHINGTON" -> "Penn Line"
    "marc": ("https://feeds.mta.maryland.gov/gtfs/marc", rail,
             lambda r: long_name(r).split(" - ")[0].title() + " Line", lambda s: marc_station(s)),
    "vre": ("https://gtfs.vre.org/containercdngtfsupload/google_transit.zip", rail, long_name),
    # Sound Transit's rail feed also has Link light rail.
    "sounder": ("https://www.soundtransit.org/GTFS-rail/40_gtfs.zip", lambda r: r["route_id"].startswith("SNDR_"),
                lambda r: r.get("route_short_name") or long_name(r)),
    "southshore": ("https://www.mysouthshoreline.com/google/google_transit.zip", rail, long_name),
    "sunrail": ("https://corporate.sunrail.com/gtfs/google_transit.zip", rail, lambda r: "SunRail"),
    "railrunner": ("https://mjcaction.com/MJC_GTFS_Public/nmrailrunner_google_transit.zip", lambda r: r["route_id"] == "rr",
                   lambda r: "Rail Runner"),
    # ACE's own copy sits behind a bot check; the Mobility Database keeps 511's.
    "ace": (MDB.format("mdb-2684"), rail, lambda r: "ACE"),
    # exo lists each platform as its own stop, with no parent station: they
    # fold into one station per name. "11 - Vaudreuil/Hudson" -> "Vaudreuil-Hudson".
    "exo": (EXO_GTFS, rail, lambda r: exo_line(r), lambda s: (slug(s), s.strip())),
    # NCTD: COASTER (commuter rail, two route ids) and SPRINTER (diesel railcars, filed as light rail).
    # Each station is listed once per direction ("... Platform 3"), with no parent: folded by name.
    "coaster": ("https://lfportal.nctd.org/staticGTFS/google_transit.zip", lambda r: r["route_long_name"] == "COASTER", lambda r: "Coaster",
                lambda s: (slug(nctd_name(s)), nctd_name(s))),
    "sprinter": ("https://lfportal.nctd.org/staticGTFS/google_transit.zip", lambda r: r["route_long_name"] == "SPRINTER", lambda r: "Sprinter",
                 lambda s: (slug(nctd_name(s)), nctd_name(s))),
    "atrain": ("https://gtfs.remix.com/dcta_denton_tx_us.zip", lambda r: r["route_long_name"] == "A-train", lambda r: "A-train"),
    # DART's feed has the Trinity Railway Express (run with Trinity Metro) and the Silver Line.
    "tre": ("https://www.dart.org/transitdata/latest/google_transit.zip", lambda r: r["route_short_name"] == "TRE", lambda r: "Trinity Railway Express"),
    "silverline": ("https://www.dart.org/transitdata/latest/google_transit.zip", lambda r: r["route_short_name"] == "SILVER", lambda r: "Silver Line"),
    "texrail": ("https://gtfsdata.ridetm.org/gtfs/fwtatransitdata.zip", lambda r: r["route_short_name"] == "TEXRail", lambda r: "TEXRail"),
    "star": ("https://www.wegotransit.com/googleexport/google_transit.zip", lambda r: r["route_id"] == "90", lambda r: "WeGo Star"),
    "upx": ("https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/UP-GTFS.zip", lambda r: True, lambda r: "UP Express"),
    # Ontario Northland files every route as a bus; its train is the Polar Bear Express (Cochrane-Moosonee).
    # The feed already has the Northlander's proposed trips, but it is not carrying passengers yet
    # (October 2026): add r["route_long_name"].startswith("Northlander") back when it is.
    "ontarionorthland": ("https://ontarionorthland.tmix.se/gtfs/gtfs.zip", lambda r: "Moosonee" in r["route_long_name"],
                         lambda r: "Polar Bear Express"),
    # The Alaska Railroad's page links its current timetable file (named by date).
    "alaska": ("https://www.alaskarailroad.com/gtfs", lambda r: True, lambda r: ALASKA_LINES.get(r["route_id"], r.get("route_long_name", ""))),
}


def get_raw(url, timeout=180, attempts=1):
    """The bytes at url, trying again on a dropped download (a connection
    reset, a timeout) as many times as attempts allows."""
    req = urllib.request.Request(url, headers={"User-Agent": "trainsheet-build"})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as err:
            if attempt == attempts - 1:
                raise
            print(f"  {url}: retry {attempt + 1} ({err})")
            time.sleep(10)


# Metrolink files its Arrow trains (San Bernardino-Redlands, 3800-3899) under
# the San Bernardino Line.
TRIP_LINE = {"metrolink": lambda t, line: "Metrolink Arrow" if re.fullmatch(r"38\d\d", t.get("trip_short_name") or "") else line}

# MARC lists each station once per direction ("NEW CARROLLTON MARC nb" and
# "... sb"), with no parent station. Both fold into one station, named in
# plain words, whose id is that name as a slug ("new-carrollton").
MARC_NAMES = {"Penn Station": "Baltimore Penn Station", "Union Station": "Washington Union Station",
              "Camden Station": "Baltimore Camden Station", "Bwi Rail Station": "BWI Airport", "St Denis": "St. Denis",
              "Brunswick Md": "Brunswick", "Harpers Ferry W Va": "Harpers Ferry", "Duffields W Va": "Duffields",
              "Martinsburg W Va": "Martinsburg", "Point Of Rocks": "Point of Rocks"}


def marc_station(name):
    """(station id, name) for one of MARC's per-direction stops."""
    base = re.sub(r"\s+MARC(\s+(nb|sb|eb|wb|Washington))?$", "", name.strip(), flags=re.I).title()
    base = MARC_NAMES.get(base, base)
    return re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-"), base


def get_zip(url, timeout=180, attempts=4, page_link=True):
    """A railroad's timetable as a ZipFile, trying again on a dropped download
    (Amtrak's 18 MB sometimes drops). page_link: follow a page that links the
    current file (the Alaska Railroad's, named by date)."""
    for attempt in range(attempts):
        try:
            data = get_raw(url, timeout)
            if page_link and data[:2] != b"PK":
                href = re.search(rb'href="([^"]+\.zip)"', data, re.I).group(1).decode()
                return get_zip(urllib.parse.urljoin(url, href), timeout, attempts, page_link)
            return zipfile.ZipFile(io.BytesIO(data))
        except Exception as err:
            if attempt == attempts - 1:
                raise
            print(f"  {url}: retry {attempt + 1} ({err})")
            time.sleep(10)


def rows(zf, name, optional=False, spaces=False, strip=True):
    """The rows of one file in a timetable, as dicts. optional: a file the feed
    may not have (calendar.txt) reads as nothing rather than failing. spaces:
    the feed puts a space after every comma (Metra). strip: pad or no, keys
    and values come trimmed (the one reader that keeps them raw says so)."""
    if optional and name not in zf.namelist():
        return
    with zf.open(name) as f:
        reader = csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"), skipinitialspace=spaces)
        if not strip:
            yield from reader
            return
        for r in reader:
            yield {k.strip(): (v or "").strip() for k, v in r.items() if k}


def minutes(hms):
    """"25:05:00" -> 1505: a timetable's clock as minutes after midnight."""
    h, m, *_ = (int(x) for x in hms.split(":"))
    return h * 60 + m
