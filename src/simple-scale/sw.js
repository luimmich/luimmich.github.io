const CACHE_NAME = "timemore-terminal-v4";

const ASSETS_TO_CACHE = [
  "/simple-scale/",
  "/simple-scale/index.html",
  "/simple-scale/manifest.json",
  "/css/scale.css",
  "/js/scale/app.js",
  "/js/scale/ble-manager.js",
  "/js/scale/timemore-decoder.js",
  "/js/scale/db.js",
  "/css/departure.css",
  "/fonts/departuremono/DepartureMono-Regular.woff2",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();

  // Cache Tolerante a Falhas: Se um arquivo der 404, os outros continuam sendo cacheados
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSETS_TO_CACHE.map((url) => {
          return cache.add(url).catch((err) => console.warn(`PWA Cache falhou para ${url}:`, err));
        }),
      );
    }),
  );
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

// Estratégia Stale-While-Revalidate com Fallback Seguro
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          // Não faz cache de respostas parciais ou erros 404/500
          if (
            !networkResponse ||
            networkResponse.status !== 200 ||
            networkResponse.type !== "basic"
          ) {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          return networkResponse;
        })
        .catch(() => {});

      return cachedResponse || fetchPromise;
    }),
  );
});
