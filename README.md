# 🥗 KaloriSehat — Monitoring Kalori Harian

Aplikasi web (PWA) untuk Android yang membantu memantau **kalori masuk & keluar**, **kesehatan harian**, dan **jadwal pengingat**, dengan bantuan **AI** untuk memperkirakan kalori dari foto makanan.

Semua komponen bisa dijalankan **gratis**:

- Frontend: HTML + CSS + JavaScript (tanpa framework, tanpa build step)
- Data: `localStorage` (mode demo) atau Firebase Firestore (opsional)
- AI: Cloudflare Workers AI (fallback gratis) atau Google Gemini free tier
- Hosting: Firebase Hosting / Cloudflare Pages / GitHub Pages / Netlify (gratis)
- Notifikasi: Web Notification API + Service Worker (PWA) + FCM (opsional)

> ⚠️ Aplikasi ini bersifat edukatif dan **bukan pengganti nasihat medis**.

### Status deployment saat ini

- Aplikasi: <https://kalorisehat-49166.web.app>
- Firebase project: `kalorisehat-49166`
- Firestore: database default di `asia-southeast2` (Jakarta), rules sudah aktif
- Auth: Email/Password + Google aktif
- Cloudflare Worker: <https://kalorisehat-ai.kalorisehat-49166.workers.dev>
- AI: Cloudflare Workers AI aktif (tanpa API key); Gemini opsional
- FCM: VAPID key sudah diisi, Worker cron berjalan, push latar belakang sudah diuji end-to-end
- Storage: mode gratis (`useStorage: false`), foto disimpan sebagai thumbnail di Firestore

---

## ✨ Fitur

- **Dashboard harian** — ring kalori, total masuk/keluar, sisa kalori, makronutrien.
- **Analisis makanan dengan AI** — foto makanan → estimasi nama, porsi, kalori, protein, karbohidrat, lemak.
- **Koreksi manual** — hasil AI bisa diedit sebelum disimpan.
- **Kalori keluar** — hitung otomatis memakai rumus MET berdasarkan jenis olahraga, durasi, dan berat badan.
- **Pemantauan kesehatan** — air minum, berat badan, dan jam tidur.
- **Jadwal harian bertanda** — pengingat makan, olahraga, minum air, tidur, atau lainnya.
- **Notifikasi** — pengingat lokal saat aplikasi aktif, plus **push FCM latar belakang** saat aplikasi ditutup (opsional, gratis).
- **Mode demo** — langsung bisa dipakai tanpa akun, data tersimpan di perangkat.
- **Mode cloud (opsional)** — login Firebase, data tersinkron di Firestore.
- **Ekspor data** — unduh semua catatan dalam format JSON.

---

## 📁 Struktur Proyek

```
kalori-app/
├── public/                  # aplikasi web (root hosting)
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js           # logika & render UI
│   │   ├── config.js        # konfigurasi Firebase + Gemini
│   │   ├── db.js            # data layer (localStorage / Firestore)
│   │   ├── ai.js            # integrasi Gemini
│   │   ├── fcm.js           # push notification FCM (opsional)
│   │   ├── notifications.js # pengingat jadwal lokal
│   │   └── utils.js
│   ├── icons/icon.svg
│   ├── icons/icon-192.png
│   ├── icons/icon-512.png
│   ├── manifest.json
│   └── sw.js                # service worker (PWA + notifikasi + FCM)
├── worker/                  # proxy AI + cron FCM (Cloudflare Worker)
│   ├── index.js
│   └── wrangler.toml
├── firebase.json            # konfigurasi Firebase Hosting
├── package.json
└── README.md
```

---

## 🚀 Mulai Cepat (Mode Demo, Tanpa Setup)

Prasyarat: **Node.js** (disarankan) atau **Python**.

```bash
cd kalori-app
npm run dev
```

Buka `http://localhost:5173`.

Alternatif tanpa Node:

```bash
python -m http.server 5173 --directory public
```

Mode demo otomatis aktif jika `public/js/config.js` belum diisi. Semua data tersimpan di browser (`localStorage`). AI memakai **estimasi demo** (bukan AI sungguhan) sampai kamu mengisi API key Gemini.

> Catatan: jangan membuka `index.html` lewat `file://`. Gunakan server lokal agar service worker dan ES module bekerja.
>
> Windows PowerShell: jika muncul error `npm.ps1 cannot be loaded because running scripts is disabled`, jalankan lewat Command Prompt dengan `cmd /c "npm run dev"`, atau aktifkan izin script seperti pada bagian Troubleshooting.

---

## 🤖 Mengaktifkan AI Foto Makanan (Gratis)

Ada tiga cara. Worker yang sudah di-deploy memakai **Cloudflare Workers AI** sebagai fallback gratis, jadi AI tetap jalan tanpa API key Gemini.

### Cara A — Cloudflare Workers AI (tanpa API key, langsung jalan)

Worker sudah memakai binding `AI` dan model vision gratis Cloudflare. Tidak perlu secret tambahan.

```bash
cd worker
npx wrangler deploy
```

Bagian penting di `worker/wrangler.toml`:

```toml
[ai]
binding = "AI"
```

Cloudflare Workers AI free tier: 10.000 Neuron/hari. Jika kuota habis, aplikasi otomatis memakai estimasi demo atau kamu bisa menambahkan Gemini key (Cara B).

### Cara B — Proxy Cloudflare Worker + Gemini (opsional)

Key tidak pernah dikirim ke browser. Cocok kalau akun Google-mu mendapat free tier Gemini.

```bash
cd worker
npx wrangler login
npx wrangler secret put GEMINI_API_KEY   # tempel API key saat diminta
npx wrangler deploy
```

Salin URL hasil deploy (contoh `https://kalorisehat-ai.username.workers.dev`) ke:

```js
// public/js/config.js
gemini: {
  backendUrl: "https://kalorisehat-ai.username.workers.dev",
  ...
}
```

Opsional: batasi origin lewat variabel `ALLOWED_ORIGIN` di `worker/wrangler.toml` agar hanya domain aplikasimu yang bisa memakai worker. Saat masih mengembangkan di `localhost`, biarkan `ALLOWED_ORIGIN` tidak diisi (default `*`) atau isi dengan `http://localhost:5173`.

Cloudflare Workers free tier: ±100.000 request/hari — lebih dari cukup.

### Cara C — Panggil Gemini langsung dari browser (khusus pribadi)

```js
// public/js/config.js
gemini: {
  apiKey: "AIza...",
  ...
}
```

Cocok untuk pemakaian pribadi di perangkat sendiri. **Jangan** pakai cara ini untuk aplikasi publik, karena API key bisa dilihat siapa pun lewat DevTools. Untuk aplikasi publik, gunakan Cara B.

### Model Gemini

Default: `gemini-3.8-flash`. Bisa diganti di `config.js` / `wrangler.toml`. Cek daftar model yang tersedia di Google AI Studio karena model lama bisa dihentikan.

Kuota gratis dibatasi per menit/hari. Aplikasi sudah mengompres foto (maks 1024 px) agar hemat kuota.

> Catatan: beberapa akun Google (terutama akun sekolah/kampus) tidak mendapat **free tier** Gemini API dan diminta mengaktifkan billing. Jika itu terjadi, buat API key dari akun Gmail pribadi di <https://aistudio.google.com>, lalu pakai key tersebut di Worker. Firebase Hosting tetap memakai project yang sekarang.

---

## ☁️ Mode Cloud dengan Firebase (Opsional)

Tanpa Firebase, aplikasi tetap berjalan penuh (mode demo). Ikuti langkah ini jika ingin data tersinkron dan bisa login.

### 1. Buat project Firebase

1. Buka <https://console.firebase.google.com> → **Add project**.
2. Tambahkan **Web app** (ikon `</>`), lalu salin objek `firebaseConfig`.

### 2. Aktifkan layanan

- **Authentication** → Sign-in method → aktifkan **Email/Password** dan **Google**.
- **Firestore Database** → Create database (mulai dari *test mode*, nanti ganti rules).
- **Storage** → *Opsional.* Untuk project baru, Firebase Storage memerlukan paket **Blaze** (kartu kredit). Supaya tetap gratis, biarkan `useStorage: false`. Foto tetap disimpan sebagai thumbnail kecil di Firestore.
- **Cloud Messaging** → aktifkan (opsional, untuk push latar belakang).

> Konfigurasi OAuth brand (termasuk email dukungan) sengaja tidak disimpan di `firebase.json`. Atur lewat Firebase Console agar email pribadi tidak ikut masuk ke repositori publik.

### 3. Isi konfigurasi

```js
// public/js/config.js
firebase: {
  apiKey: "AIza...",
  authDomain: "project-id.firebaseapp.com",
  projectId: "project-id",
  storageBucket: "project-id.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
},
useStorage: false // true hanya jika Firebase Storage (Blaze) aktif
```

Saat `apiKey`, `projectId`, dan `appId` terisi, aplikasi otomatis beralih ke mode Firebase dan menampilkan layar login.

### 4. Firestore Rules

Gunakan file `firestore.rules` di repo ini sebagai sumber aturan. Jangan memakai rules lama yang hanya mengecek UID tanpa validasi field.

Rules tersebut:

- Menerapkan **allowlist undangan**: hanya pengguna yang punya dokumen `allowlist/{uid}` yang boleh membaca/menulis data.
- Membatasi setiap pengguna hanya ke dokumen `users/{uid}` miliknya.
- Memvalidasi tipe, panjang, dan rentang field profil, makanan, olahraga, serta kesehatan.
- Membatasi jumlah jadwal (`schedules`) dan token FCM (`fcmTokens`).
- Menolak field tak dikenal dan subcollection lain di bawah `users/{uid}`.
- Menolak perubahan `ai_date`/`ai_count` dari klien; field itu hanya diisi Worker untuk kuota AI.

Jadwal dan token FCM disimpan sebagai field di dokumen `users/{uid}`. Subcollection `foods`, `activities`, dan `health` dilindungi aturan bertingkat.

#### Mengundang pengguna baru

Pendaftaran mandiri sudah dinonaktifkan di UI. Untuk mengundang seseorang:

1. Buat akun di **Firebase Console → Authentication → Add user** (atau minta orang tersebut daftar lewat API, lalu nonaktifkan jika tidak dipakai).
2. Salin **UID** akun dari kolom User UID.
3. Di **Firestore → Data**, buat dokumen `allowlist/{UID}`. Tidak perlu field; keberadaan dokumen sudah cukup.
4. Minta pengguna masuk. Data baru akan dibuat otomatis saat login pertama.

Akun yang tidak ada di allowlist tetap bisa dibuat lewat API Auth (kecuali App Check/Identity Platform dikonfigurasi), tetapi **tidak bisa membaca/menulis Firestore atau memakai AI**. Ini membatasi penyalahgunaan data dan kuota.

### 5. Storage Rules (opsional — hanya jika Storage/Blaze aktif)

Storage → Rules:

```js
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Rules juga sudah tersedia sebagai file `firestore.rules` dan `storage.rules`. Deploy Firestore rules dengan:

```bash
npm run deploy:rules
```

Jika suatu saat Storage aktif, deploy rules Storage secara terpisah:

```bash
npm run deploy:storage-rules
```

### 6. Deploy Hosting (gratis)

Prasyarat: project Firebase sudah dibuat (langkah 1) dan Node.js terpasang.

```bash
cd kalori-app
npx firebase-tools login
npx firebase-tools use --add        # pilih project, beri alias "default"
npx firebase-tools deploy --only hosting
```

Jika `firebase-tools` sudah dipasang global, perintahnya cukup `firebase login`, `firebase use --add`, dan `firebase deploy --only hosting`.

Tanpa `.firebaserc`, kamu juga bisa langsung menyebut project ID:

```bash
npx firebase-tools deploy --only hosting --project project-id
```

Atau dari root proyek:

```bash
npm run deploy
```

Setelah selesai, aplikasi tersedia di:

```
https://project-id.web.app
https://project-id.firebaseapp.com
```

File `firebase.json` sudah mengatur cache untuk `sw.js`, `index.html`, dan `manifest.json` agar update service worker cepat terdeteksi.

> Windows PowerShell: jika perintah `npx` diblokir kebijakan eksekusi, buka **Command Prompt** atau jalankan `cmd /c "npx firebase-tools login"` lalu `cmd /c "npx firebase-tools deploy --only hosting"`.

### 7. Izinkan domain

Authentication → Settings → **Authorized domains** → tambahkan domain hosting (mis. `project-id.web.app`).

---

## 📱 Install sebagai Aplikasi di Android

1. Deploy aplikasi (Firebase Hosting/Cloudflare Pages/Netlify) atau akses lewat HTTPS.
2. Buka di **Chrome Android**.
3. Menu ⋮ → **Add to Home screen / Install app**.
4. Aplikasi muncul di layar utama seperti aplikasi native.

Service worker membuat tampilan tetap bisa dibuka saat offline (data Firebase tetap butuh internet).

---

## 🔔 Push Notification Latar Belakang (FCM, Opsional)

Ini membuat pengingat tetap muncul **walaupun aplikasi sudah ditutup**, bukan hanya saat tab/PWA aktif.

Semua komponennya gratis:

- **Firebase Cloud Messaging (FCM)** — gratis.
- **Cloudflare Worker Cron Trigger** — gratis, berjalan setiap menit.
- **Firestore Spark** — cukup untuk pemakaian pribadi/keluarga.

### Cara kerja

1. Setelah login dan izin notifikasi diberikan, aplikasi mengambil **token FCM** lalu menyimpannya di dokumen `users/{uid}` (field `fcmTokens`) beserta `timezone` perangkat.
2. Jadwal harian disimpan di dokumen yang sama (field `schedules`).
3. Cloudflare Worker berjalan lewat cron setiap menit, membaca daftar pengguna dari Firestore REST API, mencocokkan jam lokal sesuai `timezone`, lalu mengirim pesan FCM.
4. Service worker menampilkan notifikasi. Saat diklik, aplikasi dibuka/difokuskan.

Saat FCM aktif, pengingat lokal tetap menjadi cadangan ketika aplikasi sedang terlihat; push FCM menangani kondisi latar belakang/ditutup.

### Setup

**1. Buat VAPID key**

Firebase Console → ⚙️ **Project settings** → tab **Cloud Messaging** → **Web Push certificates** → **Generate key pair** → salin key.

Isi di `public/js/config.js`:

```js
fcm: {
  vapidKey: "BEl...key-panjang-dari-firebase"
}
```

**2. Buat service account**

Firebase Console → ⚙️ **Project settings** → tab **Service accounts** → **Generate new private key** → unduh file JSON.

> File ini sangat sensitif. Jangan commit ke Git dan jangan taruh di folder `public/`.

**3. Ubah JSON menjadi base64**

PowerShell (Windows):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\serviceAccount.json")) | Set-Clipboard
```

macOS/Linux:

```bash
base64 -w0 serviceAccount.json
```

**4. Simpan sebagai secret Worker**

```bash
cd worker
npx wrangler login
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_B64
```

Saat diminta nilai `FIREBASE_SERVICE_ACCOUNT_B64`, tempel hasil base64 tadi (satu baris panjang).

**5. Isi URL aplikasi**

Edit `worker/wrangler.toml`:

```toml
[vars]
APP_URL = "https://project-id.web.app"
FIREBASE_PROJECT_ID = "project-id"
```

`FIREBASE_PROJECT_ID` boleh dikosongkan karena Worker bisa membacanya dari service account.

**6. Deploy Worker**

```bash
npx wrangler deploy
```

Atau dari root proyek: `npm run deploy:worker`.

Cron `* * * * *` otomatis aktif. Cek log real-time dengan:

```bash
npx wrangler tail
```

**7. Deploy aplikasi & izinkan notifikasi**

Deploy ulang Hosting, buka aplikasi, lalu di halaman **Jadwal** tekan **Aktifkan Notifikasi**. Status akan berubah menjadi **Aktif · FCM**.

### Uji coba

1. Buat jadwal 2 menit dari sekarang.
2. Tutup aplikasi sepenuhnya (swipe dari recent apps).
3. Tunggu hingga jam jadwal.
4. Notifikasi harus muncul. Jika diklik, aplikasi terbuka.

### Catatan penting

- Pastikan situs diakses lewat **HTTPS** (Firebase Hosting sudah HTTPS).
- Di Android, meng-install PWA memberi pengalaman notifikasi paling stabil. FCM web paling stabil di Chrome Android/desktop. Di iPhone/iPad, dukungan web push terbatas (iOS 16.4+ setelah **Add to Home Screen**).
- Jika inisialisasi FCM gagal (VAPID salah, service worker gagal, dsb.), aplikasi otomatis kembali memakai pengingat lokal dan status pill menjadi **Aktif**.
- Jika secret/konfigurasi Worker belum lengkap, tidak ada push latar belakang; pengingat lokal tetap berfungsi saat aplikasi terbuka.
- Timezone diambil otomatis dari perangkat saat aplikasi dibuka. Jika kamu pindah zona waktu, buka aplikasi sekali agar timezone diperbarui.
- Service account bersifat **admin**: siapa pun yang memilikinya bisa mengakses seluruh Firestore. Simpan hanya sebagai secret Worker. Jika bocor, hapus key di Firebase Console lalu buat yang baru.

---

## ⏰ Tentang Alarm / Pengingat

### Tanpa FCM (default)

- Pengingat dicek setiap 20 detik oleh aplikasi, dengan toleransi 5 menit bila timer browser sempat tertunda.
- Notifikasi muncul jika **aplikasi sedang terbuka** atau PWA masih aktif di latar belakang.
- Browser membatasi timer ketika tab/aplikasi benar-benar ditutup. Ini keterbatasan platform web, bukan bug aplikasi.

### Dengan FCM

- Worker cron mengecek jadwal setiap menit dan mengirim push via FCM.
- Notifikasi tetap muncul saat aplikasi ditutup, selama perangkat terhubung internet dan izin notifikasi aktif.
- Pengingat lokal hanya berjalan saat aplikasi terlihat; FCM menangani latar belakang agar tidak ada notifikasi ganda.


---

## 🔐 Keamanan & Privasi

- Foto makanan dikirim ke Gemini hanya saat kamu menekan **Analisis dengan AI**.
- Di mode demo, semua data (termasuk thumbnail) hanya tersimpan di perangkat.
- Di mode Firebase, data disimpan di project milikmu sendiri; rules di atas memastikan tiap pengguna hanya bisa mengakses datanya.
- Jangan commit API key ke repositori publik. Untuk aplikasi publik gunakan Worker proxy.
- Aplikasi tidak mengirim data ke pihak ketiga selain Google Gemini (analisis foto) dan Firebase Cloud Messaging (pengingat push, jika diaktifkan).

### Pengerasan yang sudah aktif

- **Security headers** di Firebase Hosting: CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP, dan `X-Robots-Tag: noindex`.
- **Firestore rules** menerapkan allowlist undangan, membatasi setiap pengguna ke dokumennya sendiri, memvalidasi tipe/rentang field, membatasi jumlah jadwal dan token FCM, serta menolak field tak dikenal.
- **Worker AI** mewajibkan Firebase ID token yang valid, hanya menerima origin aplikasi, membatasi ukuran gambar, memvalidasi MIME/base64, mengecek allowlist, dan membatasi **30 analisis AI per pengguna per hari**. Tanpa token, endpoint mengembalikan `401`; tanpa allowlist, `403`.
- **Cache aset** memakai versi (`?v=10`) dan `Cache-Control: no-cache` agar HTML/JS/CSS tidak tercampur versi lama.
- **Firebase web API key memang publik** (bukan rahasia); yang melindungi data adalah Auth + Firestore rules, bukan penyembunyian API key.
- **Service account, `.dev.vars`, dan secret Worker** tidak pernah masuk repo (lihat `.gitignore`).

### Catatan residual

Pendaftaran mandiri sudah ditutup di UI dan data/AI dikunci allowlist. Namun Firebase Auth tetap bisa membuat akun lewat API publik sampai App Check atau Identity Platform blocking function diaktifkan; akun tersebut tidak bisa mengakses data maupun AI. Untuk aplikasi yang benar-benar publik, pertimbangkan App Check dan rate limit tambahan di depan Worker.

---

## 🧪 Uji Cepat

1. Buka **Makan** → ketuk area foto → pilih gambar makanan.
2. Tekan **Analisis dengan AI**.
3. Periksa hasil, tekan **Simpan Makanan**.
4. Buka **Beranda** → ring kalori dan makronutrien bertambah.
5. Buka **Olahraga** → pilih aktivitas, isi durasi → simpan.
6. Buka **Jadwal** → aktifkan notifikasi → tambah jadwal 1–2 menit ke depan → tunggu notifikasi.
7. Buka **Profil** → isi data tubuh → **Hitung otomatis** target kalori.
8. (Opsional FCM) ulangi langkah 6, lalu tutup aplikasi. Notifikasi harus tetap muncul dari push server.

---

## 🛠️ Troubleshooting

| Masalah | Solusi |
|---------|--------|
| Halaman kosong / modul gagal dimuat | Jalankan lewat server (`npm run dev`), bukan `file://`. |
| PowerShell: `npx.ps1 cannot be loaded because running scripts is disabled` | Jalankan lewat **Command Prompt** (`cmd`), atau `cmd /c "npx ..."`, atau aktifkan izin script: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. |
| AI selalu "Estimasi demo" | Isi `backendUrl` atau `apiKey` di `public/js/config.js`, lalu refresh. |
| Error `403` dari Gemini | API key salah, model tidak tersedia, atau kuota habis. Cek di AI Studio. |
| Error `CORS` | Pakai Worker proxy (Cara A). Jangan panggil endpoint lain dari browser. |
| Login Google gagal | Tambahkan domain ke Authorized domains di Firebase Auth. |
| Notifikasi tidak muncul | Aktifkan izin notifikasi lewat tombol di halaman Jadwal; pastikan situs memakai HTTPS/localhost. |
| Notifikasi hanya muncul saat aplikasi terbuka | FCM belum aktif. Isi `fcm.vapidKey`, set secret `FIREBASE_SERVICE_ACCOUNT_B64`, isi `APP_URL`, lalu deploy Worker. |
| Status "Aktif · FCM" tetapi tidak ada push | Cek `npx wrangler tail` di folder `worker`. Pastikan jadwal aktif, jam sudah lewat, timezone benar, dan `APP_URL` sesuai domain Hosting. |
| Worker log: `FIREBASE_SERVICE_ACCOUNT_B64 belum diset` | Jalankan `npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_B64` dari folder `worker`, lalu deploy ulang. |
| Worker log: OAuth/service account tidak valid | Pastikan base64 berasal dari file JSON service account utuh (satu baris, tanpa tanda kutip). Buat key baru jika perlu. |
| FCM `403` / `PERMISSION_DENIED` | Aktifkan **Firebase Cloud Messaging API** di Google Cloud Console (APIs & Services → Library), lalu coba lagi. |
| Push telat beberapa menit | Cron Cloudflare berjalan sekitar satu menit; Android juga bisa menunda push saat penghemat baterai. Matikan optimasi baterai untuk Chrome/PWA jika perlu. |
| Foto tidak tersimpan penuh | Storage Firebase untuk project baru butuh Blaze. Aplikasi otomatis memakai thumbnail kecil di Firestore (`useStorage: false`). |
| Data hilang setelah ganti perangkat | Mode demo bersifat lokal. Gunakan mode Firebase untuk sinkronisasi. |

---

## 📌 Catatan Kuota Gratis

| Layanan | Free tier |
|---------|-----------|
| Google Gemini API | Kuota harian/per-menit terbatas (cukup untuk pemakaian pribadi) |
| Cloudflare Workers | ±100.000 request/hari (cron FCM memakai ±1.440/hari) |
| Firebase Cloud Messaging | Gratis |
| Firebase Hosting | 10 GB transfer/bulan |
| Firestore Spark | 50.000 baca, 20.000 tulis/hari (cron FCM membaca ±1.440 dokumen/hari per pengguna) |
| Firebase Storage | Project baru memerlukan Blaze; aplikasi tetap gratis dengan thumbnail Firestore |
| Firebase Auth | Tidak berbayar untuk Email/Password & Google |

Jika kuota Gemini habis, aplikasi tetap bisa dipakai dengan input manual (form selalu tersedia).

---

## 📄 Lisensi

Bebas digunakan dan dimodifikasi untuk keperluan pribadi maupun pembelajaran.
