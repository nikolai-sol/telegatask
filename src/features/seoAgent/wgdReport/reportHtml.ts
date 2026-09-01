export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MAX_DISPLAY_URL_LENGTH = 2_048;

/** Normalize a URL for visible report facts without leaking credentials or URL-carried secrets. */
export function safeDisplayUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > MAX_DISPLAY_URL_LENGTH) return null;
  const candidate = raw.startsWith("//") ? `https:${raw}` : raw;
  if (!/^https?:\/\//i.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    const shown = url.toString();
    return shown.length <= MAX_DISPLAY_URL_LENGTH ? shown : null;
  } catch {
    return null;
  }
}

function stripUrlSecrets(value: string): string {
  return value.replace(/(?:https?:)?\/\/[^\s<>"']+/gi, (candidate) => safeDisplayUrl(candidate) || "");
}

/** Escape a visible normalized value and remove credentials and query secrets from URLs. */
export function htmlText(value: unknown): string {
  return escapeHtml(stripUrlSecrets(String(value ?? "")));
}

export function safeRelativeReportPath(value: unknown): string | null {
  if (value === "report.json" || value === "manual-query-pack.md") return value;
  if (typeof value !== "string"
    || !/^evidence\/[a-z0-9][a-z0-9._/-]*$/i.test(value)
    || value.includes("..")
    || value.includes("\\")) return null;
  return value;
}

export function safeAnchorHref(value: unknown): string {
  return typeof value === "string" && /^#[a-z][a-z0-9-]*$/.test(value)
    ? value
    : "#page-details";
}

export function relativeLink(path: unknown, label?: unknown): string {
  const safePath = safeRelativeReportPath(path);
  if (!safePath) return "";
  return `<a href="${escapeHtml(safePath)}">${htmlText(label ?? safePath)}</a>`;
}

export function scoreBand(score: number | null): "unknown" | "critical" | "risk" | "improve" | "good" {
  if (score === null || !Number.isFinite(score)) return "unknown";
  if (score <= 39) return "critical";
  if (score <= 59) return "risk";
  if (score <= 79) return "improve";
  return "good";
}

export function table(headers: readonly string[], rows: readonly (readonly unknown[])[], empty: string): string {
  if (!rows.length) return `<p class="empty">${htmlText(empty)}</p>`;
  return `<div class="table-scroll"><table><thead><tr>${headers
    .map((header) => `<th scope="col">${htmlText(header)}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${htmlText(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

export function details(
  id: string | null,
  summary: string,
  body: string,
  className?: string
): string {
  const idAttribute = id ? ` id="${escapeHtml(id)}"` : "";
  const classAttribute = className ? ` class="${escapeHtml(className)}"` : "";
  return `<details${idAttribute}${classAttribute}><summary>${htmlText(summary)}</summary><div class="detail-body">${body}</div></details>`;
}
