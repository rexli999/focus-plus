const CACHE_NAME = "focusplus-cache-v27";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./sound-config.js",
  "./app.js",
  "./manifest.webmanifest",
  "./focusplus_icon.ico",
  "./click_sound/timer_alarm.wav",
  "./click_sound/click_sound2.wav",
  "./click_sound/click_sound3.wav",
  "./click_sound/click_sound4.wav",
  "./click_sound/click_sound5.wav",
  "./click_sound/cheerful_check_check2.wav",
  "./click_sound/cheerful_check_check1.wav"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key === CACHE_NAME ? Promise.resolve() : caches.delete(key))))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
