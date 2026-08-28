// Tally service worker
//
// Strategy:
// - Never touch non-GET requests (POST/PUT/PATCH/DELETE) — always go to the network.
//   This keeps writes (e.g. Supabase API calls, mutations) out of the cache entirely.
// - Never cache cross-origin requests (e.g. Supabase) — only same-origin app assets.
// - Pages (navigations): network-first, falling back to cache when offline.
// - Static assets (_next/static, images, icons, manifest): cache-first for speed,
//   populating the cache on first fetch.

const CACHE_NAME = "tally-cache-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// `next dev` reuses the same /_next/static/ filenames across rebuilds, so
// cache-first would pin the first bundle forever and every code change would
// look like it did nothing. Production filenames are content-hashed, so they
// stay safe to treat as immutable.
const IS_LOCALHOST = ["localhost", "127.0.0.1", "[::1]"].includes(
  self.location.hostname
);

function isStaticAsset(url) {
  if (url.pathname.startsWith("/_next/static/")) return !IS_LOCALHOST;
  return (
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/icon.svg" ||
    /\.(?:png|jpg|jpeg|svg|ico|webp|woff2?)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only ever handle safe, same-origin GET requests. Everything else
  // (POST/PUT/PATCH/DELETE, cross-origin calls like Supabase) passes straight
  // through to the network untouched.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isStaticAsset(url)) {
    // Cache-first for static assets.
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((response) => {
              if (response && response.ok) {
                cache.put(request, response.clone());
              }
              return response;
            })
        )
      )
    );
    return;
  }

  if (request.mode === "navigate") {
    // Network-first for page navigations, falling back to cache when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
    );
  }
});
