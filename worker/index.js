/**
 * Cloudflare Worker — dua fungsi:
 *
 * 1. Proxy gratis untuk AI analisis foto makanan. Mendukung Google Gemini
 *    (jika GEMINI_API_KEY diisi) dan fallback Cloudflare Workers AI (binding AI).
 * 2. Cron setiap menit untuk mengirim push notification FCM
 *    berdasarkan jadwal harian pengguna di Firestore.
 *
 * Setup singkat:
 *   cd worker
 *   npx wrangler login
 *   npx wrangler secret put GEMINI_API_KEY       (opsional)
 *   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_B64
 *   npx wrangler deploy
 *
 * Variabel di wrangler.toml:
 *   APP_URL                = "https://project-id.web.app"
 *   FIREBASE_PROJECT_ID    = "project-id" (opsional, dibaca dari service account)
 *   FIREBASE_API_KEY       = "web-api-key" (untuk verifikasi ID token pengguna)
 *   GEMINI_MODEL           = "gemini-3.8-flash"
 *   ALLOWED_ORIGIN         = "*" atau domain aplikasi
 *   AI_DAILY_LIMIT         = "30" (kuota analisis AI per pengguna per hari)
 *
 * Akses AI hanya untuk pengguna yang punya dokumen allowlist/{uid}.
 */

const PROMPT = `Anda adalah ahli nutrisi. Analisis foto makanan ini dan berikan estimasi terbaik Anda.

Balas HANYA dengan satu objek JSON (tanpa penjelasan, tanpa markdown) dengan format:
{"makanan":"nama makanan","porsi_gram":300,"kalori":650,"protein":18,"karbohidrat":75,"lemak":28}

Aturan:
- "porsi_gram" adalah perkiraan berat porsi yang terlihat pada foto.
- "kalori" dalam kkal, "protein"/"karbohidrat"/"lemak" dalam gram.
- Jika foto berisi lebih dari satu makanan, gabungkan menjadi satu perkiraan total dan sebutkan nama-namanya.
- Jika foto bukan makanan, balas: {"error":"Foto bukan makanan"}.`;

const BODY_BY_TYPE = {
  makan: "Waktunya makan. Jangan lupa catat makananmu di KaloriSehat.",
  olahraga: "Waktunya bergerak! Catat olahragamu setelah selesai.",
  minum_air: "Waktunya minum air. Tambahkan catatan air minummu.",
  tidur: "Sudah waktunya istirahat. Tidur cukup membantu pemulihan.",
  lainnya: "Pengingat jadwal KaloriSehat."
};

export default {
  async fetch(request, env) {
    return handleAiRequest(request, env);
  },

  async scheduled(event, env, ctx) {
    const scheduledAt = new Date(event?.scheduledTime || Date.now());
    ctx.waitUntil(
      sendDueReminders(env, scheduledAt).catch((error) => console.error("FCM scheduler error:", error))
    );
  }
};

/* =========================================================
   Bagian 1 — Proxy AI Gemini
   ========================================================= */

async function handleAiRequest(request, env) {
  const allowedOrigin = env.ALLOWED_ORIGIN || "*";
  const requestOrigin = request.headers.get("Origin") || "";
  const cors = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (allowedOrigin !== "*" && requestOrigin && requestOrigin !== allowedOrigin) {
    return json(
      { error: "Origin tidak diizinkan." },
      403,
      { ...cors, "Access-Control-Allow-Origin": "null" }
    );
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, cors);
  }

  const auth = await verifyFirebaseIdToken(request, env);
  if (!auth.ok) {
    return json({ error: auth.error }, auth.status, cors);
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 9_000_000) {
    return json({ error: "Gambar terlalu besar." }, 413, cors);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body harus berupa JSON." }, 400, cors);
  }

  const { imageBase64, mimeType } = body || {};
  if (typeof imageBase64 !== "string" || !imageBase64) {
    return json({ error: "imageBase64 wajib dikirim." }, 400, cors);
  }
  if (imageBase64.length > 8_000_000) {
    return json({ error: "Gambar terlalu besar." }, 413, cors);
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(imageBase64)) {
    return json({ error: "Format imageBase64 tidak valid." }, 400, cors);
  }

  const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (mimeType && !allowedMimeTypes.has(mimeType)) {
    return json({ error: "Format gambar tidak didukung." }, 415, cors);
  }
  const safeMimeType = allowedMimeTypes.has(mimeType) ? mimeType : "image/jpeg";

  const access = await authorizeAi(env, auth.user?.localId);
  if (!access.ok) {
    return json({ error: access.error }, access.status, cors);
  }

  const attempts = [];
  if (env.GEMINI_API_KEY) {
    attempts.push(() => callGemini(env, imageBase64, safeMimeType));
  }
  if (env.AI) {
    attempts.push(() => callWorkersAi(env, imageBase64, safeMimeType));
  }

  if (!attempts.length) {
    return json(
      { error: "AI belum dikonfigurasi. Isi GEMINI_API_KEY atau aktifkan Workers AI." },
      500,
      cors
    );
  }

  let lastError = "AI tidak mengembalikan hasil.";
  for (const attempt of attempts) {
    try {
      const parsed = await attempt();
      if (parsed) return json(parsed, 200, cors);
    } catch (error) {
      lastError = error.message || String(error);
      console.warn("AI attempt failed:", lastError);
    }
  }

  return json({ error: "Gagal memanggil AI.", detail: lastError.slice(0, 500) }, 502, cors);
}

async function verifyFirebaseIdToken(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+([A-Za-z0-9._-]+)$/);
  if (!match) {
    return { ok: false, status: 401, error: "Sesi login diperlukan." };
  }

  if (!env.FIREBASE_API_KEY) {
    console.error("FIREBASE_API_KEY belum diset.");
    return { ok: false, status: 500, error: "Autentikasi server belum dikonfigurasi." };
  }

  let response;
  try {
    response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: match[1] })
      }
    );
  } catch {
    return { ok: false, status: 503, error: "Tidak bisa memverifikasi sesi." };
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data.users) || data.users.length === 0) {
    return { ok: false, status: 401, error: "Sesi login tidak valid atau kedaluwarsa." };
  }

  return { ok: true, user: data.users[0] };
}

async function authorizeAi(env, uid) {
  if (!uid) {
    return { ok: false, status: 403, error: "Akun tidak valid." };
  }

  const serviceAccount = parseServiceAccount(env);
  if (!serviceAccount) {
    console.error("AI: secret FIREBASE_SERVICE_ACCOUNT_B64 belum diset.");
    return { ok: false, status: 503, error: "Layanan AI belum siap." };
  }

  const projectId = env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
  if (!projectId) {
    return { ok: false, status: 503, error: "Layanan AI belum siap." };
  }

  let accessToken;
  try {
    accessToken = await getAccessToken(serviceAccount);
  } catch (error) {
    console.error("AI: gagal mendapatkan access token:", error);
    return { ok: false, status: 503, error: "Layanan AI belum siap." };
  }

  const allowed = await getFirestoreDoc(projectId, accessToken, `allowlist/${uid}`);
  if (!allowed.ok) {
    if (allowed.status === 404) {
      return {
        ok: false,
        status: 403,
        error: "Akun ini belum diizinkan memakai AI. Hubungi pemilik aplikasi."
      };
    }
    return { ok: false, status: 503, error: "Tidak bisa memeriksa izin AI." };
  }

  return reserveAiQuota(projectId, accessToken, uid, env);
}

async function getFirestoreDoc(projectId, accessToken, path) {
  try {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (response.status === 404) return { ok: false, status: 404 };
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, doc: await response.json() };
  } catch (error) {
    console.warn("Firestore get gagal:", error);
    return { ok: false, status: 503 };
  }
}

async function reserveAiQuota(projectId, accessToken, uid, env) {
  const profile = await getFirestoreDoc(projectId, accessToken, `users/${uid}`);
  if (!profile.ok) {
    if (profile.status === 404) {
      return { ok: false, status: 403, error: "Profil pengguna belum siap." };
    }
    return { ok: false, status: 503, error: "Tidak bisa memeriksa kuota AI." };
  }

  const fields = profile.doc.fields || {};
  const today = localDate(env.DEFAULT_TIMEZONE || "Asia/Jakarta");
  const usageDate = fields.ai_date?.stringValue || "";
  const savedCount = Number(fields.ai_count?.integerValue || 0);
  const limit = Math.max(1, Number(env.AI_DAILY_LIMIT || 30));
  const used = usageDate === today && Number.isFinite(savedCount) ? savedCount : 0;

  if (used >= limit) {
    return {
      ok: false,
      status: 429,
      error: `Batas AI harian (${limit} analisis) sudah tercapai. Coba lagi besok.`
    };
  }

  const nextCount = used + 1;
  const url =
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}` +
    "?updateMask.fieldPaths=ai_date&updateMask.fieldPaths=ai_count";

  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          ai_date: { stringValue: today },
          ai_count: { integerValue: String(nextCount) }
        }
      })
    });

    if (!response.ok) {
      console.warn("AI: gagal menyimpan kuota", response.status);
      return { ok: false, status: 503, error: "Tidak bisa mencatat kuota AI." };
    }
  } catch (error) {
    console.warn("AI: gagal menyimpan kuota:", error);
    return { ok: false, status: 503, error: "Tidak bisa mencatat kuota AI." };
  }

  return { ok: true, remaining: limit - nextCount };
}

function localDate(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (!year || !month || !day) return new Date().toISOString().slice(0, 10);
    return `${year}-${month}-${day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function callGemini(env, imageBase64, mimeType) {
  const model = env.GEMINI_MODEL || "gemini-3.8-flash";
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${env.GEMINI_API_KEY}`;

  let upstream;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT },
              { inline_data: { mime_type: mimeType || "image/jpeg", data: imageBase64 } }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      })
    });
  } catch {
    throw new Error("Tidak bisa menghubungi Gemini.");
  }

  if (!upstream.ok) {
    const detail = await upstream.text();
    throw new Error(`Gemini ${upstream.status}: ${detail.slice(0, 300)}`);
  }

  const data = await upstream.json();
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text)
    .filter(Boolean)
    .join("");

  const parsed = parseJson(text);
  if (!parsed) throw new Error("Respons Gemini tidak valid.");
  return parsed;
}

async function callWorkersAi(env, imageBase64, mimeType) {
  const model = env.WORKERS_AI_MODEL || "@cf/mistralai/mistral-small-3.1-24b-instruct";
  const image = `data:${mimeType || "image/jpeg"};base64,${imageBase64}`;

  let result;
  try {
    result = await env.AI.run(model, {
      messages: [
        { role: "system", content: "Anda adalah ahli nutrisi. Balas hanya dengan JSON." },
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: image } }
          ]
        }
      ],
      max_tokens: 512,
      temperature: 0.2
    });
  } catch (error) {
    throw new Error(`Workers AI: ${error.message || error}`);
  }

  const raw =
    result?.response ??
    result?.result?.response ??
    result?.choices?.[0]?.message?.content ??
    result?.text ??
    "";

  if (raw && typeof raw === "object") return raw;
  const parsed = parseJson(raw);
  if (!parsed) throw new Error("Respons Workers AI tidak valid.");
  return parsed;
}

/* =========================================================
   Bagian 2 — Cron pengingat FCM
   ========================================================= */

async function sendDueReminders(env, now = new Date()) {
  const serviceAccount = parseServiceAccount(env);
  if (!serviceAccount) {
    console.warn("FCM: secret FIREBASE_SERVICE_ACCOUNT_B64 belum diset. Cron dilewati.");
    return;
  }

  const projectId = env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
  if (!projectId) {
    console.warn("FCM: project ID tidak diketahui.");
    return;
  }

  const accessToken = await getAccessToken(serviceAccount);
  const users = await listUsers(projectId, accessToken);

  let sent = 0;

  for (const doc of users) {
    const tokens = stringArray(doc, "fcmTokens");
    if (!tokens.length) continue;

    const timezone = stringField(doc, "timezone") || env.DEFAULT_TIMEZONE || "Asia/Jakarta";
    const currentTime = localTime(timezone, now);
    if (!currentTime) continue;

    const due = scheduleArray(doc).filter(
      (schedule) => schedule.aktif && schedule.waktu === currentTime
    );
    if (!due.length) continue;

    const invalidTokens = new Set();

    for (const schedule of due) {
      for (const token of tokens) {
        const result = await sendPush(env, projectId, accessToken, token, schedule);
        if (result.ok) {
          sent += 1;
        } else if (result.code === "UNREGISTERED" || result.code === "NOT_FOUND") {
          invalidTokens.add(token);
        } else {
          console.warn("FCM gagal:", result.code);
        }
      }
    }

    if (invalidTokens.size) {
      await removeTokens(doc, accessToken, invalidTokens);
    }
  }

  console.log(`FCM: ${sent} notifikasi dikirim pada ${new Date().toISOString()}.`);
}

function parseServiceAccount(env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_B64
    ? decodeBase64(env.FIREBASE_SERVICE_ACCOUNT_B64)
    : env.FIREBASE_SERVICE_ACCOUNT;

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    console.error("FCM: service account bukan JSON yang valid.");
    return null;
  }
}

let accessTokenCache = null;

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = serviceAccount.client_email || "";
  if (accessTokenCache && accessTokenCache.key === cacheKey && accessTokenCache.expiresAt > Date.now()) {
    return accessTokenCache.token;
  }

  const tokenUri = serviceAccount.token_uri || "https://oauth2.googleapis.com/token";

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging",
    aud: tokenUri,
    iat: now,
    exp: now + 3600
  };

  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const assertion = `${unsigned}.${base64UrlBytes(new Uint8Array(signature))}`;

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Gagal mendapatkan access token.");
  }

  const ttlMs = Math.max(60, Number(data.expires_in || 3600) - 60) * 1000;
  accessTokenCache = {
    key: cacheKey,
    token: data.access_token,
    expiresAt: Date.now() + ttlMs
  };

  return data.access_token;
}

async function listUsers(projectId, accessToken) {
  const docs = [];
  let pageToken = "";

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users`
    );
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      throw new Error(`Firestore list users gagal (${response.status}).`);
    }

    const data = await response.json();
    docs.push(...(data.documents || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return docs;
}

async function sendPush(env, projectId, accessToken, token, schedule) {
  const title = `⏰ ${schedule.label}`;
  const body = BODY_BY_TYPE[schedule.tipe] || BODY_BY_TYPE.lainnya;
  const tag = `jadwal-${schedule.id || schedule.waktu}`;

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          token,
          data: {
            title,
            body,
            tag,
            url: env.APP_URL || "./"
          },
          webpush: {
            headers: {
              Urgency: "high",
              TTL: "600"
            }
          }
        }
      })
    }
  );

  if (response.ok) return { ok: true };

  const data = await response.json().catch(() => ({}));
  const detail = data?.error?.details?.find((item) => item.errorCode);
  const code = detail?.errorCode || data?.error?.status || `HTTP_${response.status}`;
  return { ok: false, code };
}

async function removeTokens(doc, accessToken, invalidTokens) {
  const remaining = stringArray(doc, "fcmTokens").filter((token) => !invalidTokens.has(token));
  const url = `https://firestore.googleapis.com/v1/${doc.name}?updateMask.fieldPaths=fcmTokens`;

  await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fields: {
        fcmTokens: {
          arrayValue: {
            values: remaining.map((token) => ({ stringValue: token }))
          }
        }
      }
    })
  }).catch((error) => console.warn("Gagal membersihkan token FCM:", error));
}

/* =========================================================
   Util
   ========================================================= */

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store"
    }
  });
}

function parseJson(text) {
  if (!text) return null;
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function stringField(doc, name) {
  return doc.fields?.[name]?.stringValue || "";
}

function stringArray(doc, name) {
  return (doc.fields?.[name]?.arrayValue?.values || [])
    .map((value) => value.stringValue)
    .filter(Boolean);
}

function scheduleArray(doc) {
  const values = doc.fields?.schedules?.arrayValue?.values || [];
  return values.map((value) => {
    const fields = value.mapValue?.fields || {};
    return {
      id: fields.id?.stringValue || "",
      label: fields.label?.stringValue || "Pengingat",
      waktu: fields.waktu?.stringValue || "",
      tipe: fields.tipe?.stringValue || "lainnya",
      aktif: fields.aktif?.booleanValue !== false
    };
  });
}

function localTime(timeZone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(date);
    const hour = parts.find((part) => part.type === "hour")?.value;
    const minute = parts.find((part) => part.type === "minute")?.value;
    if (!hour || !minute) return "";
    return `${hour === "24" ? "00" : hour}:${minute}`;
  } catch {
    return "";
  }
}

function decodeBase64(value) {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function pemToArrayBuffer(privateKey) {
  const body = String(privateKey)
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function base64Url(text) {
  return base64UrlBytes(new TextEncoder().encode(text));
}

function base64UrlBytes(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
