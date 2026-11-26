/* Drop — service worker.
 *
 * Strategy:
 *  - Navigations: network first, cached index.html as the offline fallback.
 *  - Application shell (css/js/manifest/icons/fonts): network first so a
 *    redeploy always reaches returning visitors, with the cache as the
 *    offline fallback.
 *  - Everything else (including Netlify's injected scripts) is left to the
 *    browser, so platform-injected assets are never cached or intercepted.
 *
 * Bump CACHE_VERSION whenever a shipped asset changes. The version is what
 * invalidates the previous shell for everyone.
 */
const CACHE_VERSION = "v13";
const CACHE_NAME = `drop-shell-${CACHE_VERSION}`;

const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/catalog.js",
  "/catalog.json",
  "/manifest.json",
  "/icons/drop-icon.svg",
  "/icons/drop-maskable.svg",
  "/icons/drop-192.png",
  "/icons/drop-512.png",
  "/icons/drop-maskable-512.png",
  "/icons/apple-touch-icon-180.png",
  "/fonts/plus-jakarta-sans-latin.woff2",
  "/fonts/plus-jakarta-sans-latin-ext.woff2"
];

const SHELL_PATHS = new Set(APP_SHELL.map(path => new URL(path, self.location.origin).pathname));

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Cache each entry individually: one missing asset must not abort the
    // whole shell and leave the worker stuck on "installing".
    await Promise.all(APP_SHELL.map(async path => {
      try {
        const response = await fetch(path, { cache: "reload" });
        if (response && response.ok) await cache.put(path, response);
      } catch (error) {
        console.warn("Shell asset could not be precached:", path);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

/* Network first, cache fallback. Never rejects. */
async function networkFirst(request, fallbackPath) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = (await cache.match(request)) || (fallbackPath ? await cache.match(fallbackPath) : null);
    return cached || new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Netlify injects its own scripts at the edge. They are not ours to cache
  // and must never be served from a stale shell.
  if (url.pathname.startsWith("/.netlify/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/index.html"));
    return;
  }

  if (!SHELL_PATHS.has(url.pathname)) return;
  event.respondWith(networkFirst(request));
});
