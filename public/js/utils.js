export function pad2(value) {
  return String(value).padStart(2, "0");
}

export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function num(value) {
  const parsed = parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function fmt(value) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Math.round(num(value)));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function timeToMinutes(value) {
  if (!value || !value.includes(":")) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

export function sleepHours(start, end) {
  const from = timeToMinutes(start);
  const to = timeToMinutes(end);
  if (from === null || to === null) return null;
  const total = to <= from ? to + 24 * 60 - from : to - from;
  return total / 60;
}

export function formatSleep(start, end) {
  const hours = sleepHours(start, end);
  if (hours === null) return "-";
  return `${hours.toFixed(1).replace(".0", "")} jam`;
}
