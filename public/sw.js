// LawOffice OS Service Worker — Strict Public Assets Only Allowlist (T04)
const CACHE_NAME = "lawoffice-public-v1";

const STATIC_ALLOWLIST = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable.png",
  "/fonts/noto-sans-arabic-400.woff2",
  "/fonts/noto-sans-arabic-latin.woff2"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ALLOWLIST);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // STRICT ZERO-TRUST: Never intercept or cache non-GET requests
  if (event.request.method !== "GET") {
    return;
  }

  // STRICT ZERO-TRUST: Never cache or intercept any API endpoints
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // STRICT ZERO-TRUST: Never cache auth or sensitive pages
  if (
    url.pathname.startsWith("/login") ||
    url.pathname.startsWith("/verify") ||
    url.pathname.startsWith("/settings/")
  ) {
    return;
  }

  // Static public asset matching allowlist or Next.js static chunks
  const isStaticAsset =
    STATIC_ALLOWLIST.includes(url.pathname) ||
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/fonts/");

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          return cached;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Navigational HTML fallback
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match("/offline.html");
      })
    );
  }
});
