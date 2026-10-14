// Trainsheet's service worker: it makes the site installable as an app and
// lets it open without a connection. Pages and the site's own files come
// from the network first (so a deploy shows at once) and are kept as a
// fallback; live train data is never cached here.
const CACHE = "trainsheet-shell";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api")) return;
  // Only the app itself: the page, scripts, styles, images and static data.
  if (req.mode !== "navigate" && !/\.(js|css|svg|png|json|webmanifest)$/.test(url.pathname)) return;
  // Kept by path alone, so each deploy's versioned copy replaces the last.
  const key = req.mode === "navigate" ? new URL("./", location.href).href : url.origin + url.pathname;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(key, copy));
      }
      return res;
    }).catch(() => caches.match(key).then((hit) => hit || Response.error())),
  );
});
