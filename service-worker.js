// Keeps the app opening offline. Every file is fetched fresh from the server whenever there is a
// connection, so a release shows up on the very next open. The saved copy is only the offline fallback.
// Server calls to Google are never cached.
const VERSION = "coc-igbogbo-v4";
const SHELL = [
  "./", "index.html", "styles.css", "manifest.json",
  "js/core.js", "js/pwa.js", "js/auth.js", "js/views.js", "js/admin.js", "js/main.js",
  "logo.png", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "favicon.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();   // a new version takes over straight away instead of waiting for every tab to close
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      Promise.all(SHELL.map((url) => fetch(url, { cache: "reload" }).then((r) => r.ok && cache.put(url, r)).catch(() => {})))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req, { cache: "no-cache" }).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req.mode === "navigate" ? "index.html" : req, copy));
      }
      return res;
    }).catch(() =>
      caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined))
    )
  );
});
