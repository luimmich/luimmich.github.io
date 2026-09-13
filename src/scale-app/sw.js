const CACHE_NAME = "timemore-terminal-v2";

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
  "/fonts/departuremono/DepartureMono-Regular.woff",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        }),
      );
    }),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    }),
  );
});
