/* ==========================================================================
   SERVICE WORKER
   Caches only the static app shell (HTML/CSS/JS/icons) so CareConnect can
   open while offline. It deliberately does NOT cache:
     - Overpass API responses (real service data belongs in IndexedDB via
       the Offline Layer, which stamps a timestamp so the UI can label it
       "offline data" honestly)
     - map tiles (kept simple for this MVP — offline mode falls back to
       the saved service list rather than pretending the map is live)
     - anything containing the user's account or location
   ========================================================================== */

const CACHE_NAME = "careconnect-shell-v1";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/location.js",
  "./js/data.js",
  "./js/offline.js",
  "./js/intent.js",
  "./js/actions.js",
  "./js/ui.js",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin shell requests; let Overpass, tile, and font
  // requests hit the network directly (or fail visibly, which is honest —
  // we never want to serve a stale service list as if it were live).
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => {
        if (event.request.mode === "navigate") return caches.match("./index.html");
        return undefined;
      });
    })
  );
});
