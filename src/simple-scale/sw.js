// sw.js
const CACHE_NAME = "timemore-terminal-v8";

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

// Network-first: garante que atualizações do app cheguem sem depender de
// cache-bump manual; o cache fica só como fallback offline.
// ponytail: a primeira carga offline espera o fetch falhar (rápido no mobile).
// Upgrade: stale-while-revalidate se a latência offline incomodar.
self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok && networkResponse.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch (error) {
        return (
          (await caches.match(request)) ||
          (await caches.match("/simple-scale/")) ||
          Response.error()
        );
      }
    })(),
  );
});
