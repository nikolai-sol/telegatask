import type { ZarukuSeoProductionConfig } from "../zarukuSeoProductionConfig";
import { buildSitemapSummary, emptySitemapSummary, type SitemapSummary } from "../zarukuWgdRunnerHelpers";
import { fetchText, type FetchText } from "./httpText";

export async function collectSitemapSummary(
  config: Pick<ZarukuSeoProductionConfig, "sitemapUrl" | "targetUrl">,
  fetchImpl: FetchText = fetchText
): Promise<SitemapSummary> {
  const sitemapUrl = config.sitemapUrl;
  try {
    const response = await fetchImpl(sitemapUrl);
    return buildSitemapSummary({
      sitemapUrl,
      status: response.status,
      xml: response.text,
      urlPrefix: config.targetUrl,
    });
  } catch {
    return emptySitemapSummary(sitemapUrl);
  }
}
