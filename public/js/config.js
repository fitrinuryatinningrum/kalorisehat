/**
 * Konfigurasi aplikasi.
 *
 * MODE DATA
 * - Biarkan firebase kosong  -> aplikasi berjalan Mode Demo (data di localStorage).
 * - Isi firebase             -> aplikasi memakai Firebase Auth + Firestore.
 *
 * CATATAN STORAGE
 * Firebase Storage untuk project baru sekarang memerlukan Blaze (kartu kredit).
 * Supaya tetap 100% gratis, biarkan useStorage = false. Foto tetap disimpan
 * sebagai thumbnail kecil (data URL) di Firestore dan ikut tersinkron.
 *
 * MODE AI
 * - backendUrl diisi         -> foto dikirim ke Cloudflare Worker (Gemini atau Workers AI). DISARANKAN.
 * - apiKey diisi             -> panggil Gemini langsung dari browser (hanya untuk pemakaian pribadi).
 * - keduanya kosong          -> estimasi demo (tanpa AI), tetap bisa input manual.
 */
export const CONFIG = {
  firebase: {
    apiKey: "AIzaSyBpxB_NIJWzalgN8oLJIAzsOBvAQm_CDJM",
    authDomain: "kalorisehat-49166.firebaseapp.com",
    projectId: "kalorisehat-49166",
    storageBucket: "kalorisehat-49166.firebasestorage.app",
    messagingSenderId: "540788677764",
    appId: "1:540788677764:web:5236d8ea853c0989e336d1",
    measurementId: "G-ZY8N9E158F"
  },
  gemini: {
    // Tempel API key dari https://aistudio.google.com (mode pribadi saja).
    apiKey: "",
    // URL Cloudflare Worker / proxy backend.
    backendUrl: "https://kalorisehat-ai.kalorisehat-49166.workers.dev/?v=2",
    // Model Gemini. Jika model ini tidak tersedia, cek daftar model di AI Studio.
    model: "gemini-3.8-flash"
  },
  // Ubah ke true hanya jika Firebase Storage sudah aktif (biasanya butuh Blaze).
  useStorage: false,
  defaultTarget: 2000,
  waterTargetMl: 2000,
  fcm: {
    // VAPID key dari Firebase Console → Project Settings → Cloud Messaging
    // → Web Push certificates → Generate key pair.
    // Isi untuk mengaktifkan push notification latar belakang (butuh Firebase).
    vapidKey: "BPHfUKz6TOIDrggAtQFn2DsJCoKqB1IfGh3ZxshDupYpfufCQk2YxMpsefaehq_xGe8jEOMo6eHTGQrnt5PfgwY"
  }
};

export function isFirebaseConfigured() {
  const f = CONFIG.firebase;
  return Boolean(f.apiKey && f.projectId && f.appId);
}
