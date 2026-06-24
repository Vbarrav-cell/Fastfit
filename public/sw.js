// ════════════════════════════════════════════════════════════════
//  Service Worker de FastFit
//  Permite que la app sea instalable y cargue rápido.
//  Estrategia: "network-first" para que siempre uses la versión más
//  reciente cuando hay internet, y un caché de respaldo del armazón.
// ════════════════════════════════════════════════════════════════
const CACHE = "fastfit-v1";
const SHELL = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  // Nunca cachear las llamadas a la IA / API: siempre van por la red.
  if (request.url.includes("/api/")) return;
  if (request.method !== "GET") return;

  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match("/index.html")))
  );
});
