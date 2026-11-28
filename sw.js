"use strict";
// Service worker: guarda el juego entero al instalarse para que funcione sin conexión.
// Responde primero desde la caché y, mientras tanto, pide la versión nueva a la red para
// la próxima vez. Al publicar, VERSION pasa a ser el commit: cambia este archivo, el
// navegador instala la versión nueva y la página ofrece recargar.

const VERSION = "dev";
const CACHE = `carreteras-neuronales-${VERSION}`;

// Todo lo que necesita el juego. Las rutas son relativas a este archivo, así vale igual
// en la raíz de un servidor local que en /carreteras-neuronales/ de GitHub Pages.
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "fonts/fonts.css",
  "fonts/overpass-latin-400-normal.woff2",
  "fonts/overpass-latin-600-normal.woff2",
  "fonts/overpass-latin-800-normal.woff2",
  "fonts/overpass-latin-ext-400-normal.woff2",
  "fonts/overpass-latin-ext-600-normal.woff2",
  "fonts/overpass-latin-ext-800-normal.woff2",
  "fonts/overpass-mono-latin-400-normal.woff2",
  "fonts/overpass-mono-latin-600-normal.woff2",
  "fonts/overpass-mono-latin-ext-400-normal.woff2",
  "fonts/overpass-mono-latin-ext-600-normal.woff2",
  "icons/favicon.svg",
  "icons/favicon-32.png",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "js/math.js",
  "js/graph.js",
  "js/world.js",
  "js/network.js",
  "js/car.js",
  "js/traffic.js",
  "js/scenery.js",
  "js/trails.js",
  "js/view3d-geometry.js",
  "js/view3d.js",
  "js/view3d-cars.js",
  "js/view3d-fx.js",
  "js/view3d-city.js",
  "js/maps.js",
  "js/real-maps.js",
  "js/sim.js",
  "js/audio.js",
  "js/worker.js",
  "js/app/state.js",
  "js/app/training.js",
  "js/app/draw.js",
  "js/app/panels.js",
  "js/app/camera-gestures.js",
  "js/app/drive.js",
  "js/app/maps-panel.js",
  "js/app/pwa.js",
  "js/app/main.js",
  "vendor/three.min.js",
];

self.addEventListener("install", (event) => {
  // cache: "reload" salta la caché HTTP del navegador: se guarda lo que hay publicado.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
  );
  // La primera vez no hay versión anterior que esperar; si la hay, la nueva espera a que
  // la página acepte recargar (mensaje "skipWaiting").
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("carreteras-neuronales-") && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Las páginas se sirven siempre con el index.html guardado (con o sin ?parámetros).
  const key = request.mode === "navigate" ? new URL("index.html", self.registration.scope).href : request;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(key, { ignoreSearch: request.mode === "navigate" });
      const fresh = fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") cache.put(key, response.clone());
          return response;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(fresh); // revalida en segundo plano
        return cached;
      }
      return (await fresh) || Response.error();
    })()
  );
});
