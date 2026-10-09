"""Local stand-in for relay/worker.js, for development without Cloudflare.

    python3 scripts/dev_relay.py          # serves http://127.0.0.1:8787

then set window.TRAINTRACKER_RELAY = "http://127.0.0.1:8787" in config.js.
Keyed feeds read the same environment variables as the Worker's secrets
(METRA_API_TOKEN, API_511_KEY, METROLINK_API_KEY). NJ Transit is Worker-only.
"""
import json, os, time, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

q = urllib.parse.quote
FEEDS = {
    "septa": lambda e: {"url": "https://www3.septa.org/api/TrainView/index.php"},
    "rtd": lambda e: {"url": "https://open-data.rtd-denver.com/files/gtfs-rt/rtd/VehiclePosition.pb"},
    "uta": lambda e: {"url": "https://apps.rideuta.com/tms/gtfs/Vehicle"},
    "capmetro": lambda e: {"url": "https://data.texas.gov/download/eiei-9rpf/application%2Foctet-stream"},
    "trirail": lambda e: {"url": "https://gtfsr.tri-rail.com/download.aspx?file=position_updates.pb"},
    "metra": lambda e: e.get("METRA_API_TOKEN") and {
        "url": "https://gtfspublic.metrarr.com/gtfs/public/positions?api_token=" + q(e["METRA_API_TOKEN"])},
    "caltrain": lambda e: e.get("API_511_KEY") and {
        "url": "https://api.511.org/transit/vehiclepositions?agency=CT&api_key=" + q(e["API_511_KEY"])},
    "smart": lambda e: e.get("API_511_KEY") and {
        "url": "https://api.511.org/transit/vehiclepositions?agency=SA&api_key=" + q(e["API_511_KEY"])},
    "metrolink": lambda e: e.get("METROLINK_API_KEY") and {
        "url": "https://metrolink-gtfsrt.gbsdigital.us/feed/gtfsrt-vehicles",
        "headers": {"X-Api-Key": e["METROLINK_API_KEY"]}},
}
CACHE_SECONDS = 15
cache = {}


class Handler(BaseHTTPRequestHandler):
    def send(self, status, body, ctype="text/plain"):
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", ctype)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        env = os.environ
        if self.path == "/status":
            feeds = {k: bool(f(env)) for k, f in FEEDS.items()}
            return self.send(200, json.dumps({"feeds": feeds}).encode(), "application/json")
        name = self.path.removeprefix("/feed/")
        spec = FEEDS.get(name, lambda e: None)(env)
        if not self.path.startswith("/feed/") or not spec:
            return self.send(404, b"Unknown or unconfigured feed")
        hit = cache.get(name)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return self.send(200, hit[1], hit[2])
        req = urllib.request.Request(spec["url"], headers={"User-Agent": "TrainTracker relay", **spec.get("headers", {})})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                body, ctype = r.read(), r.headers.get("Content-Type", "application/octet-stream")
        except Exception as err:
            return self.send(502, f"Upstream error: {err}".encode())
        cache[name] = (time.time(), body, ctype)
        self.send(200, body, ctype)


if __name__ == "__main__":
    print("TrainTracker dev relay on http://127.0.0.1:8787")
    ThreadingHTTPServer(("127.0.0.1", 8787), Handler).serve_forever()
