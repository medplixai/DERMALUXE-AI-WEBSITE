/* DermaLuxe Staff — service worker.
 *
 * Scope is the whole origin because /staff.html lives at the root, but this
 * worker deliberately touches almost nothing: patient pages, every /api/ call
 * and anything it does not recognise are passed straight through to the
 * network without respondWith(). Only the staff shell and its static assets
 * are cached.
 *
 * Bump CACHE on every release — activate() deletes anything with another name,
 * and the page shows an "update ready" prompt when a new worker takes over.
 */
const CACHE = "dl-staff-v1";

// The shell: enough to paint a working dashboard with no network.
const SHELL = [
  "/staff.html",
  "/offline.html",
  "/manifest.webmanifest",
  "/assets/app/icon-192.png",
  "/assets/app/icon-512.png",
  "/assets/logo.png",
];

const isApi = (url) => url.pathname.startsWith("/api/");
const isStaffPage = (url) => url.pathname === "/staff.html" || url.pathname === "/academy-join.html";
// Course material is served through /api/material and can be megabytes —
// never let it into the shell cache.
const isAsset = (url) =>
  url.pathname.startsWith("/assets/") && !url.pathname.startsWith("/assets/academy/material/");
const CACHEABLE_MAX = 2 * 1024 * 1024;
function cacheable(res) {
  if (!res || !res.ok || res.type === "opaque") return !!(res && res.type === "opaque");
  if (/no-store/i.test(res.headers.get("cache-control") || "")) return false;
  const len = Number(res.headers.get("content-length") || 0);
  return !(len && len > CACHEABLE_MAX);
}
const isFont = (url) =>
  url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll rejects the whole batch if one file 404s; add them one by one.
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page asks for this after the user taps "Update" on the prompt.
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then((res) => { if (cacheable(res)) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  return hit || (await net) || Response.error();
}

// Shell: try the network so a deploy lands immediately, fall back to the last
// good copy, and only then to the offline page.
async function shellFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (cacheable(res)) cache.put("/staff.html", res.clone());
    return res;
  } catch (e) {
    return (await cache.match(req)) || (await cache.match("/staff.html")) ||
           (await cache.match("/offline.html")) || Response.error();
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                 // never touch writes
  let url;
  try { url = new URL(req.url); } catch (x) { return; }

  if (isApi(url)) return;                           // live data only, never cached
  if (req.mode === "navigate") {
    if (isStaffPage(url)) e.respondWith(shellFirst(req));
    return;                                         // patient pages: untouched
  }
  if (url.origin === self.location.origin && isAsset(url)) e.respondWith(staleWhileRevalidate(req));
  else if (isFont(url)) e.respondWith(staleWhileRevalidate(req));
});
