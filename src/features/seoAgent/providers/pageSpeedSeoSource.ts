import type { SeoPageSpeedSnapshot } from "../types";
import { SeoProviderError } from "./seoDataProvider";

function cleanNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readCategoryScore(
  categories: Record<string, { score?: number } | undefined> | undefined,
  key: string
): number | null {
  const score = categories?.[key]?.score;
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return Math.round(score * 100);
}

export class PageSpeedSeoSource {
  async getSnapshot(domain: string): Promise<SeoPageSpeedSnapshot> {
    const pageUrl = `https://${domain}`;
    const apiKey = String(process.env.PAGESPEED_API_KEY || "").trim();
    const url = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    url.searchParams.set("url", pageUrl);
    url.searchParams.set("strategy", "mobile");
    url.searchParams.set("category", "performance");
    url.searchParams.append("category", "accessibility");
    url.searchParams.append("category", "best-practices");
    url.searchParams.append("category", "seo");
    if (apiKey) {
      url.searchParams.set("key", apiKey);
    }

    let response: Response;
    try {
      response = await fetch(url.toString());
    } catch (err) {
      throw new SeoProviderError({
        category: "pagespeed_request_failed",
        safeMessage: "PageSpeed Insights request failed",
        statusCode: 503,
        internalCause: err,
      });
    }

    if (!response.ok) {
      throw new SeoProviderError({
        category: "pagespeed_http_error",
        safeMessage:
          response.status === 429
            ? "PageSpeed Insights rate limit reached"
            : "PageSpeed Insights returned an unexpected response",
        statusCode: response.status >= 400 && response.status < 600 ? response.status : 503,
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      throw new SeoProviderError({
        category: "pagespeed_invalid_json",
        safeMessage: "PageSpeed Insights returned invalid data",
        statusCode: 503,
        internalCause: err,
      });
    }

    const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const lighthouse = data.lighthouseResult as Record<string, unknown> | undefined;
    const categories = lighthouse?.categories as Record<string, { score?: number } | undefined> | undefined;
    const audits = lighthouse?.audits as Record<string, Record<string, unknown> | undefined> | undefined;

    return {
      pageUrl,
      performanceScore: readCategoryScore(categories, "performance"),
      accessibilityScore: readCategoryScore(categories, "accessibility"),
      bestPracticesScore: readCategoryScore(categories, "best-practices"),
      seoScore: readCategoryScore(categories, "seo"),
      largestContentfulPaintMs: cleanNumber(audits?.["largest-contentful-paint"]?.numericValue),
      cumulativeLayoutShift: cleanNumber(audits?.["cumulative-layout-shift"]?.numericValue),
      interactionToNextPaintMs: cleanNumber(audits?.["interaction-to-next-paint"]?.numericValue),
      totalBlockingTimeMs: cleanNumber(audits?.["total-blocking-time"]?.numericValue),
    };
  }
}
