// Trainsheet's service worker: it makes the site installable as an app and
// lets it open without a connection. The page comes from the network first
// (so a deploy shows at once) and is kept as a fallback. The site's own files
// are stamped with the deploy they belong to (?v=…, by scripts/stamp.py), and
// a stamped file never changes, so one is served from the copy kept here
// when there is one and fetched once otherwise; a new deploy's page asks for
// new stamps, which come from the network and replace the old copies. Live
// train data is never cached here.
const CACHE = "trainsheet-shell";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api")) return;
  // Only the app itself: the page, scripts, styles, images and static data.
  if (req.mode !== "navigate" && !/\.(js|css|svg|png|json|geojson|webmanifest)$/.test(url.pathname)) return;
  // Kept by path alone, so each deploy's versioned copy replaces the last.
  const key = req.mode === "navigate" ? new URL("./", location.href).href : url.origin + url.pathname;
  const fromNetwork = () => fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(key, copy));
    }
    return res;
  });
  const fromCache = () => caches.match(key);
  // A deploy's stamp ("?v=dev" is the unstamped source, always fetched).
  const stamp = url.searchParams.get("v");
  if (req.mode !== "navigate" && stamp && stamp !== "dev") {
    // The kept copy, if it's this very version (the copy remembers the
    // address it came from); else the network, with the copy as a fallback.
    e.respondWith(fromCache().then((hit) => (hit && hit.url === req.url ? hit : fromNetwork().catch(() => hit || Response.error()))));
    return;
  }
  e.respondWith(fromNetwork().catch(() => fromCache().then((hit) => hit || Response.error())));
});
