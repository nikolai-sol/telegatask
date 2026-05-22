import type { SeoCrawlerSnapshot } from "../types";
import { SeoProviderError } from "./seoDataProvider";

function includesNoindex(value: string): boolean {
  return /(^|[\s,;])noindex($|[\s,;])/i.test(value);
}

function readTagContent(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  if (!match) return null;
  return String(match[1] || "").trim() || null;
}

async function isReachable(url: string): Promise<boolean | null> {
  try {
    const response = await fetch(url, { redirect: "follow" });
    return response.ok;
  } catch {
    return null;
  }
}

export class BasicCrawlerSeoSource {
  async getSnapshot(domain: string): Promise<SeoCrawlerSnapshot> {
    const pageUrl = `https://${domain}/`;

    let response: Response;
    try {
      response = await fetch(pageUrl, { redirect: "follow" });
    } catch (err) {
      throw new SeoProviderError({
        category: "crawler_request_failed",
        safeMessage: "Crawler could not reach the homepage",
        statusCode: 503,
        internalCause: err,
      });
    }

    if (!response.ok && response.status >= 500) {
      throw new SeoProviderError({
        category: "crawler_http_error",
        safeMessage: "Crawler homepage request failed",
        statusCode: 503,
      });
    }

    let html = "";
    try {
      html = await response.text();
    } catch (err) {
      throw new SeoProviderError({
        category: "crawler_read_failed",
        safeMessage: "Crawler could not read the homepage response",
        statusCode: 503,
        internalCause: err,
      });
    }

    const title = readTagContent(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDescription = readTagContent(
      html,
      /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i
    );
    const h1 = readTagContent(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const canonical = readTagContent(
      html,
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([\s\S]*?)["'][^>]*>/i
    );
    const metaRobots = readTagContent(
      html,
      /<meta[^>]+name=["']robots["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i
    );
    const headerRobots = response.headers.get("x-robots-tag") || "";
    const isIndexable =
      response.status >= 200 && response.status < 400 ? !includesNoindex(`${metaRobots || ""},${headerRobots}`) : null;

    const [robotsTxtReachable, sitemapXmlReachable] = await Promise.all([
      isReachable(`https://${domain}/robots.txt`),
      isReachable(`https://${domain}/sitemap.xml`),
    ]);

    return {
      pageUrl,
      finalUrl: response.url || pageUrl,
      httpStatus: response.status,
      hasTitle: Boolean(title),
      hasMetaDescription: Boolean(metaDescription),
      hasH1: Boolean(h1),
      hasCanonical: Boolean(canonical),
      robotsTxtReachable,
      sitemapXmlReachable,
      isIndexable,
    };
  }
}
