const CACHE_NAME = "trv-cache-v12";

const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",

  "./icons/icon-120.png",
  "./icons/icon-152.png",
  "./icons/icon-167.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",

  //бэк
  "./assets/bg-comic-1.jpg",

  // 20 картинок сторон:
  "./img/trv_tile_1a.jpg",
  "./img/trv_tile_1b.jpg",
  "./img/trv_tile_2a.jpg",
  "./img/trv_tile_2b.jpg",
  "./img/trv_tile_3a.jpg",
  "./img/trv_tile_3b.jpg",
  "./img/trv_tile_4a.jpg",
  "./img/trv_tile_4b.jpg",
  "./img/trv_tile_5a.jpg",
  "./img/trv_tile_5b.jpg",
  "./img/trv_tile_6a.jpg",
  "./img/trv_tile_6b.jpg",
  "./img/trv_tile_7a.jpg",
  "./img/trv_tile_7b.jpg",
  "./img/trv_tile_8a.jpg",
  "./img/trv_tile_8b.jpg",
  "./img/trv_tile_9a.jpg",
  "./img/trv_tile_9b.jpg",
  "./img/trv_tile_10a.jpg",
  "./img/trv_tile_10b.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return resp;
        })
        .catch(() => caches.match("./index.html"));
    })
  );

});









