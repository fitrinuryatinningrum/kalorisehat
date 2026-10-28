import { CONFIG, isFirebaseConfigured } from "./config.js?v=10";
import { store } from "./db.js?v=10";
import { showNotification } from "./notifications.js?v=10";

let messaging = null;
let currentToken = "";
let foregroundBound = false;
const TOKEN_KEY = "kalorisehat.fcmToken";

/**
 * FCM hanya dipakai jika:
 * - Firebase dikonfigurasi,
 * - VAPID key diisi,
 * - browser mendukung service worker + Notification.
 */
export function fcmSupported() {
  return Boolean(CONFIG.fcm?.vapidKey) &&
    Boolean(CONFIG.firebase?.messagingSenderId) &&
    isFirebaseConfigured() &&
    "serviceWorker" in navigator &&
    typeof Notification !== "undefined";
}

/**
 * URL service worker. Konfigurasi Firebase dititipkan lewat query string
 * agar file sw.js tetap statis (tidak perlu diedit manual).
 */
export function messagingSwUrl() {
  if (!CONFIG.fcm?.vapidKey || !CONFIG.firebase?.messagingSenderId || !isFirebaseConfigured()) {
    return "sw.js";
  }
  return `sw.js?fcm=${base64UrlEncode(JSON.stringify(CONFIG.firebase))}`;
}

function base64UrlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function initFcm() {
  if (!fcmSupported()) return { status: "unsupported" };
  if (store.mode !== "firebase") return { status: "demo" };
  if (Notification.permission !== "granted") return { status: "permission" };

  const registration = await navigator.serviceWorker.register(messagingSwUrl(), { scope: "./" });
  await waitForActive(registration);

  const [appMod, messagingMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/11.0.1/firebase-messaging.js")
  ]);

  const supported = await messagingMod.isSupported().catch(() => false);
  if (!supported) return { status: "unsupported" };

  if (!messaging) {
    const app = appMod.getApps().some((item) => item.name === "fcm")
      ? appMod.getApp("fcm")
      : appMod.initializeApp(CONFIG.firebase, "fcm");
    messaging = messagingMod.getMessaging(app);
  }

  if (!foregroundBound) {
    foregroundBound = true;
    messagingMod.onMessage(messaging, (payload) => {
      // Saat aplikasi terlihat, pengingat lokal yang menampilkan notifikasi.
      // Ini mencegah notifikasi ganda ketika FCM dan timer lokal sama-sama aktif.
      if (document.visibilityState === "visible") return;

      const data = payload.data || {};
      showNotification(data.title || "⏰ Pengingat KaloriSehat", {
        body: data.body || "",
        tag: data.tag || "fcm-reminder",
        data: { url: data.url || "./" }
      });
    });
  }

  const token = await messagingMod.getToken(messaging, {
    vapidKey: CONFIG.fcm.vapidKey,
    serviceWorkerRegistration: registration
  });

  if (!token) return { status: "error", error: "Token FCM tidak tersedia." };

  currentToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage bisa diblokir di mode privasi; abaikan.
  }
  await store.saveFcmToken(token);
  return { status: "ok", token };
}

export async function detachFcm() {
  let token = currentToken;
  if (!token) {
    try {
      token = localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      token = "";
    }
  }
  if (!token) return;

  currentToken = "";
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // abaikan
  }

  try {
    await store.removeFcmToken(token);
  } catch (error) {
    console.warn("Gagal menghapus token FCM:", error);
  }
}

async function waitForActive(registration) {
  const desired = new URL(messagingSwUrl(), location.href).href;

  if (registration.active?.scriptURL === desired) return registration;

  const worker = registration.installing || registration.waiting;
  if (!worker) return registration;

  await new Promise((resolve) => {
    const finish = () => resolve();
    if (worker.state === "activated") {
      finish();
      return;
    }
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") finish();
    });
    setTimeout(finish, 8000);
  });

  return registration;
}
