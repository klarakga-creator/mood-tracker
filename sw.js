// Offline support. Files come from the network when online (so updates show up
// the next time the app opens) and from this cache when offline.
const CACHE = "mood-v18";
const SHELL = ["./", "index.html", "styles.css", "app.js", "sync.js", "push.js", "config.js", "vendor/supabase.js", "vendor/jspdf.umd.min.js", "report-pdf.js", "fonts/DMSans-Regular.ttf", "fonts/DMSans-SemiBold.ttf", "fonts/DMSans-Bold.ttf", "manifest.webmanifest",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("index.html")))
  );
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
