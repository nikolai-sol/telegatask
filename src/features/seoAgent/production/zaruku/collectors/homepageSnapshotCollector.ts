import type { ZarukuSeoProductionConfig } from "../zarukuSeoProductionConfig";
import { buildPageSnapshot, type PageSnapshot } from "../zarukuWgdRunnerHelpers";
import { fetchText, type FetchText } from "./httpText";

export async function collectHomepageSnapshot(
  config: Pick<ZarukuSeoProductionConfig, "targetUrl" | "domain">,
  fetchImpl: FetchText = fetchText
): Promise<PageSnapshot> {
  const response = await fetchImpl(config.targetUrl);
  return buildPageSnapshot({
    url: config.targetUrl,
    finalUrl: response.finalUrl,
    status: response.status,
    html: response.text,
    targetDomain: config.domain,
  });
}
