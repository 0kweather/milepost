"""Builds data/views.json: the views "Where to sit" names on a train's page
(js/sides.js).

Each view is a stretch of track and what it looks out on. A stretch is
written as stations ("railroad:Name", or "railroad#id" where names repeat)
and points ([lon, lat]) in the order a train passes them; the line between
them is traced along the track in data/rail.geojson, so it follows the rails
around curves. What the view looks out on is either:

  side    "left" or "right", for a train going from the first waypoint to
          the last, facing forward (rivers and shores the track runs along,
          where the side is certain), or
  toward  a point or a line (a skyline, a bridge, a mountain, the middle of
          a bay), from which js/sides.js works out the side at each point
          the train passes, whichever way it's going.

minKm: how far along the stretch a ride must go for the view to count (5 km
unless given; short for skylines and harbors seen from a bridge). A ride
must pass within NEAR_M of the stretch. reach: for a
view toward something, how far from it (km) it can still be seen. night: a
skyline, worth the seat after dark too.

The first views below were drawn by hand (lines through station positions
and maps) and are kept as they are.

    python3 scripts/build_views.py
"""

import heapq
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Points views look toward, used more than once.
MANHATTAN = [[-73.9857, 40.7484], [-74.0134, 40.7127]]  # Midtown (Empire State Building) to the World Trade Center
CITY_HALL_PHL = [-75.1636, 39.9524]
LAKE_PONTCHARTRAIN = [-90.10, 30.18]
FRONT_RANGE = [[-105.68, 39.55], [-105.64, 39.80], [-105.62, 40.05], [-105.62, 40.30]]

VIEWS = [
    # ---------- New York City ----------
    dict(name="the Manhattan skyline across the Meadowlands", night=True, minKm=3, toward=MANHATTAN,
         stretch=["amtrak:Newark Penn", "njt:Secaucus Upper Level", [-74.0345, 40.7655]]),
    dict(name="the Manhattan skyline across the Meadowlands", night=True, minKm=3, toward=MANHATTAN,
         stretch=["njt:Rutherford", "njt:Secaucus Lower Level", [-74.0560, 40.7470]]),
    dict(name="the Manhattan skyline from the Hell Gate Bridge", night=True, minKm=3, toward=MANHATTAN,
         stretch=[[-73.9230, 40.7520], [-73.9120, 40.7710], [-73.9228, 40.7832], [-73.9170, 40.8005], [-73.9040, 40.8075]]),
    dict(name="the Manhattan skyline", night=True, minKm=3, toward=MANHATTAN,
         stretch=["lirr:Forest Hills", "lirr:Woodside", [-73.9330, 40.7470]]),
    dict(name="Citi Field", minKm=1.5, toward=[-73.8458, 40.7571],
         stretch=["lirr:Woodside", "lirr:Mets-Willets Point", "lirr:Flushing Main Street"]),
    dict(name="the Unisphere and Flushing Meadows", minKm=1.5, toward=[-73.8449, 40.7466],
         stretch=["lirr:Woodside", "lirr:Mets-Willets Point", "lirr:Flushing Main Street"]),
    dict(name="Yankee Stadium", minKm=1, toward=[-73.9262, 40.8296],
         stretch=["mnr:Harlem-125 St", "mnr:Yankees-E 153 St", "mnr:Morris Heights"]),
    dict(name="the Harlem River", side="left", minKm=3,
         stretch=["mnr:Yankees-E 153 St", "mnr:Morris Heights", "mnr:University Heights", "mnr:Marble Hill", "mnr:Spuyten Duyvil"]),

    # ---------- The Hudson Valley ----------
    dict(name="the Palisades across the Hudson", side="left",
         stretch=["mnr:Spuyten Duyvil", "mnr:Riverdale", "mnr:Ludlow", "mnr:Yonkers", "mnr:Glenwood", "mnr:Greystone", "mnr:Hastings-on-Hudson"]),
    dict(name="the Mario M. Cuomo Bridge", minKm=1.5, toward=[-73.8945, 41.0700],
         stretch=["mnr:Irvington", "mnr:Tarrytown", "mnr:Philipse Manor"]),
    dict(name="Haverstraw Bay, the widest part of the Hudson", side="left",
         stretch=["mnr:Ossining", "mnr:Croton-Harmon", "mnr:Cortlandt"]),
    dict(name="the Bear Mountain Bridge", minKm=1.5, toward=[-73.9880, 41.3195],
         stretch=["mnr:Peekskill", "mnr:Manitou"]),
    dict(name="West Point", minKm=1.5, toward=[-73.9567, 41.3915],
         stretch=["mnr:Manitou", "mnr:Garrison", "mnr:Cold Spring"]),
    dict(name="Storm King Mountain and Bannerman's Castle", minKm=2, toward=[[-74.0003, 41.4271], [-73.9893, 41.4554]],
         stretch=["mnr:Cold Spring", "mnr:Breakneck Ridge", "mnr:Beacon"]),
    dict(name="the Walkway Over the Hudson and the Mid-Hudson Bridge", minKm=2, toward=[[-73.9505, 41.7030], [-73.9446, 41.7110]],
         stretch=["mnr:New Hamburg", "mnr:Poughkeepsie", [-73.9400, 41.7400]]),
    dict(name="the Catskill Mountains across the Hudson", minKm=8, toward=[[-74.20, 42.05], [-74.06, 42.13], [-74.04, 42.20], [-74.08, 42.30]],
         stretch=["amtrak:Rhinecliff-Kingston", "amtrak:Hudson", [-73.7550, 42.5500]]),
    dict(name="the Rip Van Winkle Bridge", minKm=2, toward=[-73.8700, 42.2250],
         stretch=[[-73.8900, 42.1700], "amtrak:Hudson"]),
    dict(name="Albany and the Empire State Plaza across the river", night=True, minKm=2, toward=[-73.7590, 42.6500],
         stretch=[[-73.7600, 42.5700], "amtrak:Albany-Rensselaer"]),
    dict(name="the Moodna Viaduct and the Hudson Highlands", minKm=2, toward=[-74.0003, 41.4271],
         stretch=["njt:Harriman", "njt:Salisbury Mills-Cornwall"]),

    # ---------- Long Island ----------
    dict(name="Little Neck Bay", minKm=1.5, toward=[-73.7700, 40.7900],
         stretch=["lirr:Bayside", "lirr:Douglaston", "lirr:Little Neck"]),
    dict(name="Manhasset Bay", minKm=1.5, toward=[-73.7050, 40.8150],
         stretch=["lirr:Manhasset", "lirr:Plandome", "lirr:Port Washington"]),
    dict(name="Mill Neck Creek and Oyster Bay Harbor", minKm=2, toward=[[-73.5650, 40.8900], [-73.5350, 40.8880]],
         stretch=["lirr:Locust Valley", "lirr:Oyster Bay"]),
    dict(name="Peconic Bay at the Shinnecock Canal", minKm=2, toward=[-72.5100, 40.9200],
         stretch=["lirr:Southampton", "lirr:Hampton Bays"]),
    dict(name="Napeague Bay", minKm=4, toward=[-72.0500, 41.0150],
         stretch=["lirr:Amagansett", "lirr:Montauk"]),

    # ---------- Connecticut and Rhode Island ----------
    dict(name="Cos Cob Harbor", side="right", minKm=1, stretch=["mnr:Greenwich", "mnr:Cos Cob", "mnr:Riverside"]),
    dict(name="Norwalk Harbor", side="right", minKm=1, stretch=["mnr:Rowayton", "mnr:South Norwalk", "mnr:East Norwalk"]),
    dict(name="the Saugatuck River", side="right", minKm=1, stretch=["mnr:East Norwalk", "mnr:Westport", "mnr:Green's Farms"]),
    dict(name="Black Rock and Bridgeport Harbors", side="right", minKm=1, stretch=["mnr:Fairfield-Black Rock", "mnr:Bridgeport"]),
    dict(name="the Housatonic River", side="right", minKm=1, stretch=["mnr:Stratford", "mnr:Milford"]),
    dict(name="salt marshes and Long Island Sound", side="right",
         stretch=["amtrak:New Haven Union", "ctrail:Branford", "ctrail:Guilford", "ctrail:Madison", "ctrail:Clinton", "ctrail:Westbrook", "ctrail:Old Saybrook"]),
    dict(name="Greenwich Bay", minKm=2, toward=[-71.4200, 41.6800],
         stretch=["mbta:Wickford Junction", "mbta:TF Green Airport"]),

    # ---------- New Jersey ----------
    dict(name="Raritan Bay", minKm=1.5, toward=[-74.2500, 40.4800], stretch=["njt:Perth Amboy", "njt:South Amboy"]),
    dict(name="the Navesink River", minKm=1.5, toward=[-74.0400, 40.3650], stretch=["njt:Middletown Nj", "njt:Red Bank"]),
    dict(name="the Manasquan River", minKm=1, toward=[-74.0400, 40.1050], stretch=["njt:Manasquan", "njt:Point Pleasant"]),
    dict(name="the Delaware River and the Trenton Makes bridge", minKm=1, toward=[-74.7580, 40.2050],
         stretch=["amtrak:Trenton", "septa:Levittown"]),

    # ---------- Philadelphia to Washington ----------
    dict(name="the Philadelphia skyline and the Schuylkill River", night=True, minKm=2, toward=CITY_HALL_PHL,
         stretch=["septa:Overbrook", [-75.2050, 39.9750], "amtrak:Philadelphia 30th Street"]),
    dict(name="the Philadelphia skyline", night=True, minKm=2, toward=CITY_HALL_PHL,
         stretch=["septa:North Philadelphia Amtrak", "amtrak:Philadelphia 30th Street"]),
    dict(name="the Delaware River", minKm=3, toward=[[-75.5300, 39.7100], [-75.4700, 39.7700], [-75.4000, 39.8100]],
         stretch=["septa:Wilmington", "septa:Claymont Transit Center", "septa:Marcus Hook"]),
    dict(name="the Susquehanna Flats and the Chesapeake", minKm=2, toward=[[-76.0600, 39.5200], [-76.0400, 39.5000]],
         stretch=["marc:Perryville", "amtrak:Aberdeen"]),
    dict(name="the Bush and Gunpowder Rivers", minKm=3, toward=[[-76.3450, 39.3400], [-76.2450, 39.4150]],
         stretch=["marc:Martin Airport", "marc:Edgewood", "marc:Aberdeen"]),
    # Nearly dead ahead from the bridge, so given as a side: they're west of it.
    dict(name="the Potomac, the Jefferson Memorial and the Washington Monument", night=True, minKm=1.5, side="left",
         stretch=["vre:Crystal City", "vre:L'Enfant"]),
    dict(name="the Potomac River", minKm=4, toward=[[-77.2350, 38.6400], [-77.2450, 38.5900], [-77.2650, 38.5400], [-77.2750, 38.5150]],
         stretch=["vre:Woodbridge", "vre:Rippon", "vre:Quantico"]),
    dict(name="the Potomac River and the C&O Canal", side="left", minKm=4,
         stretch=["marc:Point of Rocks", "marc:Brunswick", "marc:Harpers Ferry"]),

    # ---------- Boston and New England ----------
    dict(name="the Zakim Bridge and the Boston skyline", night=True, minKm=1, toward=[[-71.0626, 42.3687], [-71.0589, 42.3601]],
         stretch=[[-71.0790, 42.3830], "mbta:North Station"]),
    dict(name="Dorchester Bay", minKm=2, toward=[-71.0350, 42.3050], stretch=["mbta:JFK/UMass", "mbta:Quincy Center"]),
    dict(name="Salem Harbor", minKm=1, toward=[-70.8750, 42.5350], stretch=["mbta:Salem", "mbta:Beverly"]),
    dict(name="Manchester Harbor", minKm=2, toward=[[-70.7800, 42.5650], [-70.7600, 42.5680]],
         stretch=["mbta:Beverly Farms", "mbta:Manchester", "mbta:West Gloucester"]),
    dict(name="the Annisquam River and Gloucester Harbor", minKm=1, toward=[-70.6720, 42.6000],
         stretch=["mbta:West Gloucester", "mbta:Gloucester"]),
    dict(name="the Connecticut River", side="right",
         stretch=["amtrak:Brattleboro", "amtrak:Bellows Falls", "amtrak:Windsor-Mt. Ascutney", "amtrak:White River Junction"]),

    # ---------- Pennsylvania and the Midwest ----------
    dict(name="the Horseshoe Curve", minKm=2, toward=[-78.4780, 40.4970], stretch=["amtrak:Altoona", [-78.5500, 40.4800]]),
    dict(name="the Susquehanna River and the Rockville Bridge", minKm=4, toward=[[-76.9050, 40.3330], [-76.9150, 40.3600], [-76.9550, 40.3850], [-76.9950, 40.4000]],
         stretch=["amtrak:Harrisburg", [-76.9300, 40.3430], [-77.0200, 40.4050]]),
    dict(name="the Mississippi River", side="left", minKm=10,
         stretch=["amtrak:St. Paul - Minneapolis Union", "amtrak:Red Wing", "amtrak:Winona", "amtrak:La Crosse"]),
    dict(name="Lake Michigan", side="right", minKm=3, stretch=["metra:55th - 56th - 57th St.", "metra:McCormick Place", "metra:Museum Campus/11th St."]),
    dict(name="Soldier Field and the Museum Campus", minKm=1, toward=[-87.6167, 41.8623],
         stretch=["metra:McCormick Place", "metra:Museum Campus/11th St."]),
    dict(name="the Gateway Arch and the Mississippi", night=True, minKm=2, toward=[-90.1848, 38.6247],
         stretch=[[-90.1650, 38.7000], [-90.1830, 38.6700], "amtrak:St. Louis Gateway"]),

    # ---------- The South ----------
    dict(name="Lake Pontchartrain", minKm=8, reach=15, toward=LAKE_PONTCHARTRAIN, stretch=["amtrak:Slidell", "amtrak:New Orleans"]),
    dict(name="Lake Pontchartrain", minKm=8, reach=15, toward=LAKE_PONTCHARTRAIN, stretch=["amtrak#HMD", [-90.4000, 30.2800], "amtrak:New Orleans"]),
    dict(name="the New River Gorge Bridge", minKm=2, toward=[-81.0832, 38.0687], stretch=[[-81.0550, 38.0400], [-81.1000, 38.0850]]),

    # ---------- The West ----------
    dict(name="Mount Rainier, on a clear day", minKm=10, toward=[-121.7603, 46.8523], stretch=["amtrak#CTL", "amtrak#OLW", "amtrak:Tacoma Dome"]),
    dict(name="Mount Rainier, on a clear day", minKm=10, toward=[-121.7603, 46.8523], stretch=["amtrak:Tacoma Dome", "amtrak:Tukwila", "amtrak:Seattle King Street"]),
    dict(name="the Olympic Mountains across Puget Sound", minKm=10, toward=[[-123.60, 47.60], [-123.40, 47.80], [-123.20, 48.00]],
         stretch=["amtrak:Seattle King Street", "amtrak:Edmonds", "amtrak:Everett"]),
    dict(name="Mount Baker, on a clear day", minKm=10, toward=[-121.8144, 48.7768], stretch=["amtrak:Mount Vernon", "amtrak:Bellingham Fairhaven"]),
    dict(name="Semiahmoo Bay and White Rock", minKm=3, toward=[[-122.7800, 48.9900], [-122.8500, 49.0100], [-122.9000, 49.0400]],
         stretch=[[-122.7520, 48.9950], [-122.8000, 49.0180], [-122.8800, 49.0600]]),
    dict(name="Mount St. Helens, on a clear day", minKm=10, toward=[-122.1944, 46.1912], stretch=["amtrak#VAN", "amtrak:Kelso"]),
    dict(name="Mount Hood, on a clear day", minKm=3, toward=[-121.6959, 45.3736], stretch=["amtrak#PDX", "amtrak#VAN"]),
    dict(name="Mount Hood, on a clear day", minKm=10, toward=[-121.6959, 45.3736], stretch=["amtrak#VAN", "amtrak:Bingen-White Salmon"]),
    dict(name="Beacon Rock", minKm=3, toward=[-122.0221, 45.6286], stretch=[[-121.9500, 45.6500], [-122.1000, 45.6050]]),
    dict(name="Upper Klamath Lake", minKm=8, reach=8, toward=[[-121.9500, 42.4500], [-121.9000, 42.3800], [-121.8600, 42.3000]],
         stretch=["amtrak:Chemult", "amtrak:Klamath Falls"]),
    dict(name="Mount Shasta", minKm=15, toward=[-122.1949, 41.4092], stretch=["amtrak:Klamath Falls", "amtrak:Dunsmuir"]),
    dict(name="Donner Lake", minKm=3, reach=3.5, toward=[-120.2700, 39.3230], stretch=["amtrak:Truckee", [-120.3300, 39.3170]]),
    dict(name="Suisun Bay", minKm=5, reach=8, toward=[[-122.0900, 38.0650], [-122.0400, 38.0750], [-121.9800, 38.0850]],
         stretch=[[-122.1250, 38.0450], "amtrak:Suisun-Fairfield"]),
    dict(name="the San Francisco skyline and the Bay Bridge", night=True, minKm=3, toward=[[-122.3970, 37.7930], [-122.3711, 37.8098]],
         stretch=["amtrak#RIC", "amtrak:Berkeley", "amtrak:Emeryville", "amtrak:Oakland-Jack London Square"]),
    dict(name="the Golden Gate Bridge", minKm=3, toward=[-122.4783, 37.8199], stretch=["amtrak#RIC", "amtrak:Berkeley"]),
    dict(name="San Francisco Bay at Brisbane", minKm=1.5, toward=[-122.3920, 37.6850],
         stretch=["caltrain:Bayshore Station", "caltrain:South San Francisco Caltrain Station"]),
    dict(name="the Pacific along Vandenberg", minKm=5, toward=[[-120.6500, 34.6800], [-120.6600, 34.8000], [-120.6700, 34.9000]],
         stretch=["amtrak:Lompoc-Surf", "amtrak:Guadalupe"]),
    dict(name="the Los Angeles skyline", night=True, minKm=2, toward=[-118.2510, 34.0505],
         stretch=["metrolink#135", "amtrak:Los Angeles Union"]),
    dict(name="San Diego Bay", minKm=2, toward=[-117.1950, 32.7250], stretch=["amtrak:San Diego Old Town", "amtrak:San Diego Santa Fe Depot"]),
    dict(name="the Wasatch Range", minKm=10, toward=[[-111.87, 41.25], [-111.85, 41.00], [-111.75, 40.75], [-111.65, 40.45], [-111.60, 40.30]],
         stretch=["frontrunner:Ogden Central Station", "frontrunner:Salt Lake Central Station", "frontrunner:Provo Central Station"]),
    dict(name="the Sandia Mountains", minKm=5, toward=[-106.4469, 35.2101],
         stretch=["railrunner:Downtown Bernalillo", "railrunner:Downtown Albuquerque"]),
    dict(name="the Front Range", minKm=5, toward=FRONT_RANGE, stretch=["rtd:Union Station", "rtd:Olde Town Arvada", "rtd:Wheat Ridge / Ward Road Station"]),
    dict(name="the Front Range", minKm=5, toward=FRONT_RANGE, stretch=["rtd:Union Station", "rtd:Westminster Station"]),

    # ---------- Canada ----------
    dict(name="the Toronto skyline and the CN Tower", night=True, minKm=2, toward=[-79.3871, 43.6426],
         stretch=["go:Mimico GO", "go:Exhibition GO", "go:Union Station GO"]),
    dict(name="Hamilton Harbour", minKm=2, toward=[-79.8300, 43.2900], stretch=["go:Aldershot GO", "go:West Harbour GO"]),
    dict(name="Lake Ontario", minKm=3, toward=[[-78.2900, 43.9200], [-78.1600, 43.9300]], stretch=["via:Port Hope", "via:Cobourg"]),
    dict(name="the Montréal skyline across the St. Lawrence", night=True, minKm=2, toward=[-73.5670, 45.5010],
         stretch=["exo:LaSalle", "exo:Sainte-Catherine"]),
    dict(name="Mount Robson", minKm=15, reach=40, toward=[-119.1561, 53.1105], stretch=["via:Valemount", "via:Jasper"]),
]

SNAP_M = 2500
# How near a ride must pass a stretch's line. The lines here are traced
# along the track, so this can be tight, and a parallel line a few blocks
# over (common in cities) doesn't count as passing the view.
NEAR_M = 600


def dist(a, b):
    x = math.radians(b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    y = math.radians(b[1] - a[1])
    return math.hypot(x, y) * 6371000


def load_stations():
    raw = json.loads((ROOT / "data/stations.json").read_text())
    by_name, by_id = {}, {}
    for agency, rows in raw.items():
        for row in rows:
            sid, name, lat, lon = row[0], row[1], row[2], row[3]
            by_name.setdefault((agency, name.lower()), []).append([lon, lat])
            by_id[(agency, str(sid))] = [lon, lat]
    return by_name, by_id


class Rail:
    """The passenger rail lines as a graph, vertices joined at 4 decimals (as
    js/estimate.js joins lines at their ends)."""

    def __init__(self):
        g = json.loads((ROOT / "data/rail.geojson").read_text())
        self.xy, self.adj, self.index, self.grid = [], [], {}, {}
        for f in g["features"]:
            coords = f["geometry"]["coordinates"]
            prev = None
            for c in coords:
                n = self.node(c)
                if prev is not None and prev != n:
                    d = dist(self.xy[prev], self.xy[n])
                    self.adj[prev].append((n, d))
                    self.adj[n].append((prev, d))
                prev = n

    def node(self, c):
        k = (round(c[0], 4), round(c[1], 4))
        if k not in self.index:
            self.index[k] = len(self.xy)
            self.xy.append([c[0], c[1]])
            self.adj.append([])
            self.grid.setdefault((int(c[0] * 50 // 1), int(c[1] * 50 // 1)), []).append(self.index[k])
        return self.index[k]

    def snap(self, p):
        gx, gy = int(p[0] * 50 // 1), int(p[1] * 50 // 1)
        best, bd = None, SNAP_M
        for dx in (-2, -1, 0, 1, 2):
            for dy in (-2, -1, 0, 1, 2):
                for n in self.grid.get((gx + dx, gy + dy), []):
                    d = dist(p, self.xy[n])
                    if d < bd:
                        best, bd = n, d
        return best

    def route(self, a, b):
        """Shortest path between two vertices, as coordinates."""
        dist_to, prev, heap = {a: 0}, {}, [(0, a)]
        goal = self.xy[b]
        while heap:
            d, n = heapq.heappop(heap)
            if n == b:
                break
            if d > dist_to.get(n, math.inf):
                continue
            for m, w in self.adj[n]:
                nd = d + w
                if nd < dist_to.get(m, math.inf):
                    dist_to[m], prev[m] = nd, n
                    heapq.heappush(heap, (nd, m))
        if b not in dist_to:
            return None, math.inf
        path, n = [b], b
        while n != a:
            n = prev[n]
            path.append(n)
        return [self.xy[i] for i in reversed(path)], dist_to[b]


def resolve(w, by_name, by_id):
    if isinstance(w, list):
        return w
    if "#" in w:
        agency, sid = w.split("#", 1)
        if (agency, sid) not in by_id:
            raise SystemExit(f"No station {w}")
        return by_id[(agency, sid)]
    agency, name = w.split(":", 1)
    hits = by_name.get((agency, name.lower()))
    if not hits:
        raise SystemExit(f"No station {w}")
    if len(hits) > 1:
        raise SystemExit(f"Several stations are called {w}; use its id (railroad#id)")
    return hits[0]


def simplify(coords, step=400):
    out = [coords[0]]
    for c in coords[1:-1]:
        if dist(out[-1], c) >= step:
            out.append(c)
    out.append(coords[-1])
    return [[round(x, 5), round(y, 5)] for x, y in out]


def trace(points, rail):
    line = []
    for a, b in zip(points, points[1:]):
        na, nb = rail.snap(a), rail.snap(b)
        straight = dist(a, b)
        path, length = (rail.route(na, nb) if na is not None and nb is not None else (None, math.inf))
        if path is None or length > straight * 2.5 + 3000:
            print(f"    no track found from {a} to {b} ({straight / 1000:.1f} km); a straight line instead")
            path = [a, b]
        line.extend(path if not line else path[1:])
    return simplify(line)


def bearing(a, b):
    y = math.sin(math.radians(b[0] - a[0])) * math.cos(math.radians(b[1]))
    x = math.cos(math.radians(a[1])) * math.sin(math.radians(b[1])) - math.sin(math.radians(a[1])) * math.cos(math.radians(b[1])) * math.cos(math.radians(b[0] - a[0]))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def side_check(line, toward):
    """Which side the view is on going the way the line is drawn (as
    js/sides.js works it out), for checking by eye."""
    targets = toward if isinstance(toward[0], list) else [toward]
    votes = {"left": 0, "right": 0, "ahead/behind": 0}
    for a, b in zip(line, line[1:]):
        t = min(targets, key=lambda p: dist(a, p))
        rel = (bearing(a, t) - bearing(a, b)) % 360
        votes["right" if 20 < rel < 160 else "left" if 200 < rel < 340 else "ahead/behind"] += 1
    return votes


def main():
    by_name, by_id = load_stations()
    rail = Rail()
    kept = [v for v in json.loads((ROOT / "data/views.json").read_text())["views"] if v.get("hand")]
    out = list(kept)
    for v in VIEWS:
        points = [resolve(w, by_name, by_id) for w in v["stretch"]]
        line = trace(points, rail)
        km = sum(dist(a, b) for a, b in zip(line, line[1:])) / 1000
        entry = {"name": v["name"]}
        if "side" in v:
            entry["side"] = v["side"]
        else:
            entry["toward"] = v["toward"] if isinstance(v["toward"][0], list) else [v["toward"]]
        for k in ("minKm", "night", "reach"):
            if k in v:
                entry[k] = v[k]
        entry["near"] = NEAR_M
        entry["line"] = line
        out.append(entry)
        check = "" if "side" in v else f"  {side_check(line, entry['toward'])}"
        print(f"{v['name']}: {km:.1f} km{check}")
    about = ("Stretches of track with a view on one side (js/sides.js), built by scripts/build_views.py; "
             "entries marked hand were drawn by hand. line runs along the track ([lon, lat]). side is where the view is "
             "traveling the way the line is drawn, facing forward; toward is what the view looks out on, from which "
             "the side is worked out. minKm: how far along it a ride must go (5 unless given). night: worth it after dark.")
    (ROOT / "data/views.json").write_text(json.dumps({"about": about, "views": out}, separators=(",", ":")) + "\n")
    print(f"{len(out)} views ({len(kept)} drawn by hand)")


if __name__ == "__main__":
    main()
