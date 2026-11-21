// Offline-first: files come straight from this cache so the app opens instantly,
// and a fresh copy is fetched in the background (updates show on the next open).
const CACHE = "mood-v28";
const SHELL = ["./", "index.html", "styles.css", "app.js", "sync.js", "push.js", "config.js", "vendor/supabase.js", "vendor/jspdf.umd.min.js", "report-pdf.js", "fonts/DMSans-Regular.ttf", "fonts/DMSans-SemiBold.ttf", "fonts/DMSans-Bold.ttf", "fonts/DMSans-Regular.woff2", "fonts/DMSans-SemiBold.woff2", "fonts/DMSans-Bold.woff2", "manifest.webmanifest",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  const fresh = fetch(req, { cache: "no-cache" }).then((res) => {
    if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy))); }
    return res;
  });
  e.waitUntil(fresh.catch(() => {}));
  e.respondWith(caches.match(req, { ignoreSearch: req.mode === "navigate" })
    .then((hit) => hit || fresh.catch(() => caches.match("index.html"))));
});

// Push notifications (used once the reminder server is set up).
self.addEventListener("push", (e) => {
  let data = { title: "How was today?", body: "Take a moment to rate your mood." };
  try { if (e.data) data = Object.assign(data, e.data.json()); } catch (_) {}
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "icons/icon-192.png", badge: "icons/icon-192.png" }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow("./");
  }));
});
