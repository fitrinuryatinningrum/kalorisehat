# Security Policy

KaloriSehat adalah PWA gratis untuk pencatatan kalori. Jangan membuka issue
publik untuk laporan kerentanan.

Gunakan **GitHub Security Advisories** pada tab **Security** repositori ini
untuk melaporkan masalah secara privat. Sertakan langkah reproduksi, dampak,
dan versi yang terkena. Laporan akan ditinjau sebelum detail dipublikasikan.

## Cakupan

- Firestore rules dan isolasi data antar-pengguna.
- Autentikasi Firebase dan allowlist undangan.
- Cloudflare Worker AI (verifikasi token, allowlist, kuota, validasi input).
- Service worker, CSP, dan header keamanan Firebase Hosting.

## Yang tidak boleh dilaporkan sebagai kerentanan

- Firebase web API key yang memang publik.
- URL project Firebase, Worker, atau halaman aplikasi yang memang publik.
- Ketidakmampuan membuat akun baru tanpa undangan; ini disengaja.

## Praktik aman

- Jangan commit service account, `.dev.vars`, atau secret Worker.
- Jangan menonaktifkan allowlist atau memakai `allow read, write: if true`.
- Gunakan HTTPS dan jangan menambahkan domain asal sembarangan ke
  `ALLOWED_ORIGIN`.
