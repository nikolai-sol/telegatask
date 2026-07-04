export type PageSnapshot = {
  url: string;
  finalUrl: string;
  httpStatus: number | null;
  title: string | null;
  description: string | null;
  h1: string | null;
  canonical: string | null;
  wordCount: number;
  bodySample: string;
  internalLinks: string[];
};

export type SitemapSummary = {
  sitemapUrl: string;
  status: number | null;
  urlCount: number;
  sampledUrls: string[];
  sectionCounts: Array<{ section: string; count: number }>;
};

export type LighthouseSummary = {
  status: "success" | "failed";
  message: string;
  pageUrl: string;
  performanceScore: number | null;
  accessibilityScore: number | null;
  bestPracticesScore: number | null;
  seoScore: number | null;
  firstContentfulPaintMs: number | null;
  largestContentfulPaintMs: number | null;
  cumulativeLayoutShift: number | null;
  totalBlockingTimeMs: number | null;
  speedIndexMs: number | null;
  totalByteWeight: string | null;
};

export type YandexWebmasterQuery = {
  query: string;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  averagePosition: number | null;
};

export type YandexAiSource = {
  url: string;
  title: string;
  used: boolean;
};

export type YandexAiProbe = {
  channel: string;
  status: "checked" | "not_configured" | "permission_denied" | "failed";
  query: string;
  result: string;
  sources: string[];
  sourceDetails: YandexAiSource[];
  usedSources: string[];
  targetFound: boolean;
  targetUsed: boolean;
  sourcePosition: number | null;
  usedSourcePosition: number | null;
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function statusClass(status: string): string {
  if (status === "success") return "ok";
  if (status === "partial" || status === "skipped") return "warn";
  return "bad";
}

export function cleanNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readTagContent(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match ? String(match[1] || "").replace(/\s+/g, " ").trim() || null : null;
}

export function textFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAbsoluteUrl(href: string, baseUrl: string, targetDomain: string): string | null {
  try {
    const url = new URL(href, baseUrl);
    if (url.hostname.replace(/^www\./i, "") !== targetDomain) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function extractInternalLinks(html: string, baseUrl: string, targetDomain: string): string[] {
  const links = Array.from(html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi))
    .map((match) => normalizeAbsoluteUrl(String(match[1] || ""), baseUrl, targetDomain))
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(links)).slice(0, 120);
}

export function buildPageSnapshot(input: {
  url: string;
  finalUrl: string;
  status: number | null;
  html: string;
  targetDomain: string;
}): PageSnapshot {
  const bodyText = textFromHtml(input.html);
  return {
    url: input.url,
    finalUrl: input.finalUrl,
    httpStatus: input.status,
    title: readTagContent(input.html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    description: readTagContent(input.html, /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i),
    h1: readTagContent(input.html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
    canonical: readTagContent(input.html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([\s\S]*?)["'][^>]*>/i),
    wordCount: bodyText ? bodyText.split(/\s+/).length : 0,
    bodySample: bodyText.slice(0, 1200),
    internalLinks: extractInternalLinks(input.html, input.finalUrl, input.targetDomain),
  };
}

export function sectionForUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const first = url.pathname.split("/").filter(Boolean)[0] || "/";
    return first === "/" ? "/" : `/${first}/`;
  } catch {
    return "/";
  }
}

export function buildSitemapSummary(input: {
  sitemapUrl: string;
  status: number | null;
  xml: string;
  urlPrefix: string;
}): SitemapSummary {
  const urls = Array.from(input.xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi))
    .map((match) => String(match[1] || "").trim())
    .filter((url) => url.startsWith(input.urlPrefix));
  const bySection = new Map<string, number>();
  for (const url of urls) bySection.set(sectionForUrl(url), (bySection.get(sectionForUrl(url)) || 0) + 1);
  return {
    sitemapUrl: input.sitemapUrl,
    status: input.status,
    urlCount: urls.length,
    sampledUrls: urls.slice(0, 40),
    sectionCounts: Array.from(bySection.entries())
      .map(([section, count]) => ({ section, count }))
      .sort((a, b) => b.count - a.count || a.section.localeCompare(b.section))
      .slice(0, 20),
  };
}

export function emptySitemapSummary(sitemapUrl: string): SitemapSummary {
  return {
    sitemapUrl,
    status: null,
    urlCount: 0,
    sampledUrls: [],
    sectionCounts: [],
  };
}

export function readLighthouseScore(categories: Record<string, { score?: number } | undefined>, key: string): number | null {
  const score = categories[key]?.score;
  return typeof score === "number" && Number.isFinite(score) ? Math.round(score * 100) : null;
}

export function extractGenSearchSourceDetails(payload: Record<string, unknown>): YandexAiSource[] {
  const first = Array.isArray(payload.items) ? payload.items[0] : null;
  const data = first && typeof first === "object" ? (first as Record<string, unknown>) : payload;
  const rawSources = Array.isArray(data.sources) ? data.sources : [];
  return rawSources
    .map((item) => {
      const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        url: cleanString(source.url) || cleanString(source.sourceUrl),
        title: cleanString(source.title),
        used: Boolean(source.used),
      };
    })
    .filter((source) => source.url || source.title)
    .slice(0, 8);
}

export function sourceMatchesTarget(source: YandexAiSource, targetDomain: string): boolean {
  const value = source.url || source.title;
  try {
    return new URL(value).hostname.replace(/^www\./i, "") === targetDomain;
  } catch {
    return value.includes(targetDomain);
  }
}

export function aiTargetPosition(sourceDetails: YandexAiSource[], usedOnly: boolean, targetDomain: string): number | null {
  const candidates = usedOnly ? sourceDetails.filter((source) => source.used) : sourceDetails;
  const index = candidates.findIndex((source) => sourceMatchesTarget(source, targetDomain));
  return index >= 0 ? index + 1 : null;
}

export function extractGenSearchAnswer(payload: Record<string, unknown>): string {
  const first = Array.isArray(payload.items) ? payload.items[0] : null;
  const data = first && typeof first === "object" ? (first as Record<string, unknown>) : payload;
  const direct = cleanString(data.answer);
  if (direct) return direct;
  const message = data.message && typeof data.message === "object" ? (data.message as Record<string, unknown>) : {};
  const content = cleanString(message.content);
  if (content) return content;
  return JSON.stringify(data).slice(0, 1200);
}

export function renderRows<T>(items: T[], render: (item: T) => string): string {
  return items.map(render).join("");
}
