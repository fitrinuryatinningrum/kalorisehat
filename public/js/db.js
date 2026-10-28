import { CONFIG, isFirebaseConfigured } from "./config.js?v=10";
import { uid } from "./utils.js?v=10";

const STORAGE_KEY = "kalorisehat.v1";
export const AUTH_NOTICE_KEY = "kalorisehat.authNotice";
const MODE = isFirebaseConfigured() ? "firebase" : "demo";

const DEFAULT_PROFILE = {
  nama: "",
  berat: 70,
  tinggi: 170,
  umur: 25,
  gender: "pria",
  target: CONFIG.defaultTarget
};

let fb = null;
let user = null;
const authListeners = new Set();

/* =========================================================
   Penyimpanan lokal (mode demo)
   ========================================================= */

function emptyLocal() {
  return {
    profile: { ...DEFAULT_PROFILE },
    foods: {},
    activities: {},
    health: {},
    schedules: []
  };
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyLocal();
    const parsed = JSON.parse(raw);
    return {
      profile: { ...DEFAULT_PROFILE, ...(parsed.profile || {}) },
      foods: parsed.foods || {},
      activities: parsed.activities || {},
      health: parsed.health || {},
      schedules: parsed.schedules || []
    };
  } catch (error) {
    console.warn("Data lokal rusak, memakai data baru.", error);
    return emptyLocal();
  }
}

function saveLocal(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/* =========================================================
   Firebase
   ========================================================= */

async function initFirebase() {
  const [appMod, authMod, firestoreMod, storageMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js"),
    import("https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js")
  ]);

  const app = appMod.initializeApp(CONFIG.firebase);
  fb = {
    app,
    auth: authMod.getAuth(app),
    db: firestoreMod.getFirestore(app),
    storage: storageMod.getStorage(app),
    authMod,
    firestoreMod,
    storageMod
  };

  await authMod.setPersistence(fb.auth, authMod.browserLocalPersistence).catch(() => {});

  authMod.onAuthStateChanged(fb.auth, async (nextUser) => {
    user = nextUser;
    if (nextUser) {
      try {
        await ensureUserProfile(nextUser);
      } catch (error) {
        console.error("Gagal menyiapkan profil:", error);
        if (error?.code === "permission-denied") {
          try {
            sessionStorage.setItem(
              AUTH_NOTICE_KEY,
              "Akun ini belum diizinkan. Pendaftaran hanya melalui undangan."
            );
          } catch {
            // sessionStorage bisa diblokir di mode privat.
          }
          await authMod.signOut(fb.auth).catch(() => {});
          return;
        }
      }
    }
    authListeners.forEach((cb) => {
      try {
        cb(nextUser);
      } catch (error) {
        console.error(error);
      }
    });
  });
}

async function ensureUserProfile(nextUser) {
  const { doc, getDoc, setDoc } = fb.firestoreMod;
  const ref = doc(fb.db, "users", nextUser.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      ...DEFAULT_PROFILE,
      email: nextUser.email || "",
      created_at: Date.now()
    });
  }
}

function requireUser() {
  if (MODE === "firebase" && !user) throw new Error("Kamu belum masuk.");
  return user;
}

async function getIdToken() {
  if (MODE !== "firebase" || !user) return "";
  return user.getIdToken();
}

async function getUserDocData() {
  const { doc, getDoc } = fb.firestoreMod;
  const snap = await getDoc(doc(fb.db, "users", requireUser().uid));
  return snap.exists() ? snap.data() : {};
}

/* =========================================================
   Profil
   ========================================================= */

async function getProfile() {
  if (MODE === "demo") return loadLocal().profile;

  const { doc, getDoc } = fb.firestoreMod;
  const snap = await getDoc(doc(fb.db, "users", requireUser().uid));
  return snap.exists() ? { ...DEFAULT_PROFILE, ...snap.data() } : { ...DEFAULT_PROFILE };
}

async function saveProfile(patch) {
  if (MODE === "demo") {
    const data = loadLocal();
    data.profile = { ...data.profile, ...patch };
    saveLocal(data);
    return data.profile;
  }

  const { doc, setDoc } = fb.firestoreMod;
  await setDoc(doc(fb.db, "users", requireUser().uid), patch, { merge: true });
  return getProfile();
}

/* =========================================================
   Makanan
   ========================================================= */

async function listFoods(date) {
  if (MODE === "demo") {
    return [...(loadLocal().foods[date] || [])].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  }

  const { collection, query, where, getDocs } = fb.firestoreMod;
  const ref = query(collection(fb.db, "users", requireUser().uid, "foods"), where("date", "==", date));
  const snap = await getDocs(ref);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
}

async function addFood(food) {
  const item = { ...food, created_at: Date.now() };

  if (MODE === "demo") {
    const data = loadLocal();
    const list = data.foods[item.date] || [];
    const saved = { id: uid(), ...item };
    data.foods[item.date] = [...list, saved];
    saveLocal(data);
    return saved;
  }

  const { collection, addDoc } = fb.firestoreMod;
  const ref = await addDoc(collection(fb.db, "users", requireUser().uid, "foods"), item);
  return { id: ref.id, ...item };
}

async function deleteFood(id, date) {
  if (MODE === "demo") {
    const data = loadLocal();
    data.foods[date] = (data.foods[date] || []).filter((item) => item.id !== id);
    saveLocal(data);
    return;
  }

  const { doc, deleteDoc } = fb.firestoreMod;
  await deleteDoc(doc(fb.db, "users", requireUser().uid, "foods", id));
}

/* =========================================================
   Aktivitas
   ========================================================= */

async function listActivities(date) {
  if (MODE === "demo") {
    return [...(loadLocal().activities[date] || [])].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  }

  const { collection, query, where, getDocs } = fb.firestoreMod;
  const ref = query(collection(fb.db, "users", requireUser().uid, "activities"), where("date", "==", date));
  const snap = await getDocs(ref);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
}

async function addActivity(activity) {
  const item = { ...activity, created_at: Date.now() };

  if (MODE === "demo") {
    const data = loadLocal();
    const list = data.activities[item.date] || [];
    const saved = { id: uid(), ...item };
    data.activities[item.date] = [...list, saved];
    saveLocal(data);
    return saved;
  }

  const { collection, addDoc } = fb.firestoreMod;
  const ref = await addDoc(collection(fb.db, "users", requireUser().uid, "activities"), item);
  return { id: ref.id, ...item };
}

async function deleteActivity(id, date) {
  if (MODE === "demo") {
    const data = loadLocal();
    data.activities[date] = (data.activities[date] || []).filter((item) => item.id !== id);
    saveLocal(data);
    return;
  }

  const { doc, deleteDoc } = fb.firestoreMod;
  await deleteDoc(doc(fb.db, "users", requireUser().uid, "activities", id));
}

/* =========================================================
   Kesehatan harian (air, berat, tidur)
   ========================================================= */

async function getHealth(date) {
  if (MODE === "demo") return loadLocal().health[date] || {};

  const { doc, getDoc } = fb.firestoreMod;
  const snap = await getDoc(doc(fb.db, "users", requireUser().uid, "health", date));
  return snap.exists() ? snap.data() : {};
}

async function saveHealth(date, patch) {
  if (MODE === "demo") {
    const data = loadLocal();
    data.health[date] = { ...(data.health[date] || {}), ...patch };
    saveLocal(data);
    return data.health[date];
  }

  const { doc, setDoc } = fb.firestoreMod;
  const ref = doc(fb.db, "users", requireUser().uid, "health", date);
  await setDoc(ref, patch, { merge: true });
  return getHealth(date);
}

/* =========================================================
   Jadwal harian
   ========================================================= */

function sortSchedules(list) {
  return [...list].sort((a, b) => String(a.waktu || "").localeCompare(String(b.waktu || "")));
}

async function listSchedules() {
  if (MODE === "demo") return sortSchedules(loadLocal().schedules);

  const data = await getUserDocData();
  return sortSchedules(data.schedules || []);
}

async function saveSchedules(schedules) {
  const { doc, updateDoc } = fb.firestoreMod;
  await updateDoc(doc(fb.db, "users", requireUser().uid), { schedules });
}

async function addSchedule(schedule) {
  const item = { ...schedule, aktif: schedule.aktif !== false, created_at: Date.now() };

  if (MODE === "demo") {
    const data = loadLocal();
    const saved = { id: uid(), ...item };
    data.schedules = [...data.schedules, saved];
    saveLocal(data);
    return saved;
  }

  const saved = { id: uid(), ...item };
  const current = await listSchedules();
  await saveSchedules(sortSchedules([...current, saved]));
  return saved;
}

async function updateSchedule(id, patch) {
  if (MODE === "demo") {
    const data = loadLocal();
    data.schedules = data.schedules.map((item) => (item.id === id ? { ...item, ...patch } : item));
    saveLocal(data);
    return;
  }

  const current = await listSchedules();
  await saveSchedules(current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
}

async function deleteSchedule(id) {
  if (MODE === "demo") {
    const data = loadLocal();
    data.schedules = data.schedules.filter((item) => item.id !== id);
    saveLocal(data);
    return;
  }

  const current = await listSchedules();
  await saveSchedules(current.filter((item) => item.id !== id));
}

/* =========================================================
   Token FCM (push notification latar belakang)
   ========================================================= */

async function saveFcmToken(token) {
  if (MODE !== "firebase" || !token) return;

  const { doc, updateDoc, arrayUnion } = fb.firestoreMod;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jakarta";

  await updateDoc(doc(fb.db, "users", requireUser().uid), {
    fcmTokens: arrayUnion(token),
    timezone,
    fcm_updated_at: Date.now()
  });
}

async function removeFcmToken(token) {
  if (MODE !== "firebase" || !token) return;

  const { doc, updateDoc, arrayRemove } = fb.firestoreMod;
  await updateDoc(doc(fb.db, "users", requireUser().uid), { fcmTokens: arrayRemove(token) });
}

/* =========================================================
   Foto
   ========================================================= */

async function uploadPhoto(blob, fallbackUrl) {
  if (MODE === "demo") return fallbackUrl;

  const { ref, uploadBytes, getDownloadURL } = fb.storageMod;
  const path = `users/${requireUser().uid}/foods/${Date.now()}.jpg`;
  const storageRef = ref(fb.storage, path);
  await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
  return getDownloadURL(storageRef);
}

/* =========================================================
   Ekspor / reset
   ========================================================= */

async function exportData() {
  if (MODE === "demo") return loadLocal();

  const uidValue = requireUser().uid;
  const { collection, getDocs } = fb.firestoreMod;
  const [profile, userDoc, foods, activities, health] = await Promise.all([
    getProfile(),
    getUserDocData(),
    getDocs(collection(fb.db, "users", uidValue, "foods")),
    getDocs(collection(fb.db, "users", uidValue, "activities")),
    getDocs(collection(fb.db, "users", uidValue, "health"))
  ]);

  const { fcmTokens, schedules, ...safeProfile } = profile;

  return {
    profile: safeProfile,
    foods: foods.docs.map((d) => ({ id: d.id, ...d.data() })),
    activities: activities.docs.map((d) => ({ id: d.id, ...d.data() })),
    health: health.docs.map((d) => ({ id: d.id, ...d.data() })),
    schedules: userDoc.schedules || []
  };
}

function resetLocal() {
  localStorage.removeItem(STORAGE_KEY);
}

/* =========================================================
   Auth
   ========================================================= */

async function signIn(email, password) {
  if (MODE !== "firebase") throw new Error("Mode demo tidak membutuhkan login.");
  return fb.authMod.signInWithEmailAndPassword(fb.auth, email, password);
}

async function signUp(email, password) {
  if (MODE !== "firebase") throw new Error("Mode demo tidak membutuhkan login.");
  const credential = await fb.authMod.createUserWithEmailAndPassword(fb.auth, email, password);
  await ensureUserProfile(credential.user);
  return credential;
}

async function signInGoogle() {
  if (MODE !== "firebase") throw new Error("Mode demo tidak membutuhkan login.");
  const provider = new fb.authMod.GoogleAuthProvider();
  return fb.authMod.signInWithPopup(fb.auth, provider);
}

async function signOut() {
  if (MODE !== "firebase") return;
  await fb.authMod.signOut(fb.auth);
}

/* =========================================================
   API publik
   ========================================================= */

export const store = {
  mode: MODE,
  async init(onAuthChange) {
    if (onAuthChange) authListeners.add(onAuthChange);
    if (MODE === "firebase") await initFirebase();
  },
  currentUser() {
    return MODE === "firebase" ? user : { uid: "local", email: "demo@lokal" };
  },
  getIdToken,
  signIn,
  signUp,
  signInGoogle,
  signOut,
  getProfile,
  saveProfile,
  listFoods,
  addFood,
  deleteFood,
  listActivities,
  addActivity,
  deleteActivity,
  getHealth,
  saveHealth,
  listSchedules,
  addSchedule,
  updateSchedule,
  deleteSchedule,
  saveFcmToken,
  removeFcmToken,
  uploadPhoto,
  exportData,
  resetLocal
};
