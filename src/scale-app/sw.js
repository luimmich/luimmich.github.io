const CACHE_NAME = "timemore-terminal-v3";

const ASSETS_TO_CACHE = [
  "/scale-app/",
  "/scale-app/index.html",
  "/scale-app/manifest.json",
  "/css/scale.css",
  "/js/scale/app.js",
  "/js/scale/ble-manager.js",
  "/js/scale/timemore-decoder.js",
  "/css/departure.css",
  "/fonts/departuremono/DepartureMono-Regular.woff2",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)));
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
});

// Stale-While-Revalidate Strategy
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
          });
          return networkResponse;
        })
        .catch(() => {
          // Ignora erros de rede silenciosamente (offline mode)
        });

      return cachedResponse || fetchPromise;
    }),
  );
});
