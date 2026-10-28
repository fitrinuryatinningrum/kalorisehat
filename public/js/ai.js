import { CONFIG } from "./config.js?v=10";
import { store } from "./db.js?v=10";

const PROMPT = `Anda adalah ahli nutrisi. Analisis foto makanan ini dan berikan estimasi terbaik Anda.

Balas HANYA dengan satu objek JSON (tanpa penjelasan, tanpa markdown) dengan format:
{"makanan":"nama makanan","porsi_gram":300,"kalori":650,"protein":18,"karbohidrat":75,"lemak":28}

Aturan:
- "porsi_gram" adalah perkiraan berat porsi yang terlihat pada foto.
- "kalori" dalam kkal, "protein"/"karbohidrat"/"lemak" dalam gram.
- Jika foto berisi lebih dari satu makanan, gabungkan menjadi satu perkiraan total dan sebutkan nama-namanya.
- Jika foto bukan makanan, balas: {"error":"Foto bukan makanan"}.`;

const DEMO_FOODS = [
  { nama: "Nasi goreng ayam", porsi: 350, kalori: 690, protein: 24, karbohidrat: 82, lemak: 27 },
  { nama: "Ayam bakar + nasi", porsi: 400, kalori: 610, protein: 38, karbohidrat: 62, lemak: 21 },
  { nama: "Mie goreng sayur", porsi: 300, kalori: 520, protein: 14, karbohidrat: 70, lemak: 19 },
  { nama: "Salad ayam panggang", porsi: 250, kalori: 310, protein: 28, karbohidrat: 18, lemak: 14 },
  { nama: "Roti telur + kopi susu", porsi: 220, kalori: 380, protein: 15, karbohidrat: 38, lemak: 18 },
  { nama: "Soto ayam + nasi", porsi: 450, kalori: 540, protein: 27, karbohidrat: 64, lemak: 18 },
  { nama: "Bubur ayam", porsi: 350, kalori: 420, protein: 20, karbohidrat: 52, lemak: 14 },
  { nama: "Pisang + yogurt", porsi: 250, kalori: 240, protein: 9, karbohidrat: 45, lemak: 4 }
];

export function aiMode() {
  if (CONFIG.gemini.backendUrl && store.mode === "firebase") return "backend";
  if (CONFIG.gemini.apiKey) return "direct";
  return "demo";
}

export function aiLabel() {
  const mode = aiMode();
  if (mode === "backend") return "AI via server";
  if (mode === "direct") return "Gemini langsung";
  return "Estimasi demo";
}

/**
 * Kompres & ubah file gambar menjadi JPEG base64 yang siap dikirim.
 */
export async function prepareImage(file, maxSize = 1024, quality = 0.82) {
  const bitmap = await loadBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  const scale = Math.min(1, maxSize / Math.max(width, height));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (typeof bitmap.close === "function") bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

  return {
    dataUrl,
    base64: dataUrl.split(",")[1],
    mimeType: "image/jpeg",
    blob
  };
}

async function loadBitmap(file) {
  if ("createImageBitmap" in window) {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Gagal membaca gambar."));
    };
    img.src = url;
  });
}

export async function analyzeFood(image) {
  const mode = aiMode();

  if (mode === "demo") {
    await sleep(1300);
    const base = DEMO_FOODS[Math.floor(Math.random() * DEMO_FOODS.length)];
    const factor = 0.85 + Math.random() * 0.3;
    return roundFood({
      nama: base.nama,
      porsi: base.porsi * factor,
      kalori: base.kalori * factor,
      protein: base.protein * factor,
      karbohidrat: base.karbohidrat * factor,
      lemak: base.lemak * factor
    });
  }

  if (mode === "backend") {
    const token = await store.getIdToken();
    if (!token) throw new Error("Sesi login habis. Silakan masuk ulang.");

    const response = await fetch(backendEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ imageBase64: image.base64, mimeType: image.mimeType })
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      throw new Error("Sesi login habis. Silakan masuk ulang.");
    }
    if (!response.ok) {
      throw new Error(data.error || `Server AI error (${response.status})`);
    }
    return coerceFood(data);
  }

  return geminiDirect(image);
}

function backendEndpoint() {
  const url = new URL(CONFIG.gemini.backendUrl);
  url.searchParams.set("v", "2");
  return url.toString();
}

async function geminiDirect(image) {
  const { apiKey, model } = CONFIG.gemini;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: image.mimeType, data: image.base64 } }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = error?.error?.message || `Gemini error (${response.status})`;
    throw new Error(message);
  }

  const data = await response.json();
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text)
    .filter(Boolean)
    .join("");

  const parsed = parseJson(text);
  if (!parsed) throw new Error("Respons AI tidak bisa dibaca. Coba lagi.");
  return coerceFood(parsed);
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

function coerceFood(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Respons AI tidak dikenali.");
  if (raw.error) throw new Error(raw.error);

  const nama = String(raw.nama ?? raw.makanan ?? raw.name ?? "").trim();
  const kalori = toNumber(raw.kalori ?? raw.calories);

  if (!nama || kalori <= 0) {
    throw new Error("AI tidak menemukan makanan pada foto. Coba foto lain atau input manual.");
  }

  return roundFood({
    nama,
    porsi: toNumber(raw.porsi ?? raw.porsi_gram ?? raw.portion),
    kalori,
    protein: toNumber(raw.protein),
    karbohidrat: toNumber(raw.karbohidrat ?? raw.carbs),
    lemak: toNumber(raw.lemak ?? raw.fat)
  });
}

function toNumber(value) {
  const parsed = parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundFood(food) {
  return {
    nama: food.nama,
    porsi: Math.round(food.porsi || 0),
    kalori: Math.round(food.kalori || 0),
    protein: Math.round((food.protein || 0) * 10) / 10,
    karbohidrat: Math.round((food.karbohidrat || 0) * 10) / 10,
    lemak: Math.round((food.lemak || 0) * 10) / 10
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
