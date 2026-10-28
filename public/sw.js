const CACHE = "kalorisehat-v10";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css?v=10",
  "./js/app.js?v=10",
  "./js/config.js?v=10",
  "./js/db.js?v=10",
  "./js/ai.js?v=10",
  "./js/fcm.js?v=10",
  "./js/notifications.js?v=10",
  "./js/utils.js?v=10",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

/* =========================================================
   Firebase Cloud Messaging (push latar belakang)
   Konfigurasi Firebase dikirim dari halaman lewat query string:
   sw.js?fcm=<base64url(JSON config)>
   ========================================================= */

const params = new URLSearchParams(self.location.search);
const fcmConfig = params.get("fcm");

if (fcmConfig) {
  try {
    const config = JSON.parse(decodeBase64Url(fcmConfig));
    importScripts("https://www.gstatic.com/firebasejs/11.0.1/firebase-app-compat.js");
    importScripts("https://www.gstatic.com/firebasejs/11.0.1/firebase-messaging-compat.js");

    firebase.initializeApp(config);
    const messaging = firebase.messaging();
    self.__FCM_READY__ = true;

    messaging.onBackgroundMessage((payload) => {
      const data = payload.data || {};
      const notification = payload.notification || {};
      const title = data.title || notification.title || "⏰ Pengingat KaloriSehat";
      const body = data.body || notification.body || "";

      self.registration.showNotification(title, {
        body,
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png",
        tag: data.tag || "kalorisehat-reminder",
        renotify: true,
        data: { url: data.url || "./" }
      });
    });
  } catch (error) {
    console.warn("FCM service worker gagal disiapkan:", error);
  }
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

/* =========================================================
   PWA cache & offline
   ========================================================= */

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((error) => console.warn("SW install gagal:", error))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
  );
});

/* =========================================================
   Klik notifikasi → fokus / buka aplikasi
   ========================================================= */

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = event.notification.data?.url || "./";
  const targetUrl = new URL(target, self.registration.scope).href;

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientList) {
      if ("focus" in client) {
        await client.focus();
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
