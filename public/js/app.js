import { CONFIG } from "./config.js?v=10";
import { AUTH_NOTICE_KEY, store } from "./db.js?v=10";
import { aiLabel, aiMode, analyzeFood, prepareImage } from "./ai.js?v=10";
import { detachFcm, fcmSupported, initFcm, messagingSwUrl } from "./fcm.js?v=10";
import { dateKey, escapeHtml, fmt, formatSleep, num } from "./utils.js?v=10";
import {
  enableNotifications,
  notifPermission,
  notifSupported,
  startReminderLoop,
  stopReminderLoop,
  testNotification
} from "./notifications.js?v=10";

const ACTIVITIES = [
  { key: "jalan", label: "Jalan kaki", met: 3.5 },
  { key: "lari", label: "Berlari", met: 8.3 },
  { key: "sepeda", label: "Bersepeda", met: 7.5 },
  { key: "renang", label: "Berenang", met: 6.0 },
  { key: "gym", label: "Latihan beban", met: 5.0 },
  { key: "yoga", label: "Yoga", met: 2.5 },
  { key: "badminton", label: "Badminton", met: 5.5 },
  { key: "futsal", label: "Futsal", met: 7.0 },
  { key: "skipping", label: "Lompat tali", met: 10.0 },
  { key: "dansa", label: "Dansa", met: 4.8 },
  { key: "rumah", label: "Aktivitas rumah", met: 3.0 }
];

const ICONS = {
  makan: "🍽️",
  olahraga: "🏃",
  minum_air: "💧",
  tidur: "😴",
  lainnya: "📌"
};

const AUTH_ERRORS = {
  "auth/invalid-email": "Format email tidak valid.",
  "auth/missing-password": "Password wajib diisi.",
  "auth/invalid-credential": "Email atau password salah.",
  "auth/user-not-found": "Akun tidak ditemukan. Pendaftaran hanya melalui undangan.",
  "auth/wrong-password": "Password salah.",
  "auth/email-already-in-use": "Email sudah terdaftar. Silakan masuk.",
  "auth/weak-password": "Password minimal 6 karakter.",
  "auth/popup-closed-by-user": "Jendela Google ditutup sebelum selesai.",
  "auth/unauthorized-domain": "Domain ini belum diizinkan di Firebase Auth.",
  "auth/operation-not-allowed": "Metode login ini belum diaktifkan di Firebase.",
  "permission-denied": "Akun ini belum diizinkan. Pendaftaran hanya melalui undangan."
};

const state = {
  date: dateKey(),
  profile: null,
  foods: [],
  activities: [],
  health: {},
  schedules: [],
  pendingImage: null,
  pendingThumbUrl: "",
  fcmActive: false
};

let bootedUid = null;
let toastTimer = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
  return element;
}

/* =========================================================
   Inisialisasi
   ========================================================= */

init();

async function init() {
  $("#date-input").value = state.date;
  populateActivityTypes();
  bindNavigation();
  bindForms();
  bindLists();
  bindPhoto();
  bindModals();
  bindAuth();
  bindNotifications();
  bindDataButtons();
  updateAiPill();

  try {
    await store.init(handleAuthChange);
  } catch (error) {
    console.error(error);
    showToast(`Gagal terhubung ke Firebase: ${error.message}`, "error");
  }

  if (store.mode === "demo") {
    hideAuth();
    await boot();
  } else if (!store.currentUser()) {
    showAuth();
  }

  registerServiceWorker();
  updateNotifPill();
}

function handleAuthChange(user) {
  if (!user) {
    bootedUid = null;
    stopReminderLoop();
    state.fcmActive = false;
    state.schedules = [];
    updateNotifPill();
    showAuth();
    return;
  }
  hideAuth();
  if (bootedUid === user.uid) return;
  bootedUid = user.uid;
  boot().catch((error) => {
    console.error(error);
    showToast(`Gagal memuat data: ${error.message}`, "error");
  });
}

async function boot() {
  state.profile = await store.getProfile();
  state.date = dateKey();
  $("#date-input").value = state.date;

  $("#mode-badge").textContent = store.mode === "demo" ? "Mode Demo · data lokal" : "Firebase · cloud sync";
  $("#store-mode-pill").textContent = store.mode === "demo" ? "Lokal" : "Cloud";
  $("#btn-reset").classList.toggle("hidden", store.mode !== "demo");
  $("#btn-logout").classList.toggle("hidden", store.mode !== "firebase");

  fillProfileForm();
  await refreshAll();
  updateActivityPreview();
  updateNotifPill();
  await setupReminders();
}

async function refreshAll() {
  const [foods, activities, health, schedules] = await Promise.all([
    store.listFoods(state.date),
    store.listActivities(state.date),
    store.getHealth(state.date),
    store.listSchedules()
  ]);

  state.foods = foods;
  state.activities = activities;
  state.health = health || {};
  state.schedules = schedules;

  renderDashboard();
  renderFoods();
  renderActivities();
  renderSchedules();
}

async function refreshDate() {
  const [foods, activities, health] = await Promise.all([
    store.listFoods(state.date),
    store.listActivities(state.date),
    store.getHealth(state.date)
  ]);

  state.foods = foods;
  state.activities = activities;
  state.health = health || {};

  renderDashboard();
  renderFoods();
  renderActivities();
}

/* =========================================================
   Navigasi
   ========================================================= */

function bindNavigation() {
  $$("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => go(button.dataset.nav));
  });
  $$("[data-goto]").forEach((button) => {
    button.addEventListener("click", () => go(button.dataset.goto));
  });
}

function go(name) {
  $$(".screen").forEach((screen) => {
    screen.classList.toggle("active", screen.id === `screen-${name}`);
  });
  $$(".nav-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.nav === name);
  });
  window.scrollTo(0, 0);
}

/* =========================================================
   Render dashboard
   ========================================================= */

function renderDashboard() {
  const target = num(state.profile?.target) || CONFIG.defaultTarget;
  const consumed = sum(state.foods, "kalori");
  const burned = sum(state.activities, "kalori_terbakar");
  // Kalori keluar hanya dicatat sebagai aktivitas, tidak menambah jatah kalori harian.
  const budget = target;
  const remaining = Math.round(budget - consumed);
  const energyBalance = Math.round(consumed - burned);
  const over = Math.max(0, Math.round(consumed - target));
  const redeemed = Math.min(burned, over);
  const sinLeft = Math.max(0, over - burned);
  const exerciseLeft = Math.max(0, burned - over);
  const progress = Math.min(1, consumed / Math.max(1, budget));

  const circumference = 2 * Math.PI * 52;
  const ring = $("#calorie-ring");
  ring.style.strokeDasharray = `${circumference}`;
  ring.style.strokeDashoffset = `${circumference * (1 - progress)}`;
  $("#hero-card").classList.toggle("over", remaining < 0);

  $("#remaining-cal").textContent = fmt(remaining);
  setText("#energy-balance", `Saldo energi: ${fmt(energyBalance)} kkal`);
  $("#total-in").textContent = fmt(consumed);
  $("#total-out").textContent = fmt(burned);
  $("#total-target").textContent = fmt(target);

  const redeemCard = $("#redeem-card");
  if (redeemCard) {
    const redeemPill = $("#redeem-pill");
    const hasSin = sinLeft > 0;
    redeemCard.classList.toggle("has-sin", hasSin);
    redeemCard.classList.toggle("clear", !hasSin);
    if (redeemPill) {
      redeemPill.classList.remove("ok", "warn", "bad");
      redeemPill.classList.add(hasSin ? "warn" : "ok");
      redeemPill.textContent = over <= 0 ? "Aman" : hasSin ? "Belum lunas" : "Lunas";
    }
    setText("#redeem-over", `${fmt(over)} kkal`);
    setText("#redeem-paid", `${fmt(redeemed)} kkal`);
    setText("#redeem-left", `${fmt(sinLeft)} kkal`);
    const redeemFill = $("#redeem-fill");
    if (redeemFill) {
      redeemFill.style.width = over > 0 ? `${Math.min(100, (redeemed / over) * 100)}%` : "100%";
    }

    let note = "Belum ada kelebihan kalori. Terus jaga asupanmu.";
    if (over <= 0) {
      note = burned > 0
        ? `Belum ada kelebihan kalori. Kalori keluar ${fmt(burned)} kkal tetap tercatat.`
        : note;
    } else if (!hasSin) {
      note = exerciseLeft > 0
        ? `Kelebihan ${fmt(over)} kkal sudah tertutup. Sisa kalori keluar ${fmt(exerciseLeft)} kkal (tidak menambah kkal tersisa).`
        : `Kelebihan ${fmt(over)} kkal sudah tertutup oleh olahraga.`;
    } else {
      note = `Kurangi ${fmt(sinLeft)} kkal lagi atau tambah olahraga untuk melunasi.`;
    }
    setText("#redeem-note", note);
  }
  $("#health-date-label").textContent = prettyDate(state.date);

  renderMacros(target);
  renderHealth();
  renderDashboardSchedules();
  renderDashboardFoods();
}

function renderMacros(target) {
  const totals = { protein: 0, karbohidrat: 0, lemak: 0 };
  state.foods.forEach((food) => {
    totals.protein += num(food.protein);
    totals.karbohidrat += num(food.karbohidrat);
    totals.lemak += num(food.lemak);
  });

  const goals = {
    protein: Math.max(1, (target * 0.25) / 4),
    karbohidrat: Math.max(1, (target * 0.5) / 4),
    lemak: Math.max(1, (target * 0.25) / 9)
  };

  setMacro("protein", totals.protein, goals.protein);
  setMacro("carb", totals.karbohidrat, goals.karbohidrat);
  setMacro("fat", totals.lemak, goals.lemak);
}

function setMacro(key, value, goal) {
  $(`#macro-${key}-val`).textContent = `${Math.round(value)}/${Math.round(goal)} g`;
  const width = Math.min(100, (value / goal) * 100);
  $(`#macro-${key}-bar`).style.width = `${width}%`;
}

function renderHealth() {
  const health = state.health || {};
  const water = num(health.air_ml);
  const weight = num(health.berat) || num(state.profile?.berat);

  $("#health-water").textContent = `${fmt(water)} ml`;
  $("#water-fill").style.width = `${Math.min(100, (water / CONFIG.waterTargetMl) * 100)}%`;
  $("#water-note").textContent =
    `Target air: ${fmt(CONFIG.waterTargetMl)} ml` + (water >= CONFIG.waterTargetMl ? " · target tercapai 🎉" : "");
  $("#health-weight").textContent = weight ? `${weight} kg` : "- kg";
  $("#health-sleep").textContent = formatSleep(health.tidur, health.bangun);
}

function renderDashboardSchedules() {
  const list = $("#dashboard-schedule-list");
  const active = state.schedules.filter((schedule) => schedule.aktif !== false);

  if (!active.length) {
    list.innerHTML = `<li class="empty">Belum ada jadwal. Tambahkan pengingat harianmu.</li>`;
    return;
  }

  list.innerHTML = active
    .map(
      (schedule) => `
      <li class="schedule-item">
        <span class="time">${escapeHtml(schedule.waktu)}</span>
        <span class="sched-icon">${scheduleIcon(schedule.tipe)}</span>
        <span class="sched-label">${escapeHtml(schedule.label)}</span>
      </li>`
    )
    .join("");
}

function renderDashboardFoods() {
  const list = $("#dashboard-food-list");
  if (!state.foods.length) {
    list.innerHTML = `<li class="empty">Belum ada makanan tercatat untuk tanggal ini.</li>`;
    return;
  }

  list.innerHTML = state.foods
    .slice(-4)
    .reverse()
    .map(
      (food) => `
      <li class="log-item">
        ${safePhotoSrc(food.foto) ? `<img class="log-thumb" src="${escapeHtml(safePhotoSrc(food.foto))}" alt="">` : `<div class="log-thumb"></div>`}
        <div class="log-main">
          <strong>${escapeHtml(food.nama)}</strong>
          <span>${num(food.porsi) ? `${fmt(food.porsi)} g · ` : ""}${fmt(food.protein)}P / ${fmt(food.karbohidrat)}K / ${fmt(food.lemak)}L</span>
        </div>
        <span class="kcal">${fmt(food.kalori)} kkal</span>
      </li>`
    )
    .join("");
}

/* =========================================================
   Render makanan
   ========================================================= */

function renderFoods() {
  const list = $("#food-list");
  const total = sum(state.foods, "kalori");
  $("#food-day-total").textContent = `${fmt(total)} kkal`;

  if (!state.foods.length) {
    list.innerHTML = `<li class="empty">Belum ada makanan. Ambil foto atau input manual di atas.</li>`;
    return;
  }

  list.innerHTML = state.foods
    .map(
      (food) => `
      <li class="log-item">
        ${safePhotoSrc(food.foto) ? `<img class="log-thumb" src="${escapeHtml(safePhotoSrc(food.foto))}" alt="">` : `<div class="log-thumb"></div>`}
        <div class="log-main">
          <strong>${escapeHtml(food.nama)}</strong>
          <span>${num(food.porsi) ? `${fmt(food.porsi)} g · ` : ""}${fmt(food.protein)}P / ${fmt(food.karbohidrat)}K / ${fmt(food.lemak)}L</span>
        </div>
        <span class="kcal">${fmt(food.kalori)} kkal</span>
        <button class="icon-btn" type="button" data-del-food="${escapeHtml(food.id)}" title="Hapus">🗑</button>
      </li>`
    )
    .join("");
}

/* =========================================================
   Render aktivitas
   ========================================================= */

function renderActivities() {
  const list = $("#activity-list");
  const total = sum(state.activities, "kalori_terbakar");
  $("#activity-day-total").textContent = `${fmt(total)} kkal`;

  if (!state.activities.length) {
    list.innerHTML = `<li class="empty">Belum ada olahraga tercatat untuk tanggal ini.</li>`;
    return;
  }

  list.innerHTML = state.activities
    .map(
      (activity) => `
      <li class="log-item">
        <span class="log-thumb activity-thumb">🏃</span>
        <div class="log-main">
          <strong>${escapeHtml(activity.jenis)}</strong>
          <span>${fmt(activity.durasi)} menit${num(activity.met) ? ` · ${escapeHtml(activity.met)} MET` : ""}</span>
        </div>
        <span class="kcal">${fmt(activity.kalori_terbakar)} kkal</span>
        <button class="icon-btn" type="button" data-del-activity="${escapeHtml(activity.id)}" title="Hapus">🗑</button>
      </li>`
    )
    .join("");
}

/* =========================================================
   Render jadwal
   ========================================================= */

function renderSchedules() {
  const list = $("#schedule-list");
  $("#schedule-count").textContent = String(state.schedules.length);

  if (!state.schedules.length) {
    list.innerHTML = `<li class="empty">Belum ada jadwal. Tambahkan pengingat pertamamu.</li>`;
    return;
  }

  list.innerHTML = state.schedules
    .map(
      (schedule) => `
      <li class="schedule-item">
        <span class="time">${escapeHtml(schedule.waktu)}</span>
        <span class="sched-icon">${scheduleIcon(schedule.tipe)}</span>
        <span class="sched-label">${escapeHtml(schedule.label)}</span>
        <label class="switch" title="Aktif / nonaktif">
          <input type="checkbox" data-sched-toggle="${escapeHtml(schedule.id)}" ${schedule.aktif !== false ? "checked" : ""}>
          <span></span>
        </label>
        <button class="icon-btn" type="button" data-del-sched="${escapeHtml(schedule.id)}" title="Hapus">🗑</button>
      </li>`
    )
    .join("");
}

/* =========================================================
   Form makanan
   ========================================================= */

function bindPhoto() {
  const drop = $("#photo-drop");
  const input = $("#photo-input");

  drop.addEventListener("click", () => input.click());

  input.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("Pilih file gambar (JPG/PNG).", "error");
      return;
    }

    try {
      setAnalyzeStatus("Menyiapkan foto…");
      const [large, thumb] = await Promise.all([
        prepareImage(file, 1024, 0.82),
        prepareImage(file, 256, 0.6)
      ]);

      state.pendingImage = large;
      state.pendingThumbUrl = thumb.dataUrl;

      $("#photo-preview").src = large.dataUrl;
      $("#photo-preview").classList.remove("hidden");
      $("#photo-placeholder").classList.add("hidden");
      $("#btn-analyze").disabled = false;
      $("#btn-clear-photo").disabled = false;
      setAnalyzeStatus("");
    } catch (error) {
      console.error(error);
      setAnalyzeStatus("");
      showToast("Gagal memproses foto. Coba foto lain.", "error");
    }
  });

  $("#btn-analyze").addEventListener("click", analyzePendingPhoto);
  $("#btn-clear-photo").addEventListener("click", resetFoodForm);
}

async function analyzePendingPhoto() {
  if (!state.pendingImage) return;

  const button = $("#btn-analyze");
  button.disabled = true;
  button.textContent = "Menganalisis…";
  setAnalyzeStatus(`Menghubungi AI (${aiLabel()})…`);

  try {
    const result = await analyzeFood(state.pendingImage);
    $("#food-name").value = result.nama;
    $("#food-portion").value = result.porsi || "";
    $("#food-cal").value = result.kalori || "";
    $("#food-protein").value = result.protein || "";
    $("#food-carb").value = result.karbohidrat || "";
    $("#food-fat").value = result.lemak || "";
    $("#food-form-mode").textContent = `Estimasi: ${aiLabel()}`;
    setAnalyzeStatus("Periksa hasil di bawah, sesuaikan bila perlu, lalu simpan.");
    $("#food-form").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    console.error(error);
    setAnalyzeStatus("");
    showToast(error.message || "Gagal menganalisis foto.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Analisis dengan AI";
  }
}

function resetFoodForm() {
  $("#food-form").reset();
  state.pendingImage = null;
  state.pendingThumbUrl = "";
  $("#photo-preview").src = "";
  $("#photo-preview").classList.add("hidden");
  $("#photo-placeholder").classList.remove("hidden");
  $("#btn-analyze").disabled = true;
  $("#btn-clear-photo").disabled = true;
  $("#food-form-mode").textContent = "Manual";
  setAnalyzeStatus("");
}

function setAnalyzeStatus(text) {
  $("#analyze-status").textContent = text;
}

function updateAiPill() {
  const mode = aiMode();
  const pill = $("#ai-status-pill");
  pill.textContent = aiLabel();
  pill.classList.toggle("warn", mode === "demo");
  pill.classList.toggle("ok", mode !== "demo");
}

/* =========================================================
   Form aktivitas
   ========================================================= */

function populateActivityTypes() {
  $("#activity-type").innerHTML = ACTIVITIES
    .map((activity) => `<option value="${activity.key}">${activity.label} · ${activity.met} MET</option>`)
    .join("");
}

function currentActivity() {
  return ACTIVITIES.find((activity) => activity.key === $("#activity-type").value) || ACTIVITIES[0];
}

function updateActivityPreview() {
  const activity = currentActivity();
  const minutes = num($("#activity-duration").value);
  const weight = num(state.profile?.berat) || 70;
  const kcal = Math.round((activity.met * 3.5 * weight * minutes) / 200);

  $("#activity-preview").textContent = `${fmt(kcal)} kkal`;
  $("#activity-weight").textContent = weight;
}

/* =========================================================
   Form & tombol
   ========================================================= */

function bindForms() {
  $("#food-form").addEventListener("submit", onFoodSubmit);
  $("#activity-form").addEventListener("submit", onActivitySubmit);
  $("#activity-duration").addEventListener("input", updateActivityPreview);
  $("#activity-type").addEventListener("change", updateActivityPreview);
  $("#schedule-form").addEventListener("submit", onScheduleSubmit);
  $("#profile-form").addEventListener("submit", onProfileSubmit);
  $("#btn-auto-target").addEventListener("click", onAutoTarget);
  $("#date-input").addEventListener("change", async (event) => {
    if (!event.target.value) return;
    state.date = event.target.value;
    try {
      await refreshDate();
    } catch (error) {
      console.error(error);
      showToast("Gagal memuat data tanggal tersebut.", "error");
    }
  });
}

async function onFoodSubmit(event) {
  event.preventDefault();
  const button = event.submitter;

  const nama = $("#food-name").value.trim();
  const kalori = num($("#food-cal").value);

  if (!nama) {
    showToast("Nama makanan wajib diisi.", "error");
    return;
  }
  if (kalori <= 0) {
    showToast("Kalori harus lebih dari 0.", "error");
    return;
  }

  await withBusy(button, async () => {
    let photoUrl = state.pendingThumbUrl || "";

    if (store.mode === "firebase" && CONFIG.useStorage && state.pendingImage?.blob) {
      try {
        photoUrl = await store.uploadPhoto(state.pendingImage.blob, photoUrl);
      } catch (error) {
        console.warn("Upload foto gagal:", error);
        showToast("Foto gagal diunggah, memakai thumbnail lokal.", "error");
      }
    }

    await store.addFood({
      nama,
      porsi: num($("#food-portion").value),
      kalori: Math.round(kalori),
      protein: num($("#food-protein").value),
      karbohidrat: num($("#food-carb").value),
      lemak: num($("#food-fat").value),
      foto: photoUrl,
      date: state.date
    });

    resetFoodForm();
    await refreshDate();
    showToast("Makanan tersimpan.");
  });
}

async function onActivitySubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  const activity = currentActivity();
  const minutes = num($("#activity-duration").value);

  if (minutes <= 0 || minutes > 600) {
    showToast("Durasi harus antara 1–600 menit.", "error");
    return;
  }

  const weight = num(state.profile?.berat) || 70;
  const burned = Math.round((activity.met * 3.5 * weight * minutes) / 200);

  await withBusy(button, async () => {
    await store.addActivity({
      jenis: activity.label,
      met: activity.met,
      durasi: minutes,
      kalori_terbakar: burned,
      date: state.date
    });

    await refreshDate();
    showToast(`Olahraga tersimpan · ${fmt(burned)} kkal terbakar.`);
  });
}

async function onScheduleSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  const label = $("#schedule-label").value.trim();
  const waktu = $("#schedule-time").value;
  const tipe = $("#schedule-type").value;

  if (!label || !waktu) {
    showToast("Isi label dan waktu jadwal.", "error");
    return;
  }

  await withBusy(button, async () => {
    const saved = await store.addSchedule({ label, waktu, tipe, aktif: true });
    state.schedules = sortSchedules([...state.schedules, saved]);
    renderSchedules();
    renderDashboardSchedules();
    $("#schedule-label").value = "";
    showToast("Jadwal ditambahkan.");
  });
}

async function onProfileSubmit(event) {
  event.preventDefault();
  const button = event.submitter;

  await withBusy(button, async () => {
    state.profile = await store.saveProfile({
      nama: $("#profile-name").value.trim(),
      umur: Math.round(num($("#profile-age").value)) || 25,
      gender: $("#profile-gender").value === "wanita" ? "wanita" : "pria",
      tinggi: num($("#profile-height").value) || 170,
      berat: num($("#profile-weight").value) || 70,
      target: Math.round(num($("#profile-target").value)) || CONFIG.defaultTarget
    });

    renderDashboard();
    updateActivityPreview();
    showToast("Profil diperbarui.");
  });
}

function onAutoTarget() {
  const profile = {
    berat: num($("#profile-weight").value) || 70,
    tinggi: num($("#profile-height").value) || 170,
    umur: num($("#profile-age").value) || 25,
    gender: $("#profile-gender").value
  };

  const bmr = calcBMR(profile);
  const tdee = Math.round(bmr * 1.2);
  $("#profile-target").value = tdee;
  $("#bmr-note").textContent =
    `BMR ≈ ${fmt(bmr)} kkal. Kebutuhan harian dengan aktivitas ringan ≈ ${fmt(tdee)} kkal. ` +
    `Kurangi ±400 kkal bila ingin menurunkan berat badan.`;
}

function calcBMR(profile) {
  const base = 10 * num(profile.berat) + 6.25 * num(profile.tinggi) - 5 * num(profile.umur);
  return Math.round(base + (profile.gender === "wanita" ? -161 : 5));
}

function fillProfileForm() {
  const profile = state.profile || {};
  $("#profile-name").value = profile.nama || "";
  $("#profile-age").value = profile.umur || 25;
  $("#profile-gender").value = profile.gender || "pria";
  $("#profile-height").value = profile.tinggi || 170;
  $("#profile-weight").value = profile.berat || 70;
  $("#profile-target").value = profile.target || CONFIG.defaultTarget;
}

/* =========================================================
   Daftar (hapus, toggle)
   ========================================================= */

function bindLists() {
  $("#food-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-del-food]");
    if (!button) return;
    if (!confirm("Hapus makanan ini?")) return;
    try {
      await store.deleteFood(button.dataset.delFood, state.date);
      await refreshDate();
      showToast("Makanan dihapus.");
    } catch (error) {
      console.error(error);
      showToast("Gagal menghapus makanan.", "error");
    }
  });

  $("#activity-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-del-activity]");
    if (!button) return;
    if (!confirm("Hapus aktivitas ini?")) return;
    try {
      await store.deleteActivity(button.dataset.delActivity, state.date);
      await refreshDate();
      showToast("Aktivitas dihapus.");
    } catch (error) {
      console.error(error);
      showToast("Gagal menghapus aktivitas.", "error");
    }
  });

  $("#schedule-list").addEventListener("change", async (event) => {
    const toggle = event.target.closest("[data-sched-toggle]");
    if (!toggle) return;
    const id = toggle.dataset.schedToggle;
    const aktif = toggle.checked;
    try {
      await store.updateSchedule(id, { aktif });
      state.schedules = state.schedules.map((schedule) =>
        schedule.id === id ? { ...schedule, aktif } : schedule
      );
      renderDashboardSchedules();
      showToast(aktif ? "Jadwal diaktifkan." : "Jadwal dinonaktifkan.");
    } catch (error) {
      console.error(error);
      toggle.checked = !aktif;
      showToast("Gagal mengubah jadwal.", "error");
    }
  });

  $("#schedule-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-del-sched]");
    if (!button) return;
    if (!confirm("Hapus jadwal ini?")) return;
    try {
      await store.deleteSchedule(button.dataset.delSched);
      state.schedules = state.schedules.filter((schedule) => schedule.id !== button.dataset.delSched);
      renderSchedules();
      renderDashboardSchedules();
      showToast("Jadwal dihapus.");
    } catch (error) {
      console.error(error);
      showToast("Gagal menghapus jadwal.", "error");
    }
  });
}

/* =========================================================
   Kesehatan (air, berat, tidur)
   ========================================================= */

function bindModals() {
  $("#quick-water").addEventListener("click", () => addWater(250));
  $$("[data-water]").forEach((button) => {
    button.addEventListener("click", () => addWater(num(button.dataset.water)));
  });
  $("#btn-weight").addEventListener("click", openWeightModal);
  $("#btn-sleep").addEventListener("click", openSleepModal);

  $$("[data-close-modal]").forEach((element) => {
    element.addEventListener("click", closeModal);
  });
}

async function addWater(amount) {
  if (!amount) return;
  const next = Math.max(0, num(state.health.air_ml) + amount);
  try {
    await store.saveHealth(state.date, { air_ml: next });
    state.health.air_ml = next;
    renderHealth();
    showToast(`+${fmt(amount)} ml air.`);
  } catch (error) {
    console.error(error);
    showToast("Gagal menyimpan air minum.", "error");
  }
}

function openWeightModal() {
  const current = num(state.health.berat) || num(state.profile?.berat) || 70;
  openModal(
    "Ubah Berat Badan",
    `<form id="weight-form" class="modal-form">
      <label>Berat badan (kg)
        <input id="modal-weight" type="number" min="25" max="300" step="0.1" value="${current}" required>
      </label>
      <button class="btn primary wide" type="submit">Simpan</button>
    </form>`
  );

  $("#weight-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const weight = num($("#modal-weight").value);
    if (weight <= 0) return;
    try {
      await store.saveHealth(state.date, { berat: weight });
      state.health.berat = weight;
      state.profile = await store.saveProfile({ berat: weight });
      closeModal();
      renderHealth();
      updateActivityPreview();
      showToast("Berat badan diperbarui.");
    } catch (error) {
      console.error(error);
      showToast("Gagal menyimpan berat badan.", "error");
    }
  });
}

function openSleepModal() {
  const health = state.health || {};
  openModal(
    "Catat Tidur",
    `<form id="sleep-form" class="modal-form">
      <label>Jam tidur
        <input id="modal-sleep-start" type="time" value="${escapeHtml(health.tidur || "22:00")}" required>
      </label>
      <label>Jam bangun
        <input id="modal-sleep-end" type="time" value="${escapeHtml(health.bangun || "06:00")}" required>
      </label>
      <button class="btn primary wide" type="submit">Simpan</button>
    </form>`
  );

  $("#sleep-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const tidur = $("#modal-sleep-start").value;
    const bangun = $("#modal-sleep-end").value;
    if (!tidur || !bangun) return;
    try {
      await store.saveHealth(state.date, { tidur, bangun });
      state.health.tidur = tidur;
      state.health.bangun = bangun;
      closeModal();
      renderHealth();
      showToast(`Tidur tercatat: ${formatSleep(tidur, bangun)}.`);
    } catch (error) {
      console.error(error);
      showToast("Gagal menyimpan data tidur.", "error");
    }
  });
}

/* =========================================================
   Notifikasi jadwal
   ========================================================= */

function bindNotifications() {
  $("#btn-enable-notif").addEventListener("click", async () => {
    try {
      const result = await enableNotifications();
      updateNotifPill();
      if (result === "granted") await setupReminders();
      showToast(
        result === "granted" ? "Notifikasi diaktifkan." : "Izin notifikasi belum diberikan.",
        result === "granted" ? "ok" : "error"
      );
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#btn-test-notif").addEventListener("click", async () => {
    if (notifPermission() !== "granted") {
      showToast("Aktifkan notifikasi terlebih dahulu.", "error");
      return;
    }
    const sent = await testNotification();
    showToast(sent ? "Notifikasi uji dikirim." : "Notifikasi gagal dikirim.", sent ? "ok" : "error");
  });
}

function updateNotifPill() {
  const pill = $("#notif-pill");
  const button = $("#btn-enable-notif");
  if (!notifSupported()) {
    pill.textContent = "Tidak didukung";
    pill.className = "pill bad";
    button.disabled = true;
    return;
  }

  const permission = notifPermission();
  if (permission === "granted") {
    pill.textContent = state.fcmActive ? "Aktif · FCM" : "Aktif";
    pill.className = "pill ok";
    button.disabled = true;
    button.textContent = "Notifikasi Aktif";
  } else if (permission === "denied") {
    pill.textContent = "Diblokir";
    pill.className = "pill bad";
    button.disabled = true;
    button.textContent = "Notifikasi Diblokir";
  } else {
    pill.textContent = "Belum aktif";
    pill.className = "pill warn";
    button.disabled = false;
    button.textContent = "Aktifkan Notifikasi";
  }
}

/**
 * Jika FCM tersedia (Firebase + VAPID key + izin notifikasi), pengingat
 * ditangani oleh push dari server — termasuk saat aplikasi ditutup.
 * Jika tidak, pakai pengingat lokal selama aplikasi terbuka.
 */
async function setupReminders() {
  if (store.mode === "firebase" && fcmSupported()) {
    try {
      const result = await initFcm();
      if (result.status === "ok") {
        state.fcmActive = true;
        startReminderLoop(() => state.schedules, 20000, { skipWhenHidden: true });
        updateNotifPill();
        return;
      }
      if (result.status === "error") {
        console.warn("FCM tidak aktif:", result.error);
      }
    } catch (error) {
      console.warn("FCM gagal diinisialisasi:", error);
    }
  }

  state.fcmActive = false;
  startReminderLoop(() => state.schedules);
  updateNotifPill();
}

/* =========================================================
   Auth
   ========================================================= */

function bindAuth() {
  $("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    setAuthMessage("Memproses…");

    try {
      await store.signIn(email, password);
      setAuthMessage("");
    } catch (error) {
      console.error(error);
      setAuthMessage(friendlyAuthError(error), true);
    }
  });

  $("#btn-register").addEventListener("click", () => {
    setAuthMessage("Pendaftaran hanya melalui undangan. Hubungi pemilik aplikasi.", true);
  });

  $("#btn-google").addEventListener("click", async () => {
    setAuthMessage("Membuka Google…");
    try {
      await store.signInGoogle();
      setAuthMessage("");
    } catch (error) {
      console.error(error);
      setAuthMessage(friendlyAuthError(error), true);
    }
  });

  $("#btn-logout").addEventListener("click", async () => {
    try {
      await detachFcm();
      await store.signOut();
      stopReminderLoop();
      state.fcmActive = false;
      showToast("Kamu sudah keluar.");
    } catch (error) {
      console.error(error);
      showToast("Gagal keluar.", "error");
    }
  });
}

function showAuth() {
  $("#auth-screen").classList.remove("hidden");
  $("#app-shell").classList.add("hidden");

  try {
    const notice = sessionStorage.getItem(AUTH_NOTICE_KEY);
    if (notice) {
      sessionStorage.removeItem(AUTH_NOTICE_KEY);
      setAuthMessage(notice, true);
    }
  } catch {
    // sessionStorage bisa diblokir di mode privat.
  }
}

function hideAuth() {
  $("#auth-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
}

function setAuthMessage(text, isError = false) {
  const element = $("#auth-message");
  element.textContent = text;
  element.style.color = isError ? "var(--red)" : "var(--muted)";
}

function friendlyAuthError(error) {
  const code = error?.code || "";
  return AUTH_ERRORS[code] || error?.message || "Terjadi kesalahan. Coba lagi.";
}

/* =========================================================
   Data (ekspor / reset)
   ========================================================= */

function bindDataButtons() {
  $("#btn-export").addEventListener("click", async () => {
    try {
      const data = await store.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `kalorisehat-${state.date}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast("Data diekspor.");
    } catch (error) {
      console.error(error);
      showToast("Gagal mengekspor data.", "error");
    }
  });

  $("#btn-reset").addEventListener("click", () => {
    if (!confirm("Hapus semua data lokal di perangkat ini? Tindakan ini tidak bisa dibatalkan.")) return;
    store.resetLocal();
    location.reload();
  });
}

/* =========================================================
   Utilitas UI
   ========================================================= */

function openModal(title, html) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = html;
  $("#modal-root").classList.remove("hidden");
}

function closeModal() {
  $("#modal-root").classList.add("hidden");
  $("#modal-body").innerHTML = "";
}

function showToast(message, type = "ok") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast ${type === "error" ? "error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3400);
}

async function withBusy(button, action) {
  const original = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    button.textContent = "Menyimpan…";
  }
  try {
    await action();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Terjadi kesalahan.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register(messagingSwUrl()).catch((error) => {
    console.warn("Service worker gagal didaftarkan:", error);
  });
}

function safePhotoSrc(value) {
  const src = String(value || "").trim();
  if (/^data:image\/(?:jpeg|png|webp|gif);base64,[a-z0-9+/=]+$/i.test(src)) return src;
  if (/^https:\/\/[^\s"'<>]+$/i.test(src)) return src;
  return "";
}

function scheduleIcon(type) {
  const key = String(type || "");
  return Object.prototype.hasOwnProperty.call(ICONS, key) ? ICONS[key] : ICONS.lainnya;
}

function sum(list, key) {
  return list.reduce((total, item) => total + num(item[key]), 0);
}

function sortSchedules(list) {
  return [...list].sort((a, b) => String(a.waktu || "").localeCompare(String(b.waktu || "")));
}

function prettyDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
}
