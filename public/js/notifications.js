import { dateKey } from "./utils.js?v=10";

const ICON = "icons/icon-192.png";
let timer = null;
let scheduleProvider = () => [];
let listenersBound = false;
let skipWhenHidden = false;
const firedKeys = new Set();

const BODY_BY_TYPE = {
  makan: "Waktunya makan. Jangan lupa catat makananmu di KaloriSehat.",
  olahraga: "Waktunya bergerak! Catat olahragamu setelah selesai.",
  minum_air: "Waktunya minum air. Tambahkan catatan air minummu.",
  tidur: "Sudah waktunya istirahat. Tidur cukup membantu pemulihan.",
  lainnya: "Pengingat jadwal KaloriSehat."
};

export function notifSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notifPermission() {
  if (!notifSupported()) return "unsupported";
  return Notification.permission;
}

export async function enableNotifications() {
  if (!notifSupported()) throw new Error("Browser ini tidak mendukung notifikasi.");
  return Notification.requestPermission();
}

export async function showNotification(title, options = {}) {
  if (!notifSupported() || Notification.permission !== "granted") return false;

  const payload = {
    icon: ICON,
    badge: ICON,
    ...options
  };

  try {
    if ("serviceWorker" in navigator) {
      const registration = await withTimeout(navigator.serviceWorker.ready, 2500);
      if (registration && typeof registration.showNotification === "function") {
        await registration.showNotification(title, payload);
        return true;
      }
    }
  } catch (error) {
    console.warn("Notifikasi via service worker gagal:", error);
  }

  try {
    new Notification(title, payload);
    return true;
  } catch (error) {
    console.warn("Notifikasi gagal:", error);
    return false;
  }
}

export async function testNotification() {
  return showNotification("🔔 Notifikasi uji", {
    body: "Pengingat KaloriSehat siap digunakan.",
    tag: "uji-notifikasi"
  });
}

export function startReminderLoop(provider, intervalMs = 20000, options = {}) {
  scheduleProvider = provider;
  skipWhenHidden = Boolean(options.skipWhenHidden);
  if (timer) clearInterval(timer);
  timer = setInterval(checkSchedules, intervalMs);

  if (!listenersBound) {
    listenersBound = true;
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) checkSchedules();
    });
    window.addEventListener("focus", checkSchedules);
  }

  checkSchedules();
}

export function stopReminderLoop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function checkSchedules() {
  if (!notifSupported() || Notification.permission !== "granted") return;
  // Saat FCM aktif, latar belakang ditangani push server; timer lokal
  // hanya untuk aplikasi yang sedang terlihat agar tidak dobel.
  if (skipWhenHidden && document.hidden) return;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const today = dateKey(now);

  for (const schedule of scheduleProvider()) {
    if (!schedule || schedule.aktif === false) continue;

    const time = String(schedule.waktu || "");
    if (!time.includes(":")) continue;

    const [hours, minutes] = time.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) continue;

    const scheduledMinutes = hours * 60 + minutes;
    const delay = currentMinutes - scheduledMinutes;

    // Beri toleransi 5 menit agar pengingat tetap muncul saat timer browser
    // tertunda (mis. tab sempat di latar belakang).
    if (delay < 0 || delay > 5) continue;

    const key = `${today}|${schedule.id}|${schedule.waktu}`;
    if (firedKeys.has(key)) continue;
    firedKeys.add(key);

    showNotification(`⏰ ${schedule.label}`, {
      body: BODY_BY_TYPE[schedule.tipe] || BODY_BY_TYPE.lainnya,
      tag: `jadwal-${schedule.id}`,
      renotify: true,
      data: { scheduleId: schedule.id }
    });
  }

  if (firedKeys.size > 400) firedKeys.clear();
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timerId = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timerId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timerId);
        reject(error);
      }
    );
  });
}
