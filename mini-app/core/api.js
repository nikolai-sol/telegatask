let API_BASE = "";
let INIT_DATA = "";

export function setApiContext(input) {
  API_BASE = String(input?.apiBase || "");
  INIT_DATA = String(input?.initData || "");
}

function buildUrl(path) {
  const p = String(path || "");
  if (/^https?:\/\//i.test(p)) return p;
  const base = String(API_BASE || "").replace(/\/$/, "");
  if (!base) return p;
  if (p.startsWith("/")) return `${base}${p}`;
  return `${base}/${p}`;
}

export async function apiFetch(path, opts = {}) {
  const url = buildUrl(path);
  const method = String(opts.method || "GET").toUpperCase();

  const headers = new Headers(opts.headers || {});
  if (INIT_DATA) headers.set("X-Telegram-Init-Data", INIT_DATA);

  let body = opts.body;
  if (body && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
    headers.set("Content-Type", headers.get("Content-Type") || "application/json");
    body = JSON.stringify(body);
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
  });

  const text = await res.text().catch(() => "");
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") && text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : (text || null);

  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && "error" in data && data.error) ? String(data.error) :
      (typeof data === "string" && data) ? data :
      `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

