const STATIC_CACHE = "gold-rate-cache-v1";
const API_CACHE = "gold-rate-api-cache-v1";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/icons/favicon.ico",
  "/icons/favicon-32x32.png",
  "/icons/favicon-16x16.png",
  "/icons/apple-touch-icon.png",
  "/icons/android-chrome-192x192.png",
  "/icons/android-chrome-512x512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== API_CACHE)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function isApiJson(url) {
  return (
    url.pathname.endsWith("/slabs.json") ||
    url.pathname.endsWith("/cities.json") ||
    url.pathname.endsWith("/city-slab-map.json")
  );
}

function isStaticRequest(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;

  return (
    url.pathname === "/" ||
    url.pathname === "/index.html" ||
    url.pathname === "/style.css" ||
    url.pathname === "/app.js" ||
    url.pathname === "/manifest.json" ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/cities/")
  );
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Network-first for API JSON endpoints
  if (isApiJson(url)) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const cloned = response.clone();
          caches.open(API_CACHE).then(cache => cache.put(request, cloned));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for static assets and pages
  if (isStaticRequest(request, url)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          const cloned = response.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(request, cloned));
          return response;
        });
      })
    );
    return;
  }
});
