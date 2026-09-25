// sw.js
const CACHE_NAME = "timemore-terminal-v7";

const APP_SHELL = [
  "/simple-scale/",
  "/simple-scale/index.html",
  "/simple-scale/manifest.json",
  "/css/scale.css",
  "/js/scale/app.js",
  "/js/scale/ble-manager.js",
  "/js/scale/timemore-decoder.js",
  "/js/scale/db.js",
  "/fonts/departuremono/departure.css",
  "/fonts/departuremono/DepartureMono-Regular.woff2",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          APP_SHELL.map((url) =>
            cache.add(url).catch((err) => console.warn(`PWA Cache falhou para ${url}:`, err)),
          ),
        ),
      ),
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

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const isNavigationRequest = request.mode === "navigate";
  const isSameOrigin = new URL(request.url).origin === self.location.origin;

  if (!isSameOrigin) return;

  event.respondWith(
    (async () => {
      if (isNavigationRequest) {
        try {
          const networkResponse = await fetch(request);
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, networkResponse.clone());
          return networkResponse;
        } catch (error) {
          return (await caches.match(request)) || (await caches.match("/simple-scale/"));
        }
      }

      const cachedResponse = await caches.match(request);
      if (cachedResponse) return cachedResponse;

      try {
        const networkResponse = await fetch(request);

        if (networkResponse && networkResponse.ok && networkResponse.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, networkResponse.clone());
        }

        return networkResponse;
      } catch (error) {
        return Response.error();
      }
    })(),
  );
});
